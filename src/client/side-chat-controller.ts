/** Owns one main Session's parallel side chats, their ordered references, and frozen transport state. */
import type {
  ISessions,
  SessionBinding,
  SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSubmissionId } from '../shared/ids.ts'
import {
  parseSideChatSubmissionPayload,
  sideChatSubmissionFingerprint,
} from '../shared/side-chat-protocol.ts'
import {
  SIDE_CHAT_PROTOCOL_SOURCE,
  SIDE_CHAT_PROTOCOL_VERSION,
  SIDE_CHAT_STORAGE_VERSION,
  type PersistedSideChatEntry,
  type PersistedSideChatState,
  type SideChatId,
  type SideChatOutbox,
  type SideChatReceiptState,
  type SideChatReference,
  type SideChatReferenceId,
  type SideChatSubmissionPayload,
} from '../shared/side-chat-types.ts'
import type {
  AnnotationSubmissionPayload,
  ProtocolLocale,
  SubmissionId,
  SubmittedAttachmentIdentity,
} from '../shared/types.ts'
import type { SelectionCapture } from './selection.ts'
import { SideChatStorage, type SideChatSaveResult } from './side-chat-storage.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Annotation plugin's independent side-chat lifetime, including a hidden panel. */
    annotationSideChat: unknown
    /** Preserve the source main's Client scope and runtime drafts while its side association is active. */
    annotationSideChatMain: unknown
  }
}

/** Stable handling identity; receiving UI supplies the localized summary and recovery action. */
export type SideChatFailureCode =
  | 'create'
  | 'workspace'
  | 'load'
  | 'unavailable'
  | 'storage'
  | 'source'
  | 'frozen'
  | 'send-failed'
  | 'send-unknown'
  | 'receipt-conflict'
  | 'disposed'

/** The controller's affected operation failed; drafts and confirmed references remain intact. */
export class SideChatFailure extends Error {
  /** @param code - Handling identity. @param cause - Original failure, retained outside UI text. */
  constructor(
    readonly code: SideChatFailureCode,
    cause?: unknown,
  ) {
    super(`Side-chat operation failed: ${code}`, cause === undefined ? undefined : { cause })
    this.name = 'SideChatFailure'
  }
}

/** One parallel side chat as the panel, the list, and the reference dock read it. */
export interface SideChatChatView {
  readonly sideChatId: SideChatId
  readonly sideSessionId: SessionId | null
  readonly title: string | null
  readonly archived: boolean
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'disposed'
  readonly references: readonly SideChatReference[]
  /** Saved source occurrences retain their identity after send. */
  readonly referenceRecords: readonly SideChatReference[]
  readonly referenceRecordIds?: readonly SideChatReferenceId[]
  readonly failure: SideChatFailure | null
  readonly outbox: SideChatOutbox | null
  /** Whether this chat's reference record panel is expanded above the composer. */
  readonly panelOpen: boolean
  readonly saveState: SideChatSaveState
}

/** How the latest browser-local write settled; drives the visible save feedback. */
export type SideChatSaveState = 'saved' | 'merged' | 'unavailable' | 'conflict'

/** Narrow observable face for the main Session's side-chat panel and reference dock. */
export interface SideChatView {
  readonly mainSessionId: SessionId
  /** Chats in stable creation order; every parallel chat shares one main Session but no state. */
  readonly chats: readonly SideChatChatView[]
  readonly activeSideChatId: SideChatId | null
  /** The chat that renders now and receives newly confirmed references, if any. */
  readonly active: SideChatChatView | null
  readonly visible: boolean
  readonly storageAvailable: boolean
  /** Incompatible browser edits block dependent mutations until recovery succeeds. */
  readonly storageOutdated: boolean
  /** Result of the latest browser-local write, including conflict and unavailable storage. */
  readonly saveState: SideChatSaveState
  /** Latest local changes have a durable recovery record, including unresolved edits. */
  readonly recoveryAvailable: boolean
  /** Active-chat mirrors; absent while no chat exists. */
  readonly sideSessionId: SessionId | null
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'disposed'
  readonly references: readonly SideChatReference[]
  readonly failure: SideChatFailure | null
  readonly outbox: SideChatOutbox | null
}

/** Session creation details belong to the current main Session's environment. */
export interface SideChatControllerOptions {
  /** Creation options used when no asynchronous environment resolver is configured. */
  readonly createOptions?: Parameters<ISessions['create']>[0]
  /** @param ordinal - Creation slot, including archived/deleted chats. @returns A localized name saved in the existing title field. */
  readonly untitled?: (ordinal: number) => string
  /**
   * Resolve the main Session's environment before initial creation; cancellation releases resolver-owned resources.
   * @param signal - Current preparation lifetime.
   * @returns Creation options for the main Session's existing environment.
   */
  readonly resolveCreateOptions?: (signal: AbortSignal) => Promise<Parameters<ISessions['create']>[0]>
  readonly onReady?: (binding: SessionBinding, sideChatId: SideChatId) => void | Promise<void>
  readonly now?: () => number
  readonly randomUUID?: () => string
}

/** Composer content and attachment identities captured by the existing submission owner. */
export interface SideChatSubmissionInput {
  readonly question: string
  readonly protocolLocale: ProtocolLocale
  readonly attachmentIdentities: readonly SubmittedAttachmentIdentity[]
  readonly annotationSubmission?: AnnotationSubmissionPayload
  readonly submissionId?: SubmissionId
  /** Captured before asynchronous composer/attachment serialization when supplied. */
  readonly references?: readonly SideChatReference[]
  /** Explicitly resubmit the same frozen request, including an unknown outcome. */
  readonly retry?: boolean
  /** Complete composite admission checks run before the pending request is published. */
  readonly validate?: (payload: SideChatSubmissionPayload) => void
}

