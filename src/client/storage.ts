import { sourceKey, sourceFields } from '../shared/annotation-source.ts'
import { createAnnotationId, submissionMessageId } from '../shared/ids.ts'
import {
  parseAnnotationAnchor,
  parseAnnotationQuote,
  parseProcessingMode,
  parseStructuredSelection,
  parseSubmissionPayload,
  parseSubmittedAnnotation,
} from '../shared/protocol.ts'
import type {
  AnnotationDraft,
  AnnotationTrashEntry,
  AnnotationDeletionMark,
  AnnotationDeletionId,
  AnnotationSelectionCapture,
  AnnotationStatus,
  OutboxEntry,
  OutboxAttachments,
  OutboxImages,
  OutboxStatus,
  PersistedEditorDraft,
  PersistedSessionState,
  SessionIdentity,
  SubmissionId,
  AnnotationId,
} from '../shared/types.ts'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  readonly length?: number
  key?(index: number): string | null
}

/** Browser lock and key enumeration supplied by the Client entry point. */
export interface StorageCoordination {
  keys(): readonly string[]
  runExclusive?(name: string, task: () => void, signal: AbortSignal): Promise<void>
}

const PREFIX = 'dsh-annotation:v1:'
/** Pre-rename keys read only to migrate their state into the new namespace. */
const LEGACY_PREFIXES = ['dsh-inline-comments:v1:', 'dsh-inline-annotations:v1:'] as const
const ANNOTATION_STATUSES: readonly AnnotationStatus[] = ['draft', 'queued', 'sent', 'processed']
const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  'ready',
  'sending',
  'accepted',
  'queued',
  'sent',
  'failed',
  'withdrawn',
]

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function needsEditorIds(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return [source.editorDraft, ...(Array.isArray(source.editorDrafts) ? source.editorDrafts : [])].some(
    (candidate: unknown) => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
      const editor = candidate as Record<string, unknown>
      return editor.kind === 'new' && editor.draftId === undefined
    },
  )
}

export function emptyPersistedState(): PersistedSessionState {
  return Object.freeze({
    storageVersion: 6,
    annotations: Object.freeze([]),
    outbox: Object.freeze([]),
    overallRequirementDraft: '',
  })
}

function parseAnnotation(value: unknown, index: number): AnnotationDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('annotation must be an object')
  const source = value as Record<string, unknown>
  const submitted = parseSubmittedAnnotation(source, index)
  if (!ANNOTATION_STATUSES.includes(source.status as AnnotationStatus))
    throw new Error('invalid annotation status')
  if (!Number.isSafeInteger(source.updatedAt) || (source.updatedAt as number) < submitted.createdAt) {
    throw new Error('invalid annotation updatedAt')
  }
  if (source.submissionId !== undefined && typeof source.submissionId !== 'string')
    throw new Error('invalid submissionId')
  if (source.supplementalTo !== undefined && typeof source.supplementalTo !== 'string')
    throw new Error('invalid supplementalTo')
  if (source.blockIndex !== undefined && !Number.isSafeInteger(source.blockIndex))
    throw new Error('invalid blockIndex')
  return Object.freeze({
    ...submitted,
    status: source.status as AnnotationStatus,
    updatedAt: source.updatedAt as number,
    ...(source.blockIndex === undefined ? {} : { blockIndex: source.blockIndex as number }),
    ...(source.submissionId === undefined ? {} : { submissionId: source.submissionId as SubmissionId }),
    ...(source.supplementalTo === undefined ? {} : { supplementalTo: source.supplementalTo as AnnotationId }),
  })
}

function parseOutboxImages(value: unknown): OutboxImages | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('outbox images must be an object')
  const source = value as Record<string, unknown>
  if (!Number.isSafeInteger(source.count) || (source.count as number) < 1)
    throw new Error('invalid outbox image count')
  if (!Array.isArray(source.mediaTypes) || !source.mediaTypes.every((item) => typeof item === 'string'))
    throw new Error('invalid outbox image media types')
  if (!Array.isArray(source.names) || !source.names.every((item) => typeof item === 'string'))
    throw new Error('invalid outbox image names')
  return Object.freeze({
    count: source.count as number,
    mediaTypes: Object.freeze(source.mediaTypes as string[]),
    names: Object.freeze(source.names as string[]),
  })
}

function parseOutboxAttachments(value: unknown): OutboxAttachments | undefined {
  const metadata = parseOutboxImages(value)
  if (metadata === undefined) return undefined
  const source = value as Record<string, unknown>
  if (
    !Array.isArray(source.kinds) ||
    source.kinds.length !== metadata.count ||
    !source.kinds.every((kind) => kind === 'image' || kind === 'file')
  ) {
    throw new Error('invalid outbox attachment kinds')
  }
  return Object.freeze({
    ...metadata,
    kinds: Object.freeze(source.kinds as ('image' | 'file')[]),
  })
}

function parseOutbox(value: unknown, recoverInterrupted = true): OutboxEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('outbox entry must be an object')
  const source = value as Record<string, unknown>
  const payload = parseSubmissionPayload(source.payload)
  if (typeof source.targetSessionId !== 'string' || typeof source.messageId !== 'string')
    throw new Error('invalid outbox identity')
  if (source.targetSessionId !== payload.sessionId)
    throw new Error('outbox target does not match payload session')
  if (source.messageId !== submissionMessageId(payload.submissionId)) {
    throw new Error('outbox message id does not match submission id')
  }
  if (!OUTBOX_STATUSES.includes(source.status as OutboxStatus)) throw new Error('invalid outbox status')
  if (!Number.isSafeInteger(source.attempts) || (source.attempts as number) < 0)
    throw new Error('invalid attempts')
  if (source.lastError !== undefined && typeof source.lastError !== 'string')
    throw new Error('invalid lastError')
  const images = parseOutboxImages(source.images)
  const attachments = parseOutboxAttachments(source.attachments)
  if (payload.attachmentIdentities !== undefined) {
    const count = attachments?.count ?? images?.count ?? 0
    if (
      payload.attachmentIdentities.length !== count ||
      payload.attachmentIdentities.some((item, index) => item.type !== (attachments?.kinds[index] ?? 'image'))
    )
      throw new Error('outbox attachment identities do not match metadata')
  }
  const interrupted = recoverInterrupted && (source.status === 'sending' || source.status === 'accepted')
  return Object.freeze({
    payload,
    targetSessionId: source.targetSessionId as SessionIdentity,
    messageId: source.messageId as OutboxEntry['messageId'],
    status: interrupted ? 'failed' : (source.status as OutboxStatus),
    attempts: source.attempts as number,
    ...(images === undefined ? {} : { images }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(interrupted
      ? { lastError: 'Submission outcome was not observed; retry with the same submission id.' }
      : source.lastError === undefined
        ? {}
        : { lastError: source.lastError }),
  })
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function persistedId<T extends string>(value: unknown, field: string): T {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new Error(`${field} must be a non-blank id`)
  }
  return value as T
}

