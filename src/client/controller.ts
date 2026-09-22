import { sourceFields, sourceKey } from '../shared/annotation-source.ts'
import type { DiffSnapshot } from '../shared/diff-source.ts'
import { createAnnotationId, createSubmissionId, submissionMessageId } from '../shared/ids.ts'
import { parseModelAcknowledgements } from '../shared/model-ack.ts'
import {
  parseAnnotationSource,
  parseSubmissionPayload,
  validateSubmissionLimits,
} from '../shared/protocol.ts'
import {
  PROTOCOL_SOURCE,
  PROTOCOL_VERSION,
  FALLBACK_PROTOCOL_LOCALE,
  DEFAULT_PROCESSING_MODE,
} from '../shared/types.ts'
import type {
  AnnotationConfig,
  AnnotationDraft,
  AnnotationId,
  AnnotationKind,
  AnnotationSelectionMode,
  ProcessingMode,
  AnnotationStatus,
  AnnotationSubmissionPayload,
  DeliveryMode,
  MessageIdentity,
  OutboxEntry,
  OutboxAttachments,
  PersistedEditorDraft,
  PersistedSessionState,
  ProtocolLocale,
  SessionIdentity,
  SubmissionId,
  SubmittedAnnotation,
  SubmittedAttachmentIdentity,
} from '../shared/types.ts'
import { AnnotationStorage } from './storage.ts'
import type { SelectionCapture } from './selection.ts'
import { rangesOverlap } from './selection.ts'

export type EditorState = PersistedEditorDraft
export type AnnotationPresentation = 'summary' | 'marker' | 'marker-edit'

/** Submission preparation observed a later edit or deletion; no outbox was created. */
export class SubmissionChangedError extends Error {
  constructor() {
    super('Annotations changed while preparing the submission; review them before sending again.')
    this.name = 'SubmissionChangedError'
  }
}

export interface AnnotationView {
  readonly annotations: readonly AnnotationDraft[]
  readonly diffPanel?: { readonly snapshot?: DiffSnapshot; readonly annotationId?: AnnotationId } | null
  readonly outbox: readonly OutboxEntry[]
  readonly overallRequirementDraft: string
  readonly editor: EditorState | null
  readonly editorDrafts: readonly EditorState[]
  readonly selectionMode: AnnotationSelectionMode
  readonly selectedAnnotationIds: readonly AnnotationId[]
  readonly processingMode: ProcessingMode
  readonly retrySubmissionId: SubmissionId | null
  readonly overlap: {
    readonly capture: SelectionCapture
    readonly annotationIds: readonly AnnotationId[]
  } | null
  readonly editorSaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  readonly deletedDraft: AnnotationDraft | null
  readonly panelOpen: boolean
  readonly notice: { readonly level: 'info' | 'error'; readonly text: string } | null
  readonly activeAnnotationId: AnnotationId | null
  /** Monotonic identity for the latest transient source-navigation effect. */
  readonly navigationEpoch: number
  /** Transient annotation card anchored to a marker in the assistant body. */
  readonly markerAnnotationId: AnnotationId | null
  readonly latestAssistantMessageId: MessageIdentity | null
  readonly storageAvailable: boolean
}

export interface AnnotationReconciliationSnapshot {
  readonly chat: {
    readonly nodes: {
      values(): Iterable<unknown>
    }
  }
  /** Undefined until the Host Inbox is available; only next-turn entries are withdrawable. */
  readonly queue: readonly { readonly messageId: unknown }[] | undefined
  readonly hasMore: boolean
}

export interface AnnotationNavigationSession {
  getSnapshot(): Pick<AnnotationReconciliationSnapshot, 'hasMore'>
  loadOlder(): Promise<void>
}

export interface AnnotationEndpoint {
  reveal(annotationId: AnnotationId, navigationEpoch: number): void
  annotateAll(): void
}

const STATUS_RANK: Record<AnnotationStatus, number> = { draft: 0, queued: 1, sent: 2, processed: 3 }
const EDITOR_AUTOSAVE_MS = 400

function sortAnnotations(values: readonly AnnotationDraft[]): AnnotationDraft[] {
  return [...values].sort(
    (left, right) =>
      (left.messageSeq ?? Number.MAX_SAFE_INTEGER) - (right.messageSeq ?? Number.MAX_SAFE_INTEGER) ||
      left.quote.start - right.quote.start ||
      left.createdAt - right.createdAt,
  )
}

function withOrdinals(values: readonly AnnotationDraft[]): AnnotationDraft[] {
  return sortAnnotations(values).map((value, index) =>
    value.status !== 'draft' || value.ordinal === index + 1
      ? value
      : Object.freeze({ ...value, ordinal: index + 1 }),
  )
}

function sameAnnotationContent(left: SubmittedAnnotation, right: SubmittedAnnotation): boolean {
  const a = left.structure
  const b = right.structure
  const sameStructure =
    a === b ||
    (a?.kind === 'code' &&
      b?.kind === 'code' &&
      a.language === b.language &&
      a.startLine === b.startLine &&
      a.endLine === b.endLine) ||
    (a?.kind === 'table' &&
      b?.kind === 'table' &&
      a.startRow === b.startRow &&
      a.startColumn === b.startColumn &&
      a.endRow === b.endRow &&
      a.endColumn === b.endColumn)
  return (
    ((left.source?.kind !== 'diff' && right.source?.kind !== 'diff') ||
      JSON.stringify(left.source) === JSON.stringify(right.source)) &&
    left.annotation === right.annotation &&
    left.kind === right.kind &&
    left.messageId === right.messageId &&
    left.messageSeq === right.messageSeq &&
    left.responseVersion === right.responseVersion &&
    left.supplementalTo === right.supplementalTo &&
    left.quote.exact === right.quote.exact &&
    left.quote.start === right.quote.start &&
    left.quote.end === right.quote.end &&
    left.quote.prefix === right.quote.prefix &&
    left.quote.suffix === right.quote.suffix &&
    sameStructure
  )
}

function captureAnnotation(item: SubmittedAnnotation): SelectionCapture {
  return {
    ...sourceFields(item),
    quote: item.quote,
    ...(item.structure === undefined ? {} : { structure: item.structure }),
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  }
}

/**
 * Identify an active or suspended editor independently of displayed annotation numbers.
 * @param editor Browser-local editor buffer.
 * @returns Stable annotation/draft key, or source coordinates for a legacy buffer.
 */