const EMPTY_REFERENCES: readonly SideChatReference[] = Object.freeze([])

/** Mutable per-chat state; the frozen view published above is derived from it. */
interface ChatState {
  readonly sideChatId: SideChatId
  sideSessionId: SessionId | null
  created: boolean
  title: string | null
  archived: boolean
  references: readonly SideChatReference[]
  referenceRecords: readonly SideChatReference[]
  referenceRecordIds: readonly SideChatReferenceId[]
  removedReferenceIds: readonly SideChatReferenceId[]
  outbox: SideChatOutbox | null
  status: SideChatChatView['status']
  failure: SideChatFailure | null
  reference: SessionReference | null
  preparation: Promise<SessionBinding> | null
  acquisition: AbortController | null
  unsubscribeSession: (() => void) | null
  epoch: number
  removed: boolean
  panelOpen: boolean
  saveState: SideChatSaveState
  view: SideChatChatView | null
}

function freezeChat(chat: ChatState): SideChatChatView {
  const previous = chat.view
  if (
    previous !== null &&
    previous.sideSessionId === chat.sideSessionId &&
    previous.title === chat.title &&
    previous.archived === chat.archived &&
    previous.status === chat.status &&
    previous.references === chat.references &&
    previous.referenceRecords === chat.referenceRecords &&
    previous.referenceRecordIds === chat.referenceRecordIds &&
    previous.failure === chat.failure &&
    previous.outbox === chat.outbox &&
    previous.panelOpen === chat.panelOpen &&
    previous.saveState === chat.saveState
  )
    return previous
  chat.view = Object.freeze({
    sideChatId: chat.sideChatId,
    sideSessionId: chat.sideSessionId,
    title: chat.title,
    archived: chat.archived,
    status: chat.status,
    references: chat.references,
    referenceRecords: chat.referenceRecords,
    referenceRecordIds: chat.referenceRecordIds,
    failure: chat.failure,
    outbox: chat.outbox,
    panelOpen: chat.panelOpen,
    saveState: chat.saveState,
  })
  return chat.view
}

/** Owns every parallel side chat of one main Session until suspend/dispose; hiding affects presentation only. */
export class SideChatController {
  private chats: ChatState[] = []
  private activeSideChatId: SideChatId | null = null
  private visible = false
  private deletedSideChatIds = new Set<SideChatId>()
  private view: SideChatView
  private mainReference: SessionReference | null = null
  private mainAcquisition: AbortController | null = null
  private mainReadiness: Promise<SessionBinding> | null = null
  private unsubscribeMainSession: (() => void) | null = null
  private closed = false
  private disposed = false
  private saveState: SideChatSaveState = 'saved'
  private readonly listeners = new Set<() => void>()
  /** Per-chat projection caches; a chat's observable keeps one identity and stable snapshots. */
  private readonly chatObservables = new Map<SideChatId, HostObservable<SideChatView>>()
  private readonly now: () => number
  private readonly randomUUID: () => string
  /** Initial browser-read failure, cleared after successful recovery. */
  private storageFailure: SideChatFailure | null
  private readonly unsubscribeStorage: () => void

  /** @param mainSessionId - Association owner. @param sessions - Ordinary Session lifecycle API. @param storage - Browser-local pending-state owner. @param options - Creation scope and deterministic test inputs. */
  constructor(
    readonly mainSessionId: SessionId,
    private readonly sessions: Pick<ISessions, 'create' | 'retain'>,
    private readonly storage: SideChatStorage,
    private readonly options: SideChatControllerOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
    let saved: PersistedSideChatState | null = null
    let failure: SideChatFailure | null = null
    try {
      saved = storage.load()
    } catch (cause: unknown) {
      failure = new SideChatFailure('storage', cause)
    }
    this.storageFailure = failure
    this.saveState = !storage.available ? 'unavailable' : storage.outdated ? 'conflict' : 'saved'
    if (saved !== null) {
      this.chats = saved.chats.map((entry, index) => this.restore(entry, failure, index + 1))
      this.deletedSideChatIds = new Set(saved.deletedSideChatIds ?? [])
      this.activeSideChatId =
        this.chats.find((chat) => chat.sideChatId === saved.activeSideChatId && !chat.archived)?.sideChatId ??
        this.chats.find((chat) => !chat.archived)?.sideChatId ??
        null
      this.visible = saved.visible
    }
    this.view = this.derive()
    this.unsubscribeStorage = storage.subscribe(() => this.synchronizeStorage())
  }

  /** @returns Immutable state; unchanged reads reuse the same object. */
  getSnapshot = (): SideChatView => this.view