function parseCapture(value: unknown, field: string): AnnotationSelectionCapture {
  const source = object(value, field)
  const anchor = parseAnnotationAnchor(source)
  const rectSource = object(source.rect, `${field}.rect`)
  const coordinates = ['top', 'left', 'bottom', 'right'] as const
  if (coordinates.some((coordinate) => !Number.isFinite(rectSource[coordinate]))) {
    throw new Error(`${field}.rect must contain finite coordinates`)
  }
  const parsedStructure = parseStructuredSelection(source.structure, `${field}.structure`)
  if (anchor.source?.kind === 'diff' && parsedStructure !== undefined)
    throw new Error('Diff captures cannot use message-fragment coordinates')
  if (source.blockIndex !== undefined && !Number.isSafeInteger(source.blockIndex)) {
    throw new Error(`${field}.blockIndex must be a safe integer`)
  }
  return Object.freeze({
    ...sourceFields(anchor),
    ...(source.blockIndex === undefined ? {} : { blockIndex: source.blockIndex as number }),
    quote: parseAnnotationQuote(source.quote, anchor),
    ...(parsedStructure === undefined ? {} : { structure: parsedStructure }),
    rect: Object.freeze({
      top: rectSource.top as number,
      left: rectSource.left as number,
      bottom: rectSource.bottom as number,
      right: rectSource.right as number,
    }),
  })
}

function parseEditorDraft(value: unknown): PersistedEditorDraft | undefined {
  if (value === undefined) return undefined
  const source = object(value, 'editorDraft')
  if (typeof source.text !== 'string') throw new Error('editorDraft.text must be a string')
  if (source.kind === 'new') {
    if (typeof source.longSelectionConfirmed !== 'boolean') {
      throw new Error('editorDraft.longSelectionConfirmed must be a boolean')
    }
    const supplementalTo =
      source.supplementalTo === undefined
        ? undefined
        : persistedId<AnnotationId>(source.supplementalTo, 'editorDraft.supplementalTo')
    return Object.freeze({
      kind: 'new',
      draftId:
        source.draftId === undefined
          ? createAnnotationId()
          : persistedId<AnnotationId>(source.draftId, 'editorDraft.draftId'),
      capture: parseCapture(source.capture, 'editorDraft.capture'),
      text: source.text,
      longSelectionConfirmed: source.longSelectionConfirmed,
      ...(supplementalTo === undefined ? {} : { supplementalTo }),
    })
  }
  if (source.kind === 'edit') {
    if (source.supplement !== undefined && typeof source.supplement !== 'boolean')
      throw new Error('invalid editor supplement flag')
    if (source.longSelectionConfirmed !== undefined && typeof source.longSelectionConfirmed !== 'boolean')
      throw new Error('invalid long-selection decision')
    const expandedCapture =
      source.expandedCapture === undefined
        ? undefined
        : parseCapture(source.expandedCapture, 'editorDraft.expandedCapture')
    return Object.freeze({
      kind: 'edit',
      annotationId: persistedId<AnnotationId>(source.annotationId, 'editorDraft.annotationId'),
      text: source.text,
      ...(expandedCapture === undefined ? {} : { expandedCapture }),
      ...(source.supplement === undefined ? {} : { supplement: source.supplement }),
      ...(source.longSelectionConfirmed === undefined
        ? {}
        : { longSelectionConfirmed: source.longSelectionConfirmed }),
    })
  }
  throw new Error('editorDraft.kind must be new or edit')
}

function duplicateIds<T>(ids: readonly T[]): Set<T> {
  const seen = new Set<T>()
  const duplicates = new Set<T>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return duplicates
}

function parseDeletionMark(value: unknown): AnnotationDeletionMark {
  const source = object(value, 'deletion mark')
  if (source.state !== 'trashed' && source.state !== 'restored' && source.state !== 'purged')
    throw new Error('invalid annotation deletion state')
  if (!Number.isSafeInteger(source.revision) || (source.revision as number) < 1)
    throw new Error('invalid annotation deletion revision')
  if (!Number.isSafeInteger(source.updatedAt) || (source.updatedAt as number) < 0)
    throw new Error('invalid annotation deletion time')
  return Object.freeze({
    annotationId: persistedId<AnnotationId>(source.annotationId, 'deletion annotationId'),
    deletionId: persistedId<AnnotationDeletionId>(source.deletionId, 'deletion id'),
    revision: source.revision as number,
    state: source.state,
    updatedAt: source.updatedAt as number,
  })
}

function parseTrashEntry(value: unknown, index: number): AnnotationTrashEntry {
  const source = object(value, 'trash entry')
  const annotation = parseAnnotation(source.annotation, index)
  if (!Number.isSafeInteger(source.deletedAt) || (source.deletedAt as number) < annotation.createdAt)
    throw new Error('invalid annotation deletion time')
  if (!Array.isArray(source.editorDrafts)) throw new Error('invalid trash editor drafts')
  const editorDrafts = source.editorDrafts.map((value) => {
    const editor = parseEditorDraft(value)
    if (editor === undefined || editor.kind !== 'edit' || editor.annotationId !== annotation.annotationId)
      throw new Error('invalid trash editor target')
    return editor
  })
  return Object.freeze({
    annotation,
    deletedAt: source.deletedAt as number,
    deletionId: persistedId<AnnotationDeletionId>(source.deletionId, 'trash deletion id'),
    editorDrafts: Object.freeze(editorDrafts),
  })
}