export function editorBufferKey(editor: EditorState): string {
  return editor.kind === 'edit'
    ? `edit:${editor.annotationId}`
    : `new:${editor.draftId ?? `${sourceKey(editor.capture)}:${editor.capture.quote.start}:${editor.capture.quote.end}`}`
}

function unfinishedEdit(editor: EditorState, annotations: readonly AnnotationDraft[]): boolean {
  if (editor.kind === 'new') return true
  const saved = annotations.find((item) => item.annotationId === editor.annotationId)
  return (
    saved !== undefined &&
    (editor.supplement === true || editor.expandedCapture !== undefined || editor.text !== saved.annotation)
  )
}

/**
 * Exclude unfinished edits from saved drafts; recovery buffers are never sendable.
 * @param view Current or captured Session state.
 * @returns Saved drafts whose last saved content can be submitted.
 */
export function eligibleAnnotations(view: AnnotationView): readonly AnnotationDraft[] {
  const blocked = new Set(
    [...view.editorDrafts, ...(view.editor === null ? [] : [view.editor])]
      .filter((editor) => editor.kind === 'edit' && unfinishedEdit(editor, view.annotations))
      .map((editor) => (editor.kind === 'edit' ? editor.annotationId : null)),
  )
  return view.annotations.filter((item) => item.status === 'draft' && !blocked.has(item.annotationId))
}

/**
 * Resolve a new batch without deciding whether the official composer is attached.
 * @param view Current or submit-time Session state.
 * @returns All eligible drafts in aggregate mode, or the explicit selected-ID intersection.
 */
export function selectedAnnotations(view: AnnotationView): readonly AnnotationDraft[] {
  const eligible = eligibleAnnotations(view)
  if (view.selectionMode === 'all') return eligible
  const selected = new Set(view.selectedAnnotationIds)
  return eligible.filter((item) => selected.has(item.annotationId))
}

/**
 * Resolve the active frozen retry without selecting another pending outbox record.
 * @param view Current or submit-time Session state.
 * @returns The selected ready/failed entry, when it is still retryable.
 */
export function retryEntry(view: AnnotationView): OutboxEntry | undefined {
  return view.outbox.find(
    (item) =>
      item.payload.submissionId === view.retrySubmissionId &&
      (item.status === 'failed' || item.status === 'ready'),
  )
}

function statusAtLeast(current: AnnotationStatus, candidate: AnnotationStatus): AnnotationStatus {
  return STATUS_RANK[current] >= STATUS_RANK[candidate] ? current : candidate
}

function cloneState(view: AnnotationView): PersistedSessionState {
  return Object.freeze({
    storageVersion: 3,
    annotations: view.annotations,
    outbox: view.outbox,
    overallRequirementDraft: view.overallRequirementDraft,
    ...(view.editor === null ? {} : { editorDraft: view.editor }),
    editorDrafts: view.editorDrafts,
    selectionMode: view.selectionMode,
    selectedAnnotationIds: view.selectedAnnotationIds,
    processingMode: view.processingMode,
    retrySubmissionId: view.retrySubmissionId,
  })
}

function textFromAssistantNode(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const data = (node as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null) return ''
  const blocks = (data as Record<string, unknown>).blocks
  if (!Array.isArray(blocks)) return ''
  return blocks
    .flatMap((block) => {
      if (typeof block !== 'object' || block === null) return []
      const source = block as Record<string, unknown>
      return (source.kind === 'text' || source.kind === 'reasoning') && typeof source.text === 'string'
        ? [source.text]
        : []
    })
    .join('\n')
}

function sourceFromInputNode(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return undefined
  const source = node as Record<string, unknown>
  if (source.kind !== 'user' && source.kind !== 'steering') return undefined
  const data = source.data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>).source : undefined
}

function finalAssistantId(node: unknown): MessageIdentity | null {
  if (
    typeof node !== 'object' ||
    node === null ||
    (node as Record<string, unknown>).kind !== 'assistant-step'
  )
    return null
  const data = (node as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null) return null
  const finalNode = (data as Record<string, unknown>).finalNode
  if (typeof finalNode !== 'object' || finalNode === null) return null
  const messageId = (finalNode as Record<string, unknown>).messageId
  return typeof messageId === 'string' ? (messageId as MessageIdentity) : null
}

/** Observable, persistent state owner shared by every slot entry in one Session. */
export class AnnotationController {
  private view: AnnotationView
  private readonly listeners = new Set<() => void>()
  private readonly endpoints = new Map<MessageIdentity, AnnotationEndpoint>()
  private pendingNavigation: {
    messageId: MessageIdentity
    annotationId: AnnotationId
    navigationEpoch: number
  } | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private deletedSelection = false
  private deletedEditors: readonly EditorState[] = []

  constructor(
    readonly sessionId: SessionIdentity,
    private readonly storage: AnnotationStorage,
    private readonly navigationSession: AnnotationNavigationSession,
    private readonly config: AnnotationConfig,
    private readonly now: () => number = Date.now,
  ) {
    const persisted = storage.load()
    const editor = persisted.editorDraft ?? null
    const activeAnnotationId =
      editor === null ? null : editor.kind === 'edit' ? editor.annotationId : (editor.supplementalTo ?? null)
    this.view = Object.freeze({
      annotations: Object.freeze(
        persisted.annotations.map((item) => {
          if (item.status === 'draft' || item.submissionId === undefined) return item
          const submitted = persisted.outbox
            .find((entry) => entry.payload.submissionId === item.submissionId)
            ?.payload.annotations.find((entry) => entry.annotationId === item.annotationId)
          return submitted === undefined || submitted.ordinal === item.ordinal
            ? item
            : Object.freeze({ ...item, ordinal: submitted.ordinal })
        }),
      ),
      outbox: persisted.outbox,
      overallRequirementDraft: persisted.overallRequirementDraft,
      editor,
      editorDrafts: persisted.editorDrafts ?? Object.freeze([]),
      selectionMode: persisted.selectionMode ?? 'all',
      selectedAnnotationIds: persisted.selectedAnnotationIds ?? Object.freeze([]),
      processingMode: persisted.processingMode ?? DEFAULT_PROCESSING_MODE,
      retrySubmissionId:
        persisted.retrySubmissionId === undefined
          ? (persisted.outbox.find((item) => item.status === 'failed' || item.status === 'ready')?.payload
              .submissionId ?? null)
          : persisted.retrySubmissionId,
      overlap: null,
      editorSaveStatus: editor === null ? 'idle' : 'saved',
      deletedDraft: null,
      panelOpen: false,
      notice: storage.lastError() === null ? null : { level: 'error' as const, text: 'storage' },
      activeAnnotationId,
      navigationEpoch: 0,
      markerAnnotationId: null,
      latestAssistantMessageId: null,
      storageAvailable: storage.lastError() === null,
    })
  }