  /**
   * Bind a composer to one exact side chat, independent of the panel's current selection.
   *
   * The returned observable keeps a stable identity and reuses its snapshot while that
   * chat's projection is unchanged, so switching the panel from B to A cannot make a
   * standalone A composer read B's references, panel state, or save status.
   * @param sideChatId - Chat owning the composer's Session.
   * @returns A stable observable whose active chat is always {@link sideChatId}.
   */
  observableFor(sideChatId: SideChatId): HostObservable<SideChatView> {
    const existing = this.chatObservables.get(sideChatId)
    if (existing !== undefined) return existing
    let snapshot: SideChatView | null = null
    const project = (): SideChatView => {
      const view = this.view
      const chat = view.chats.find((candidate) => candidate.sideChatId === sideChatId) ?? null
      const saveState =
        view.saveState === 'unavailable' || view.saveState === 'conflict'
          ? view.saveState
          : (chat?.saveState ?? 'saved')
      const status = chat?.status ?? (this.disposed ? 'disposed' : 'idle')
      if (
        snapshot !== null &&
        snapshot.active === chat &&
        snapshot.storageAvailable === view.storageAvailable &&
        snapshot.storageOutdated === view.storageOutdated &&
        snapshot.saveState === saveState &&
        snapshot.recoveryAvailable === view.recoveryAvailable &&
        snapshot.status === status
      )
        return snapshot
      snapshot = Object.freeze({
        ...view,
        chats: Object.freeze(chat === null ? [] : [chat]),
        activeSideChatId: sideChatId,
        active: chat,
        visible: false,
        sideSessionId: chat?.sideSessionId ?? null,
        status,
        references: chat?.references ?? EMPTY_REFERENCES,
        failure: chat?.failure ?? this.storageFailure,
        outbox: chat?.outbox ?? null,
        saveState,
      })
      return snapshot
    }
    const observable: HostObservable<SideChatView> = {
      getSnapshot: project,
      subscribe: (listener) => {
        let previous = project()
        return this.subscribe(() => {
          const next = project()
          if (next === previous) return
          previous = next
          listener()
        })
      },
    }
    this.chatObservables.set(sideChatId, observable)
    return observable
  }

  /** @param sideChatId - Chat to read; the active chat by default. @returns Its frozen view, or null. */
  chatView(sideChatId?: SideChatId): SideChatChatView | null {
    const chat = this.chat(sideChatId)
    return chat === null ? null : freezeChat(chat)
  }

  /** @param sideChatId - Chat whose retained SessionProvider reference is wanted; the active one by default. @returns The ready owner-held reference, without acquiring another lifetime. */
  getReference(sideChatId?: SideChatId): SessionReference | undefined {
    const chat = this.chat(sideChatId)
    if (this.closed || chat === null || chat.status !== 'ready') return undefined
    return chat.reference ?? undefined
  }

  /** @param listener - View-change observer. @returns Its disposer. */
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {}
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @returns The newly created chat, already selected for subsequent confirmations. */
  createChat(): SideChatChatView {
    this.assertMutable()
    const chat: ChatState = {
      sideChatId: `side-chat-${this.randomUUID()}` as SideChatId,
      sideSessionId: null,
      created: false,
      title: this.options.untitled?.(this.chats.length + this.deletedSideChatIds.size + 1) ?? null,
      archived: false,
      references: EMPTY_REFERENCES,
      referenceRecords: EMPTY_REFERENCES,
      referenceRecordIds: [],
      removedReferenceIds: [],
      outbox: null,
      status: 'idle',
      failure: null,
      reference: null,
      preparation: null,
      acquisition: null,
      unsubscribeSession: null,
      epoch: 0,
      removed: false,
      panelOpen: false,
      saveState: this.saveState,
      view: null,
    }
    this.chats = [...this.chats, chat]
    this.activeSideChatId = chat.sideChatId
    this.publish(chat.sideChatId)
    return freezeChat(chat)
  }

  /** @param sideChatId - Chat that receives the next confirmed reference. @returns Nothing; collected references stay where they were confirmed. */
  selectChat(sideChatId: SideChatId): void {
    if (this.closed || this.activeSideChatId === sideChatId) return
    const chat = this.chat(sideChatId)
    if (chat === null || chat.archived || chat.removed) throw new SideChatFailure('unavailable')
    this.activeSideChatId = sideChatId
    this.publish()
  }

  private successor(sideChatId: SideChatId): SideChatId | null {
    const active = this.chats.filter((chat) => !chat.archived && !chat.removed)
    const index = active.findIndex((chat) => chat.sideChatId === sideChatId)
    return active[index + 1]?.sideChatId ?? active[index - 1]?.sideChatId ?? null
  }

  /** @param sideChatId - Exact association after successful official deletion. @returns Nothing; permanent markers reject stale-page resurrection. */
  removeChat(sideChatId: SideChatId): void {
    if (this.closed) return
    const chat = this.chat(sideChatId)
    if (this.activeSideChatId === sideChatId) this.activeSideChatId = this.successor(sideChatId)
    this.deletedSideChatIds.add(sideChatId)
    const durable = this.storage.markDeleted(sideChatId)
    if (chat !== null) {
      chat.removed = true
      this.releaseChat(chat)
      this.chats = this.chats.filter((candidate) => candidate !== chat)
    }
    this.publish()
    if (!durable) this.applySave({ status: 'unavailable' })
  }

  /** @param sideChatId - Exact association observed in the official archive set. @param archived - Host-authoritative archive state. @returns Nothing; restoration retains the original Session and browser data. */
  setArchived(sideChatId: SideChatId, archived: boolean): void {
    const chat = this.chat(sideChatId)
    if (this.closed || chat === null || chat.archived === archived) return
    if (archived && this.activeSideChatId === sideChatId) this.activeSideChatId = this.successor(sideChatId)
    chat.archived = archived
    if (!archived && this.activeSideChatId === null) this.activeSideChatId = sideChatId
    this.publish()
  }

  /** @param capture - Confirmed main assistant occurrence. @param sideChatId - Receiving chat; created on demand for the first reference. @returns Newly appended stable reference, synchronously. */
  collect(capture: SelectionCapture, sideChatId?: SideChatId): SideChatReference {
    this.assertMutable()
    if (capture.source !== undefined && capture.source.kind !== 'message') throw new SideChatFailure('source')
    if (
      capture.messageId === undefined ||
      capture.messageSeq === undefined ||
      capture.responseVersion === undefined
    )
      throw new SideChatFailure('source')
    const chat = this.targetChat(sideChatId)
    const reference: SideChatReference = Object.freeze({
      referenceId: `side-ref-${this.randomUUID()}` as SideChatReferenceId,
      sourceSessionId: this.mainSessionId,
      messageId: capture.messageId,
      messageSeq: capture.messageSeq,
      responseVersion: capture.responseVersion,
      quote: Object.freeze({ ...capture.quote }),
      createdAt: this.now(),
    })
    chat.references = Object.freeze([...chat.references, reference])
    chat.referenceRecords = Object.freeze([...chat.referenceRecords, reference])
    chat.referenceRecordIds = Object.freeze([...chat.referenceRecordIds, reference.referenceId])
    this.publish(chat.sideChatId)
    return reference
  }

