import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createAnnotationId, createSubmissionId, submissionMessageId } from '../shared/ids.ts'
import { parseModelAcknowledgements } from '../shared/model-ack.ts'
import { parseInlineAnnotationSource } from '../shared/protocol.ts'
import { PROTOCOL_VERSION } from '../shared/types.ts'
import type {
  AnnotationConfig,
  AnnotationDraft,
  AnnotationId,
  AnnotationStatus,
  AnnotationSubmissionPayload,
  DeliveryMode,
  MessageIdentity,
  OutboxEntry,
  PersistedEditorDraft,
  PersistedSessionState,
  SessionIdentity,
  SubmissionId,
  SubmittedAnnotation,
} from '../shared/types.ts'
import { AnnotationStorage } from './storage.ts'
import type { SelectionCapture } from './selection.ts'
import { rangesOverlap } from './selection.ts'

export type EditorState = PersistedEditorDraft

export interface AnnotationView {
  readonly annotations: readonly AnnotationDraft[]
  readonly outbox: readonly OutboxEntry[]
  readonly overallRequirementDraft: string
  readonly editor: EditorState | null
  readonly editorSaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  readonly deletedDraft: AnnotationDraft | null
  readonly panelOpen: boolean
  readonly notice: { readonly level: 'info' | 'error'; readonly text: string } | null
  readonly activeAnnotationId: AnnotationId | null
  readonly latestAssistantMessageId: MessageIdentity | null
  readonly storageAvailable: boolean
  readonly storageBytes: number
}

export interface AnnotationNavigationSession {
  getSnapshot(): Pick<ConversationSnapshot, 'hasMore'>
  loadOlder(): Promise<void>
}

export interface AnnotationEndpoint {
  reveal(annotationId: AnnotationId): void
  annotateAll(): void
}

const STATUS_RANK: Record<AnnotationStatus, number> = { draft: 0, queued: 1, sent: 2, processed: 3 }
const EDITOR_AUTOSAVE_MS = 400

function sortAnnotations(values: readonly AnnotationDraft[]): AnnotationDraft[] {
  return [...values].sort(
    (left, right) =>
      left.messageSeq - right.messageSeq ||
      left.quote.start - right.quote.start ||
      left.createdAt - right.createdAt,
  )
}

function withOrdinals(values: readonly AnnotationDraft[]): AnnotationDraft[] {
  return sortAnnotations(values).map((value, index) =>
    value.ordinal === index + 1 ? value : Object.freeze({ ...value, ordinal: index + 1 }),
  )
}

function statusAtLeast(current: AnnotationStatus, candidate: AnnotationStatus): AnnotationStatus {
  return STATUS_RANK[current] >= STATUS_RANK[candidate] ? current : candidate
}