  getSnapshot = (): AnnotationView => this.view

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
      this.storage.save(cloneState(this.view))
    }
    this.disposed = true
    this.listeners.clear()
    this.endpoints.clear()
  }

  beginSelection(capture: SelectionCapture): void {
    const {
      source: _source,
      messageId: _message,
      messageSeq: _seq,
      responseVersion: _version,
      ...selection
    } = capture
    capture = Object.freeze({ ...selection, ...sourceFields(capture) })
    this.suspendEditor()
    const overlaps = this.view.annotations.filter(
      (item) => sourceKey(item) === sourceKey(capture) && rangesOverlap(item.quote, capture.quote),
    )
    if (overlaps.length > 0) {
      this.publish({
        ...this.view,
        overlap: Object.freeze({
          capture,
          annotationIds: Object.freeze(overlaps.map((item) => item.annotationId)),
        }),
        panelOpen: true,
        markerAnnotationId: null,
      })
      return
    }
    this.startNewEditor(capture)
  }

  /** Resolve an overlapping selection only after the user chooses new or a particular target. */
  chooseOverlap(annotationId?: AnnotationId): void {
    const overlap = this.view.overlap
    if (overlap === null) return
    this.suspendEditor()
    if (annotationId === undefined) {
      this.startNewEditor(overlap.capture)
      return
    }
    const item = this.view.annotations.find((candidate) => candidate.annotationId === annotationId)
    if (item === undefined || !overlap.annotationIds.includes(annotationId)) return
    if (item.status !== 'draft') {
      this.startNewEditor(overlap.capture, annotationId)
      return
    }
    const recovery = this.view.editorDrafts.find(
      (editor) => editor.kind === 'edit' && editor.annotationId === annotationId,
    )
    if (recovery !== undefined) {
      this.resumeEditor(editorBufferKey(recovery))
      this.setNotice('info', 'resume-before-supplement')
      return
    }
    const changedQuote =
      item.quote.start !== overlap.capture.quote.start ||
      item.quote.end !== overlap.capture.quote.end ||
      item.quote.exact !== overlap.capture.quote.exact
    this.publish({
      ...this.view,
      overlap: null,
      editor: Object.freeze({
        kind: 'edit',
        annotationId,
        text: '',
        supplement: true,
        ...(changedQuote ? { expandedCapture: overlap.capture } : {}),
        longSelectionConfirmed: overlap.capture.quote.exact.length <= this.config.warnSelectionChars,
      }),
      editorSaveStatus: 'idle',
      activeAnnotationId: annotationId,
      markerAnnotationId: null,
    })
  }

  dismissOverlap(): void {
    if (this.view.overlap !== null) this.publish({ ...this.view, overlap: null })
  }

  private startNewEditor(capture: SelectionCapture, supplementalTo?: AnnotationId): void {
    this.publish({
      ...this.view,
      overlap: null,
      editor: Object.freeze({
        kind: 'new',
        draftId: createAnnotationId(),
        capture,
        text: '',
        longSelectionConfirmed: capture.quote.exact.length <= this.config.warnSelectionChars,
        ...(supplementalTo === undefined ? {} : { supplementalTo }),
      }),
      editorSaveStatus: 'idle',
      activeAnnotationId: supplementalTo ?? null,
      markerAnnotationId: null,
    })
  }

  /** A Host-accepted mode change clears pending send intent, never immutable outbox content. */
  setSelectionMode(individual: boolean): void {
    const selectionMode = individual ? 'individual' : 'all'
    if (this.view.selectionMode === selectionMode) return
    this.deletedSelection = false
    this.publish({
      ...this.view,
      selectionMode,
      selectedAnnotationIds: Object.freeze([]),
      retrySubmissionId: null,
      notice: { level: 'info', text: 'selection-mode-changed' },
    })
  }

  toggleSelected(annotationId: AnnotationId): void {
    if (this.view.selectionMode !== 'individual') return
    if (!eligibleAnnotations(this.view).some((item) => item.annotationId === annotationId)) return
    const selected = this.view.selectedAnnotationIds.includes(annotationId)
    this.publish({
      ...this.view,
      selectedAnnotationIds: Object.freeze(
        selected
          ? this.view.selectedAnnotationIds.filter((id) => id !== annotationId)
          : [...this.view.selectedAnnotationIds, annotationId],
      ),
      retrySubmissionId: null,
    })
  }

  setProcessingMode(processingMode: ProcessingMode): void {
    if (processingMode !== this.view.processingMode) this.publish({ ...this.view, processingMode })
  }

  selectRetry(submissionId: SubmissionId): void {
    if (
      !this.view.outbox.some(
        (entry) =>
          entry.payload.submissionId === submissionId &&
          (entry.status === 'ready' || entry.status === 'failed'),
      )
    )
      return
    this.publish({
      ...this.view,
      retrySubmissionId: this.view.retrySubmissionId === submissionId ? null : submissionId,
      selectedAnnotationIds: Object.freeze([]),
    })
  }

  openAnnotation(annotationId: AnnotationId, presentation: AnnotationPresentation = 'summary'): void {
    const item = this.view.annotations.find((candidate) => candidate.annotationId === annotationId)
    if (item === undefined) return
    const closing = this.view.markerAnnotationId === annotationId && this.view.editor === null
    this.suspendEditor()
    this.dismissOverlap()
    if (item.source?.kind === 'diff') this.openDiffPanel(item.source.snapshot, annotationId)
    if (presentation === 'marker') {
      this.publish({
        ...this.view,
        editor: null,
        editorSaveStatus: 'idle',
        panelOpen: false,
        activeAnnotationId: closing ? null : annotationId,
        markerAnnotationId: closing ? null : annotationId,
      })
      return
    }
    const markerAnnotationId = presentation === 'marker-edit' ? annotationId : null
    const recovery = this.view.editorDrafts.find(
      (editor) => editor.kind === 'edit' && editor.annotationId === annotationId,
    )
    if (item.status === 'draft' && recovery !== undefined) {
      this.resumeEditor(editorBufferKey(recovery))
      this.publish({ ...this.view, markerAnnotationId, overlap: null })
      return
    }
    if (item.status === 'queued') {
      this.publish({
        ...this.view,
        editor: null,
        editorSaveStatus: 'idle',
        panelOpen: presentation === 'summary',
        activeAnnotationId: annotationId,
        markerAnnotationId,
      })
      return
    }
    if (item.status === 'sent' || item.status === 'processed') {
      const capture = captureAnnotation(item)
      this.publish({
        ...this.view,
        editor: Object.freeze({
          kind: 'new',
          draftId: createAnnotationId(),
          capture,
          text: '',
          longSelectionConfirmed: true,
          supplementalTo: annotationId,
        }),
        editorSaveStatus: 'idle',
        activeAnnotationId: annotationId,
        markerAnnotationId,
      })
      return
    }
    this.publish({
      ...this.view,
      editor: Object.freeze({ kind: 'edit', annotationId, text: item.annotation }),
      editorSaveStatus: 'idle',
      activeAnnotationId: annotationId,
      markerAnnotationId,
    })
  }

  updateEditorText(text: string): void {
    if (this.view.editor === null) return
    this.publish(
      {
        ...this.view,
        editor: Object.freeze({ ...this.view.editor, text }),
        editorSaveStatus: 'saving',
      },
      false,
    )
    this.schedulePersist()
  }

  confirmLongSelection(): void {
    if (this.view.editor === null) return
    this.publish({
      ...this.view,
      editor: Object.freeze({ ...this.view.editor, longSelectionConfirmed: true }),
      editorSaveStatus: 'saved',
    })
  }

  saveEditor(): AnnotationId {
    const editor = this.view.editor
    if (editor === null) throw new Error('no annotation editor is open')
    const original =
      editor.kind === 'edit'
        ? this.view.annotations.find((item) => item.annotationId === editor.annotationId)
        : undefined
    if (editor.kind === 'edit' && original?.status !== 'draft')
      throw new Error('only draft annotations can be edited')
    if (
      editor.kind === 'edit' &&
      editor.expandedCapture !== undefined &&
      editor.expandedCapture.quote.exact.length > this.config.warnSelectionChars &&
      editor.longSelectionConfirmed !== true
    ) {
      throw new Error('long selection is not confirmed')
    }
    const annotation =
      editor.kind === 'edit' && editor.supplement === true
        ? [original?.annotation ?? '', editor.text.trim()].filter((text) => text !== '').join('\n\n')
        : editor.text.trim()
    const kind: AnnotationKind = annotation.length === 0 ? 'highlight-only' : 'note'
    const time = this.now()
    let savedId: AnnotationId
    let annotations: AnnotationDraft[]
    if (editor.kind === 'new') {
      if (!editor.longSelectionConfirmed) throw new Error('long selection is not confirmed')
      savedId = editor.draftId ?? createAnnotationId()
      const supplementalTo = editor.supplementalTo
      annotations = withOrdinals([
        ...this.view.annotations,
        Object.freeze({
          annotationId: savedId,
          ordinal: this.view.annotations.length + 1,
          ...sourceFields(editor.capture),
          ...(editor.capture.blockIndex === undefined ? {} : { blockIndex: editor.capture.blockIndex }),
          quote: editor.capture.quote,
          annotation,
          kind,
          ...(editor.capture.structure === undefined ? {} : { structure: editor.capture.structure }),
          createdAt: time,
          updatedAt: time,
          status: 'draft',
          ...(supplementalTo === undefined ? {} : { supplementalTo }),
        }),
      ])
    } else {
      savedId = editor.annotationId
      annotations = withOrdinals(
        this.view.annotations.map((item) => {
          if (item.annotationId !== editor.annotationId) return item
          if (item.status !== 'draft') throw new Error('only draft annotations can be edited')
          const capture = editor.expandedCapture
          const {
            source: _source,
            messageId: _message,
            messageSeq: _seq,
            responseVersion: _version,
            structure,
            ...fields
          } = item
          const nextStructure = capture === undefined ? structure : capture.structure
          return Object.freeze({
            ...fields,
            ...sourceFields(capture ?? item),
            annotation,
            kind,
            quote: capture?.quote ?? item.quote,
            ...(nextStructure === undefined ? {} : { structure: nextStructure }),
            updatedAt: time,
          })
        }),
      )
    }
    this.publish({
      ...this.view,
      annotations,
      editor: null,
      editorDrafts: this.view.editorDrafts.filter(
        (buffer) => editorBufferKey(buffer) !== editorBufferKey(editor),
      ),
      editorSaveStatus: 'idle',
      activeAnnotationId: savedId,
    })
    return savedId
  }

  /** Collapse the editor without consuming the pointer or keyboard action that dismissed it. */
  suspendEditor(): void {
    const editor = this.view.editor
    if (editor === null) return
    const buffers = this.view.editorDrafts.filter(
      (buffer) => editorBufferKey(buffer) !== editorBufferKey(editor),
    )
    const retain = unfinishedEdit(editor, this.view.annotations)
    this.publish({
      ...this.view,
      editor: null,
      editorDrafts: Object.freeze(retain ? [...buffers, editor] : buffers),
      editorSaveStatus: retain ? 'saved' : 'idle',
      activeAnnotationId: null,
      markerAnnotationId: null,
    })
  }

  resumeEditor(key: string): void {
    const editor = this.view.editorDrafts.find((buffer) => editorBufferKey(buffer) === key)
    if (editor === undefined) return
    this.suspendEditor()
    const source =
      editor.kind === 'new'
        ? editor.capture.source
        : (
            editor.expandedCapture ??
            this.view.annotations.find((item) => item.annotationId === editor.annotationId)
          )?.source
    if (source?.kind === 'diff')
      this.openDiffPanel(source.snapshot, editor.kind === 'edit' ? editor.annotationId : undefined)
    this.publish({
      ...this.view,
      editor,
      editorDrafts: Object.freeze(this.view.editorDrafts.filter((buffer) => editorBufferKey(buffer) !== key)),
      overlap: null,
      editorSaveStatus: 'saved',
      activeAnnotationId: editor.kind === 'edit' ? editor.annotationId : (editor.supplementalTo ?? null),
      markerAnnotationId: null,
    })
  }

  discardEditorDraft(key: string): void {
    if (this.view.editor !== null && editorBufferKey(this.view.editor) === key) {
      this.closeEditor(true)
      return
    }
    this.publish({
      ...this.view,
      editorDrafts: Object.freeze(this.view.editorDrafts.filter((buffer) => editorBufferKey(buffer) !== key)),
    })
  }

  /** Explicit discard removes this edit buffer, never the previously saved annotation. */
  closeEditor(force = false): boolean {
    const editor = this.view.editor
    if (editor === null) return true
    if (!force) {
      this.suspendEditor()
      return true
    }
    this.publish({
      ...this.view,
      editor: null,
      editorDrafts: Object.freeze(
        this.view.editorDrafts.filter((buffer) => editorBufferKey(buffer) !== editorBufferKey(editor)),
      ),
      editorSaveStatus: 'idle',
      activeAnnotationId: null,
      markerAnnotationId: null,
    })
    return true
  }

  /** Synchronously retain the latest keystroke on pagehide and before teardown. */
  flush(): void {
    if (!this.disposed) this.publish({ ...this.view })
  }

  deleteDraft(annotationId: AnnotationId): void {
    const target = this.view.annotations.find((item) => item.annotationId === annotationId)
    if (target === undefined) return
    if (target.status !== 'draft') throw new Error('only draft annotations can be deleted')
    const relatedEditor = (editor: EditorState) =>
      editor.kind === 'edit' && editor.annotationId === annotationId
    const closesEditor = this.view.editor !== null && relatedEditor(this.view.editor)
    this.deletedSelection = this.view.selectedAnnotationIds.includes(annotationId)
    this.deletedEditors = [
      ...this.view.editorDrafts.filter(relatedEditor),
      ...(closesEditor && this.view.editor !== null ? [this.view.editor] : []),
    ]
    this.publish({
      ...this.view,
      annotations: withOrdinals(this.view.annotations.filter((item) => item.annotationId !== annotationId)),
      editor: closesEditor ? null : this.view.editor,
      editorDrafts: Object.freeze(this.view.editorDrafts.filter((editor) => !relatedEditor(editor))),
      editorSaveStatus: closesEditor ? 'idle' : this.view.editorSaveStatus,
      deletedDraft: target,
      activeAnnotationId: this.view.activeAnnotationId === annotationId ? null : this.view.activeAnnotationId,
      markerAnnotationId: this.view.markerAnnotationId === annotationId ? null : this.view.markerAnnotationId,
    })
  }

  undoDelete(): void {
    const deleted = this.view.deletedDraft
    if (deleted === null) return
    if (this.view.annotations.some((item) => item.annotationId === deleted.annotationId)) {
      this.publish({ ...this.view, deletedDraft: null }, false)
      return
    }
    this.publish({
      ...this.view,
      annotations: withOrdinals([...this.view.annotations, deleted]),
      editorDrafts: Object.freeze([...this.view.editorDrafts, ...this.deletedEditors]),
      selectedAnnotationIds:
        this.deletedSelection && this.view.selectionMode === 'individual'
          ? Object.freeze([...this.view.selectedAnnotationIds, deleted.annotationId])
          : this.view.selectedAnnotationIds,
      deletedDraft: null,
      activeAnnotationId: deleted.annotationId,
    })
  }

  dismissDeleteUndo(): void {
    if (this.view.deletedDraft === null) return
    this.publish({ ...this.view, deletedDraft: null }, false)
  }

  setPanelOpen(panelOpen: boolean): void {
    this.publish(
      {
        ...this.view,
        panelOpen,
        markerAnnotationId: panelOpen ? null : this.view.markerAnnotationId,
      },
      false,
    )
  }

  setOverallRequirementDraft(overallRequirementDraft: string): void {
    this.publish({ ...this.view, overallRequirementDraft })
  }

  setNotice(level: 'info' | 'error', text: string): void {
    this.publish({ ...this.view, notice: { level, text } }, false)
  }

  clearNotice(): void {
    this.publish({ ...this.view, notice: null }, false)
  }

  createOutbox(
    delivery: DeliveryMode,
    targetSessionId: SessionIdentity,
    overallRequirement = '',
    attachments?: OutboxAttachments,
    protocolLocale: ProtocolLocale = FALLBACK_PROTOCOL_LOCALE,
    snapshot: AnnotationView = this.view,
    attachmentIdentities?: readonly SubmittedAttachmentIdentity[],
  ): OutboxEntry {
    const retry = retryEntry(snapshot)
    if (retry !== undefined) {
      const current = this.view.outbox.find(
        (item) => item.payload.submissionId === retry.payload.submissionId,
      )
      if (current === undefined || current.status === 'withdrawn') throw new SubmissionChangedError()
      return current
    }
    const drafts = sortAnnotations(selectedAnnotations(snapshot))
    if (drafts.length === 0) throw new Error('no draft annotations to submit')
    const currentEligible = new Map(eligibleAnnotations(this.view).map((item) => [item.annotationId, item]))
    for (const draft of drafts) {
      const current = currentEligible.get(draft.annotationId)
      if (current === undefined || !sameAnnotationContent(current, draft)) {
        throw new SubmissionChangedError()
      }
    }
    const submissionId = createSubmissionId()
    const annotations: SubmittedAnnotation[] = drafts.map((item, index) =>
      Object.freeze({
        annotationId: item.annotationId,
        ordinal: index + 1,
        ...sourceFields(item),
        quote: item.quote,
        annotation: item.annotation,
        kind: item.kind,
        ...(item.structure === undefined ? {} : { structure: item.structure }),
        ...(item.supplementalTo === undefined ? {} : { supplementalTo: item.supplementalTo }),
        createdAt: item.createdAt,
      }),
    )
    const overall = overallRequirement.trim()
    const payload: AnnotationSubmissionPayload = parseSubmissionPayload({
      protocolVersion: PROTOCOL_VERSION,
      source: PROTOCOL_SOURCE,
      submissionId,
      sessionId: targetSessionId,
      delivery,
      protocolLocale,
      processingMode: snapshot.processingMode,
      createdAt: this.now(),
      ...(overall.length === 0 ? {} : { overallRequirement: overall }),
      annotations: Object.freeze(annotations),
      ...(attachmentIdentities === undefined ? {} : { attachmentIdentities }),
    })
    validateSubmissionLimits(
      payload,
      this.config,
      new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    )
    const entry: OutboxEntry = Object.freeze({
      payload,
      targetSessionId,
      messageId: submissionMessageId(submissionId),
      status: 'ready',
      attempts: 0,
      ...(attachments === undefined
        ? {}
        : {
            attachments: Object.freeze({
              count: attachments.count,
              kinds: Object.freeze([...attachments.kinds]),
              mediaTypes: Object.freeze([...attachments.mediaTypes]),
              names: Object.freeze([...attachments.names]),
            }),
          }),
    })
    const selected = new Map(payload.annotations.map((item) => [item.annotationId, item.ordinal]))
    const nextAnnotations = this.view.annotations.map((item) =>
      selected.has(item.annotationId)
        ? Object.freeze({
            ...item,
            ordinal: selected.get(item.annotationId)!,
            status: 'queued' as const,
            submissionId,
            updatedAt: this.now(),
          })
        : item,
    )
    const closesEditor = this.view.editor?.kind === 'edit' && selected.has(this.view.editor.annotationId)
    this.publish({
      ...this.view,
      annotations: nextAnnotations,
      outbox: [...this.view.outbox, entry],
      retrySubmissionId: submissionId,
      editor: closesEditor ? null : this.view.editor,
      overallRequirementDraft: '',
    })
    return entry
  }

  adoptOutbox(entry: OutboxEntry): void {
    const existingIds = new Set(this.view.annotations.map((item) => item.annotationId))
    const annotations = [
      ...this.view.annotations,
      ...entry.payload.annotations
        .filter((item) => !existingIds.has(item.annotationId))
        .map((item) =>
          Object.freeze({
            ...item,
            status: 'queued' as const,
            updatedAt: this.now(),
            submissionId: entry.payload.submissionId,
          }),
        ),
    ]
    const outbox = this.view.outbox.some((item) => item.payload.submissionId === entry.payload.submissionId)
      ? this.view.outbox
      : [...this.view.outbox, entry]
    this.publish({ ...this.view, annotations: withOrdinals(annotations), outbox })
  }

  markSending(submissionId: SubmissionId): void {
    this.patchOutbox(submissionId, (item) => {
      if (item.status !== 'ready' && item.status !== 'failed') return item
      const { lastError: _lastError, ...rest } = item
      return Object.freeze({ ...rest, status: 'sending', attempts: item.attempts + 1 })
    })
  }

  markAccepted(submissionId: SubmissionId): void {
    this.patchOutbox(submissionId, (item) => {
      if (item.status === 'queued' || item.status === 'sent' || item.status === 'withdrawn') return item
      const { lastError: _lastError, ...rest } = item
      return Object.freeze({ ...rest, status: 'accepted' })
    })
  }

  markQueueClaimed(submissionId: SubmissionId): void {
    this.patchOutbox(submissionId, (item) => {
      if (item.status !== 'queued') return item
      return Object.freeze({ ...item, status: 'accepted' })
    })
  }

  markFailed(submissionId: SubmissionId, error: string): void {
    this.patchOutbox(submissionId, (item) => {
      if (item.status !== 'ready' && item.status !== 'sending' && item.status !== 'failed') return item
      return Object.freeze({ ...item, status: 'failed', lastError: error })
    })
  }

  markWithdrawn(submissionId: SubmissionId): void {
    const time = this.now()
    this.publish({
      ...this.view,
      annotations: this.view.annotations.map((item) => {
        if (item.submissionId !== submissionId || item.status !== 'queued') return item
        const { submissionId: _submissionId, ...rest } = item
        return Object.freeze({ ...rest, status: 'draft' as const, updatedAt: time })
      }),
      outbox: this.view.outbox.map((item) =>
        item.payload.submissionId === submissionId
          ? Object.freeze({ ...item, status: 'withdrawn' as const })
          : item,
      ),
    })
  }

  /** Drop a never-queued retry record and return its annotations to the editable draft list. */
  discardOutbox(submissionId: SubmissionId): void {
    const entry = this.view.outbox.find((item) => item.payload.submissionId === submissionId)
    if (entry === undefined || (entry.status !== 'ready' && entry.status !== 'failed')) return
    const time = this.now()
    this.publish({
      ...this.view,
      annotations: this.view.annotations.map((item) => {
        if (item.submissionId !== submissionId || item.status !== 'queued') return item
        const { submissionId: _submissionId, ...rest } = item
        return Object.freeze({ ...rest, status: 'draft' as const, updatedAt: time })
      }),
      outbox: this.view.outbox.map((item) =>
        item.payload.submissionId === submissionId
          ? Object.freeze({ ...item, status: 'withdrawn' as const })
          : item,
      ),
    })
  }

  reconcile(snapshot: AnnotationReconciliationSnapshot): void {
    const submissions = new Map<SubmissionId, AnnotationSubmissionPayload>()
    const acknowledgements = new Map<SubmissionId, Set<AnnotationId>>()
    let latestAssistantMessageId: MessageIdentity | null = null
    for (const node of snapshot.chat.nodes.values()) {
      const source = sourceFromInputNode(node)
      const payload = parseAnnotationSource(source)
      if (payload !== null) submissions.set(payload.submissionId, payload)
      const assistantId = finalAssistantId(node)
      if (assistantId !== null) latestAssistantMessageId = assistantId
      const text = textFromAssistantNode(node)
      for (const acknowledgement of parseModelAcknowledgements(text)) {
        const ids = acknowledgements.get(acknowledgement.submissionId) ?? new Set<AnnotationId>()
        for (const id of acknowledgement.processed) ids.add(id)
        acknowledgements.set(acknowledgement.submissionId, ids)
      }
    }
    const queued =
      snapshot.queue === undefined ? undefined : new Set(snapshot.queue.map((item) => String(item.messageId)))
    let annotations = [...this.view.annotations]
    const known = new Map(annotations.map((item, index) => [item.annotationId, index]))
    const restoredDrafts = new Map<
      AnnotationId,
      { previous: AnnotationDraft; replacementId: AnnotationId | null }
    >()
    let preservedChanges = false
    for (const payload of submissions.values()) {
      for (const item of payload.annotations) {
        const index = known.get(item.annotationId)
        const previous = index === undefined ? undefined : annotations[index]
        if (
          previous !== undefined &&
          previous.status !== 'draft' &&
          previous.submissionId !== payload.submissionId
        )
          continue
        if (previous?.status === 'draft') {
          let replacementId: AnnotationId | null = null
          if (!sameAnnotationContent(previous, item)) {
            replacementId = createAnnotationId()
            const { submissionId: _submissionId, ...draft } = previous
            annotations.push(
              Object.freeze({
                ...draft,
                annotationId: replacementId,
                supplementalTo: previous.annotationId,
                createdAt: this.now(),
                updatedAt: this.now(),
              }),
            )
            preservedChanges = true
          }
          restoredDrafts.set(item.annotationId, { previous, replacementId })
        }
        const restored = Object.freeze({
          ...item,
          ...(previous?.blockIndex !== undefined && sameAnnotationContent(previous, item)
            ? { blockIndex: previous.blockIndex }
            : {}),
          status: previous?.status === 'processed' ? ('processed' as const) : ('sent' as const),
          updatedAt: previous?.updatedAt ?? payload.createdAt,
          submissionId: payload.submissionId,
        })
        if (index === undefined) {
          known.set(item.annotationId, annotations.length)
          annotations.push(restored)
        } else {
          annotations[index] = restored
        }
      }
    }
    const restoreEditor = (editor: EditorState | null): EditorState | null => {
      if (editor === null || editor.kind === 'new') return editor
      const restored = restoredDrafts.get(editor.annotationId)
      if (restored === undefined) return editor
      if (restored.replacementId !== null)
        return Object.freeze({ ...editor, annotationId: restored.replacementId })
      if (!unfinishedEdit(editor, [restored.previous])) return null
      preservedChanges = true
      return Object.freeze({
        kind: 'new',
        draftId: createAnnotationId(),
        text: editor.text,
        capture: editor.expandedCapture ?? captureAnnotation(restored.previous),
        supplementalTo: restored.previous.annotationId,
        longSelectionConfirmed: editor.longSelectionConfirmed ?? editor.expandedCapture === undefined,
      })
    }
    const editor = restoreEditor(this.view.editor)
    const editorDrafts = this.view.editorDrafts
      .map(restoreEditor)
      .filter((entry): entry is EditorState => entry !== null)
    annotations = annotations.map((item) => {
      if (item.submissionId === undefined) return item
      const sent = submissions.has(item.submissionId)
      const processed =
        submissions.has(item.submissionId) &&
        acknowledgements.get(item.submissionId)?.has(item.annotationId) === true
      const queuedNow = this.view.outbox.some(
        (outbox) =>
          outbox.payload.submissionId === item.submissionId && queued?.has(String(outbox.messageId)),
      )
      const candidate: AnnotationStatus = processed
        ? 'processed'
        : sent
          ? 'sent'
          : queuedNow
            ? 'queued'
            : item.status
      const status = statusAtLeast(item.status, candidate)
      return status === item.status ? item : Object.freeze({ ...item, status, updatedAt: this.now() })
    })
    const outbox = this.view.outbox.map((item) => {
      if (submissions.has(item.payload.submissionId)) {
        const { lastError: _lastError, ...rest } = item
        return Object.freeze({ ...rest, status: 'sent' as const })
      }
      if (queued?.has(String(item.messageId)) && item.status !== 'sent' && item.status !== 'withdrawn') {
        const { lastError: _lastError, ...rest } = item
        return Object.freeze({ ...rest, status: 'queued' as const })
      }
      if (queued !== undefined && item.status === 'queued' && item.targetSessionId === this.sessionId) {
        return Object.freeze({ ...item, status: 'accepted' as const })
      }
      return item
    })
    this.publish({
      ...this.view,
      annotations: withOrdinals(annotations),
      outbox,
      editor,
      editorDrafts: Object.freeze(editorDrafts),
      editorSaveStatus: editor === null ? 'idle' : this.view.editorSaveStatus,
      activeAnnotationId:
        this.view.activeAnnotationId === null
          ? null
          : (restoredDrafts.get(this.view.activeAnnotationId)?.replacementId ?? this.view.activeAnnotationId),
      markerAnnotationId:
        this.view.markerAnnotationId !== null && restoredDrafts.has(this.view.markerAnnotationId)
          ? null
          : this.view.markerAnnotationId,
      notice: preservedChanges ? { level: 'info', text: 'local-edits-preserved' } : this.view.notice,
      latestAssistantMessageId,
    })
  }

  /** Mirror target-owned queue placement or departure, plus durable status, for an archived submission. */
  syncSubmissionState(
    source: AnnotationView,
    submissionId: SubmissionId,
    sourceSessionId: SessionIdentity,
  ): void {
    const sourceAnnotations = new Map(
      source.annotations
        .filter((item) => item.submissionId === submissionId)
        .map((item) => [item.annotationId, item] as const),
    )
    let changed = false
    const annotations = this.view.annotations.map((item) => {
      if (item.submissionId !== submissionId) return item
      const sourceItem = sourceAnnotations.get(item.annotationId)
      if (sourceItem === undefined) return item
      const status = statusAtLeast(item.status, sourceItem.status)
      if (status === item.status) return item
      changed = true
      return Object.freeze({ ...item, status, updatedAt: this.now() })
    })
    const sourceOutbox = source.outbox.find((item) => item.payload.submissionId === submissionId)
    const sourceOwnsTarget = sourceOutbox?.targetSessionId === sourceSessionId
    const mirroredOutboxStatus =
      sourceOutbox?.status === 'sent'
        ? ('sent' as const)
        : sourceOutbox?.status === 'queued' && sourceOwnsTarget
          ? ('queued' as const)
          : sourceOutbox?.status === 'accepted' && sourceOwnsTarget
            ? ('accepted' as const)
            : null
    const outbox = this.view.outbox.map((item) => {
      if (item.payload.submissionId !== submissionId || mirroredOutboxStatus === null) return item
      if (
        item.status === mirroredOutboxStatus ||
        (mirroredOutboxStatus === 'queued' && (item.status === 'sent' || item.status === 'withdrawn')) ||
        (mirroredOutboxStatus === 'accepted' && item.status !== 'queued')
      ) {
        return item
      }
      changed = true
      const { lastError: _lastError, ...rest } = item
      return Object.freeze({ ...rest, status: mirroredOutboxStatus })
    })
    if (changed) this.publish({ ...this.view, annotations, outbox })
  }

  registerEndpoint(messageId: MessageIdentity, endpoint: AnnotationEndpoint): () => void {
    this.endpoints.set(messageId, endpoint)
    if (
      this.pendingNavigation?.messageId === messageId &&
      this.pendingNavigation.navigationEpoch === this.view.navigationEpoch
    ) {
      const pending = this.pendingNavigation
      this.pendingNavigation = null
      endpoint.reveal(pending.annotationId, pending.navigationEpoch)
    }
    return () => {
      if (this.endpoints.get(messageId) === endpoint) this.endpoints.delete(messageId)
    }
  }

  annotateMessage(messageId: MessageIdentity): boolean {
    const endpoint = this.endpoints.get(messageId)
    if (endpoint === undefined) return false
    endpoint.annotateAll()
    return true
  }

  /** Open the plugin-owned Diff panel without changing any submitted source. */
  openDiffPanel(snapshot?: DiffSnapshot, annotationId?: AnnotationId): void {
    this.publish(
      {
        ...this.view,
        diffPanel: {
          ...(snapshot === undefined ? {} : { snapshot }),
          ...(annotationId === undefined ? {} : { annotationId }),
        },
      },
      false,
    )
  }

  closeDiffPanel(): void {
    this.suspendEditor()
    this.publish({ ...this.view, diffPanel: null }, false)
  }

  /** A Shift action may extend only the active new Diff editor on the same frozen side. */
  beginDiffSelection(capture: SelectionCapture, extend = false, supplementalTo?: AnnotationId): void {
    const editor = this.view.editor
    if (capture.source?.kind !== 'diff') throw new Error('Diff selection requires a real file source')
    if (extend && (editor?.kind !== 'new' || sourceKey(editor.capture) !== sourceKey(capture))) {
      throw new Error('Diff ranges must stay on the same file, version and side')
    }
    if (extend && editor?.kind === 'new') {
      this.publish({
        ...this.view,
        editor: {
          ...editor,
          capture,
          longSelectionConfirmed: capture.quote.exact.length <= this.config.warnSelectionChars,
        },
      })
      return
    }
    if (supplementalTo !== undefined) {
      this.suspendEditor()
      this.startNewEditor(capture, supplementalTo)
    } else this.beginSelection(capture)
  }

  async navigate(annotationId: AnnotationId): Promise<boolean> {
    const annotation = this.view.annotations.find((item) => item.annotationId === annotationId)
    if (annotation === undefined) return false
    if (annotation.source?.kind === 'diff') {
      this.suspendEditor()
      this.pendingNavigation = null
      this.publish(
        {
          ...this.view,
          navigationEpoch: this.view.navigationEpoch + 1,
          activeAnnotationId: annotationId,
          markerAnnotationId: null,
          overlap: null,
          panelOpen: false,
        },
        false,
      )
      this.openDiffPanel(annotation.source.snapshot, annotationId)
      return true
    }
    const navigationEpoch = this.view.navigationEpoch + 1
    this.pendingNavigation = null
    this.publish(
      {
        ...this.view,
        activeAnnotationId: null,
        navigationEpoch,
        markerAnnotationId: null,
        panelOpen: false,
      },
      false,
    )
    const endpoint = this.endpoints.get(annotation.messageId!)
    if (endpoint !== undefined) {
      endpoint.reveal(annotationId, navigationEpoch)
      return true
    }
    this.pendingNavigation = { messageId: annotation.messageId!, annotationId, navigationEpoch }
    for (let page = 0; page < this.config.locateHistoryPages; page += 1) {
      if (this.view.navigationEpoch !== navigationEpoch) return false
      if (!this.navigationSession.getSnapshot().hasMore) break
      await this.navigationSession.loadOlder()
      if (this.view.navigationEpoch !== navigationEpoch) return false
      // 官方 loadOlder 只保证数据已取回；目标消息的端点由挂载的助手节点在
      // 随后的 React 提交中注册，可能晚于这次同步检查。给注册留出有界等待。
      const loaded = await this.awaitEndpoint(annotation.messageId!)
      if (this.view.navigationEpoch !== navigationEpoch) return false
      if (loaded !== undefined) {
        if (this.pendingNavigation?.navigationEpoch === navigationEpoch) {
          this.pendingNavigation = null
          loaded.reveal(annotationId, navigationEpoch)
        }
        return true
      }
      // 已加载到历史末尾仍未见目标消息：直接失败，不再空转等待。
      if (!this.navigationSession.getSnapshot().hasMore) break
    }
    if (this.view.navigationEpoch !== navigationEpoch) return false
    if (this.pendingNavigation?.navigationEpoch === navigationEpoch) this.pendingNavigation = null
    this.publish({ ...this.view, notice: { level: 'error', text: 'locate' } }, false)
    return false
  }

  /** Bounded wait for the mounted assistant node to register its endpoint after a history page lands. */
  private async awaitEndpoint(
    messageId: MessageIdentity,
    frames = 5,
  ): Promise<AnnotationEndpoint | undefined> {
    for (let frame = 0; frame < frames; frame += 1) {
      const endpoint = this.endpoints.get(messageId)
      if (endpoint !== undefined) return endpoint
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
        else setTimeout(resolve, 16)
      })
    }
    return this.endpoints.get(messageId)
  }

  private patchOutbox(submissionId: SubmissionId, update: (entry: OutboxEntry) => OutboxEntry): void {
    this.publish({
      ...this.view,
      outbox: this.view.outbox.map((item) =>
        item.payload.submissionId === submissionId ? update(item) : item,
      ),
    })
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      if (this.disposed) return
      this.publish({
        ...this.view,
        editorSaveStatus: this.view.editor === null ? 'idle' : 'saved',
      })
    }, EDITOR_AUTOSAVE_MS)
  }

  private publish(next: AnnotationView, persist = true): void {
    if (this.disposed) return
    if (persist && this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const eligibleIds = new Set(eligibleAnnotations(next).map((item) => item.annotationId))
    const selectedIds = [...new Set(next.selectedAnnotationIds.filter((id) => eligibleIds.has(id)))]
    const selectionUnchanged =
      selectedIds.length === next.selectedAnnotationIds.length &&
      selectedIds.every((id, index) => id === next.selectedAnnotationIds[index])
    const retryPresent = next.outbox.some(
      (item) =>
        item.payload.submissionId === next.retrySubmissionId &&
        (item.status === 'ready' || item.status === 'sending' || item.status === 'failed'),
    )
    this.view = Object.freeze({
      ...next,
      selectedAnnotationIds: selectionUnchanged ? next.selectedAnnotationIds : Object.freeze(selectedIds),
      retrySubmissionId: retryPresent ? next.retrySubmissionId : null,
    })
    if (persist) {
      const saved = this.storage.save(cloneState(this.view))
      this.view = saved
        ? Object.freeze({
            ...this.view,
            editorSaveStatus: this.view.editorSaveStatus === 'saving' ? 'saved' : this.view.editorSaveStatus,
            storageAvailable: true,
            notice: this.view.notice?.text === 'storage' ? null : this.view.notice,
          })
        : Object.freeze({
            ...this.view,
            editorSaveStatus: this.view.editor === null ? 'idle' : 'error',
            storageAvailable: false,
            notice: { level: 'error' as const, text: 'storage' },
          })
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[dsh-annotation] subscriber failed:', error)
      }
    }
  }
}