function parseState(
  value: unknown,
  recoverInterrupted = true,
): { state: PersistedSessionState; error: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('state must be an object')
  const source = value as Record<string, unknown>
  const version = source.storageVersion
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6)
    throw new Error('unsupported storage state')
  const errors: string[] = []
  const rows = (candidate: unknown, field: string): unknown[] => {
    if (Array.isArray(candidate)) return candidate
    errors.push(`invalid ${field} array`)
    return []
  }
  const recover = <T>(items: unknown[], parse: (item: unknown, index: number) => T): T[] => {
    const recovered: T[] = []
    items.forEach((item, index) => {
      try {
        recovered.push(parse(item, index))
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    })
    return recovered
  }
  const deletionMarks = recover(
    source.deletionMarks === undefined ? [] : rows(source.deletionMarks, 'deletionMarks'),
    parseDeletionMark,
  )
  const marks = new Map(deletionMarks.map((mark) => [mark.annotationId, mark]))
  if (marks.size !== deletionMarks.length) errors.push('duplicate annotation deletion marks')
  const trash = recover(
    source.trash === undefined ? [] : rows(source.trash, 'trash'),
    parseTrashEntry,
  ).filter((entry) => {
    const mark = marks.get(entry.annotation.annotationId)
    if (mark?.state === 'trashed' && mark.deletionId === entry.deletionId) return true
    errors.push('trash entry is missing its deletion mark')
    return false
  })
  if (new Set(trash.map((entry) => entry.annotation.annotationId)).size !== trash.length)
    errors.push('duplicate trash annotation ids')
  for (const mark of deletionMarks) {
    if (
      mark.state === 'trashed' &&
      !trash.some((entry) => entry.annotation.annotationId === mark.annotationId)
    )
      errors.push('trashed annotation is missing its saved content')
  }
  const annotationRows = recover(rows(source.annotations, 'annotations'), (item, index) => {
    const annotation = parseAnnotation(item, index)
    if (annotation.status !== 'draft' && annotation.submissionId === undefined)
      throw new Error('submitted annotation is missing its submission id')
    return annotation
  })
  const duplicateAnnotationIds = duplicateIds(annotationRows.map((item) => item.annotationId))
  if (duplicateAnnotationIds.size > 0) errors.push('persisted annotation ids must be unique')
  const annotations = annotationRows.filter(
    (item) =>
      !duplicateAnnotationIds.has(item.annotationId) &&
      (marks.get(item.annotationId) === undefined || marks.get(item.annotationId)?.state === 'restored'),
  )
  const outboxRows = recover(rows(source.outbox, 'outbox'), (item) => parseOutbox(item, recoverInterrupted))
  const duplicateSubmissionIds = duplicateIds(outboxRows.map((item) => item.payload.submissionId))
  if (duplicateSubmissionIds.size > 0) errors.push('persisted outbox submission ids must be unique')
  const outbox = outboxRows.filter((item) => !duplicateSubmissionIds.has(item.payload.submissionId))
  let overallRequirementDraft = ''
  if (typeof source.overallRequirementDraft === 'string') {
    overallRequirementDraft = source.overallRequirementDraft
  } else {
    errors.push('invalid overall requirement draft')
  }
  const validEditor = (candidate: PersistedEditorDraft | undefined): candidate is PersistedEditorDraft => {
    if (candidate === undefined) return false
    if (candidate.kind === 'new')
      return (
        !annotations.some((item) => item.annotationId === candidate.draftId) &&
        candidate.draftId !== candidate.supplementalTo
      )
    const target = annotations.find(
      (item) => item.annotationId === candidate.annotationId && item.status === 'draft',
    )
    return (
      target !== undefined &&
      (candidate.expandedCapture === undefined || sourceKey(candidate.expandedCapture) === sourceKey(target))
    )
  }
  const parseRecoverableEditor = (candidate: unknown): PersistedEditorDraft | undefined => {
    try {
      const parsed = parseEditorDraft(candidate)
      if (parsed !== undefined && !validEditor(parsed)) throw new Error('invalid editorDraft target')
      return parsed
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
  const editorDraft = version !== 1 ? parseRecoverableEditor(source.editorDraft) : undefined
  if (source.editorDrafts !== undefined && !Array.isArray(source.editorDrafts))
    errors.push('invalid suspended editor drafts')
  const editorKey = (editor: PersistedEditorDraft) =>
    editor.kind === 'edit' ? `edit:${editor.annotationId}` : `new:${editor.draftId}`
  const editorKeys = new Set(editorDraft === undefined ? [] : [editorKey(editorDraft)])
  const editorDrafts = (Array.isArray(source.editorDrafts) ? source.editorDrafts : [])
    .map(parseRecoverableEditor)
    .filter((editor): editor is PersistedEditorDraft => editor !== undefined)
    .filter((editor) => {
      const key = editorKey(editor)
      if (editorKeys.has(key)) {
        errors.push('duplicate editorDraft key')
        return false
      }
      editorKeys.add(key)
      return true
    })
  const selectionMode = source.selectionMode
  if (selectionMode !== undefined && selectionMode !== 'all' && selectionMode !== 'individual')
    errors.push('invalid annotation selection mode')
  if (source.selectedAnnotationIds !== undefined && !Array.isArray(source.selectedAnnotationIds))
    errors.push('invalid selected annotation ids')
  const attachableIds = new Set(
    annotations
      .filter((item) => item.status === 'draft' || item.status === 'sent' || item.status === 'processed')
      .map((item) => item.annotationId),
  )
  const selectedAnnotationIds = [
    ...new Set(
      (Array.isArray(source.selectedAnnotationIds) ? source.selectedAnnotationIds : [])
        .map((id) => {
          try {
            return persistedId<AnnotationId>(id, 'selectedAnnotationIds')
          } catch (error: unknown) {
            errors.push(error instanceof Error ? error.message : String(error))
            return null
          }
        })
        .filter((id): id is AnnotationId => id !== null)
        .filter((id) => attachableIds.has(id)),
    ),
  ]
  let processingMode: PersistedSessionState['processingMode']
  try {
    processingMode = parseProcessingMode(source.processingMode)
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  let retryId: SubmissionId | null | undefined
  try {
    retryId =
      source.retrySubmissionId === undefined || source.retrySubmissionId === null
        ? source.retrySubmissionId
        : persistedId<SubmissionId>(source.retrySubmissionId, 'retrySubmissionId')
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const retrySubmissionId =
    retryId === undefined
      ? undefined
      : outbox.some(
            (entry) =>
              entry.payload.submissionId === retryId &&
              (entry.status === 'ready' ||
                entry.status === 'failed' ||
                (!recoverInterrupted && entry.status === 'sending')),
          )
        ? retryId
        : null
  const state = Object.freeze({
    storageVersion: 6,
    ...(source.trash === undefined ? {} : { trash: Object.freeze(trash) }),
    ...(source.deletionMarks === undefined ? {} : { deletionMarks: Object.freeze(deletionMarks) }),
    annotations: Object.freeze(annotations),
    outbox: Object.freeze(outbox),
    overallRequirementDraft,
    ...(editorDraft === undefined ? {} : { editorDraft }),
    ...(source.editorDrafts === undefined ? {} : { editorDrafts: Object.freeze(editorDrafts) }),
    ...(selectionMode !== 'all' && selectionMode !== 'individual' ? {} : { selectionMode }),
    ...(source.selectedAnnotationIds === undefined
      ? {}
      : { selectedAnnotationIds: Object.freeze(selectedAnnotationIds) }),
    ...(source.processingMode === undefined || processingMode === undefined ? {} : { processingMode }),
    ...(retrySubmissionId === undefined ? {} : { retrySubmissionId }),
  }) satisfies PersistedSessionState
  return { state, error: errors.length === 0 ? null : errors.join('; ') }
}

type RecordChange<T> = { readonly id: string; readonly before: T | null; readonly after: T | null }
type ValueChange<T> = { readonly before: T; readonly after: T }
type StoredEditor = NonNullable<PersistedSessionState['editorDraft']>

interface StorageJournal {
  readonly id: string
  readonly previousId: string | null
  readonly dependencies: readonly string[]
  readonly annotations: readonly RecordChange<AnnotationDraft>[]
  readonly trash: readonly RecordChange<AnnotationTrashEntry>[]
  readonly deletionMarks: readonly RecordChange<AnnotationDeletionMark>[]
  readonly observedDeletionMarks: readonly AnnotationDeletionMark[]
  readonly outbox: readonly RecordChange<OutboxEntry>[]
  readonly editors: readonly RecordChange<StoredEditor>[]
  readonly editorTargets: readonly AnnotationDraft[]
  readonly activeEditor: ValueChange<string | null> | null
  readonly overallRequirementDraft: ValueChange<string> | null
  readonly selectionMode: ValueChange<PersistedSessionState['selectionMode'] | null> | null
  readonly selectedAnnotationIds: ValueChange<readonly AnnotationId[] | null> | null
  readonly processingMode: ValueChange<PersistedSessionState['processingMode'] | null> | null
  readonly retrySubmissionId: ValueChange<SubmissionId | null> | null
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function samePersistedReferences(left: PersistedSessionState, right: PersistedSessionState): boolean {
  return (
    left.storageVersion === right.storageVersion &&
    left.annotations === right.annotations &&
    left.trash === right.trash &&
    left.deletionMarks === right.deletionMarks &&
    left.outbox === right.outbox &&
    left.overallRequirementDraft === right.overallRequirementDraft &&
    left.editorDraft === right.editorDraft &&
    left.editorDrafts === right.editorDrafts &&
    left.selectionMode === right.selectionMode &&
    left.selectedAnnotationIds === right.selectedAnnotationIds &&
    left.processingMode === right.processingMode &&
    left.retrySubmissionId === right.retrySubmissionId
  )
}

function recordChanges<T>(
  before: readonly T[],
  after: readonly T[],
  identity: (value: T) => string,
): RecordChange<T>[] {
  const old = new Map(before.map((value) => [identity(value), value]))
  const next = new Map(after.map((value) => [identity(value), value]))
  const changes: RecordChange<T>[] = []
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const previous = old.get(id) ?? null
    const current = next.get(id) ?? null
    if (!sameValue(previous, current)) changes.push({ id, before: previous, after: current })
  }
  return changes
}

function editors(state: PersistedSessionState): readonly StoredEditor[] {
  return [...(state.editorDraft === undefined ? [] : [state.editorDraft]), ...(state.editorDrafts ?? [])]
}

function editorKey(editor: StoredEditor): string {
  return editor.kind === 'edit' ? `edit:${editor.annotationId}` : `new:${editor.draftId}`
}

function changed<T>(before: T, after: T): ValueChange<T> | null {
  return sameValue(before, after) ? null : { before, after }
}

function makeJournal(
  id: string,
  previousId: string | null,
  before: PersistedSessionState,
  after: PersistedSessionState,
  dependencies: readonly string[],
): StorageJournal {
  const editorTargets = new Map<AnnotationId, AnnotationDraft>()
  for (const editor of editors(after)) {
    if (editor.kind !== 'edit') continue
    const target = [...before.annotations, ...after.annotations].find(
      (item) => item.annotationId === editor.annotationId && item.status === 'draft',
    )
    if (target !== undefined) editorTargets.set(target.annotationId, target)
  }
  return {
    id,
    previousId,
    dependencies,
    annotations: recordChanges(before.annotations, after.annotations, (item) => item.annotationId),
    trash: recordChanges(before.trash ?? [], after.trash ?? [], (item) => item.annotation.annotationId),
    deletionMarks: recordChanges(
      before.deletionMarks ?? [],
      after.deletionMarks ?? [],
      (item) => item.annotationId,
    ),
    observedDeletionMarks: before.deletionMarks ?? [],
    outbox: recordChanges(before.outbox, after.outbox, (item) => item.payload.submissionId),
    editors: recordChanges(editors(before), editors(after), editorKey),
    editorTargets: [...editorTargets.values()],
    activeEditor: changed(
      before.editorDraft === undefined ? null : editorKey(before.editorDraft),
      after.editorDraft === undefined ? null : editorKey(after.editorDraft),
    ),
    overallRequirementDraft: changed(before.overallRequirementDraft, after.overallRequirementDraft),
    selectionMode: changed(before.selectionMode ?? null, after.selectionMode ?? null),
    selectedAnnotationIds: changed(before.selectedAnnotationIds ?? null, after.selectedAnnotationIds ?? null),
    processingMode: changed(before.processingMode ?? null, after.processingMode ?? null),
    retrySubmissionId: changed(before.retrySubmissionId ?? null, after.retrySubmissionId ?? null),
  }
}

function journalHasChanges(journal: StorageJournal): boolean {
  return (
    journal.annotations.length > 0 ||
    journal.trash.length > 0 ||
    journal.deletionMarks.length > 0 ||
    journal.outbox.length > 0 ||
    journal.editors.length > 0 ||
    journal.activeEditor !== null ||
    journal.overallRequirementDraft !== null ||
    journal.selectionMode !== null ||
    journal.selectedAnnotationIds !== null ||
    journal.processingMode !== null ||
    journal.retrySubmissionId !== null
  )
}

function parseJournal(raw: string): StorageJournal {
  const source = object(JSON.parse(raw), 'journal')
  if (source.version !== 1 && source.version !== 2) throw new Error('unsupported storage journal')
  const id = persistedId<string>(source.id, 'journal.id')
  const previousId =
    source.previousId === null ? null : persistedId<string>(source.previousId, 'journal.previousId')
  const changes = <T>(value: unknown, field: string, parse: (value: unknown, index: number) => T) => {
    if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
    return value.map((item, index) => {
      const row = object(item, field)
      return {
        id: persistedId<string>(row.id, `${field}.id`),
        before: row.before === null ? null : parse(row.before, index),
        after: row.after === null ? null : parse(row.after, index),
      } satisfies RecordChange<T>
    })
  }
  const valueChange = <T>(value: unknown, field: string, parse: (candidate: unknown) => T) => {
    if (value === null) return null
    const row = object(value, field)
    return { before: parse(row.before), after: parse(row.after) } satisfies ValueChange<T>
  }
  const optionalMode = (value: unknown) => {
    if (value === null) return null
    if (value !== 'all' && value !== 'individual') throw new Error('invalid journal selection mode')
    return value
  }
  const optionalProcessing = (value: unknown) => (value === null ? null : parseProcessingMode(value))
  const optionalRetry = (value: unknown) =>
    value === null ? null : persistedId<SubmissionId>(value, 'journal.retrySubmissionId')
  const selected = (value: unknown) => {
    if (value === null) return null
    if (!Array.isArray(value)) throw new Error('invalid journal selected ids')
    return value.map((item) => persistedId<AnnotationId>(item, 'journal.selectedAnnotationIds'))
  }
  const parseStoredEditor = (value: unknown): StoredEditor => {
    const editor = parseEditorDraft(value)
    if (editor === undefined) throw new Error('missing journal editor')
    return editor
  }
  if (!Array.isArray(source.editorTargets)) throw new Error('journal.editorTargets must be an array')
  return {
    id,
    previousId,
    dependencies: (() => {
      if (source.dependencies === undefined) return []
      if (!Array.isArray(source.dependencies)) throw new Error('invalid journal dependencies')
      return source.dependencies.map((value) => persistedId<string>(value, 'journal dependency'))
    })(),
    annotations: changes(source.annotations, 'journal.annotations', parseAnnotation),
    trash: changes(source.trash ?? [], 'journal.trash', parseTrashEntry),
    deletionMarks: changes(source.deletionMarks ?? [], 'journal.deletionMarks', parseDeletionMark),
    observedDeletionMarks: (() => {
      if (source.observedDeletionMarks === undefined) return []
      if (!Array.isArray(source.observedDeletionMarks)) throw new Error('invalid observed deletion marks')
      return source.observedDeletionMarks.map(parseDeletionMark)
    })(),
    outbox: changes(source.outbox, 'journal.outbox', (value) => parseOutbox(value, false)),
    editors: changes(source.editors, 'journal.editors', parseStoredEditor),
    editorTargets: source.editorTargets.map((value, index) => parseAnnotation(value, index)),
    activeEditor: valueChange(source.activeEditor, 'journal.activeEditor', (value) =>
      value === null ? null : persistedId<string>(value, 'journal.activeEditor'),
    ),
    overallRequirementDraft: valueChange(
      source.overallRequirementDraft,
      'journal.overallRequirementDraft',
      (value) => {
        if (typeof value !== 'string') throw new Error('invalid journal overall draft')
        return value
      },
    ),
    selectionMode: valueChange(source.selectionMode, 'journal.selectionMode', optionalMode),
    selectedAnnotationIds: valueChange(
      source.selectedAnnotationIds,
      'journal.selectedAnnotationIds',
      selected,
    ),
    processingMode: valueChange(source.processingMode, 'journal.processingMode', optionalProcessing),
    retrySubmissionId: valueChange(source.retrySubmissionId, 'journal.retrySubmissionId', optionalRetry),
  }
}

function orderedJournals(entries: readonly StorageJournal[]): StorageJournal[] {
  const remaining = new Map(entries.map((entry) => [entry.id, entry]))
  if (remaining.size !== entries.length) throw new Error('duplicate storage journal id')
  const ordered: StorageJournal[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter(
        (entry) =>
          (entry.previousId === null || !remaining.has(entry.previousId)) &&
          entry.dependencies.every((dependency) => !remaining.has(dependency)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    if (ready === undefined) throw new Error('cyclic storage journal')
    ordered.push(ready)
    remaining.delete(ready.id)
  }
  return ordered
}

function conflictAnnotation(annotation: AnnotationDraft, conflictId: string): AnnotationDraft {
  const { submissionId: _submissionId, ...draft } = annotation
  return Object.freeze({
    ...draft,
    annotationId: conflictId as AnnotationId,
    status: 'draft' as const,
  })
}

function outboxPriority(entry: OutboxEntry): number {
  const status = { ready: 0, sending: 1, failed: 2, queued: 3, withdrawn: 4, accepted: 5, sent: 6 }
  return status[entry.status]
}

function preferredOutbox(current: OutboxEntry, incoming: OutboxEntry): OutboxEntry {
  if (!sameValue(current.payload, incoming.payload)) throw new Error('conflicting frozen submission payload')
  if (current.status === 'sent') return current
  if (incoming.status === 'sent') return incoming
  if (incoming.attempts !== current.attempts) return incoming.attempts > current.attempts ? incoming : current
  return outboxPriority(incoming) > outboxPriority(current) ? incoming : current
}

function mergedOverallRequirement(current: string, change: ValueChange<string> | null): string {
  if (change === null || current === change.after) return current
  if (current === change.before || current === '') return change.after
  if (change.after === '') return current
  throw new Error('conflicting unfinished overall requirement')
}

function applyJournal(state: PersistedSessionState, journal: StorageJournal): PersistedSessionState {
  const annotations = new Map(state.annotations.map((item) => [item.annotationId, item]))
  const deletedTargets = new Map<AnnotationId, AnnotationDraft>()
  const marks = new Map((state.deletionMarks ?? []).map((mark) => [mark.annotationId, mark]))
  const trash = new Map((state.trash ?? []).map((entry) => [entry.annotation.annotationId, entry]))
  const observed = new Map(journal.observedDeletionMarks.map((mark) => [mark.annotationId, mark]))
  for (const change of journal.deletionMarks) {
    const next = change.after
    if (
      next === null ||
      next.annotationId !== change.id ||
      (change.before !== null && change.before.annotationId !== change.id)
    )
      throw new Error('invalid deletion mark journal')
    const current = marks.get(next.annotationId)
    const rank = { restored: 0, trashed: 1, purged: 2 }
    if (
      current === undefined ||
      (current.state !== 'purged' &&
        ((next.state === 'purged' && next.deletionId === current.deletionId) ||
          next.revision > current.revision ||
          (next.revision === current.revision &&
            (rank[next.state] > rank[current.state] ||
              (rank[next.state] === rank[current.state] && next.deletionId > current.deletionId)))))
    )
      marks.set(next.annotationId, next)
    observed.set(next.annotationId, next)
  }
  const isDeleted = (id: AnnotationId) => {
    const mark = marks.get(id)
    return mark !== undefined && mark.state !== 'restored'
  }
  const staleLifecycle = (id: AnnotationId) => !sameValue(marks.get(id) ?? null, observed.get(id) ?? null)
  for (const change of journal.trash) {
    if (
      (change.after !== null && change.after.annotation.annotationId !== change.id) ||
      (change.before !== null && change.before.annotation.annotationId !== change.id)
    )
      throw new Error('trash journal annotation id mismatch')
    const id = change.id as AnnotationId
    const mark = marks.get(id)
    if (mark?.state !== 'trashed') {
      trash.delete(id)
      continue
    }
    if (change.after?.deletionId === mark.deletionId) {
      const previous = trash.get(id)
      const next = change.after
      const statuses = { draft: 0, queued: 1, sent: 2, processed: 3 }
      trash.set(
        id,
        previous?.deletionId === next.deletionId &&
          statuses[previous.annotation.status] > statuses[next.annotation.status]
          ? previous
          : next,
      )
    }
  }
  for (const [id, mark] of marks) {
    if (mark.state !== 'restored') annotations.delete(id)
    if (mark.state !== 'trashed') trash.delete(id)
  }
  for (const [index, change] of journal.annotations.entries()) {
    if (isDeleted(change.id as AnnotationId) || staleLifecycle(change.id as AnnotationId)) continue
    const conflictId = `ann-conflict-${journal.id}-a${index}`
    if (
      (change.before !== null && change.before.annotationId !== change.id) ||
      (change.after !== null && change.after.annotationId !== change.id)
    )
      throw new Error('journal annotation id mismatch')
    const current = annotations.get(change.id as AnnotationId) ?? null
    if (sameValue(current, change.after)) continue
    if (sameValue(current, change.before)) {
      if (change.after === null) {
        if (current !== null) deletedTargets.set(current.annotationId, current)
        annotations.delete(change.id as AnnotationId)
      } else if (current !== null && (current.status === 'sent' || current.status === 'processed')) {
        if (change.after.status === 'draft') {
          const copy = conflictAnnotation(change.after, conflictId)
          annotations.set(copy.annotationId, copy)
        }
      } else annotations.set(change.after.annotationId, change.after)
      continue
    }
    if (change.after === null) {
      if (current?.status === 'draft') {
        const copy = conflictAnnotation(current, conflictId)
        annotations.set(copy.annotationId, copy)
        annotations.delete(change.id as AnnotationId)
      }
      continue
    }
    if (current === null) {
      if (change.after.status === 'draft') {
        const copy = conflictAnnotation(change.after, conflictId)
        annotations.set(copy.annotationId, copy)
      } else annotations.set(change.after.annotationId, change.after)
      continue
    }
    if (current.status !== 'draft' && change.after.status !== 'draft') {
      if (
        change.after.status === 'processed' ||
        (current.status !== 'processed' && change.after.status === 'sent')
      )
        annotations.set(change.after.annotationId, change.after)
      continue
    }
    if (change.after.status !== 'draft') {
      const copy = conflictAnnotation(current, conflictId)
      annotations.set(copy.annotationId, copy)
      annotations.set(change.after.annotationId, change.after)
      continue
    }
    const copy = conflictAnnotation(change.after, conflictId)
    annotations.set(copy.annotationId, copy)
  }

  const outbox = new Map(state.outbox.map((item) => [item.payload.submissionId, item]))
  for (const change of journal.outbox) {
    if (
      (change.before !== null && change.before.payload.submissionId !== change.id) ||
      (change.after !== null && change.after.payload.submissionId !== change.id)
    )
      throw new Error('journal outbox id mismatch')
    const current = outbox.get(change.id as SubmissionId) ?? null
    if (sameValue(current, change.after)) continue
    if (sameValue(current, change.before)) {
      if (change.after !== null)
        outbox.set(
          change.after.payload.submissionId,
          current === null ? change.after : preferredOutbox(current, change.after),
        )
      continue
    }
    if (change.after === null) continue
    if (current === null) {
      outbox.set(change.after.payload.submissionId, change.after)
      continue
    }
    outbox.set(change.after.payload.submissionId, preferredOutbox(current, change.after))
  }

  const editorTargets = new Map(journal.editorTargets.map((item) => [item.annotationId, item]))
  const editorMap = new Map<string, StoredEditor>()
  const editorKeys = new Map<string, string>()
  for (const [index, editor] of editors(state).entries()) {
    const targetId = editor.kind === 'edit' ? editor.annotationId : editor.draftId
    if (
      targetId !== undefined &&
      (isDeleted(targetId) || (editor.kind === 'new' && annotations.has(targetId)))
    )
      continue
    if (editor.kind === 'edit' && !annotations.has(editor.annotationId)) {
      const removal = journal.editors.find(
        (change) => change.id === editorKey(editor) && change.after === null,
      )
      if (removal !== undefined && sameValue(editor, removal.before)) continue
      const target = deletedTargets.get(editor.annotationId) ?? editorTargets.get(editor.annotationId)
      if (target === undefined || target.status !== 'draft')
        throw new Error('unfinished edit target was removed by another page')
      const cloneId = `ann-conflict-${journal.id}-retained${index}` as AnnotationId
      annotations.set(cloneId, Object.freeze({ ...target, annotationId: cloneId }))
      const copy = Object.freeze({ ...editor, annotationId: cloneId })
      editorMap.set(editorKey(copy), copy)
      editorKeys.set(editorKey(editor), editorKey(copy))
    } else editorMap.set(editorKey(editor), editor)
  }
  for (const [index, change] of journal.editors.entries()) {
    const target = change.after ?? change.before
    const targetId = target?.kind === 'edit' ? target.annotationId : target?.draftId
    if (targetId !== undefined && (isDeleted(targetId) || staleLifecycle(targetId))) continue
    if (
      (change.before !== null && editorKey(change.before) !== change.id) ||
      (change.after !== null && editorKey(change.after) !== change.id)
    )
      throw new Error('journal editor id mismatch')
    const current = editorMap.get(change.id) ?? null
    if (sameValue(current, change.after)) continue
    if (sameValue(current, change.before)) {
      if (change.after === null) editorMap.delete(change.id)
      else editorMap.set(change.id, change.after)
      continue
    }
    if (change.after === null) continue
    const cloneId = `ann-conflict-${journal.id}-e${index}` as AnnotationId
    let copy: StoredEditor
    if (change.after.kind === 'new') {
      copy = Object.freeze({ ...change.after, draftId: cloneId })
    } else {
      const target =
        annotations.get(change.after.annotationId) ??
        deletedTargets.get(change.after.annotationId) ??
        editorTargets.get(change.after.annotationId)
      if (target === undefined || target.status !== 'draft')
        throw new Error('conflicting unfinished edit has no draft target')
      const clonedTarget = Object.freeze({ ...target, annotationId: cloneId })
      annotations.set(cloneId, clonedTarget)
      copy = Object.freeze({ ...change.after, annotationId: cloneId })
    }
    editorMap.set(editorKey(copy), copy)
    editorKeys.set(change.id, editorKey(copy))
  }
  let activeEditorKey =
    state.editorDraft === undefined
      ? null
      : (editorKeys.get(editorKey(state.editorDraft)) ?? editorKey(state.editorDraft))
  if (journal.activeEditor !== null) {
    const nextKey = journal.activeEditor.after
    activeEditorKey = nextKey === null ? null : (editorKeys.get(nextKey) ?? nextKey)
  }
  const activeEditor = activeEditorKey === null ? undefined : editorMap.get(activeEditorKey)
  const suspendedEditors = [...editorMap.entries()]
    .filter(([key]) => key !== activeEditorKey)
    .map(([, editor]) => editor)
  const overallRequirementDraft = mergedOverallRequirement(
    state.overallRequirementDraft,
    journal.overallRequirementDraft,
  )
  const selectionMode = journal.selectionMode === null ? state.selectionMode : journal.selectionMode.after
  const selectedAnnotationIds =
    journal.selectedAnnotationIds === null ? state.selectedAnnotationIds : journal.selectedAnnotationIds.after
  const processingMode = journal.processingMode === null ? state.processingMode : journal.processingMode.after
  const merged = parseState(
    {
      storageVersion: 6,
      ...(state.trash === undefined && journal.trash.length === 0 ? {} : { trash: [...trash.values()] }),
      ...(state.deletionMarks === undefined && journal.deletionMarks.length === 0
        ? {}
        : { deletionMarks: [...marks.values()] }),
      annotations: [...annotations.values()],
      outbox: [...outbox.values()],
      overallRequirementDraft,
      ...(activeEditor === undefined ? {} : { editorDraft: activeEditor }),
      editorDrafts: suspendedEditors,
      ...(selectionMode == null ? {} : { selectionMode }),
      ...(selectedAnnotationIds == null ? {} : { selectedAnnotationIds }),
      ...(processingMode == null ? {} : { processingMode }),
      retrySubmissionId:
        journal.retrySubmissionId === null ? state.retrySubmissionId : journal.retrySubmissionId.after,
    },
    false,
  )
  if (merged.error !== null) throw new Error(merged.error)
  return merged.state
}

class ChangedJournalError extends Error {}

/** Browser-local repository for one Session's drafts and immutable retry records. */
export class AnnotationStorage {
  readonly key: string
  private readonly legacyKeys: readonly string[]
  private error: string | null = null
  private drainError: string | null = null
  private bytes = 0
  private status: 'unread' | 'missing' | 'loaded' | 'failed' = 'unread'
  private baseState: PersistedSessionState | null = null
  private fastSkipAllowed = false
  private previousJournalId: string | null = null
  private observedJournalIds: readonly string[] = []
  private drainPending: Promise<void> = Promise.resolve()
  private drainScheduled = false
  private readonly abort = new AbortController()
  private readonly listeners = new Set<() => void>()
  private migration: { readonly raw: string; readonly state: PersistedSessionState } | null = null

  constructor(
    private readonly storage: StorageLike,
    sessionId: SessionIdentity,
    private readonly coordination?: StorageCoordination,
  ) {
    this.key = `${PREFIX}${sessionId}`
    this.legacyKeys = Object.freeze(LEGACY_PREFIXES.map((prefix) => `${prefix}${sessionId}`))
  }

  /** Enumerate current and renamed session stores, including sessions whose writes are still journaled. */
  static listSessionIds(
    storage: StorageLike,
    coordination?: StorageCoordination,
  ): readonly SessionIdentity[] {
    const keys =
      coordination?.keys() ??
      (storage.key === undefined || storage.length === undefined
        ? []
        : Array.from({ length: storage.length }, (_, index) => storage.key!(index)).filter(
            (key): key is string => key !== null,
          ))
    const ids = new Set<SessionIdentity>()
    for (const key of keys) {
      const prefix = [PREFIX, ...LEGACY_PREFIXES].find((candidate) => key.startsWith(candidate))
      if (prefix === undefined) continue
      const id = key.slice(prefix.length).split(':journal:')[0]
      if (id !== undefined && id.length > 0) ids.add(id as SessionIdentity)
    }
    return Object.freeze([...ids].sort())
  }

  load(live = false): PersistedSessionState {
    return this.read(live, 0)
  }

  private read(live: boolean, retries: number): PersistedSessionState {
    let recovered = emptyPersistedState()
    this.fastSkipAllowed = false
    try {
      const raw = this.readFirstAvailable()
      this.bytes = raw === null ? 0 : byteLength(raw)
      let state = emptyPersistedState()
      let decoded: unknown
      if (raw !== null) {
        decoded = JSON.parse(raw)
        const parsed = parseState(decoded, !live)
        state = parsed.state
        recovered = state
        if (parsed.error !== null) {
          this.status = 'failed'
          this.error = parsed.error
          return state
        }
      }
      const journalKeys = this.journalKeys()
      if (journalKeys !== null) {
        this.observedJournalIds = journalKeys.map((key) => key.slice(`${this.key}:journal:`.length))
        if (raw !== null && needsEditorIds(decoded)) {
          if (this.migration?.raw === raw) state = this.migration.state
          else this.migration = { raw, state }
        }
        for (const journal of orderedJournals(
          journalKeys.map((key) => {
            const content = this.storage.getItem(key)
            if (content === null) throw new ChangedJournalError('storage journal changed during read')
            const parsed = parseJournal(content)
            if (key !== `${this.key}:journal:${parsed.id}`)
              throw new Error('storage journal key does not match its id')
            return parsed
          }),
        )) {
          state = applyJournal(state, journal)
          recovered = state
        }
        this.baseState = state
        this.status = raw === null && journalKeys.length === 0 ? 'missing' : 'loaded'
        this.error = null
        const migrate =
          raw !== null &&
          (this.storage.getItem(this.key) === null ||
            needsEditorIds(decoded) ||
            (decoded as Record<string, unknown>).storageVersion !== 6)
        if (this.coordination?.runExclusive !== undefined && (journalKeys.length > 0 || migrate))
          this.scheduleDrain()
        return state
      }
      if (raw === null) {
        this.baseState = state
        this.status = 'missing'
        this.error = null
        return state
      }
      this.status = 'loaded'
      try {
        this.writeMigrated(
          state,
          raw,
          needsEditorIds(decoded) || (decoded as Record<string, unknown>).storageVersion !== 6,
        )
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : String(error)
        return state
      }
      this.error = null
      this.baseState = state
      return state
    } catch (error: unknown) {
      if (error instanceof ChangedJournalError && retries < 3) return this.read(live, retries + 1)
      this.status = 'failed'
      this.error = error instanceof Error ? error.message : String(error)
      return recovered
    }
  }

  save(state: PersistedSessionState): boolean {
    if (this.status === 'unread') this.load()
    if (this.status === 'failed') return false
    if (
      this.fastSkipAllowed &&
      this.baseState !== null &&
      this.error === null &&
      this.drainError === null &&
      samePersistedReferences(this.baseState, state)
    )
      return true
    try {
      if (this.journalKeys() !== null) {
        const id = crypto.randomUUID()
        const journal = makeJournal(
          id,
          this.previousJournalId,
          this.baseState ?? emptyPersistedState(),
          state,
          this.observedJournalIds,
        )
        if (!journalHasChanges(journal)) {
          this.baseState = state
          this.scheduleDrain()
          return true
        }
        const serialized = JSON.stringify({ version: 2, ...journal })
        this.storage.setItem(`${this.key}:journal:${id}`, serialized)
        this.baseState = state
        this.previousJournalId = id
        this.bytes += byteLength(serialized)
        this.error = null
        this.status = 'loaded'
        this.fastSkipAllowed = true
        this.scheduleDrain()
        return true
      }
      const serialized = JSON.stringify(state)
      this.storage.setItem(this.key, serialized)
      this.removeLegacyKeys()
      this.bytes = byteLength(serialized)
      this.baseState = state
      this.status = 'loaded'
      this.error = null
      this.fastSkipAllowed = true
      return true
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  clear(): void {
    this.storage.removeItem(this.key)
    for (const key of this.journalKeys() ?? []) this.storage.removeItem(key)
    this.removeLegacyKeys()
    this.bytes = 0
    this.baseState = emptyPersistedState()
    this.status = 'missing'
    this.error = null
    this.drainError = null
    this.fastSkipAllowed = false
  }

  /** Listen for a committed merge or a coordination error in this Session. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Wait for lock work owned by this instance; journal data remains durable if the lock is unavailable. */
  async whenIdle(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.drainPending
      await pending
    } while (pending !== this.drainPending)
  }

  /** Stop notifications and pending lock requests without deleting durable journal entries. */
  dispose(): void {
    this.abort.abort()
    this.listeners.clear()
  }

  /** Report whether the last load found no value, recovered a value, or must retain damaged raw data. */
  loadStatus(): 'unread' | 'missing' | 'loaded' | 'failed' {
    return this.status
  }

  usageBytes(): number {
    return this.bytes
  }

  lastError(): string | null {
    return this.error ?? this.drainError
  }

  private journalKeys(): string[] | null {
    let keys: readonly string[]
    if (this.coordination !== undefined) {
      keys = this.coordination.keys()
    } else if (this.storage.key !== undefined && this.storage.length !== undefined) {
      keys = Array.from({ length: this.storage.length }, (_, index) => this.storage.key!(index)).filter(
        (key): key is string => key !== null,
      )
    } else {
      return null
    }
    return keys.filter((key) => key.startsWith(`${this.key}:journal:`))
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.abort.signal.aborted || this.coordination?.runExclusive === undefined)
      return
    this.drainScheduled = true
    let succeeded = false
    this.drainPending = this.coordination
      .runExclusive(
        this.key,
        () => {
          if (this.abort.signal.aborted) return
          this.drainJournals()
          succeeded = true
        },
        this.abort.signal,
      )
      .catch((error: unknown) => {
        if (this.abort.signal.aborted) return
        this.drainError = error instanceof Error ? error.message : String(error)
        this.notifyListeners()
      })
      .finally(() => {
        this.drainScheduled = false
        if (succeeded && (this.journalKeys()?.length ?? 0) > 0) this.scheduleDrain()
      })
  }

  private drainJournals(): void {
    const keys = this.journalKeys() ?? []
    const raw = this.readFirstAvailable()
    const parsed =
      raw === null
        ? { state: emptyPersistedState(), error: null }
        : this.migration?.raw === raw
          ? { state: this.migration.state, error: null }
          : parseState(JSON.parse(raw), false)
    if (parsed.error !== null) throw new Error(parsed.error)
    let merged = parsed.state
    for (const journal of orderedJournals(
      keys.map((key) => {
        const content = this.storage.getItem(key)
        if (content === null) throw new Error('storage journal disappeared during merge')
        const entry = parseJournal(content)
        if (key !== `${this.key}:journal:${entry.id}`)
          throw new Error('storage journal key does not match its id')
        return entry
      }),
    )) {
      merged = applyJournal(merged, journal)
    }
    const serialized = JSON.stringify(merged)
    if (this.storage.getItem(this.key) !== serialized) this.storage.setItem(this.key, serialized)
    this.removeLegacyKeys()
    for (const key of keys) this.storage.removeItem(key)
    this.bytes = byteLength(serialized)
    this.status = 'loaded'
    this.error = null
    this.drainError = null
    this.fastSkipAllowed = true
    this.migration = null
    this.notifyListeners()
  }

  private notifyListeners(): void {
    if (this.abort.signal.aborted) return
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[dsh-annotation] storage subscriber failed:', error)
      }
    }
  }

  /**
   * Read the new namespace first; fall back to pre-rename keys in order.
   * Legacy data is preserved until its conversion has been written back.
   */
  private readFirstAvailable(): string | null {
    const current = this.storage.getItem(this.key)
    if (current !== null) return current
    for (const legacyKey of this.legacyKeys) {
      const legacy = this.storage.getItem(legacyKey)
      if (legacy !== null) return legacy
    }
    return null
  }

  /** Persist namespace migration and newly allocated recovery ids without overwriting a concurrent writer. */
  private writeMigrated(state: PersistedSessionState, raw: string, normalizeEditors: boolean): void {
    const current = this.storage.getItem(this.key)
    if (current === null || (normalizeEditors && current === raw)) {
      const serialized = JSON.stringify(state)
      this.storage.setItem(this.key, serialized)
      this.bytes = byteLength(serialized)
    }
    this.removeLegacyKeys()
  }

  private removeLegacyKeys(): void {
    for (const legacyKey of this.legacyKeys) {
      this.storage.removeItem(legacyKey)
    }
  }
}