  /** @param referenceId - Pending occurrence to remove. @param sideChatId - Owning chat; the active one by default. @returns Nothing; composer content is untouched. */
  removeReference(referenceId: SideChatReferenceId, sideChatId?: SideChatId): void {
    if (this.closed || !this.lastSaveSucceeded) return
    const chat = this.chat(sideChatId)
    if (chat === null) return
    const references = chat.references.filter((item) => item.referenceId !== referenceId)
    const records = chat.referenceRecords.filter((item) => item.referenceId !== referenceId)
    if (references.length === chat.references.length && records.length === chat.referenceRecords.length)
      return
    chat.references = Object.freeze(references)
    chat.referenceRecords = Object.freeze(records)
    chat.removedReferenceIds = Object.freeze([...new Set([...chat.removedReferenceIds, referenceId])])
    if (references.length === 0) chat.panelOpen = false
    this.publish(chat.sideChatId)
  }

  /**
   * Retire only references whose annotation copies are already durable.
   * @param referenceIds - Exact successfully imported occurrences.
   * @param sideChatId - Receiving chat captured before import.
   * @returns Nothing; frozen submissions keep their original records and retry identity.
   */
  retireMigratedReferences(referenceIds: readonly SideChatReferenceId[], sideChatId: SideChatId): void {
    const chat = this.chat(sideChatId)
    if (this.closed || !this.lastSaveSucceeded || chat === null || chat.outbox !== null) return
    const ids = new Set(referenceIds)
    chat.references = Object.freeze(chat.references.filter((item) => !ids.has(item.referenceId)))
    chat.referenceRecords = Object.freeze(chat.referenceRecords.filter((item) => !ids.has(item.referenceId)))
    chat.removedReferenceIds = Object.freeze([...new Set([...chat.removedReferenceIds, ...ids])])
    if (chat.references.length === 0) chat.panelOpen = false
    this.publish(chat.sideChatId)
  }

  /** @param sideChatId - Chat whose pending references leave this send. @returns Nothing; question, annotations, and history stay intact. */
  removeAllReferences(sideChatId?: SideChatId): void {
    if (this.closed || !this.lastSaveSucceeded) return
    const chat = this.chat(sideChatId)
    if (chat === null || chat.references.length === 0) return
    const removed = new Set(chat.references.map((item) => item.referenceId))
    chat.removedReferenceIds = Object.freeze([...new Set([...chat.removedReferenceIds, ...removed])])
    chat.referenceRecords = Object.freeze(
      chat.referenceRecords.filter((item) => !removed.has(item.referenceId)),
    )
    chat.references = EMPTY_REFERENCES
    chat.panelOpen = false
    this.publish(chat.sideChatId)
  }

  /** @param open - Whether the active chat's reference record panel is expanded. @param sideChatId - Chat to toggle; the active one by default. @returns Nothing. */
  setReferencePanelOpen(open: boolean, sideChatId?: SideChatId): void {
    if (this.closed) return
    const chat = this.chat(sideChatId)
    if (chat === null || chat.panelOpen === open) return
    chat.panelOpen = open
    this.publish()
  }

  /** @returns Nothing; explicit presentation opens preserve every chat and composer. */
  show(): void {
    this.assertOpen()
    if (!this.visible) {
      this.visible = true
      this.publish()
    }
  }

  /** @returns Nothing; hidden chats retain their live Sessions and pending content. */
  hide(): void {
    if (this.closed || !this.visible) return
    this.visible = false
    this.publish()
  }

