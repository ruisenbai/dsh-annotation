import { submissionMessageId } from '../shared/ids.ts'
import {
  parseStructuredSelection,
  parseSubmissionPayload,
  parseSubmittedAnnotation,
  parseTextQuoteSelector,
} from '../shared/protocol.ts'
import type {
  AnnotationDraft,
  AnnotationSelectionCapture,
  AnnotationStatus,
  MessageIdentity,
  OutboxEntry,
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

export function emptyPersistedState(): PersistedSessionState {
  return Object.freeze({
    storageVersion: 2,
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

function parseOutbox(value: unknown): OutboxEntry {
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
  const interrupted = source.status === 'sending' || source.status === 'accepted'
  return Object.freeze({
    payload,
    targetSessionId: source.targetSessionId as SessionIdentity,
    messageId: source.messageId as OutboxEntry['messageId'],
    status: interrupted ? 'failed' : (source.status as OutboxStatus),
    attempts: source.attempts as number,
    ...(images === undefined ? {} : { images }),
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
  const messageId = persistedId<MessageIdentity>(source.messageId, `${field}.messageId`)
  const responseVersion = persistedId<MessageIdentity>(source.responseVersion, `${field}.responseVersion`)
  if (responseVersion !== messageId) throw new Error(`${field}.responseVersion must match messageId`)
  if (!Number.isSafeInteger(source.messageSeq) || (source.messageSeq as number) < 0) {
    throw new Error(`${field}.messageSeq must be a non-negative safe integer`)
  }
  const rectSource = object(source.rect, `${field}.rect`)
  const coordinates = ['top', 'left', 'bottom', 'right'] as const
  if (coordinates.some((coordinate) => !Number.isFinite(rectSource[coordinate]))) {
    throw new Error(`${field}.rect must contain finite coordinates`)
  }
  const parsedStructure = parseStructuredSelection(source.structure, `${field}.structure`)
  if (source.blockIndex !== undefined && !Number.isSafeInteger(source.blockIndex)) {
    throw new Error(`${field}.blockIndex must be a safe integer`)
  }
  return Object.freeze({
    messageId,
    messageSeq: source.messageSeq as number,
    responseVersion,
    ...(source.blockIndex === undefined ? {} : { blockIndex: source.blockIndex as number }),
    quote: parseTextQuoteSelector(source.quote, `${field}.quote`),
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
      capture: parseCapture(source.capture, 'editorDraft.capture'),
      text: source.text,
      longSelectionConfirmed: source.longSelectionConfirmed,
      ...(supplementalTo === undefined ? {} : { supplementalTo }),
    })
  }
  if (source.kind === 'edit') {
    const expandedCapture =
      source.expandedCapture === undefined
        ? undefined
        : parseCapture(source.expandedCapture, 'editorDraft.expandedCapture')
    return Object.freeze({
      kind: 'edit',
      annotationId: persistedId<AnnotationId>(source.annotationId, 'editorDraft.annotationId'),
      text: source.text,
      ...(expandedCapture === undefined ? {} : { expandedCapture }),
    })
  }
  throw new Error('editorDraft.kind must be new or edit')
}

function parseRecoverableEditorDraft(value: unknown): PersistedEditorDraft | undefined {
  try {
    return parseEditorDraft(value)
  } catch {
    // An optional recovery buffer must not invalidate submitted records or immutable retry state.
    return undefined
  }
}

function parseState(value: unknown): PersistedSessionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('state must be an object')
  const source = value as Record<string, unknown>
  const version = source.storageVersion
  if (
    (version !== 1 && version !== 2) ||
    !Array.isArray(source.annotations) ||
    !Array.isArray(source.outbox)
  ) {
    throw new Error('unsupported storage state')
  }
  if (typeof source.overallRequirementDraft !== 'string') throw new Error('invalid overall requirement draft')
  const annotations = source.annotations.map(parseAnnotation)
  if (new Set(annotations.map((item) => item.annotationId)).size !== annotations.length) {
    throw new Error('persisted annotation ids must be unique')
  }
  if (annotations.some((item) => item.status !== 'draft' && item.submissionId === undefined)) {
    throw new Error('submitted annotation is missing its submission id')
  }
  const outbox = source.outbox.map(parseOutbox)
  if (new Set(outbox.map((item) => item.payload.submissionId)).size !== outbox.length) {
    throw new Error('persisted outbox submission ids must be unique')
  }
  const candidateEditor = version === 2 ? parseRecoverableEditorDraft(source.editorDraft) : undefined
  const editorDraft =
    candidateEditor?.kind === 'edit' &&
    !annotations.some(
      (annotation) =>
        annotation.annotationId === candidateEditor.annotationId && annotation.status === 'draft',
    )
      ? undefined
      : candidateEditor
  return Object.freeze({
    storageVersion: 2,
    annotations: Object.freeze(annotations),
    outbox: Object.freeze(outbox),
    overallRequirementDraft: source.overallRequirementDraft,
    ...(editorDraft === undefined ? {} : { editorDraft }),
  })
}

/** Browser-local repository for one Session's drafts and immutable retry records. */
export class AnnotationStorage {
  readonly key: string
  private readonly legacyKeys: readonly string[]
  private error: string | null = null
  private bytes = 0

  constructor(
    private readonly storage: StorageLike,
    sessionId: SessionIdentity,
  ) {
    this.key = `${PREFIX}${sessionId}`
    this.legacyKeys = Object.freeze(LEGACY_PREFIXES.map((prefix) => `${prefix}${sessionId}`))
  }

  load(): PersistedSessionState {
    try {
      const raw = this.readFirstAvailable()
      this.bytes = raw === null ? 0 : byteLength(raw)
      if (raw === null) return emptyPersistedState()
      const parsed = parseState(JSON.parse(raw))
      this.writeMigrated(parsed)
      this.error = null
      return parsed
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
      return emptyPersistedState()
    }
  }

  save(state: PersistedSessionState): boolean {
    try {
      const serialized = JSON.stringify(state)
      this.storage.setItem(this.key, serialized)
      this.removeLegacyKeys()
      this.bytes = byteLength(serialized)
      this.error = null
      return true
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  clear(): void {
    this.storage.removeItem(this.key)
    this.removeLegacyKeys()
    this.bytes = 0
    this.error = null
  }

  usageBytes(): number {
    return this.bytes
  }

  lastError(): string | null {
    return this.error
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

  /** Persist a successful legacy load into the new namespace, then drop legacy keys. */
  private writeMigrated(state: PersistedSessionState): void {
    const current = this.storage.getItem(this.key)
    if (current !== null) {
      // The new namespace already owns this Session; legacy keys are inert residue.
      this.removeLegacyKeys()
      return
    }
    this.storage.setItem(this.key, JSON.stringify(state))
    this.removeLegacyKeys()
  }

  private removeLegacyKeys(): void {
    for (const legacyKey of this.legacyKeys) {
      this.storage.removeItem(legacyKey)
    }
  }
}