function cloneState(view: AnnotationView): PersistedSessionState {
  const editorDraft = view.editor === null || view.editor.text.trim() === '' ? undefined : view.editor
  return Object.freeze({
    storageVersion: 2,
    annotations: view.annotations,
    outbox: view.outbox,
    overallRequirementDraft: view.overallRequirementDraft,
    ...(editorDraft === undefined ? {} : { editorDraft }),
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
  private pendingNavigation: { messageId: MessageIdentity; annotationId: AnnotationId } | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

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
      annotations: persisted.annotations,
      outbox: persisted.outbox,
      overallRequirementDraft: persisted.overallRequirementDraft,
      editor,
      editorSaveStatus: editor === null ? 'idle' : 'saved',
      deletedDraft: null,
      panelOpen: false,
      notice: storage.lastError() === null ? null : { level: 'error' as const, text: 'storage' },
      activeAnnotationId,
      latestAssistantMessageId: null,
      storageAvailable: storage.lastError() === null,
      storageBytes: storage.usageBytes(),
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
    const overlap = this.view.annotations.find(
      (item) => item.messageId === capture.messageId && rangesOverlap(item.quote, capture.quote),
    )
    if (overlap?.status === 'draft') {
      this.publish({
        ...this.view,
        editor: Object.freeze({
          kind: 'edit',
          annotationId: overlap.annotationId,
          text: overlap.comment,
          expandedCapture: capture,
        }),
        editorSaveStatus: 'idle',
        activeAnnotationId: overlap.annotationId,
      })
      return
    }
    this.publish({
      ...this.view,
      editor: Object.freeze({
        kind: 'new',
        capture,
        text: '',
        longSelectionConfirmed: capture.quote.exact.length <= this.config.warnSelectionChars,
        ...(overlap === undefined ? {} : { supplementalTo: overlap.annotationId }),
      }),
      editorSaveStatus: 'idle',
      activeAnnotationId: overlap?.annotationId ?? null,
    })
  }

  openAnnotation(annotationId: AnnotationId): void {
    const item = this.view.annotations.find((candidate) => candidate.annotationId === annotationId)
    if (item === undefined) return
    if (item.status === 'queued') {
      this.publish({
        ...this.view,
        editor: null,
        editorSaveStatus: 'idle',
        panelOpen: true,
        activeAnnotationId: annotationId,
      })
      return
    }
    if (item.status === 'sent' || item.status === 'processed') {
      const capture: SelectionCapture = {
        messageId: item.messageId,
        messageSeq: item.messageSeq,
        responseVersion: item.responseVersion,
        quote: item.quote,
        ...(item.structure === undefined ? {} : { structure: item.structure }),
        rect: { top: 0, left: 0, bottom: 0, right: 0 },
      }
      this.publish({
        ...this.view,
        editor: Object.freeze({
          kind: 'new',
          capture,
          text: '',
          longSelectionConfirmed: true,
          supplementalTo: annotationId,
        }),
        editorSaveStatus: 'idle',
        activeAnnotationId: annotationId,
      })
      return
    }
    this.publish({
      ...this.view,
      editor: Object.freeze({ kind: 'edit', annotationId, text: item.comment }),
      editorSaveStatus: 'idle',
      activeAnnotationId: annotationId,
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
    if (this.view.editor?.kind !== 'new') return
    this.publish({
      ...this.view,
      editor: Object.freeze({ ...this.view.editor, longSelectionConfirmed: true }),
      editorSaveStatus: 'saved',
    })
  }

  saveEditor(): AnnotationId {
    const editor = this.view.editor
    if (editor === null) throw new Error('no annotation editor is open')
    const comment = editor.text.trim()
    if (comment.length === 0) throw new Error('annotation comment is blank')
    const time = this.now()
    let savedId: AnnotationId
    let annotations: AnnotationDraft[]
    if (editor.kind === 'new') {
      if (!editor.longSelectionConfirmed) throw new Error('long selection is not confirmed')
      savedId = createAnnotationId()
      const supplementalTo = editor.supplementalTo
      annotations = withOrdinals([
        ...this.view.annotations,
        Object.freeze({
          annotationId: savedId,
          ordinal: this.view.annotations.length + 1,
          messageId: editor.capture.messageId,
          messageSeq: editor.capture.messageSeq,
          responseVersion: editor.capture.responseVersion,
          quote: editor.capture.quote,
          comment,
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
          return Object.freeze({
            ...item,
            comment,
            ...(capture === undefined
              ? {}
              : {
                  quote: capture.quote,
                  structure: capture.structure,
                }),
            updatedAt: time,
          })
        }),
      )
    }
    this.publish({
      ...this.view,
      annotations,
      editor: null,
      editorSaveStatus: 'idle',
      activeAnnotationId: savedId,
    })
    return savedId
  }

  closeEditor(force = false): boolean {
    const editor = this.view.editor
    if (editor === null) return true
    const dirty =
      editor.kind === 'new'
        ? editor.text.trim().length > 0
        : editor.expandedCapture !== undefined ||
          this.view.annotations.find((item) => item.annotationId === editor.annotationId)?.comment !==
            editor.text
    if (!force && dirty) return false
    this.publish({
      ...this.view,
      editor: null,
      editorSaveStatus: 'idle',
      activeAnnotationId: null,
    })
    return true
  }

  deleteDraft(annotationId: AnnotationId): void {
    const target = this.view.annotations.find((item) => item.annotationId === annotationId)
    if (target === undefined) return
    if (target.status !== 'draft') throw new Error('only draft annotations can be deleted')
    const closesEditor =
      (this.view.editor?.kind === 'edit' && this.view.editor.annotationId === annotationId) ||
      (this.view.editor?.kind === 'new' && this.view.editor.supplementalTo === annotationId)
    this.publish({
      ...this.view,
      annotations: withOrdinals(this.view.annotations.filter((item) => item.annotationId !== annotationId)),
      editor: closesEditor ? null : this.view.editor,
      editorSaveStatus: closesEditor ? 'idle' : this.view.editorSaveStatus,
      deletedDraft: target,
      activeAnnotationId: this.view.activeAnnotationId === annotationId ? null : this.view.activeAnnotationId,
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
      deletedDraft: null,
      activeAnnotationId: deleted.annotationId,
    })
  }

  dismissDeleteUndo(): void {
    if (this.view.deletedDraft === null) return
    this.publish({ ...this.view, deletedDraft: null }, false)
  }

  setPanelOpen(panelOpen: boolean): void {
    this.publish({ ...this.view, panelOpen }, false)
  }

  setOverallRequirementDraft(overallRequirementDraft: string): void {
    this.publish({ ...this.view, overallRequirementDraft })
  }

  exportLocalData(): string {
    return JSON.stringify(cloneState(this.view), null, 2)
  }

  clearLocalDrafts(): void {
    const draftIds = new Set(
      this.view.annotations.filter((item) => item.status === 'draft').map((item) => item.annotationId),
    )
    this.publish({
      ...this.view,
      annotations: withOrdinals(this.view.annotations.filter((item) => item.status !== 'draft')),
      overallRequirementDraft: '',
      editor: null,
      editorSaveStatus: 'idle',
      deletedDraft: null,
      activeAnnotationId:
        this.view.activeAnnotationId !== null && draftIds.has(this.view.activeAnnotationId)
          ? null
          : this.view.activeAnnotationId,
    })
  }

  setNotice(level: 'info' | 'error', text: string): void {
    this.publish({ ...this.view, notice: { level, text } }, false)
  }

  clearNotice(): void {
    this.publish({ ...this.view, notice: null }, false)
  }

  createOutbox(delivery: DeliveryMode, targetSessionId: SessionIdentity): OutboxEntry {
    const retry = this.view.outbox.find((item) => item.status === 'failed' || item.status === 'ready')
    if (retry !== undefined) return retry
    const drafts = sortAnnotations(this.view.annotations.filter((item) => item.status === 'draft'))
    if (drafts.length === 0) throw new Error('no draft annotations to submit')
    const submissionId = createSubmissionId()
    const annotations: SubmittedAnnotation[] = drafts.map((item, index) =>
      Object.freeze({
        annotationId: item.annotationId,
        ordinal: index + 1,
        messageId: item.messageId,
        messageSeq: item.messageSeq,
        responseVersion: item.responseVersion,
        quote: item.quote,
        comment: item.comment,
        ...(item.structure === undefined ? {} : { structure: item.structure }),
        createdAt: item.createdAt,
      }),
    )
    const overall = this.view.overallRequirementDraft.trim()
    const payload: AnnotationSubmissionPayload = Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      submissionId,
      sessionId: targetSessionId,
      delivery,
      createdAt: this.now(),
      ...(overall.length === 0 ? {} : { overallRequirement: overall }),
      annotations: Object.freeze(annotations),
    })
    const entry: OutboxEntry = Object.freeze({
      payload,
      targetSessionId,
      messageId: submissionMessageId(submissionId),
      status: 'ready',
      attempts: 0,
    })
    const selected = new Set(drafts.map((item) => item.annotationId))
    const nextAnnotations = this.view.annotations.map((item) =>
      selected.has(item.annotationId)
        ? Object.freeze({ ...item, status: 'queued' as const, submissionId, updatedAt: this.now() })
        : item,
    )
    this.publish({
      ...this.view,
      annotations: nextAnnotations,
      outbox: [...this.view.outbox, entry],
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
      const { lastError: _lastError, ...rest } = item
      return Object.freeze({ ...rest, status: 'sending', attempts: item.attempts + 1 })
    })
  }

  markAccepted(submissionId: SubmissionId): void {
    this.patchOutbox(submissionId, (item) => {
      const { lastError: _lastError, ...rest } = item
      return Object.freeze({ ...rest, status: 'queued' })
    })
  }

  markFailed(submissionId: SubmissionId, error: string): void {
    this.patchOutbox(submissionId, (item) => Object.freeze({ ...item, status: 'failed', lastError: error }))
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

  reconcile(snapshot: ConversationSnapshot): void {
    const submissions = new Map<SubmissionId, AnnotationSubmissionPayload>()
    const acknowledgements = new Map<SubmissionId, Set<AnnotationId>>()
    let latestAssistantMessageId: MessageIdentity | null = null
    for (const node of snapshot.chat.nodes.values()) {
      const source = sourceFromInputNode(node)
      const payload = parseInlineAnnotationSource(source)
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
    const queued = new Set(snapshot.queue.map((item) => String(item.messageId)))
    let annotations = [...this.view.annotations]
    const known = new Set(annotations.map((item) => item.annotationId))
    for (const payload of submissions.values()) {
      for (const item of payload.annotations) {
        if (known.has(item.annotationId)) continue
        known.add(item.annotationId)
        annotations.push(
          Object.freeze({
            ...item,
            status: 'sent',
            updatedAt: payload.createdAt,
            submissionId: payload.submissionId,
          }),
        )
      }
    }
    annotations = annotations.map((item) => {
      if (item.submissionId === undefined) return item
      const sent = submissions.has(item.submissionId)
      const processed =
        submissions.has(item.submissionId) &&
        acknowledgements.get(item.submissionId)?.has(item.annotationId) === true
      const queuedNow = this.view.outbox.some(
        (outbox) => outbox.payload.submissionId === item.submissionId && queued.has(String(outbox.messageId)),
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
      if (submissions.has(item.payload.submissionId))
        return Object.freeze({ ...item, status: 'sent' as const })
      if (queued.has(String(item.messageId)) && item.status !== 'failed')
        return Object.freeze({ ...item, status: 'queued' as const })
      return item
    })
    this.publish({
      ...this.view,
      annotations: withOrdinals(annotations),
      outbox,
      latestAssistantMessageId,
    })
  }

  /** Mirror durable status only when one archived-source submission is observed in its fork target. */
  syncSubmissionState(source: AnnotationView, submissionId: SubmissionId): void {
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
    const outbox = this.view.outbox.map((item) => {
      if (
        item.payload.submissionId !== submissionId ||
        sourceOutbox?.status !== 'sent' ||
        item.status === 'sent'
      ) {
        return item
      }
      changed = true
      return Object.freeze({ ...item, status: 'sent' as const })
    })
    if (changed) this.publish({ ...this.view, annotations, outbox })
  }

  registerEndpoint(messageId: MessageIdentity, endpoint: AnnotationEndpoint): () => void {
    this.endpoints.set(messageId, endpoint)
    if (this.pendingNavigation?.messageId === messageId) {
      const pending = this.pendingNavigation
      this.pendingNavigation = null
      endpoint.reveal(pending.annotationId)
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

  async navigate(annotationId: AnnotationId): Promise<boolean> {
    const annotation = this.view.annotations.find((item) => item.annotationId === annotationId)
    if (annotation === undefined) return false
    this.publish({ ...this.view, activeAnnotationId: annotationId, panelOpen: false }, false)
    const endpoint = this.endpoints.get(annotation.messageId)
    if (endpoint !== undefined) {
      endpoint.reveal(annotationId)
      return true
    }
    this.pendingNavigation = { messageId: annotation.messageId, annotationId }
    for (let page = 0; page < this.config.locateHistoryPages; page += 1) {
      if (!this.navigationSession.getSnapshot().hasMore) break
      await this.navigationSession.loadOlder()
      const loaded = this.endpoints.get(annotation.messageId)
      if (loaded !== undefined) {
        this.pendingNavigation = null
        loaded.reveal(annotationId)
        return true
      }
    }
    this.pendingNavigation = null
    this.publish({ ...this.view, notice: { level: 'error', text: 'locate' } }, false)
    return false
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
    this.view = Object.freeze(next)
    if (persist) {
      const saved = this.storage.save(cloneState(this.view))
      this.view = saved
        ? Object.freeze({
            ...this.view,
            editorSaveStatus: this.view.editorSaveStatus === 'saving' ? 'saved' : this.view.editorSaveStatus,
            storageAvailable: true,
            storageBytes: this.storage.usageBytes(),
            notice: this.view.notice?.text === 'storage' ? null : this.view.notice,
          })
        : Object.freeze({
            ...this.view,
            editorSaveStatus: this.view.editor === null ? 'idle' : 'error',
            storageAvailable: false,
            storageBytes: this.storage.usageBytes(),
            notice: { level: 'error' as const, text: 'storage' },
          })
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[dsh-inline-annotations] subscriber failed:', error)
      }
    }
  }
}