  /** @param sideChatId - Chat to prepare; the active one by default. @returns The associated retained binding. Concurrent callers share one creation/opening attempt. */
  prepare(sideChatId?: SideChatId): Promise<SessionBinding> {
    if (this.closed) return Promise.reject(new SideChatFailure('disposed'))
    const chat = this.targetChat(sideChatId)
    if (chat.removed) return Promise.reject(new SideChatFailure('unavailable'))
    if (chat.status === 'ready' && chat.reference !== null) return Promise.resolve(chat.reference.binding)
    if (chat.preparation !== null) return chat.preparation
    chat.unsubscribeSession?.()
    chat.unsubscribeSession = null
    chat.reference?.release()
    chat.reference = null
    if (chat.sideSessionId === null) chat.sideSessionId = `annotation-side-${this.randomUUID()}` as SessionId
    const epoch = ++chat.epoch
    const acquisition = new AbortController()
    chat.acquisition = acquisition
    const mainReady = this.retainMain()
    chat.status = 'preparing'
    chat.failure = null
    const requestedId = chat.sideSessionId
    this.publish()
    const operation = async (): Promise<SessionBinding> => {
      let stage: 'create' | 'load' = 'create'
      try {
        await mainReady
        this.assertGeneration(chat, epoch)
        let sideSessionId = requestedId
        if (!chat.created) {
          this.assertMutable()
          const createOptions =
            this.options.resolveCreateOptions === undefined
              ? this.options.createOptions
              : await this.options.resolveCreateOptions(acquisition.signal)
          this.assertGeneration(chat, epoch)
          sideSessionId = await this.sessions.create({ ...createOptions, sessionId: requestedId })
          if (sideSessionId === this.mainSessionId) throw new SideChatFailure('unavailable')
          // Record the Host identity before the generation check: a creation that lands
          // after suspension still exists, and a later attempt must reuse it.
          chat.created = true
          chat.sideSessionId = sideSessionId
          this.assertGeneration(chat, epoch)
          this.publish()
        }
        stage = 'load'
        this.assertGeneration(chat, epoch)
        const reference = this.sessions.retain(sideSessionId, {
          source: 'annotationSideChat',
          signal: acquisition.signal,
        })
        chat.reference = reference
        const binding = await reference.ready
        this.assertGeneration(chat, epoch)
        const observeSession = () => {
          if (chat.epoch !== epoch || this.closed) return
          const snapshot = binding.session.getSnapshot()
          if (snapshot.removed) chat.removed = true
          if (snapshot.removed || snapshot.openState === 'error') {
            chat.status = 'error'
            chat.failure = new SideChatFailure('unavailable')
            this.publish()
          }
        }
        chat.unsubscribeSession = binding.session.subscribe(observeSession)
        const snapshot = binding.session.getSnapshot()
        if (snapshot.removed || snapshot.openState === 'error') {
          chat.removed = snapshot.removed
          throw new SideChatFailure('unavailable')
        }
        await this.options.onReady?.(binding, chat.sideChatId)
        this.assertGeneration(chat, epoch)
        chat.status = 'ready'
        chat.failure = this.outboxFailure(chat.outbox)
        this.publish()
        return binding
      } catch (cause: unknown) {
        if (chat.epoch !== epoch || this.closed) throw new SideChatFailure('disposed', cause)
        chat.unsubscribeSession?.()
        chat.unsubscribeSession = null
        chat.reference?.release()
        chat.reference = null
        const failure = chat.removed
          ? new SideChatFailure('unavailable', cause)
          : cause instanceof SideChatFailure
            ? cause
            : new SideChatFailure(stage, cause)
        chat.status = 'error'
        chat.failure = failure
        this.publish()
        throw failure
      } finally {
        if (chat.epoch === epoch) {
          chat.preparation = null
          chat.acquisition = null
        }
      }
    }
    const preparation = Promise.resolve().then(operation)
    chat.preparation = preparation
    return preparation
  }

  /** @param input - Frozen composer content. @param sideChatId - Sending chat; the active one by default. @returns One immutable request; later collection changes only the next request. */
  snapshotSubmission(input: SideChatSubmissionInput, sideChatId?: SideChatId): SideChatSubmissionPayload {
    this.assertMutable()
    const chat = this.chat(sideChatId)
    if (
      chat === null ||
      chat.status !== 'ready' ||
      chat.sideSessionId === null ||
      chat.reference === null ||
      chat.reference.binding.session.getSnapshot().removed
    )
      throw new SideChatFailure('unavailable')
    const previous = chat.outbox
    if (previous?.failureCode === 'receipt-conflict') throw new SideChatFailure('receipt-conflict')
    if (previous !== null && previous.status !== 'accepted') {
      if (input.retry === true && previous.status !== 'sending') return previous.payload
      throw new SideChatFailure('frozen')
    }
    const payload = parseSideChatSubmissionPayload({
      protocolVersion: SIDE_CHAT_PROTOCOL_VERSION,
      source: SIDE_CHAT_PROTOCOL_SOURCE,
      submissionId:
        input.annotationSubmission?.submissionId ?? input.submissionId ?? createSubmissionId(this.randomUUID),
      mainSessionId: this.mainSessionId,
      sideSessionId: chat.sideSessionId,
      delivery: 'queue',
      createdAt: this.now(),
      protocolLocale: input.protocolLocale,
      question: input.question,
      references: input.references ?? chat.references,
      attachmentIdentities: input.attachmentIdentities,
      ...(input.annotationSubmission === undefined
        ? {}
        : { annotationSubmission: input.annotationSubmission }),
    })
    input.validate?.(payload)
    chat.outbox = Object.freeze({ payload, status: 'ready' })
    chat.failure = null
    this.publish(chat.sideChatId)
    if (!this.lastSaveSucceeded) throw new SideChatFailure('storage')
    return payload
  }

  /** @param submissionId - The exact frozen request entering transport. @param sideChatId - Sending chat. @returns Nothing. */
  markSending(submissionId: SubmissionId, sideChatId?: SideChatId): void {
    this.assertMutable()
    this.updateOutbox(sideChatId, submissionId, 'sending', null)
    if (!this.lastSaveSucceeded) {
      this.updateOutbox(sideChatId, submissionId, 'failed', null)
      throw new SideChatFailure('storage')
    }
  }

  /**
   * Recover source occurrences from the same Session's persisted user messages.
   * @param references - Recorded occurrences from official chat projection data.
   * @param sideChatId - Exact owning side chat.
   * @returns Nothing; already known records do not cause a write.
   */
  recoverReferenceRecords(references: readonly SideChatReference[], sideChatId: SideChatId): void {
    const chat = this.chat(sideChatId)
    if (this.closed || chat === null) return
    const known = new Set([...chat.referenceRecordIds, ...chat.removedReferenceIds])
    const additions = references.filter((item) => {
      if (item.sourceSessionId !== this.mainSessionId || known.has(item.referenceId)) return false
      known.add(item.referenceId)
      return true
    })
    if (additions.length === 0) return
    chat.referenceRecords = Object.freeze([...chat.referenceRecords, ...additions])
    chat.referenceRecordIds = Object.freeze([
      ...chat.referenceRecordIds,
      ...additions.map((item) => item.referenceId),
    ])
    this.publish(sideChatId)
  }

  /** @param submissionId - Host-accepted identity. @param sideChatId - Sending chat. @returns Nothing; only its captured pending occurrences are consumed. */
  markAccepted(submissionId: SubmissionId, sideChatId?: SideChatId): void {
    const chat = this.chat(sideChatId)
    if (this.closed || chat?.outbox?.payload.submissionId !== submissionId) return
    if (chat.outbox.failureCode === 'receipt-conflict') return
    const sent = new Set(chat.outbox.payload.references.map((item) => item.referenceId))
    chat.references = Object.freeze(chat.references.filter((item) => !sent.has(item.referenceId)))
    if (chat.references.length === 0) chat.panelOpen = false
    chat.outbox = null
    chat.failure = null
    this.publish()
  }

  /** @param submissionId - Rejected-before-admission request. @param cause - Reported failure. @param sideChatId - Sending chat. @returns Nothing. */
  markFailed(submissionId: SubmissionId, cause?: unknown, sideChatId?: SideChatId): void {
    this.updateOutbox(sideChatId, submissionId, 'failed', new SideChatFailure('send-failed', cause))
  }

  /** @param submissionId - Request with uncertain acceptance. @param cause - Transport failure. @param sideChatId - Sending chat. @returns Nothing; automatic retry remains blocked. */
  markUnknown(submissionId: SubmissionId, cause?: unknown, sideChatId?: SideChatId): void {
    this.updateOutbox(sideChatId, submissionId, 'unknown', new SideChatFailure('send-unknown', cause))
  }

  /** @param submissionId - Frozen request whose accepted identity has different content. @param cause - Receipt conflict. @param sideChatId - Sending chat. @returns Nothing; the conflict stays blocked after recovery. */
  markConflict(submissionId: SubmissionId, cause?: unknown, sideChatId?: SideChatId): void {
    this.updateOutbox(sideChatId, submissionId, 'unknown', new SideChatFailure('receipt-conflict', cause))
  }

  /** @param state - Host receipt Projection, prepared by the existing Session owner. @param sideChatId - Chat whose frozen request is reconciled. @returns Nothing. */
  reconcileReceipts(state: SideChatReceiptState | undefined, sideChatId?: SideChatId): void {
    const chat = this.chat(sideChatId)
    if (this.closed || state === undefined || chat === null) return
    const outbox = chat.outbox
    if (outbox === null || outbox.failureCode === 'receipt-conflict') return
    const fingerprint = Object.hasOwn(state.receipts, outbox.payload.submissionId)
      ? state.receipts[outbox.payload.submissionId]
      : undefined
    if (fingerprint === undefined) return
    if (fingerprint !== sideChatSubmissionFingerprint(outbox.payload)) {
      this.markConflict(outbox.payload.submissionId, undefined, chat.sideChatId)
      return
    }
    this.markAccepted(outbox.payload.submissionId, chat.sideChatId)
  }

  /** @param sideChatId - Exact chat whose title is known. @param title - Host-facing chat title, or null while unknown. @returns Nothing; the list keeps the previous title on no change. */
  setChatTitle(sideChatId: SideChatId, title: string | null): void {
    const chat = this.chat(sideChatId)
    if (this.closed || chat === null || chat.title === title) return
    chat.title = title
    this.publish()
  }

  /** @param sideSessionId - Any side Session identity. @returns The chat that owns it, if this main Session created it. */
  chatForSideSession(sideSessionId: SessionId): SideChatChatView | null {
    const chat = this.chats.find((candidate) => candidate.sideSessionId === sideSessionId)
    return chat === undefined ? null : freezeChat(chat)
  }

  /** @returns Nothing; feature disable releases local lifetimes and preserves refreshable pending content. */
  suspend(): void {
    if (this.closed) return
    for (const chat of this.chats) {
      ++chat.epoch
      chat.acquisition?.abort()
      chat.acquisition = null
      chat.unsubscribeSession?.()
      chat.unsubscribeSession = null
      chat.reference?.release()
      chat.reference = null
      chat.preparation = null
      if (chat.status !== 'error') chat.status = 'idle'
      if (chat.outbox?.status === 'sending') {
        chat.outbox = Object.freeze({ ...chat.outbox, status: 'unknown' as const })
        chat.failure = new SideChatFailure('send-unknown')
      } else {
        chat.failure = this.outboxFailure(chat.outbox) ?? (chat.status === 'error' ? chat.failure : null)
      }
    }
    this.releaseMain()
    this.publish()
  }

  /** @returns Nothing; late creation/opening callbacks cannot publish after disposal. */
  dispose(): void {
    if (this.closed) return
    this.suspend()
    this.closed = true
    this.disposed = true
    for (const chat of this.chats) chat.status = 'disposed'
    this.view = this.derive()
    this.listeners.clear()
    this.chatObservables.clear()
    this.unsubscribeStorage()
    this.storage.dispose()
  }

  private restore(
    entry: PersistedSideChatEntry,
    failure: SideChatFailure | null,
    ordinal = this.chats.length + this.deletedSideChatIds.size + 1,
  ): ChatState {
    const chat: ChatState = {
      sideChatId: entry.sideChatId,
      sideSessionId: entry.sideSessionId,
      created: entry.created,
      title: entry.title ?? this.options.untitled?.(ordinal) ?? null,
      archived: entry.archived ?? false,
      references: entry.references,
      referenceRecords: entry.referenceRecords ?? entry.references,
      referenceRecordIds:
        entry.referenceRecordIds ??
        (entry.referenceRecords ?? entry.references).map((item) => item.referenceId),
      removedReferenceIds: entry.removedReferenceIds ?? [],
      outbox: entry.outbox,
      status: 'idle',
      failure: failure ?? this.outboxFailure(entry.outbox),
      reference: null,
      preparation: null,
      acquisition: null,
      unsubscribeSession: null,
      epoch: 0,
      removed: false,
      panelOpen: entry.panelOpen ?? false,
      saveState: this.saveState,
      view: null,
    }
    return chat
  }

  private outboxFailure(outbox: SideChatOutbox | null): SideChatFailure | null {
    if (outbox?.failureCode === 'receipt-conflict') return new SideChatFailure('receipt-conflict')
    if (outbox?.status === 'unknown') return new SideChatFailure('send-unknown')
    if (outbox?.status === 'failed') return new SideChatFailure('send-failed')
    return null
  }

  private chat(sideChatId?: SideChatId): ChatState | null {
    const id = sideChatId ?? this.activeSideChatId
    if (id === null) return null
    return this.chats.find((candidate) => candidate.sideChatId === id) ?? null
  }

  private targetChat(sideChatId?: SideChatId): ChatState {
    const existing = this.chat(sideChatId)
    if (existing !== null && !existing.archived) return existing
    if (sideChatId !== undefined) throw new SideChatFailure('unavailable')
    const created = this.createChat()
    this.assertMutable()
    return this.chat(created.sideChatId)!
  }

  private updateOutbox(
    sideChatId: SideChatId | undefined,
    submissionId: SubmissionId,
    status: SideChatOutbox['status'],
    failure: SideChatFailure | null,
  ): void {
    const chat = this.chat(sideChatId)
    if (this.closed || chat?.outbox?.payload.submissionId !== submissionId) return
    if (chat.outbox.failureCode === 'receipt-conflict') return
    chat.outbox = Object.freeze({
      payload: chat.outbox.payload,
      status,
      ...(failure?.code === 'receipt-conflict' ? { failureCode: 'receipt-conflict' as const } : {}),
    })
    chat.failure = failure
    this.publish()
  }

  private assertOpen(): void {
    if (this.closed) throw new SideChatFailure('disposed')
  }

  private assertGeneration(chat: ChatState, epoch: number): void {
    if (this.closed || epoch !== chat.epoch) throw new SideChatFailure('disposed')
    if (chat.removed) throw new SideChatFailure('unavailable')
  }

  private retainMain(): Promise<SessionBinding> {
    if (this.mainReadiness !== null) return this.mainReadiness
    let reference: SessionReference
    try {
      this.mainAcquisition = new AbortController()
      reference = this.sessions.retain(this.mainSessionId, {
        source: 'annotationSideChatMain',
        signal: this.mainAcquisition.signal,
      })
    } catch (cause: unknown) {
      return Promise.reject(new SideChatFailure('unavailable', cause))
    }
    this.mainReference = reference
    const readiness = reference.ready
      .then((binding) => {
        if (this.mainReference !== reference || this.closed) throw new SideChatFailure('disposed')
        const observe = (): void => {
          if (this.mainReference !== reference || this.closed) return
          const snapshot = binding.session.getSnapshot()
          if (!snapshot.removed && snapshot.openState !== 'error') return
          this.releaseMain()
          for (const chat of this.chats) {
            chat.removed = snapshot.removed ? true : chat.removed
            chat.acquisition?.abort()
            chat.acquisition = null
            if (chat.status === 'disposed') continue
            chat.status = 'error'
            chat.failure = new SideChatFailure('unavailable')
          }
          this.publish()
        }
        const unsubscribe = binding.session.subscribe(observe)
        if (this.mainReference !== reference) {
          unsubscribe()
          throw new SideChatFailure('unavailable')
        }
        this.unsubscribeMainSession = unsubscribe
        observe()
        if (this.mainReference !== reference) throw new SideChatFailure('unavailable')
        return binding
      })
      .catch((cause: unknown) => {
        if (this.mainReference !== reference || this.closed) {
          if (cause instanceof SideChatFailure) throw cause
          throw new SideChatFailure('disposed', cause)
        }
        this.releaseMain()
        throw cause instanceof SideChatFailure ? cause : new SideChatFailure('unavailable', cause)
      })
    this.mainReadiness = readiness
    return readiness
  }

  private releaseMain(): void {
    this.mainAcquisition?.abort()
    this.mainAcquisition = null
    this.unsubscribeMainSession?.()
    this.unsubscribeMainSession = null
    this.mainReference?.release()
    this.mainReference = null
    this.mainReadiness = null
  }

  private releaseChat(chat: ChatState): void {
    ++chat.epoch
    chat.acquisition?.abort()
    chat.acquisition = null
    chat.unsubscribeSession?.()
    chat.unsubscribeSession = null
    chat.reference?.release()
    chat.reference = null
    chat.preparation = null
    if (this.chats.every((candidate) => candidate.reference === null && candidate.preparation === null))
      this.releaseMain()
  }

  private derive(): SideChatView {
    const chats = Object.freeze(this.chats.map(freezeChat))
    const active = chats.find((chat) => chat.sideChatId === this.activeSideChatId) ?? null
    return Object.freeze({
      mainSessionId: this.mainSessionId,
      chats,
      activeSideChatId: this.activeSideChatId,
      active,
      visible: this.visible,
      storageAvailable: this.storage.available,
      storageOutdated: this.storage.outdated,
      saveState:
        this.saveState === 'unavailable' || this.saveState === 'conflict'
          ? this.saveState
          : (active?.saveState ?? this.saveState),
      recoveryAvailable: this.storage.recoveryAvailable,
      sideSessionId: active?.sideSessionId ?? null,
      status: active?.status ?? (this.disposed ? 'disposed' : 'idle'),
      references: active?.references ?? EMPTY_REFERENCES,
      failure: active?.failure ?? this.storageFailure,
      outbox: active?.outbox ?? null,
    })
  }

  private persisted(): PersistedSideChatState {
    return {
      storageVersion: SIDE_CHAT_STORAGE_VERSION,
      mainSessionId: this.mainSessionId,
      chats: this.chats.map((chat) => ({
        sideChatId: chat.sideChatId,
        sideSessionId: chat.sideSessionId,
        created: chat.created,
        ...(chat.title === null ? {} : { title: chat.title }),
        archived: chat.archived,
        panelOpen: chat.panelOpen,
        references: chat.references,
        referenceRecords: chat.referenceRecords,
        referenceRecordIds: chat.referenceRecordIds,
        removedReferenceIds: chat.removedReferenceIds,
        outbox: chat.outbox,
      })),
      activeSideChatId: this.activeSideChatId,
      deletedSideChatIds: [...this.deletedSideChatIds],
      visible: this.visible,
    }
  }

  private publish(affected?: SideChatId): void {
    if (this.closed) return
    this.applySave(this.storage.save(this.persisted()), affected)
  }

  private applySave(result: SideChatSaveResult, affected?: SideChatId): void {
    this.saveState = result.status
    if (result.status === 'conflict' && result.state !== undefined) this.adoptMerged(result.state)
    if (result.status === 'saved' || result.status === 'merged') {
      this.storageFailure = null
      this.adoptMerged(result.state)
      for (const chat of this.chats) {
        if (chat.failure?.code === 'storage') chat.failure = this.outboxFailure(chat.outbox)
      }
    }
    for (const chat of this.chats) {
      if (
        result.status === 'unavailable' ||
        result.status === 'conflict' ||
        chat.sideChatId === affected ||
        chat.saveState === 'unavailable' ||
        chat.saveState === 'conflict'
      )
        chat.saveState = result.status
    }
    this.view = this.derive()
    for (const listener of this.listeners) listener()
  }

  /** Adopt durable references while retaining this occurrence's selection and live Session ownership. */
  private adoptMerged(merged: PersistedSideChatState): void {
    this.deletedSideChatIds = new Set(merged.deletedSideChatIds ?? [])
    const byId = new Map(merged.chats.map((entry) => [entry.sideChatId, entry]))
    for (const chat of this.chats) {
      const entry = byId.get(chat.sideChatId)
      if (entry === undefined) {
        this.releaseChat(chat)
        continue
      }
      if (JSON.stringify(chat.references) !== JSON.stringify(entry.references))
        chat.references = entry.references
      const recordIds =
        entry.referenceRecordIds ??
        (entry.referenceRecords ?? entry.references).map((item) => item.referenceId)
      if (JSON.stringify(chat.referenceRecordIds) !== JSON.stringify(recordIds))
        chat.referenceRecordIds = recordIds
      const removedIds = entry.removedReferenceIds ?? []
      if (JSON.stringify(chat.removedReferenceIds) !== JSON.stringify(removedIds))
        chat.removedReferenceIds = removedIds
      const records = entry.referenceRecords ?? entry.references
      if (JSON.stringify(chat.referenceRecords) !== JSON.stringify(records)) chat.referenceRecords = records
      if (JSON.stringify(chat.outbox) !== JSON.stringify(entry.outbox)) {
        chat.outbox = entry.outbox
        chat.failure = this.outboxFailure(entry.outbox)
      }
      if (chat.references.length === 0) chat.panelOpen = false
      if (chat.sideSessionId !== entry.sideSessionId) {
        this.releaseChat(chat)
        chat.sideSessionId = entry.sideSessionId
        chat.status = 'idle'
      }
      if (entry.archived === true && !chat.archived && this.activeSideChatId === chat.sideChatId)
        this.activeSideChatId = this.successor(chat.sideChatId)
      chat.archived = entry.archived ?? false
      chat.created = entry.created
      chat.title = entry.title ?? chat.title
    }
    this.chats = this.chats.filter((chat) => byId.has(chat.sideChatId))
    const known = new Set(this.chats.map((chat) => chat.sideChatId))
    for (const entry of merged.chats) {
      if (!known.has(entry.sideChatId)) this.chats.push(this.restore(entry, this.storageFailure))
    }
    if (!this.chats.some((chat) => chat.sideChatId === this.activeSideChatId && !chat.archived))
      this.activeSideChatId = this.chats.find((chat) => !chat.archived)?.sideChatId ?? null
  }

  /** @param key - Browser storage event key; absent for an explicit read. @returns Nothing; live drafts, selection and Session bindings stay with this page. */
  synchronizeStorage(key?: string | null): void {
    if (this.closed || (key !== undefined && !this.storage.ownsKey(key))) return
    this.applySave(this.storage.synchronize(this.persisted()))
  }

  /** @returns Whether retained local edits were saved or safely merged after an explicit retry. */
  retryStorage(): boolean {
    if (this.closed) return false
    for (const id of this.deletedSideChatIds) this.storage.markDeleted(id)
    this.applySave(this.storage.retry(this.persisted()))
    return this.lastSaveSucceeded
  }

  /** @returns Downloadable local references, associations and retry records; excludes official drafts, attachments and Host messages. */
  exportStorageRecovery(): string {
    return this.storage.exportRecovery(this.persisted())
  }

  /** @returns Completion of browser compaction owned by this controller. */
  whenStorageIdle(): Promise<void> {
    return this.storage.whenIdle()
  }

  private assertMutable(): void {
    this.assertOpen()
    if (!this.lastSaveSucceeded) throw new SideChatFailure('storage')
  }

  /** @returns Whether the last browser-local write kept every local change. */
  get lastSaveSucceeded(): boolean {
    return this.saveState === 'saved' || this.saveState === 'merged'
  }

  /** @returns Why the last browser-local write did not simply succeed. */
  get saveFailure(): SideChatSaveState {
    return this.saveState
  }
}
