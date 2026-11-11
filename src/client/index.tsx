/** Browser selection, independent side conversations, annotation records, and draft recovery. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ChatSnapshot, AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CommandClaim,
  InputTriggerServiceContract,
  SubmitAttachment,
  SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { resolveConfig, LEGACY_COMMAND_NAMES } from '../shared/config.ts'
import { encodeSubmissionCommand } from '../shared/codec.ts'
import { parseAttachmentIdentities, sameAttachmentIdentities } from '../shared/protocol.ts'
import { isOutboxPayloadEntry, outboxSubmissionId } from '../shared/outbox-redaction.ts'
import { ATTACHMENT_PREPARE_INPUT, ATTACHMENT_IDENTITY_MISMATCH } from '../shared/types.ts'
import { ANNOTATION_SETTINGS_NAMESPACE, type AnnotationSettings } from '../shared/settings.ts'
import type {
  AnnotationConfig,
  MessageIdentity,
  OutboxAttachments,
  OutboxPayloadEntry,
  ProtocolLocale,
  SessionIdentity,
  SubmissionId,
} from '../shared/types.ts'
import {
  attachComposer,
  COMPOSER_ATTACHMENT_TOKEN,
  detachComposer,
  hasComposerAttachment,
  isSlashCommandLine,
  mergeLegacyRequirement,
  serializeComposerRequirement,
  stripComposerToken,
  visibleComposerDraft,
} from './composer-attachment.ts'
import {
  AnnotationController,
  SubmissionChangedError,
  retryEntry,
  selectedAnnotations,
  type AnnotationView,
  type SourceAnnotationMarker,
  type AnnotationReconciliationSnapshot,
} from './controller.ts'
import type { AnnotationInjected, UserAnnotationProps } from './contract.ts'
import { AnnotationSettingsController } from './feature-toggle.ts'
import { MarketUpdateController } from './market-update.ts'
import { createFocusChatAdapter } from './focus-adapter.ts'
import { markerElement, selectionAnchor, visibleBoundary, type AnnotationFloatingAnchor } from './floating.ts'
import { HighlightManager } from './highlight.ts'
import { AnnotationStorage } from './storage.ts'
import { AnnotationTrashController } from './annotation-trash.ts'
import { SourceSnapshotStore } from './source-snapshots.ts'
import { captureSourceContent, observeSourceSnapshots } from './snapshot-capture.ts'
import type { StorageCoordination, StorageLike } from './storage.ts'
import { styles } from './styles.ts'
import { en, zh } from './locales.ts'
import { decorateAssistantRenderers } from './assistant-renderer-decorator.tsx'
import { MessageSelectionActions } from './components/MessageSelectionActions.tsx'
import { AnnotatedUserNode } from './components/AnnotatedUserNode.tsx'
import {
  AnnotationExperience,
  AnnotationRecordToggle,
  AnnotationComposerChip,
} from './components/AnnotationExperience.tsx'
import { AssistantAnnotationAction } from './components/AssistantAnnotationAction.tsx'
import { HiddenCommandRow } from './components/HiddenCommandRow.tsx'
import { AnnotationPluginCard } from './components/AnnotationPluginCard.tsx'
import { installDocumentIntegration } from './document-integration.tsx'
import {
  FileWholeAnnotationAction,
  OfficeWholeAnnotationAction,
} from './components/FileWholeAnnotationAction.tsx'
import type { FileAnnotationSource, OfficialDiffAnnotationSource } from '../shared/annotation-source.ts'
import { messageSourceSession } from '../shared/annotation-source.ts'
import { compactFileSource, compactOfficialDiffSource } from './official-adapters.ts'
import { createDiffReviewAction, installDiffIntegration } from './diff-integration.tsx'
import { AnnotationNoticeHub, AnnotationToastHost } from './notice.tsx'
import { installCodexUiCompatibility } from './codex-ui-compatibility.ts'
import { SideChatController, SideChatFailure } from './side-chat-controller.ts'
import { SideChatStorage, storedSideChatMainIds } from './side-chat-storage.ts'
import {
  encodeSideChatSubmissionCommand,
  parseSideChatReceiptState,
  parseSideChatSource,
} from '../shared/side-chat-protocol.ts'
import {
  SIDE_CHAT_COMMAND_NAME,
  SIDE_CHAT_RECEIPTS_PROJECTION,
  type SideChatId,
} from '../shared/side-chat-types.ts'
import { registerSideChatSidebar, SIDE_CHAT_KIND, type SideChatSidebar } from './side-chat-sidebar.tsx'
import { submitSideChat } from './side-chat-submit.ts'
import { resolveSideChatWorkspace } from './side-chat-workspace.ts'
import { migrateSideReferences, sideAnnotationCapture } from './side-chat-annotations.ts'
import { sideChatDisplayTitle } from './side-chat-title.ts'
import type { SideChatReference, SideChatOutbox } from '../shared/side-chat-types.ts'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    'changes-review': { readonly index?: number }
  }
}

/** Host viewport width below which the right Sidebar becomes a fullscreen panel. */
const SIDEBAR_DRAWER_BREAKPOINT = 768

/** Project only withdrawable turn entries, preserving an unavailable Inbox as unknown. */
function annotationQueue(inbox: InboxState | undefined): AnnotationReconciliationSnapshot['queue'] {
  return inbox?.['next-turn'].map((message) => ({ messageId: message.id }))
}

const NS = 'dshAnnotation'
const DOCUMENT_RENDERER_IDS = [
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/image',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/excel',
] as const
const EMPTY_CHAT_NODES: AnnotationReconciliationSnapshot['chat']['nodes'] = {
  values: () => [],
}
export const inject = [
  'slots',
  'sessions',
  'workspaces',
  'uiConversation',
  'locale',
  'conversation',
  'inputTriggers',
  'configForms',
  'sidebarRight',
  'sidebarRightTabs',
  'remote.workspaceFiles',
  'remote',
]

function UserNode(props: UserAnnotationProps<'user'>) {
  return <AnnotatedUserNode {...props} />
}

function SteeringNode(props: UserAnnotationProps<'steering'>) {
  return <AnnotatedUserNode {...props} />
}

function failureMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}

function transportMessage(result: unknown): string {
  const error =
    typeof result === 'object' && result !== null && 'error' in result
      ? (result as { readonly error: unknown }).error
      : undefined
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return error === undefined ? 'command was not matched' : String(error)
}

/** Normalized admission outcome shared by the remote command bridge and its session fallback. */
interface CommandOutcome {
  readonly ok: boolean
  readonly errorText: string
  readonly text?: string
}

/** Stop waiting at feature or Session retirement even when an attachment-free command cannot cancel. */
function commandWithinLifetime<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(new SideChatFailure('disposed', signal.reason))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(cause)
      },
    )
    if (signal.aborted) abort()
  })
}

/** Structural mirror of the mounted `commands/execute` remote, typed without the attachment package. */
interface CommandRemoteFace {
  execute(
    sessionId: SessionId,
    line: string,
    attachments: readonly SubmitAttachment[],
    signal?: AbortSignal,
  ): Promise<{
    readonly ok: boolean
    readonly value?: { readonly result: { readonly kind: 'success' | 'error'; readonly text?: string } }
    readonly error?: unknown
  }>
}

/** Retry metadata excludes image bytes and temporary file-upload receipts. */
function attachmentMetadata(attachments: readonly SubmitAttachment[]): OutboxAttachments | undefined {
  if (attachments.length === 0) return undefined
  const images = attachments.filter((attachment) => attachment.type === 'image')
  return Object.freeze({
    count: attachments.length,
    kinds: Object.freeze(attachments.map((attachment) => attachment.type)),
    mediaTypes: Object.freeze(images.map((image) => image.mediaType)),
    names: Object.freeze(images.map((image) => image.name ?? '').filter((name) => name !== '')),
  })
}

/** Mount every UI contribution and bind one controller to each encountered Session. */
export function apply(ctx: ClientContext, input?: Partial<AnnotationConfig>): void {
  const config = resolveConfig(input)
  const sessions: ISessions & { isDeleted?(id: SessionId): Promise<boolean> } =
    ctx.sessions as unknown as ISessions
  const conversation = ctx.conversation as unknown as IConversation
  const inputTriggers = ctx.inputTriggers as unknown as InputTriggerServiceContract
  const unavailableStorage: StorageLike = {
    getItem(): never {
      throw new Error('localStorage is unavailable')
    },
    setItem(): never {
      throw new Error('localStorage is unavailable')
    },
    removeItem(): never {
      throw new Error('localStorage is unavailable')
    },
  }
  let browserStorage: StorageLike
  try {
    browserStorage = globalThis.localStorage
  } catch {
    // Browser privacy modes can deny the localStorage getter itself.
    browserStorage = unavailableStorage
  }
  const lockManager = globalThis.navigator?.locks
  const storageCoordination: StorageCoordination = {
    keys: () =>
      browserStorage.key === undefined || browserStorage.length === undefined
        ? []
        : Array.from({ length: browserStorage.length }, (_, index) => browserStorage.key!(index)).filter(
            (key): key is string => key !== null,
          ),
    ...(lockManager === undefined
      ? {}
      : {
          runExclusive: (name: string, task: () => void, signal: AbortSignal) =>
            lockManager.request(name, { mode: 'exclusive', signal }, () => task()),
        }),
  }
  const settingsController = new AnnotationSettingsController(
    ctx.configForms.get<AnnotationSettings>(ANNOTATION_SETTINGS_NAMESPACE),
    browserStorage,
  )
  const featureEnabled = settingsController.feature()
  const officialFileEnabled = settingsController.officialFileAnnotations()
  const officialDiffEnabled = settingsController.officialDiffAnnotations()
  const autoAttachEnabled = settingsController.autoAttach()
  const compactSummaryEnabled = settingsController.compactSummary()
  const marketUpdateController = new MarketUpdateController()
  const noticeHub = new AnnotationNoticeHub()
  ctx.effect(() => () => settingsController.dispose(), 'dsh-annotation: settings controller')
  ctx.effect(() => () => marketUpdateController.dispose(), 'dsh-annotation: market update controller')
  ctx.effect(() => () => noticeHub.dispose(), 'dsh-annotation: notice hub')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-annotation: dictionaries')
  const annotationT = ctx.locale.bind(NS)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshAnnotation = 'true'
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-annotation: styles')
  ctx.effect(
    () =>
      installCodexUiCompatibility(
        {
          entries: (name) => ctx.slots.entries(name),
          subscribe: (listener) => ctx.on('slots/changed', listener),
        },
        document.documentElement,
      ),
    'dsh-annotation: Codex UI compatibility',
  )

  // dsh-focus-chat 可选兼容：未安装时保持被动，适配失败不影响核心功能。
  const focusAdapter = createFocusChatAdapter()
  ctx.effect(() => {
    focusAdapter.start()
    return () => focusAdapter.dispose()
  }, 'dsh-annotation: focus-chat adapter')

  /** 模型协议语言：只读 DSH 当前 locale（已归一化为 zh/en，回退 en）。 */
  const resolveProtocolLocale = (): ProtocolLocale => {
    const locale = ctx.locale.getLocale?.().active
    return locale === 'zh' ? 'zh' : 'en'
  }

  const highlights = new HighlightManager()
  const sideChats = new Map<SessionId, SideChatController>()
  const sideOwners = new Map<SessionId, SideChatController>()
  const visibleSidePanels = new Map<SessionId, Set<symbol>>()
  /** Side Session -> the exact chat that owns it, so two chats never share a face. */
  const sideChatIds = new Map<SessionId, SideChatId>()
  const sideChatObservers = new Map<SessionId, () => void>()
  const unavailableMains = new Set<SessionId>()
  const sideChatRetirements = new Map<SessionId, Promise<void>>()
  let sideChatSidebar: SideChatSidebar | undefined
  let disposed = false
  let integrationLifetime = new AbortController()
  const controllers = new Map<
    SessionId,
    {
      controller: AnnotationController
      dispose: () => void
      lifetime: AbortController
      commandReleased: boolean
      manualDetached: boolean
      submissionSnapshot: {
        readonly view: AnnotationView
        readonly protocolLocale: ProtocolLocale
        readonly sideReferences: readonly SideChatReference[]
        readonly sideOutbox: SideChatOutbox | null
        readonly includeAnnotations: boolean
      } | null
    }
  >()
  const sourceSnapshots = new SourceSnapshotStore()
  const annotationTrash = new AnnotationTrashController(
    browserStorage,
    storageCoordination,
    config,
    sourceSnapshots,
    (sessionId) =>
      [...controllers.values()].find((entry) => entry.controller.sessionId === sessionId)?.controller,
  )
  const readFileSnapshot: import('./components/FileWholeAnnotationAction.tsx').ReadFileSnapshot = (
    sessionId,
    path,
    signal,
    range,
  ) =>
    ctx
      .get('remote.workspaceFiles')
      .readBytes(String(sessionId) as SessionId, path, range === undefined ? {} : { range }, signal)
  ctx.effect(() => {
    annotationTrash.refresh()
    return () => {
      annotationTrash.dispose()
      sourceSnapshots.dispose()
    }
  }, 'dsh-annotation: local source archive')
  const mirrorGroups = new Map<AnnotationController, Map<SubmissionId, ReadonlySet<AnnotationController>>>()
  const linkMirrors = (
    submissionId: SubmissionId,
    first: AnnotationController,
    second: AnnotationController,
  ) => {
    const group = new Set([first, second])
    for (const controller of group) {
      const submissions = mirrorGroups.get(controller) ?? new Map()
      submissions.set(submissionId, group)
      mirrorGroups.set(controller, submissions)
    }
    first.syncSubmissionState(second.getSnapshot(), submissionId, second.sessionId)
    second.syncSubmissionState(first.getSnapshot(), submissionId, first.sessionId)
  }
  const syncMirrors = (source: AnnotationController) => {
    const submissions = mirrorGroups.get(source)
    if (submissions === undefined) return
    const snapshot = source.getSnapshot()
    for (const [submissionId, group] of submissions) {
      for (const target of group) {
        if (target !== source) target.syncSubmissionState(snapshot, submissionId, source.sessionId)
      }
    }
  }
  const reconnectMirrors = (sessionId: SessionId, controller: AnnotationController) => {
    for (const [otherId, entry] of controllers) {
      if (entry.controller === controller) continue
      for (const outbox of controller.getSnapshot().outbox) {
        if (outbox.targetSessionId === (otherId as unknown as SessionIdentity)) {
          linkMirrors(outboxSubmissionId(outbox), controller, entry.controller)
        }
      }
      for (const outbox of entry.controller.getSnapshot().outbox) {
        if (outbox.targetSessionId === (sessionId as unknown as SessionIdentity)) {
          linkMirrors(outboxSubmissionId(outbox), entry.controller, controller)
        }
      }
    }
  }
  const dropController = (sessionId: SessionId) => {
    const entry = controllers.get(sessionId)
    if (entry === undefined) return
    entry.dispose()
    controllers.delete(sessionId)
    const submissions = mirrorGroups.get(entry.controller)
    mirrorGroups.delete(entry.controller)
    if (submissions === undefined) return
    for (const [submissionId, group] of submissions) {
      for (const peer of group) {
        if (peer !== entry.controller) mirrorGroups.get(peer)?.delete(submissionId)
      }
    }
  }
  const receivingTitleFor = (sessionId: SessionId): string =>
    sideChatDisplayTitle(
      sessions.list.getSnapshot().byId[sessionId]?.title,
      sideOwners.get(sessionId)?.chatForSideSession(sessionId)?.title ?? annotationT('sideChat.title'),
    )

  const refreshSourceAnnotations = (): void => {
    const markers = new Map<string, SourceAnnotationMarker[]>()
    for (const [targetId, entry] of controllers) {
      const owner = sideOwners.get(targetId)
      const side = owner?.getSnapshot()
      const visible =
        side === undefined ||
        (visibleSidePanels.has(side.mainSessionId) && side.active?.sideSessionId === targetId) ||
        (sessions.list.getSnapshot().byId[targetId]?.retainedBy.mainView ?? 0) > 0
      const view = entry.controller.getSnapshot()
      const title = receivingTitleFor(targetId)
      for (const annotation of view.annotations) {
        const sourceId = messageSourceSession(annotation, String(targetId))
        if (sourceId === undefined || sourceId === String(targetId)) continue
        const items = markers.get(sourceId) ?? []
        items.push({
          annotation,
          targetSessionId: entry.controller.sessionId,
          title,
          active: visible && view.activeAnnotationId === annotation.annotationId,
          detailsOpen:
            visible && (view.markerAnnotationId !== null || view.editor !== null || view.panelOpen),
          editorOpen: visible && view.editor !== null,
        })
        markers.set(sourceId, items)
      }
    }
    for (const [sourceId, entry] of controllers)
      entry.controller.setSourceAnnotations(markers.get(String(sourceId)) ?? [])
  }

  const controllerFor = (sessionId: SessionId): AnnotationController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing.controller
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`Session ${String(sessionId)} has no client binding`)
    const controller = new AnnotationController(
      sessionId as unknown as SessionIdentity,
      new AnnotationStorage(browserStorage, sessionId as unknown as SessionIdentity, storageCoordination),
      binding.session,
      config,
    )
    const lifetime = new AbortController()
    controller.setSourceNavigator(async (annotationId) => {
      const item = controller
        .getSnapshot()
        .annotations.find((candidate) => candidate.annotationId === annotationId)
      const source = item?.source
      try {
        if (source?.kind === 'file') {
          ctx.sidebarRight.openResource(source.resourceAddress, {
            params: source.startLine === undefined ? undefined : { line: source.endLine ?? source.startLine },
          })
          const active = ctx.sidebarRight.active()
          if (active !== undefined) ctx.sidebarRight.focus(active.id)
          return true
        }
        if (source?.kind !== 'official-diff') return false
        const address = `dsh-resource://changes-review/session/${encodeURIComponent(String(source.snapshot.sessionId))}/${source.snapshot.seq}/${source.snapshot.turn}`
        ctx.sidebarRight.openResource(address, { params: { index: source.snapshot.fileIndex } })
        const active = ctx.sidebarRight.active()
        if (active !== undefined) ctx.sidebarRight.focus(active.id)
        return true
      } catch {
        return false
      }
    })
    const chat = ctx.uiConversation.binding(binding).target('chat')
    const stopSourceSnapshots = observeSourceSnapshots(
      controller,
      sourceSnapshots,
      (capture, signal) =>
        captureSourceContent(
          capture,
          readFileSnapshot,
          (messageId) => {
            const sourceId = messageSourceSession(capture, String(sessionId))
            const sourceBinding = sourceId === undefined ? undefined : sessions.binding(sourceId as SessionId)
            const sourceChat =
              sourceId === String(sessionId)
                ? chat
                : sourceBinding === undefined
                  ? undefined
                  : ctx.uiConversation.binding(sourceBinding).target('chat')
            for (const node of sourceChat?.getSnapshot()?.nodes.values() ?? []) {
              if (node.kind !== 'assistant-step') continue
              const data = node.data as AssistantChatData
              if (String(data.finalNode?.messageId) !== String(messageId)) continue
              return data.blocks.flatMap((block) => (block.kind === 'text' ? [block.text] : [])).join('\n')
            }
            return undefined
          },
          signal,
        ),
      annotationTrash.refresh,
      () => controller.setNotice('error', 'trash.error.cleanup'),
    )
    const inboxFace = binding.session.projections.faceOf('inbox')
    const receiptFace = binding.session.projections.faceOf(SIDE_CHAT_RECEIPTS_PROJECTION)
    const reconcileReceipts = (): void => {
      const owner = sideOwners.get(sessionId)
      if (owner === undefined || owner.getSnapshot().status === 'disposed') return
      const chatId = sideChatIds.get(sessionId)
      try {
        owner.reconcileReceipts(parseSideChatReceiptState(receiptFace.getSnapshot()), chatId)
      } catch (cause: unknown) {
        const outbox = owner.chatView(chatId)?.outbox ?? null
        if (outbox !== null) owner.markUnknown(outbox.payload.submissionId, cause, chatId)
        controller.setNotice('error', 'sideChat.failure.send-unknown')
        ctx.logger.error('Could not read the side-chat receipt projection', cause)
      }
    }
    let reconciledChat: ChatSnapshot | undefined
    let reconciledInbox: InboxState | undefined
    let reconciled = false
    const reconcile = () => {
      const sessionSnapshot = binding.session.getSnapshot()
      const chatSnapshot = chat.getSnapshot()
      const inbox = inboxFace.getSnapshot() as InboxState | undefined
      const refreshChat = !reconciled || chatSnapshot !== reconciledChat
      if (reconciled && !refreshChat && inbox === reconciledInbox) return
      reconciled = true
      reconciledChat = chatSnapshot
      reconciledInbox = inbox
      controller.reconcile(
        {
          chat: { nodes: chatSnapshot?.nodes ?? EMPTY_CHAT_NODES },
          queue: annotationQueue(inbox),
          hasMore: sessionSnapshot.hasMore,
        },
        refreshChat,
      )
      syncMirrors(controller)
      const owner = sideOwners.get(sessionId)
      const chatId = sideChatIds.get(sessionId)
      if (refreshChat && owner !== undefined && chatId !== undefined) {
        try {
          const references = Array.from((chatSnapshot?.nodes ?? EMPTY_CHAT_NODES).values()).flatMap(
            (node) => {
              if (
                typeof node !== 'object' ||
                node === null ||
                !('kind' in node) ||
                (node.kind !== 'user' && node.kind !== 'steering') ||
                !('data' in node) ||
                typeof node.data !== 'object' ||
                node.data === null ||
                !('source' in node.data)
              )
                return []
              const payload = parseSideChatSource(node.data.source)
              return payload?.sideSessionId === sessionId && payload.mainSessionId === owner.mainSessionId
                ? payload.references
                : []
            },
          )
          owner.recoverReferenceRecords(references, chatId)
        } catch (cause: unknown) {
          controller.setNotice('error', 'sideChat.saveFailed')
          ctx.logger.warn('Side-chat source record recovery failed', cause)
        }
      }
    }
    const input = conversation.input.for(binding.ctx)
    let repairing = false
    let repairQueued = false
    const repair = (): void => {
      if (disposed || repairing || !featureEnabled.getSnapshot() || !controllers.has(sessionId)) return
      repairing = true
      try {
        repairComposerAttachment(sessionId)
      } finally {
        repairing = false
      }
    }
    const observeInput = (): void => {
      const entry = controllers.get(sessionId)
      const state = input.state.getSnapshot()
      if (entry !== undefined) {
        if (state.phase === 'submitting' && hasComposerAttachment(state)) {
          const chat = sideOwners.get(sessionId)?.chatView(sideChatIds.get(sessionId))
          entry.submissionSnapshot ??= Object.freeze({
            view: controller.getSnapshot(),
            protocolLocale: resolveProtocolLocale(),
            sideReferences: chat?.references ?? [],
            sideOutbox: chat?.outbox ?? null,
            includeAnnotations: !entry.manualDetached,
          })
        } else {
          entry.submissionSnapshot = null
        }
      }
      // Input notifications can run in Lexical's commit listeners, outside its writable update.
      if (repairQueued || lifetime.signal.aborted) return
      repairQueued = true
      queueMicrotask(() => {
        repairQueued = false
        if (!lifetime.signal.aborted) repair()
      })
    }
    let markerView = controller.getSnapshot()
    const unsubscribeController = controller.subscribe(() => {
      repair()
      const next = controller.getSnapshot()
      if (
        next.annotations === markerView.annotations &&
        next.activeAnnotationId === markerView.activeAnnotationId &&
        next.markerAnnotationId === markerView.markerAnnotationId &&
        next.panelOpen === markerView.panelOpen &&
        (next.editor !== null) === (markerView.editor !== null)
      )
        return
      markerView = next
      refreshSourceAnnotations()
    })
    const unsubscribeInput = input.state.subscribe(observeInput)
    const unsubscribeSession = binding.session.subscribe(reconcile)
    const unsubscribeChat = chat.subscribe(reconcile)
    const unsubscribeInbox = inboxFace.subscribe(reconcile)
    const unsubscribeReceipts = receiptFace.subscribe(reconcileReceipts)
    controllers.set(sessionId, {
      controller,
      lifetime,
      commandReleased: false,
      manualDetached: false,
      submissionSnapshot: null,
      dispose: () => {
        lifetime.abort()
        stopSourceSnapshots()
        unsubscribeInput()
        unsubscribeController()
        unsubscribeInbox()
        unsubscribeReceipts()
        unsubscribeChat()
        unsubscribeSession()
        controller.dispose()
      },
    })
    reconnectMirrors(sessionId, controller)
    reconcile()
    reconcileReceipts()
    repair()
    const sideOwner = sideOwners.get(sessionId)
    const sideChatId = sideChatIds.get(sessionId)
    if (
      sideOwner !== undefined &&
      sideChatId !== undefined &&
      sideOwner.chatView(sideChatId)?.status === 'idle'
    )
      void prepareSideChat(sideOwner.mainSessionId, sideChatId)
    const mainOwner = sideChats.get(sessionId)
    if (mainOwner !== undefined) refreshSourceReferences(sessionId, mainOwner)
    refreshSourceAnnotations()
    return controller
  }

  const refreshSourceReferences = (mainSessionId: SessionId, owner: SideChatController): void => {
    const records = owner.getSnapshot().chats.flatMap((chat) =>
      chat.referenceRecords.map((reference) => ({
        reference,
        sideChatId: chat.sideChatId,
        ordinal: (chat.referenceRecordIds ?? []).indexOf(reference.referenceId) + 1,
        disabled: chat.saveState === 'conflict' || chat.saveState === 'unavailable',
      })),
    )
    records.sort(
      (left, right) =>
        left.reference.createdAt - right.reference.createdAt ||
        String(left.reference.referenceId).localeCompare(String(right.reference.referenceId)),
    )
    controllers.get(mainSessionId)?.controller.setSourceReferences(records)
  }

  const sideChatFor = (mainSessionId: SessionId): SideChatController => {
    const existing = sideChats.get(mainSessionId)
    if (existing !== undefined) return existing
    const registerSideSession = (sideSessionId: SessionId, chatId: SideChatId): void => {
      sideOwners.set(sideSessionId, owner)
      sideChatIds.set(sideSessionId, chatId)
    }
    const owner: SideChatController = new SideChatController(
      mainSessionId,
      sessions,
      new SideChatStorage(browserStorage, mainSessionId, storageCoordination),
      {
        untitled: (ordinal) => annotationT('sideChat.untitled', { ordinal }),
        resolveCreateOptions: (signal) =>
          resolveSideChatWorkspace(ctx.workspaces, sessions, mainSessionId, signal),
        onReady: (binding, chatId) => {
          if (disposed || !featureEnabled.getSnapshot()) throw new SideChatFailure('disposed')
          if (unavailableMains.has(mainSessionId)) throw new SideChatFailure('unavailable')
          registerSideSession(binding.sessionId, chatId)
          const annotations = controllerFor(binding.sessionId)
          if (!migrateSideReferences(owner, chatId, annotations))
            annotations.setNotice('error', 'sideChat.migrationFailed')
          repairComposerAttachment(binding.sessionId)
        },
      },
    )
    sideChats.set(mainSessionId, owner)
    for (const chat of owner.getSnapshot().chats) {
      if (chat.sideSessionId !== null) registerSideSession(chat.sideSessionId, chat.sideChatId)
    }
    sideChatObservers.set(
      mainSessionId,
      owner.subscribe(() => {
        refreshSourceReferences(mainSessionId, owner)
        const known = new Set(
          owner
            .getSnapshot()
            .chats.flatMap((chat) => (chat.sideSessionId === null ? [] : [chat.sideSessionId])),
        )
        for (const [sideId, candidate] of sideOwners) {
          if (candidate !== owner || known.has(sideId)) continue
          try {
            AnnotationStorage.retireSession(
              browserStorage,
              String(sideId) as SessionIdentity,
              storageCoordination,
            )
          } catch (cause: unknown) {
            controllerFor(mainSessionId).setNotice('error', 'sideChat.actionFailed')
            ctx.logger.warn('Deleted side-chat annotation cleanup failed', cause)
          }
          dropController(sideId)
          sideOwners.delete(sideId)
          sideChatIds.delete(sideId)
        }
        for (const chat of owner.getSnapshot().chats) {
          if (chat.sideSessionId === null) continue
          registerSideSession(chat.sideSessionId, chat.sideChatId)
          const annotations = controllers.get(chat.sideSessionId)?.controller
          if (
            annotations !== undefined &&
            chat.status === 'ready' &&
            !migrateSideReferences(owner, chat.sideChatId, annotations)
          )
            annotations.setNotice('error', 'sideChat.migrationFailed')
          if (sessions.binding(chat.sideSessionId) !== undefined && controllers.has(chat.sideSessionId))
            repairComposerAttachment(chat.sideSessionId)
        }
        refreshSourceAnnotations()
      }),
    )
    refreshSourceReferences(mainSessionId, owner)
    return owner
  }

  /**
   * Prepare exactly one chat's Session from any visible entry point.
   * The id is captured at call time, so an async creation finishing after the
   * user switched chats cannot publish into the newly selected chat.
   */
  const prepareSideChat = async (mainSessionId: SessionId, sideChatId: SideChatId): Promise<void> => {
    if (disposed || unavailableMains.has(mainSessionId)) return
    const owner = sideChatFor(mainSessionId)
    if (owner.chatView(sideChatId) === null) return
    await owner.prepare(sideChatId).catch((cause: unknown) => {
      if (cause instanceof SideChatFailure && cause.code === 'disposed') return
      if (!disposed && sideChats.get(mainSessionId) === owner)
        controllers.get(mainSessionId)?.controller.setNotice('error', 'sideChat.error')
    })
  }

  /** 侧栏展开时宿主会跟随会话底部；保留用户点击时可见的原文位置。 */
  const keepSideAnnotationSource = (resolve: () => AnnotationFloatingAnchor | null) => {
    if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return undefined
    const original = resolve()
    if (original === null) return undefined
    const context = original instanceof HTMLElement ? original : original.contextElement
    const scroller = context.closest<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) return undefined
    const before = original instanceof HTMLElement ? original.getBoundingClientRect() : original.rect
    const band = visibleBoundary(context)
    if (before.bottom <= band.top || before.top >= band.bottom) return undefined
    const width = scroller.clientWidth
    const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
    return async (signal: AbortSignal) => {
      await nextFrame()
      await nextFrame()
      const tracks = document
        .getAnimations()
        .filter(
          (animation) =>
            'transitionProperty' in animation &&
            animation.transitionProperty === 'grid-template-columns' &&
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target instanceof Element &&
            animation.effect.target.contains(scroller),
        )
      if (tracks.length > 0) await Promise.allSettled(tracks.map((track) => track.finished))
      await nextFrame()
      if (signal.aborted || !scroller.isConnected || scroller.clientWidth === width) return
      const target = resolve()
      if (target === null) return
      const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : target.rect
      const bounds = visibleBoundary(target instanceof HTMLElement ? target : target.contextElement)
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
        scroller.scrollTop += rect.bottom - before.bottom
        await nextFrame()
      }
    }
  }

  const beginSideAnnotation = (
    mainSessionId: SessionId,
    capture: import('./selection.ts').SelectionCapture,
  ): boolean => {
    if (
      disposed ||
      !featureEnabled.getSnapshot() ||
      (sideOwners.has(mainSessionId) &&
        (sessions.list.getSnapshot().byId[mainSessionId]?.retainedBy.mainView ?? 0) === 0) ||
      unavailableMains.has(mainSessionId)
    )
      return false
    const main = sessions.binding(mainSessionId)
    if (main === undefined || main.session.getSnapshot().removed) return false
    const owner = sideChatFor(mainSessionId)
    try {
      const current = owner.getSnapshot().active
      const chat = current === null || current.archived ? owner.createChat() : current
      if (!owner.lastSaveSucceeded) throw new SideChatFailure('storage')
      const source = sideAnnotationCapture(capture, mainSessionId)
      const lifetime = integrationLifetime.signal
      const restore = keepSideAnnotationSource(() => selectionAnchor(source, document, mainSessionId))
      owner.show()
      sideChatSidebar?.open(mainSessionId)
      // Capture the target before asynchronous preparation; switching tabs never retargets this editor.
      void owner
        .prepare(chat.sideChatId)
        .then(async (binding) => {
          if (lifetime.aborted) return
          await restore?.(lifetime)
          if (lifetime.aborted || disposed || !featureEnabled.getSnapshot()) return
          if (sideOwners.get(binding.sessionId) !== owner || unavailableMains.has(mainSessionId)) return
          if (!canEditAnnotations(binding.sessionId)) {
            controllerFor(binding.sessionId).setNotice('error', 'error.submitting')
            return
          }
          faceFor(binding.sessionId).beginSelection(source)
        })
        .catch((cause: unknown) => {
          if (lifetime.aborted || disposed) return
          controllerFor(mainSessionId).setNotice('error', 'sideChat.annotationFailed')
          ctx.logger.warn('Could not open the receiving annotation editor', cause)
        })
      return true
    } catch (cause: unknown) {
      controllerFor(mainSessionId).setNotice(
        'error',
        cause instanceof SideChatFailure && cause.code === 'storage'
          ? 'sideChat.storageUnavailable'
          : 'sideChat.annotationFailed',
      )
      return false
    }
  }

  /** @param sessionId - side Conversation. @returns Whether its chat still holds pending references or a frozen request. */
  const sideAttachable = (sessionId: SessionId): boolean => {
    const owner = sideOwners.get(sessionId)
    if (owner === undefined) return false
    const chat = sideChatIds.get(sessionId)
    const target = chat === undefined ? owner.getSnapshot().active : owner.chatView(chat)
    if (target === null || target.status === 'disposed') return false
    return target.references.length > 0 || target.outbox !== null
  }

  /** @param mainSessionId - main Conversation collecting references. @returns Its receiving chat label, or nothing before multiple chats exist. */
  const sideChatTargetLabel = (mainSessionId: SessionId): string | undefined => {
    const owner = sideChats.get(mainSessionId)
    if (owner === undefined) return undefined
    const view = owner.getSnapshot()
    if (view.chats.length < 2 || view.active === null) return undefined
    const ordinal = view.chats.findIndex((chat) => chat.sideChatId === view.activeSideChatId) + 1
    return annotationT('sideChat.receivingTarget', {
      title:
        view.active.sideSessionId === null
          ? (view.active.title ?? annotationT('sideChat.untitled', { ordinal }))
          : receivingTitleFor(view.active.sideSessionId),
    })
  }

  for (const mainSessionId of storedSideChatMainIds(browserStorage)) sideChatFor(mainSessionId)

  /** Wait until the Host reports the source Session on screen, then until its exact message is mounted. */
  const awaitSourceSession = (sourceId: SessionId, signal: AbortSignal): Promise<boolean> => {
    if (ctx.sidebarRight.mounted.getSnapshot() === sourceId) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const settle = (found: boolean): void => {
        unsubscribe()
        signal.removeEventListener('abort', abort)
        resolve(found)
      }
      const abort = (): void => {
        settle(false)
      }
      const unsubscribe = ctx.sidebarRight.mounted.subscribe(() => {
        if (ctx.sidebarRight.mounted.getSnapshot() === sourceId) settle(true)
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /**
   * Show the exact recorded quote in its source main Session without replacing the current panel state.
   *
   * When the source Session is not the one on screen the Host navigation opens it first;
   * the sidebar stays as it is on wide screens and is returned to the main body on narrow
   * ones, where a fullscreen panel would cover the restored quote.
   */
  const locateSideChatReference = async (
    reference: Pick<
      SideChatReference,
      'sourceSessionId' | 'messageId' | 'messageSeq' | 'responseVersion' | 'quote'
    >,
  ): Promise<boolean> => {
    const sourceId = reference.sourceSessionId
    if (disposed || !featureEnabled.getSnapshot() || unavailableMains.has(sourceId)) return false
    const binding = sessions.binding(sourceId)
    if (binding === undefined || binding.session.getSnapshot().removed) return false
    const navigation = new AbortController()
    const lifetime = integrationLifetime.signal
    const abort = (): void => navigation.abort()
    lifetime.addEventListener('abort', abort, { once: true })
    const narrow = (): boolean =>
      typeof window !== 'undefined' && window.innerWidth < SIDEBAR_DRAWER_BREAKPOINT
    try {
      if (ctx.sidebarRight.mounted.getSnapshot() !== sourceId) {
        // Host navigation owns the Session switch; the panel keeps its own state until the
        // source Conversation is actually on screen.
        const workspace = ctx.get('uiWorkspace')
        if (workspace === undefined) return false
        workspace.openSession(sourceId)
        if (!(await awaitSourceSession(sourceId, navigation.signal))) return false
      }
      // A fullscreen panel would cover the restored quote; a docked one stays while the body shows.
      if (narrow()) {
        const tab = ctx.sidebarRight.tabsIn(sourceId).find((item) => item.kind === SIDE_CHAT_KIND)
        if (tab !== undefined) ctx.sidebarRight.hide(tab.id)
      }
      const result = await controllerFor(sourceId).locateMessageQuote(reference, navigation.signal)
      const found =
        !navigation.signal.aborted &&
        ctx.sidebarRight.mounted.getSnapshot() === sourceId &&
        result === 'shown'
      if (!found && !navigation.signal.aborted && ctx.sidebarRight.mounted.getSnapshot() === sourceId)
        controllers.get(sourceId)?.controller.setNotice('error', 'sideChat.locationFailed')
      return found
    } finally {
      lifetime.removeEventListener('abort', abort)
      navigation.abort()
    }
  }

  /** Execute one slash-command line through the Session-addressed command Remote with ordered image and file attachments. */
  const executeCommand = async (
    targetId: SessionId,
    line: string,
    attachments: readonly SubmitAttachment[],
    signal?: AbortSignal,
  ): Promise<CommandOutcome> => {
    if (signal?.aborted) throw new SideChatFailure('disposed')
    const binding = sessions.binding(targetId)
    if (binding === undefined) {
      return { ok: false, errorText: `Target Session ${String(targetId)} is unavailable` }
    }
    const remoteCommands = ctx.get('remote.commands') as CommandRemoteFace | undefined
    if (remoteCommands !== undefined) {
      const result = await commandWithinLifetime(
        remoteCommands.execute(targetId, line, attachments, signal),
        signal,
      )
      if (!result.ok) return { ok: false, errorText: transportMessage(result) }
      const value = result.value
      if (value === undefined) return { ok: false, errorText: 'command was not matched' }
      if (value.result.kind === 'error')
        return { ok: false, errorText: value.result.text ?? 'command failed' }
      return {
        ok: true,
        errorText: '',
        ...(value.result.text === undefined ? {} : { text: value.result.text }),
      }
    }
    if (attachments.length > 0) return { ok: false, errorText: 'attachments are unavailable' }
    const result = await commandWithinLifetime(binding.session.command(line), signal)
    if (!result.ok) return { ok: false, errorText: transportMessage(result) }
    if (!result.value.matched) return { ok: false, errorText: 'command was not matched' }
    return { ok: true, errorText: '' }
  }

  const prepareAttachmentIdentities = async (
    targetId: SessionId,
    attachments: readonly SubmitAttachment[],
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof parseAttachmentIdentities>> => {
    if (attachments.length === 0) return Object.freeze([])
    const prepared = await executeCommand(
      targetId,
      `/${config.commandName} ${ATTACHMENT_PREPARE_INPUT}`,
      attachments,
      signal,
    )
    if (!prepared.ok)
      throw new Error(annotationT('error.prepareAttachments'), { cause: new Error(prepared.errorText) })
    try {
      const actual = parseAttachmentIdentities(JSON.parse(prepared.text ?? 'null'))
      if (
        actual.length !== attachments.length ||
        actual.some((item, index) => item.type !== attachments[index]!.type)
      )
        throw new Error('Preflight attachment count or order does not match the request')
      return actual
    } catch (cause: unknown) {
      throw new Error(annotationT('error.prepareAttachments'), { cause })
    }
  }

  const submitAttached = async (
    origin: AnnotationController,
    overallRequirement: string,
    attachments: readonly SubmitAttachment[],
    protocolLocale: ProtocolLocale,
    snapshot: AnnotationView,
    signal: AbortSignal,
  ): Promise<void> => {
    const selectedRetry = retryEntry(snapshot)
    const retry =
      selectedRetry === undefined
        ? undefined
        : origin
            .getSnapshot()
            .outbox.find(
              (item): item is OutboxPayloadEntry =>
                isOutboxPayloadEntry(item) &&
                item.payload.submissionId === selectedRetry.payload.submissionId,
            )
    if (selectedRetry !== undefined) {
      if (retry === undefined || retry.status === 'withdrawn') throw new SubmissionChangedError()
      if (retry.status !== 'ready' && retry.status !== 'failed') return
    }
    const draftCount = selectedAnnotations(snapshot).length
    if (retry === undefined && draftCount > config.maxAnnotationsPerSubmission) {
      origin.setNotice('error', 'error.items')
      throw new Error(`annotation batch exceeds ${config.maxAnnotationsPerSubmission} annotations`)
    }
    // 刷新后附件由用户重新选择；数量或类型不符时不能丢弃原批次的附件继续发送。
    const expectedAttachments = retry?.attachments ?? retry?.images
    if (retry !== undefined) {
      const count = expectedAttachments?.count ?? 0
      const kinds = retry?.attachments?.kinds
      const matches =
        attachments.length === count &&
        attachments.every((attachment, index) => attachment.type === (kinds?.[index] ?? 'image'))
      if (!matches) {
        const message =
          count === 0
            ? annotationT('error.retryAttachmentsAdded')
            : annotationT('error.attachmentsRequired', { count })
        origin.setNotice(
          'error',
          count === 0 ? 'error.retryAttachmentsAdded' : 'error.attachmentsRequired',
          count === 0 ? undefined : { count },
        )
        throw new Error(message)
      }
    }
    const targetId = (retry?.targetSessionId ?? origin.sessionId) as unknown as SessionId
    let attachmentIdentities = retry?.payload.attachmentIdentities
    if (retry === undefined || attachmentIdentities !== undefined) {
      let actual: ReturnType<typeof parseAttachmentIdentities> = Object.freeze([])
      if (attachments.length > 0) {
        const prepared = await executeCommand(
          targetId,
          `/${config.commandName} ${ATTACHMENT_PREPARE_INPUT}`,
          attachments,
          signal,
        )
        if (signal.aborted) throw new SideChatFailure('disposed')
        if (!prepared.ok) throw new Error(prepared.errorText)
        try {
          actual = parseAttachmentIdentities(JSON.parse(prepared.text ?? 'null'))
          if (
            actual.length !== attachments.length ||
            actual.some((item, index) => item.type !== attachments[index]!.type)
          ) {
            throw new Error('Preflight attachment count or order does not match the request')
          }
        } catch (cause: unknown) {
          const message = annotationT('error.prepareAttachments')
          origin.setNotice('error', 'error.prepareAttachments')
          throw new Error(message, { cause })
        }
      }
      if (attachmentIdentities !== undefined && !sameAttachmentIdentities(attachmentIdentities, actual)) {
        const message = annotationT('error.retryAttachmentsChanged')
        origin.setNotice('error', 'error.retryAttachmentsChanged')
        throw new Error(message)
      }
      attachmentIdentities = actual
    }
    if (signal.aborted) throw new SideChatFailure('disposed')
    const entry = origin.createOutbox(
      'queue',
      targetId as unknown as SessionIdentity,
      overallRequirement,
      retry === undefined ? attachmentMetadata(attachments) : undefined,
      protocolLocale,
      snapshot,
      attachmentIdentities,
    )
    if (entry.status !== 'ready' && entry.status !== 'failed') return
    const target = targetId === (origin.sessionId as unknown as SessionId) ? origin : controllerFor(targetId)
    if (target !== origin) {
      target.adoptOutbox(entry)
      linkMirrors(entry.payload.submissionId, origin, target)
    }
    const rejectLocal = (notice: 'items' | 'payload', message: string): never => {
      origin.setNotice('error', notice === 'items' ? 'error.items' : 'error.payload')
      throw new Error(message)
    }
    if (entry.payload.annotations.length > config.maxAnnotationsPerSubmission) {
      rejectLocal('items', `annotation batch exceeds ${config.maxAnnotationsPerSubmission} annotations`)
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(entry.payload)).byteLength
    if (payloadBytes > config.maxPayloadBytes) {
      rejectLocal('payload', `annotation payload exceeds ${config.maxPayloadBytes} bytes`)
    }
    const binding = sessions.binding(targetId)
    if (binding === undefined) {
      const message = `Target Session ${String(targetId)} is unavailable`
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw new Error(message)
    }
    origin.markSending(entry.payload.submissionId)
    if (target !== origin) target.markSending(entry.payload.submissionId)
    let outcome: CommandOutcome
    try {
      outcome = await executeCommand(
        targetId,
        encodeSubmissionCommand(config.commandName, entry.payload),
        attachments,
        signal,
      )
    } catch (cause: unknown) {
      if (signal.aborted) {
        const message = annotationT('sideChat.failure.disposed')
        origin.markFailed(entry.payload.submissionId, message)
        if (target !== origin) target.markFailed(entry.payload.submissionId, message)
        throw new SideChatFailure('disposed', cause)
      }
      const message = failureMessage(cause)
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw cause instanceof Error ? cause : new Error(message)
    }
    if (signal.aborted) throw new SideChatFailure('disposed')
    if (!outcome.ok) {
      const message =
        outcome.errorText === ATTACHMENT_IDENTITY_MISMATCH
          ? annotationT('error.retryAttachmentsChanged')
          : outcome.errorText
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw new Error(message)
    }
    origin.markAccepted(entry.payload.submissionId)
    if (target !== origin) target.markAccepted(entry.payload.submissionId)
  }

  const withdraw = async (origin: AnnotationController, submissionId: SubmissionId): Promise<void> => {
    const entry = origin
      .getSnapshot()
      .outbox.find((item) => isOutboxPayloadEntry(item) && item.payload.submissionId === submissionId)
    if (
      entry === undefined ||
      entry.status !== 'queued' ||
      entry.payload.annotations.some((annotation) => annotation.source?.kind === 'diff')
    )
      return
    const targetId = entry.targetSessionId as unknown as SessionId
    const binding = sessions.binding(targetId)
    if (binding === undefined) {
      origin.setNotice('error', 'error.targetSessionUnavailable')
      return
    }
    const target = targetId === (origin.sessionId as unknown as SessionId) ? origin : controllerFor(targetId)
    const inbox = binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
    if (inbox === undefined) return
    if (!inbox['next-turn'].some((message) => message.id === String(entry.messageId))) {
      origin.markQueueClaimed(submissionId)
      if (target !== origin) target.markQueueClaimed(submissionId)
      return
    }
    const result = await binding.session.updateQueue(entry.messageId as unknown as MessageId, {
      kind: 'remove',
    })
    if (!result.ok) {
      if (result.error.code === 'session/queue-item-not-found') {
        const sessionSnapshot = binding.session.getSnapshot()
        const chatSnapshot = ctx.uiConversation.binding(binding).target('chat').getSnapshot()
        target.reconcile({
          chat: { nodes: chatSnapshot?.nodes ?? EMPTY_CHAT_NODES },
          queue: annotationQueue(
            binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined,
          ),
          hasMore: sessionSnapshot.hasMore,
        })
        if (target !== origin) {
          origin.syncSubmissionState(target.getSnapshot(), submissionId, target.sessionId)
        }
        origin.markQueueClaimed(submissionId)
        if (target !== origin) target.markQueueClaimed(submissionId)
        return
      }
      origin.setNotice('error', 'error.send')
      return
    }
    origin.markWithdrawn(submissionId)
    if (target !== origin) target.markWithdrawn(submissionId)
  }

  const discardOutbox = (origin: AnnotationController, submissionId: SubmissionId): void => {
    const entry = origin
      .getSnapshot()
      .outbox.find((item) => isOutboxPayloadEntry(item) && item.payload.submissionId === submissionId)
    if (entry === undefined) return
    const targetId = entry.targetSessionId as unknown as SessionId
    const binding = sessions.binding(targetId)
    let target = origin
    if (binding !== undefined) {
      target = targetId === (origin.sessionId as unknown as SessionId) ? origin : controllerFor(targetId)
      const chat = ctx.uiConversation.binding(binding).target('chat').getSnapshot()
      target.reconcile({
        chat: { nodes: chat?.nodes ?? EMPTY_CHAT_NODES },
        queue: annotationQueue(
          binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined,
        ),
        hasMore: binding.session.getSnapshot().hasMore,
      })
      if (target !== origin) origin.syncSubmissionState(target.getSnapshot(), submissionId, target.sessionId)
    }
    origin.discardOutbox(submissionId)
    if (target !== origin) target.discardOutbox(submissionId)
  }

  const claimFor = (sessionId: SessionId): CommandClaim =>
    Object.freeze({
      name: 'dsh-annotation-attachment',
      token: COMPOSER_ATTACHMENT_TOKEN,
      attachments: true,
      async submit(
        args: string,
        actx: ClientContext,
        attachments: readonly SubmitAttachment[],
      ): Promise<SubmitOutcome> {
        if (sessions.scopeOf(actx) !== sessionId) {
          return { kind: 'error', text: 'Annotation attachment belongs to another Session.' }
        }
        const input = conversation.input.for(actx)
        const state = input.state.getSnapshot()
        // Re-check slash commands inside submit: an Enter that lands before the
        // command-release watcher must still route through the official command
        // interface without creating an outbox or marking annotations sent.
        const visible = stripComposerToken(args.trim() === '' ? visibleComposerDraft(state) : args).trim()
        if (visible.startsWith('/')) {
          return executeCommand(sessionId, visible, attachments).then(
            (outcome) =>
              outcome.ok ? { kind: 'success' as const } : { kind: 'error' as const, text: outcome.errorText },
            (cause: unknown) => ({ kind: 'error' as const, text: failureMessage(cause) }),
          )
        }
        const serialization = new AbortController()
        const sessionLifetime = controllers.get(sessionId)?.lifetime.signal
        const signal = AbortSignal.any([
          serialization.signal,
          integrationLifetime.signal,
          ...(sessionLifetime === undefined ? [] : [sessionLifetime]),
        ])
        try {
          if (disposed || signal.aborted || !featureEnabled.getSnapshot() || sessionLifetime === undefined)
            throw new SideChatFailure('disposed')
          const controller = controllerFor(sessionId)
          const prepared = controllers.get(sessionId)?.submissionSnapshot
          const snapshot = prepared?.view ?? controller.getSnapshot()
          const includeAnnotations =
            prepared?.includeAnnotations ?? !controllers.get(sessionId)?.manualDetached
          const association = sideOwners.get(sessionId)
          const sideOwner = association?.getSnapshot().status === 'disposed' ? undefined : association
          const sideChatId = sideChatIds.get(sessionId)
          const sideChat = sideOwner?.chatView(sideChatId) ?? null
          const references = prepared?.sideReferences ?? sideChat?.references ?? []
          const sideOutbox =
            prepared === undefined || prepared === null ? (sideChat?.outbox ?? null) : prepared.sideOutbox
          const submitReferences = sideOwner !== undefined && (references.length > 0 || sideOutbox !== null)
          const hasAttachable =
            submitReferences ||
            (includeAnnotations &&
              (retryEntry(snapshot) !== undefined || selectedAnnotations(snapshot).length > 0))
          if (!hasAttachable) {
            // 注解已被清空而 claim 仍被占用：不要用英文报错卡住发送。
            // 结算后释放 claim，下一次 Enter 走官方普通消息通道，文字不丢失。
            scheduleDetachRetry(sessionId)
            return { kind: 'error', text: annotationT('error.emptySubmit') }
          }
          const overallRequirement = await serializeComposerRequirement(
            state,
            inputTriggers.sessionOf(actx),
            signal,
          )
          if (signal.aborted) throw new SideChatFailure('disposed')
          const protocolLocale = prepared?.protocolLocale ?? resolveProtocolLocale()
          if (submitReferences) {
            await submitSideChat({
              owner: sideOwner,
              ...(sideChatId === undefined ? {} : { sideChatId }),
              annotations: controller,
              ...(includeAnnotations ? { annotationSnapshot: snapshot } : {}),
              references,
              outbox: sideOutbox,
              question: overallRequirement,
              attachments,
              ...(attachments.length === 0 ? {} : { attachmentMetadata: attachmentMetadata(attachments)! }),
              protocolLocale,
              config,
              signal,
              available: () => {
                const binding = sessions.binding(sessionId)
                return (
                  sideOwners.get(sessionId) === sideOwner &&
                  !unavailableMains.has(sideOwner.mainSessionId) &&
                  binding !== undefined &&
                  !binding.session.getSnapshot().removed
                )
              },
              prepareAttachments: () => prepareAttachmentIdentities(sessionId, attachments, signal),
              execute: async (payload) => {
                const outcome = await executeCommand(
                  sessionId,
                  encodeSideChatSubmissionCommand(payload),
                  attachments,
                  signal,
                )
                return outcome.ok ? outcome.text : outcome.errorText
              },
              t: annotationT,
            })
          } else {
            await submitAttached(
              controller,
              overallRequirement,
              attachments,
              protocolLocale,
              snapshot,
              signal,
            )
          }
          return { kind: 'success' }
        } catch (cause: unknown) {
          return {
            kind: 'error',
            text:
              cause instanceof SideChatFailure
                ? annotationT(`sideChat.failure.${cause.code}`)
                : cause instanceof SubmissionChangedError
                  ? annotationT('error.submissionChanged')
                  : failureMessage(cause),
          }
        } finally {
          serialization.abort()
        }
      },
    })

  const ensureComposerAttachment = (sessionId: SessionId, includeAnnotations = true): boolean => {
    if (disposed || !featureEnabled.getSnapshot()) return false
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return false
    const controller = controllerFor(sessionId)
    const input = conversation.input.for(binding.ctx)
    const state = input.state.getSnapshot()
    const entry = controllers.get(sessionId)
    if (state.phase === 'claimed' && state.claim?.token === COMPOSER_ATTACHMENT_TOKEN) {
      if (entry !== undefined && includeAnnotations) entry.manualDetached = false
      return true
    }
    if (state.phase !== 'plain') return false
    // Never arm the composer while it carries an official slash command.
    if (isSlashCommandLine(state)) return false
    const snapshot = controller.getSnapshot()
    const retry = retryEntry(snapshot)
    if (retry === undefined && selectedAnnotations(snapshot).length === 0 && !sideAttachable(sessionId))
      return false
    const legacy = includeAnnotations ? snapshot.overallRequirementDraft : ''
    if (legacy.trim() !== '') input.setDraft(mergeLegacyRequirement(state.draft, legacy))
    const detached = entry?.manualDetached
    if (entry !== undefined && includeAnnotations) entry.manualDetached = false
    const attached = attachComposer(binding.ctx, input, claimFor(sessionId))
    if (!attached && entry !== undefined && detached !== undefined) entry.manualDetached = detached
    if (attached && legacy.trim() !== '') controller.setOverallRequirementDraft('')
    return attached
  }

  const toggleComposerAttachment = (sessionId: SessionId): boolean => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return false
    const input = conversation.input.for(binding.ctx)
    if (hasComposerAttachment(input.state.getSnapshot())) {
      const entry = controllers.get(sessionId)
      if (entry !== undefined) entry.manualDetached = true
      if (sideAttachable(sessionId)) {
        controllerFor(sessionId).detachAnnotations(
          controllerFor(sessionId).getSnapshot().selectedAnnotationIds,
        )
        return true
      }
      return detachComposer(binding.ctx, input)
    }
    return ensureComposerAttachment(sessionId)
  }

  /**
   * Keep the invisible attachment in sync with the composer on every input
   * change: release the claim while a slash command occupies the line (and
   * re-arm it once the command state ends), withdraw the token entirely when
   * nothing attachable remains, and never override a manual detach.
   */
  const repairComposerAttachment = (sessionId: SessionId): void => {
    if (disposed || !featureEnabled.getSnapshot()) return
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const controller = controllerFor(sessionId)
    const entry = controllers.get(sessionId)
    if (entry === undefined) return
    const input = conversation.input.for(binding.ctx)
    const state = input.state.getSnapshot()
    const snapshot = controller.getSnapshot()
    const sidePending = sideAttachable(sessionId)
    const attachable =
      sidePending ||
      (!entry.manualDetached &&
        (retryEntry(snapshot) !== undefined || selectedAnnotations(snapshot).length > 0))
    const attached = hasComposerAttachment(state)
    if (isSlashCommandLine(state)) {
      // Command state: release the claim and drop the zero-width token, while
      // annotations stay logically attached. Only OUR automatic release marks
      // the command-exit re-arm; a manual detach never does.
      if (attached) {
        entry.commandReleased = true
        detachComposer(binding.ctx, input)
      }
      return
    }
    const commandReleased = entry.commandReleased
    entry.commandReleased = false
    // Nothing attachable remains (drafts cleared, retry discarded): withdraw
    // any surviving attachment, including one still in the claimed phase.
    if (!attachable) {
      if (attached) detachComposer(binding.ctx, input)
      return
    }
    if (state.phase !== 'plain' || (entry.manualDetached && !sidePending)) return
    // Arm the claim only when this plugin owns the release: a surviving
    // unclaimed token, or an exit from our slash-command release. A manual
    // detach stays detached until the user (or auto-attach) arms it again.
    if (state.claim?.token !== COMPOSER_ATTACHMENT_TOKEN) {
      if (sidePending || hasComposerAttachment(state) || commandReleased || autoAttachEnabled.getSnapshot()) {
        ensureComposerAttachment(sessionId, !entry.manualDetached)
      }
    }
  }

  const canEditAnnotations = (sessionId: SessionId): boolean => {
    if (disposed || !featureEnabled.getSnapshot()) return false
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return false
    const { phase } = conversation.input.for(binding.ctx).state.getSnapshot()
    return phase === 'plain' || phase === 'claimed'
  }

  const faceFor = (sessionId: SessionId): AnnotationInjected => {
    const controller = controllerFor(sessionId)
    const sideOwner = sideOwners.get(sessionId)
    const canEdit = (): boolean => canEditAnnotations(sessionId)
    const changeSendIntent = (change: () => void): void => {
      if (!canEdit()) return
      change()
      repairComposerAttachment(sessionId)
    }
    return {
      hooks: {
        annotations: controller,
        compactSummary: compactSummaryEnabled,
      },
      annotationT,
      openSourceAnnotation: (target, annotationId) => {
        const targetId = String(target) as SessionId
        const owner = sideOwners.get(targetId)
        const chat = owner?.chatForSideSession(targetId)
        const targetController = controllerFor(targetId)
        const reopen = () => {
          const item = targetController
            .getSnapshot()
            .annotations.find((item) => item.annotationId === annotationId)
          if (item !== undefined)
            targetController.openAnnotation(annotationId, item.status === 'draft' ? 'marker-edit' : 'marker')
        }
        if (owner === undefined || chat == null || chat.archived) {
          ctx.get('uiWorkspace')?.openSession(targetId)
        } else {
          const lifetime = integrationLifetime.signal
          const restore = keepSideAnnotationSource(() =>
            markerElement(annotationId, document, owner.mainSessionId),
          )
          owner.selectChat(chat.sideChatId)
          owner.show()
          sideChatSidebar?.open(owner.mainSessionId)
          const layout = restore?.(lifetime)
          if (layout !== undefined) {
            void layout.then(() => {
              if (
                !lifetime.aborted &&
                owner.getSnapshot().activeSideChatId === chat.sideChatId &&
                controllers.get(targetId)?.controller === targetController
              )
                reopen()
            })
            return
          }
        }
        reopen()
      },
      ...(sideOwner === undefined ? {} : { sideChatMainSessionId: sideOwner.mainSessionId }),
      beginSideAnnotation: (capture: import('./selection.ts').SelectionCapture) =>
        beginSideAnnotation(sessionId, capture),
      locateSideChatReference,
      removeSourceReference: (chatId, referenceId) =>
        sideChats.get(sessionId)?.removeReference(referenceId, chatId),
      bindNoticeHost: (anchor) => noticeHub.activate(controller, anchor),
      beginSelection: (capture) => changeSendIntent(() => controller.beginSelection(capture)),
      chooseOverlap: (annotationId) => changeSendIntent(() => controller.chooseOverlap(annotationId)),
      dismissOverlap: () => controller.dismissOverlap(),
      suspendEditor: () => controller.suspendEditor(),
      resumeEditor: (key) => changeSendIntent(() => controller.resumeEditor(key)),
      discardEditorDraft: (key) => changeSendIntent(() => controller.discardEditorDraft(key)),
      toggleSelected: (annotationId) =>
        changeSendIntent(() => {
          const selecting = !controller.getSnapshot().selectedAnnotationIds.includes(annotationId)
          if (selecting) {
            const entry = controllers.get(sessionId)
            if (entry !== undefined) entry.manualDetached = false
          }
          controller.toggleSelected(annotationId)
          if (selecting) ensureComposerAttachment(sessionId)
        }),
      setProcessingMode: (mode) => changeSendIntent(() => controller.setProcessingMode(mode)),
      selectRetry: (submissionId) =>
        changeSendIntent(() => {
          const binding = sessions.binding(sessionId)
          if (binding !== undefined) detachComposer(binding.ctx, conversation.input.for(binding.ctx))
          controller.selectRetry(submissionId)
          if (retryEntry(controller.getSnapshot()) !== undefined) ensureComposerAttachment(sessionId)
        }),
      openAnnotation: (annotationId, presentation) =>
        changeSendIntent(() => controller.openAnnotation(annotationId, presentation)),
      updateEditorText: (text) => changeSendIntent(() => controller.updateEditorText(text)),
      confirmLongSelection: () => changeSendIntent(() => controller.confirmLongSelection()),
      saveEditor: () => {
        if (!canEdit()) throw new Error(annotationT('error.submitting'))
        if (controller.getSnapshot().editor?.kind === 'new') {
          const entry = controllers.get(sessionId)
          if (entry !== undefined) entry.manualDetached = false
        }
        return controller.saveEditor()
      },
      closeEditor: (force) => (force === true && !canEdit() ? false : controller.closeEditor(force)),
      detachAnnotations: (ids) =>
        changeSendIntent(() => {
          if (!controller.detachAnnotations(ids)) controller.setNotice('error', 'trash.error.write')
        }),
      trashAnnotations: (ids) =>
        changeSendIntent(() => {
          try {
            if (!controller.trashAnnotations(ids)) controller.setNotice('error', 'trash.error.write')
          } catch (error) {
            controller.setNotice(
              'error',
              error instanceof Error && error.message === 'annotation-submission-locked'
                ? 'trash.error.locked'
                : 'trash.error.write',
            )
          }
        }),
      deleteDraft: (annotationId) => changeSendIntent(() => controller.deleteDraft(annotationId)),
      undoDelete: () => changeSendIntent(() => controller.undoDelete()),
      dismissDeleteUndo: () => controller.dismissDeleteUndo(),
      setPanelOpen: (open) => controller.setPanelOpen(open),
      setRecordExpanded: (expanded) => controller.setRecordExpanded(expanded),
      autoAttachEnabled: () => autoAttachEnabled.getSnapshot(),
      ensureComposerAttachment: () => ensureComposerAttachment(sessionId),
      toggleComposerAttachment: () => toggleComposerAttachment(sessionId),
      repairComposerAttachment: () => repairComposerAttachment(sessionId),
      withdraw: async (submissionId) => {
        if (canEdit()) await withdraw(controller, submissionId)
      },
      discardOutbox: (submissionId) => changeSendIntent(() => discardOutbox(controller, submissionId)),
      navigate: (annotationId) => {
        const item = controller.getSnapshot().annotations.find((item) => item.annotationId === annotationId)
        const sourceId = item === undefined ? undefined : messageSourceSession(item, String(sessionId))
        if (
          item !== undefined &&
          item.messageId !== undefined &&
          sourceId !== undefined &&
          sourceId !== String(sessionId)
        )
          return locateSideChatReference({
            sourceSessionId: sourceId as SessionId,
            messageId: item.messageId,
            messageSeq: item.messageSeq,
            responseVersion: item.responseVersion,
            quote: item.quote,
          })
        return controller.navigate(annotationId)
      },
      annotateMessage: (messageId) => canEdit() && controller.annotateMessage(messageId),
      registerEndpoint: (messageId, endpoint) => controller.registerEndpoint(messageId, endpoint),
      updateHighlightRanges: (messageId, ranges) =>
        highlights.update(JSON.stringify([sessionId, messageId]), ranges),
      activateHighlight: (messageId, range) =>
        highlights.activate(JSON.stringify([sessionId, messageId]), range),
      removeHighlights: (messageId) => highlights.remove(JSON.stringify([sessionId, messageId])),
      highlightsSupported: () => highlights.supported(),
    }
  }

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'dsh-annotation-notice',
        locale: NS,
        inject: () => noticeHub.inject(),
      },
      AnnotationToastHost,
    ),
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: ANNOTATION_SETTINGS_NAMESPACE,
        order: 22,
        label: () => annotationT('settings.title'),
        locale: NS,
        inject: () => {
          const settings = settingsController.inject()
          const market = marketUpdateController.inject()
          const trash = annotationTrash.inject()
          return {
            ...settings,
            ...market,
            ...trash,
            hooks: { ...settings.hooks, ...market.hooks, ...trash.hooks, sessionCatalog: sessions.list },
          }
        },
      },
      AnnotationPluginCard,
    ),
  )

  const beginFileAnnotation = (source: FileAnnotationSource, rect: DOMRect): void => {
    const entry = [...controllers.values()].find(
      (candidate) => String(candidate.controller.sessionId) === String(source.sessionId),
    )
    if (entry === undefined) return
    entry.controller.beginSelection({
      source: compactFileSource(source),
      quote: Object.freeze({ exact: '', prefix: '', suffix: '', start: 0, end: 0 }),
      rect: Object.freeze({ top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }),
    })
  }

  const beginOfficialDiff = (source: OfficialDiffAnnotationSource, rect: DOMRect): void => {
    const entry = [...controllers.values()].find(
      (candidate) => String(candidate.controller.sessionId) === String(source.snapshot.sessionId),
    )
    if (entry === undefined) return
    entry.controller.beginSelection({
      source: compactOfficialDiffSource(source),
      quote: Object.freeze({ exact: '', prefix: '', suffix: '', start: 0, end: 0 }),
      rect: Object.freeze({ top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }),
    })
  }

  const manageSideChat = async (
    mainSessionId: SessionId,
    chatId: SideChatId,
    operation: 'archive' | 'delete',
  ): Promise<void> => {
    const owner = sideChats.get(mainSessionId)
    const chat = owner?.chatView(chatId)
    if (owner === undefined || chat === null || chat === undefined || disposed) return
    const actions = ctx.get('sessionActions')
    if (actions === undefined) {
      controllerFor(mainSessionId).setNotice('error', 'sideChat.hostUpgrade')
      return
    }
    try {
      if (chat.sideSessionId === null || chat.status !== 'ready') await owner.prepare(chatId)
      const target = owner.chatView(chatId)?.sideSessionId
      if (target == null) throw new SideChatFailure('unavailable')
      const outcome = await actions[operation](target)
      if (disposed || outcome !== 'completed') return
      if (operation === 'archive') owner.setArchived(chatId, true)
      else owner.removeChat(chatId)
      const next = owner.getSnapshot().activeSideChatId
      if (next !== null) void prepareSideChat(mainSessionId, next)
    } catch (cause: unknown) {
      if (disposed) return
      controllerFor(mainSessionId).setNotice('error', 'sideChat.actionFailed')
      ctx.logger.warn('Side-chat Session operation failed', cause)
    }
  }

  const installConversationIntegrations = (): (() => Promise<void>) => {
    const sidebar = registerSideChatSidebar(ctx, annotationT, {
      retainVisiblePanel: (mainSessionId) => {
        const panels = visibleSidePanels.get(mainSessionId) ?? new Set<symbol>()
        const token = Symbol()
        panels.add(token)
        visibleSidePanels.set(mainSessionId, panels)
        refreshSourceAnnotations()
        return () => {
          if (!panels.delete(token) || visibleSidePanels.get(mainSessionId) !== panels) return
          if (panels.size === 0) visibleSidePanels.delete(mainSessionId)
          refreshSourceAnnotations()
        }
      },
      controllerFor: (mainSessionId) =>
        unavailableMains.has(mainSessionId) ? undefined : sideChatFor(mainSessionId),
      controllerForSide: (sideSessionId) => sideOwners.get(sideSessionId),
      locateReference: locateSideChatReference,
      archiveChat: (mainSessionId, chatId) => manageSideChat(mainSessionId, chatId, 'archive'),
      deleteChat: (mainSessionId, chatId) => manageSideChat(mainSessionId, chatId, 'delete'),
      openPanel: (mainSessionId) => {
        if (disposed || unavailableMains.has(mainSessionId)) return
        const owner = sideChatFor(mainSessionId)
        owner.show()
        // A page kind is one tab per pane, so opening it again reveals the same panel
        // instead of stacking duplicates; a first open creates the page.
        const target = owner.getSnapshot().activeSideChatId
        ctx.sidebarRight.openTabIn(mainSessionId, SIDE_CHAT_KIND)
        if (target !== null) void prepareSideChat(mainSessionId, target)
      },
      prepareChat: prepareSideChat,
      openStandalone: (sideSessionId) => {
        const workspace = ctx.get('uiWorkspace')
        if (workspace === undefined) return
        const owner = sideOwners.get(sideSessionId)
        if (owner !== undefined) {
          owner.show()
          const chat = owner.chatForSideSession(sideSessionId)
          if (chat !== null) void prepareSideChat(owner.mainSessionId, chat.sideChatId)
        }
        workspace.openSession(sideSessionId)
      },
    })
    sideChatSidebar = sidebar
    // Older released Hosts have no text-interaction service or shared toolbar.
    const sharedSelection = ctx.uiConversation.interactions !== undefined
    const readFilePage: import('./components/FileWholeAnnotationAction.tsx').ReadFilePage = (
      sessionId,
      path,
      offset,
      limit,
      signal,
    ) =>
      ctx.get('remote.workspaceFiles').read(String(sessionId) as SessionId, path, { offset, limit }, signal)
    const previewSources = new Map<string, FileAnnotationSource>()
    const registerPreviewSource = (source: FileAnnotationSource): (() => void) => {
      previewSources.set(source.resourceAddress, source)
      return () => {
        if (previewSources.get(source.resourceAddress) === source)
          previewSources.delete(source.resourceAddress)
      }
    }
    const disposers = [
      ...(sharedSelection
        ? [
            ctx.slots.inject('conversation.chat.text-interaction', () =>
              ctx.slots.register(
                {
                  name: 'conversation.chat.text-interaction',
                  key: 'quote',
                  priority: -100,
                  locale: NS,
                  inject: (sessionId) => {
                    const sideOwner = sideOwners.get(sessionId)
                    return {
                      ...(sideOwner === undefined ? {} : { sideChatMainSessionId: sideOwner.mainSessionId }),
                      readAnnotationSelection: () => controllerFor(sessionId).readMessageSelection(),
                      beginSideAnnotation: (capture: import('./selection.ts').SelectionCapture) =>
                        beginSideAnnotation(sessionId, capture),
                      readSideChatTarget: () => sideChatTargetLabel(sessionId),
                      beginAnnotation: (capture: import('./selection.ts').SelectionCapture) => {
                        if (!canEditAnnotations(sessionId)) return false
                        faceFor(sessionId).beginSelection(capture)
                        return true
                      },
                    }
                  },
                },
                MessageSelectionActions,
              ),
            ),
          ]
        : []),
      ctx.slots.inject('deliverables.review.file.actions', () =>
        ctx.slots.register(
          {
            name: 'deliverables.review.file.actions',
            id: 'dsh-annotation-official-diff-action',
            locale: NS,
          },
          createDiffReviewAction(beginOfficialDiff, officialDiffEnabled),
        ),
      ),
      installDiffIntegration(
        {
          get: (sessionId) =>
            [...controllers.values()].find(
              (candidate) => String(candidate.controller.sessionId) === String(sessionId),
            )?.controller,
        },
        {
          t: annotationT,
          annotate: annotationT('selection.annotate'),
          title: annotationT('editor.editTitle'),
          annotation: annotationT('editor.annotationLabel'),
          save: annotationT('editor.save'),
          cancel: annotationT('editor.cancel'),
          edit: annotationT('source.edit'),
          locate: annotationT('source.locate'),
          wholeFile: annotationT('source.wholeFile'),
          failed: annotationT('editor.autosaveFailed'),
          status: {
            draft: annotationT('status.draft'),
            queued: annotationT('status.queued'),
            sent: annotationT('status.sent'),
            processed: annotationT('status.processed'),
          },
        },
        highlights,
        officialDiffEnabled,
      ),
      ctx.slots.inject('sidebar.right.tab.document.action', () =>
        DOCUMENT_RENDERER_IDS.map((key) =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document.action',
              key,
              locale: NS,
              registrant: 'dsh-annotation',
            },
            FileWholeAnnotationAction(
              beginFileAnnotation,
              readFileSnapshot,
              registerPreviewSource,
              readFilePage,
              officialFileEnabled,
            ),
          ),
        ),
      ),
      ctx.slots.inject('sidebar.right.tab.document.actions', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.tab.document.actions',
            id: 'dsh-annotation-office-whole-file',
            locale: NS,
          },
          OfficeWholeAnnotationAction(
            beginFileAnnotation,
            readFileSnapshot,
            registerPreviewSource,
            officialFileEnabled,
          ),
        ),
      ),
      installDocumentIntegration(
        {
          get: (sessionId) =>
            [...controllers.entries()].find(([id]) => String(id) === String(sessionId))?.[1]?.controller,
        },
        (key) => annotationT(key),
        (address) => previewSources.get(address),
        highlights,
        officialFileEnabled,
      ),
      ctx.slots.inject('conversation.chat.node', () => {
        const restoreAssistantRenderers = decorateAssistantRenderers(ctx, faceFor, sharedSelection)
        const removeUser = ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: 'user',
            priority: -100,
            locale: NS,
            inject: faceFor,
          },
          UserNode,
        )
        const removeSteering = ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: 'steering',
            priority: -100,
            locale: NS,
            inject: faceFor,
          },
          SteeringNode,
        )
        return () => {
          restoreAssistantRenderers()
          removeSteering()
          removeUser()
        }
      }),
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'dsh-annotation',
            order: -20,
            locale: NS,
            inject: faceFor,
          },
          AnnotationExperience,
        ),
      ),
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'dsh-annotation-record-toggle',
            order: -20,
            locale: NS,
            inject: faceFor,
          },
          AnnotationRecordToggle,
        ),
      ),
      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'dsh-annotation-composer-chip',
            order: -20,
            locale: NS,
            inject: faceFor,
          },
          AnnotationComposerChip,
        ),
      ),
      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: 'dsh-annotation',
            order: 15,
            locale: NS,
            inject: faceFor,
          },
          AssistantAnnotationAction,
        ),
      ),
      ctx.slots.inject('conversation.chat.commandview', () => [
        ctx.slots.register(
          {
            name: 'conversation.chat.commandview',
            key: config.commandName,
            inject: faceFor,
          },
          HiddenCommandRow,
        ),
        ...[SIDE_CHAT_COMMAND_NAME, ...LEGACY_COMMAND_NAMES]
          .filter((name) => name !== config.commandName)
          .map((name) =>
            ctx.slots.register(
              {
                name: 'conversation.chat.commandview',
                key: name,
                inject: faceFor,
              },
              HiddenCommandRow,
            ),
          ),
      ]),
    ]
    return async () => {
      if (sideChatSidebar === sidebar) sideChatSidebar = undefined
      for (const dispose of disposers.reverse()) dispose()
      await sidebar.dispose()
    }
  }

  const pendingDetachRetries = new Map<SessionId, { cancel: () => void; settled: Promise<void> }>()

  const cancelPendingDetachRetries = (): void => {
    for (const pending of pendingDetachRetries.values()) pending.cancel()
    pendingDetachRetries.clear()
  }

  /** Keep the input observer until Host settlement makes the retained command token editable. */
  const scheduleDetachRetry = (sessionId: SessionId): Promise<void> => {
    const pending = pendingDetachRetries.get(sessionId)
    if (pending !== undefined) return pending.settled
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return Promise.resolve()
    const input = conversation.input.for(binding.ctx)
    let finish: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      finish = resolve
    })
    let unsubscribeInput: () => void = () => undefined
    let unsubscribeSessions: () => void = () => undefined
    const cancel = () => {
      unsubscribeInput()
      unsubscribeSessions()
      pendingDetachRetries.delete(sessionId)
      finish()
    }
    const check = (): void => {
      const current = sessions.binding(sessionId)
      if (current === undefined || current.ctx !== binding.ctx || binding.session.getSnapshot().removed) {
        cancel()
        return
      }
      const { phase } = input.state.getSnapshot()
      if (phase !== 'plain' && phase !== 'claimed') return
      if (!hasComposerAttachment(input.state.getSnapshot()) || detachComposer(binding.ctx, input)) cancel()
    }
    pendingDetachRetries.set(sessionId, { cancel, settled })
    unsubscribeInput = input.state.subscribe(check)
    unsubscribeSessions = sessions.list.subscribe(check)
    check()
    return settled
  }

  const detachAllComposerAttachments = (): Promise<void> => {
    for (const [sessionId, entry] of controllers) {
      entry.commandReleased = false
      const binding = sessions.binding(sessionId)
      if (binding === undefined) continue
      const input = conversation.input.for(binding.ctx)
      if (!hasComposerAttachment(input.state.getSnapshot())) continue
      if (detachComposer(binding.ctx, input)) continue
      void scheduleDetachRetry(sessionId)
    }
    return Promise.all([...pendingDetachRetries.values()].map((pending) => pending.settled)).then(
      () => undefined,
    )
  }

  const retireSideChat = (mainSessionId: SessionId): void => {
    if (unavailableMains.has(mainSessionId)) return
    unavailableMains.add(mainSessionId)
    const owner = sideChats.get(mainSessionId)
    if (owner === undefined) return
    sideChatObservers.get(mainSessionId)?.()
    sideChatObservers.delete(mainSessionId)
    const sideIds = owner
      .getSnapshot()
      .chats.flatMap((chat) => (chat.sideSessionId === null ? [] : [chat.sideSessionId]))
    const detach = Promise.all(
      sideIds.map((sideId) => {
        controllers.get(sideId)?.lifetime.abort()
        const binding = sessions.binding(sideId)
        return binding === undefined ? Promise.resolve() : scheduleDetachRetry(binding.sessionId)
      }),
    )
    const retirement = Promise.all([sideChatSidebar?.retire(mainSessionId), detach]).then(() => {
      for (const sideId of sideIds) {
        dropController(sideId)
        sideOwners.delete(sideId)
        sideChatIds.delete(sideId)
      }
      owner.dispose()
    })
    sideChatRetirements.set(mainSessionId, retirement)
    void retirement.then(
      () => sideChatRetirements.delete(mainSessionId),
      (cause: unknown) => ctx.logger.error('Could not release the deleted main Session side chat', cause),
    )
  }

  ctx.effect(() => {
    const prune = (): void => {
      if (disposed) return
      const list = sessions.list.getSnapshot()
      if (list.phase !== 'ready') return
      for (const mainSessionId of sideChats.keys()) {
        if (!Object.hasOwn(list.byId, mainSessionId)) retireSideChat(mainSessionId)
      }
      for (const [sideId, owner] of sideOwners) {
        const chat = owner.chatForSideSession(sideId)
        if (chat === null || !chat.sideSessionId || Object.hasOwn(list.byId, sideId)) continue
        // The published Host baseline predates permanent Session deletion.
        if (typeof sessions.isDeleted !== 'function') continue
        void sessions
          .isDeleted(sideId)
          .then((deleted) => {
            if (deleted && !disposed && sideOwners.get(sideId) === owner) owner.removeChat(chat.sideChatId)
          })
          .catch((cause: unknown) => {
            ctx.logger.warn('Could not verify side-chat deletion', cause)
          })
      }
      for (const sessionId of controllers.keys()) {
        if (!Object.hasOwn(list.byId, sessionId) && !sideOwners.has(sessionId)) dropController(sessionId)
      }
      refreshSourceAnnotations()
    }
    const unsubscribe = sessions.list.subscribe(prune)
    prune()
    return unsubscribe
  }, 'dsh-annotation: Session controller pruning')

  ctx.effect(() => {
    const reconcile = (): void => {
      if (disposed || ctx.workspaces.list.getSnapshot().phase !== 'ready') return
      const archived = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds)
      for (const owner of sideChats.values()) {
        for (const chat of owner.getSnapshot().chats) {
          if (chat.sideSessionId !== null)
            owner.setArchived(chat.sideChatId, archived.has(chat.sideSessionId))
        }
        const target = owner.getSnapshot().activeSideChatId
        if (target !== null && featureEnabled.getSnapshot()) void prepareSideChat(owner.mainSessionId, target)
      }
    }
    const release = ctx.workspaces.list.subscribe(reconcile)
    reconcile()
    return release
  }, 'dsh-annotation: official side-chat archive state')

  // Only hosts with durable deletion inspection also publish this lifecycle event.
  if (typeof sessions.isDeleted === 'function') {
    const deletionEvents = ctx.remote as typeof ctx.remote & {
      $on(event: 'api-session/deleted', listener: (id: SessionId) => void): () => void
    }
    ctx.effect(
      () =>
        deletionEvents.$on('api-session/deleted', (sideSessionId) => {
          const owner = sideOwners.get(sideSessionId)
          const chat = owner?.chatForSideSession(sideSessionId)
          if (chat !== undefined && chat !== null) owner?.removeChat(chat.sideChatId)
        }),
      'dsh-annotation: official side-chat deletion',
    )
  }

  ctx.effect(() => {
    const flush = (): void => {
      for (const entry of controllers.values()) entry.controller.flush()
    }
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
      flush()
    }
  }, 'dsh-annotation: editor lifecycle persistence')

  ctx.effect(() => {
    const synchronize = (event: StorageEvent): void => {
      if (event.storageArea !== null && event.storageArea !== browserStorage) return
      for (const owner of sideChats.values()) owner.synchronizeStorage(event.key)
      if (event.key === null) return
      for (const [sessionId, entry] of controllers) {
        const prefix = `dsh-annotation:v1:${sessionId}`
        if (event.key === prefix || event.key.startsWith(`${prefix}:journal:`))
          entry.controller.synchronizeStorage()
      }
      if (event.key.startsWith('dsh-annotation:')) annotationTrash.refresh()
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, 'dsh-annotation: cross-page storage synchronization')

  ctx.effect(() => {
    let disposeIntegrations: (() => Promise<void>) | undefined
    let retirement: Promise<void> | undefined
    const suspendSideChats = (): void => {
      for (const owner of sideChats.values()) {
        for (const chat of owner.getSnapshot().chats) {
          if (chat.sideSessionId !== null) dropController(chat.sideSessionId)
        }
        owner.suspend()
      }
    }
    const sync = (): void => {
      if (disposed) return
      if (featureEnabled.getSnapshot()) {
        if (retirement !== undefined) return
        cancelPendingDetachRetries()
        if (disposeIntegrations === undefined) {
          integrationLifetime = new AbortController()
          disposeIntegrations = installConversationIntegrations()
          // Restored associations can only retain their side Sessions after the
          // Host Session catalog is ready; preparing earlier races the catalog
          // and reports a false "unknown session" failure.
          const prepareRestored = (): void => {
            if (disposed || sessions.list.getSnapshot().phase !== 'ready') return
            unsubscribeCatalog()
            // Retained chats supply source markers even when another Tab is selected.
            for (const owner of sideChats.values()) {
              if (unavailableMains.has(owner.mainSessionId)) continue
              for (const chat of owner.getSnapshot().chats) {
                if (chat.archived || chat.sideSessionId === null) continue
                void prepareSideChat(owner.mainSessionId, chat.sideChatId)
              }
            }
          }
          const unsubscribeCatalog = sessions.list.subscribe(prepareRestored)
          integrationLifetime.signal.addEventListener('abort', unsubscribeCatalog, { once: true })
          prepareRestored()
        }
        for (const sessionId of controllers.keys()) repairComposerAttachment(sessionId)
        return
      }
      integrationLifetime.abort()
      for (const entry of controllers.values()) entry.controller.suspendEditor()
      const detached = detachAllComposerAttachments()
      const dispose = disposeIntegrations
      disposeIntegrations = undefined
      highlights.dispose()
      if (dispose === undefined) return
      const pending = Promise.all([dispose(), detached]).then(suspendSideChats)
      retirement = pending
      void pending.then(
        () => {
          if (retirement === pending) retirement = undefined
          sync()
        },
        (cause: unknown) => {
          for (const entry of controllers.values()) entry.controller.setNotice('error', 'sideChat.error')
          ctx.logger.error('Could not release the side-chat interface', cause)
        },
      )
    }
    const unsubscribeFeature = featureEnabled.subscribe(sync)
    sync()
    return async () => {
      disposed = true
      integrationLifetime.abort()
      unsubscribeFeature()
      const detached = detachAllComposerAttachments()
      await Promise.all([disposeIntegrations?.(), detached])
      await retirement
      await Promise.all(sideChatRetirements.values())
      cancelPendingDetachRetries()
      for (const unsubscribe of sideChatObservers.values()) unsubscribe()
      sideChatObservers.clear()
      for (const entry of controllers.values()) entry.dispose()
      controllers.clear()
      mirrorGroups.clear()
      for (const owner of sideChats.values()) owner.dispose()
      await Promise.all([...sideChats.values()].map((owner) => owner.whenStorageIdle()))
      sideChats.clear()
      sideOwners.clear()
      visibleSidePanels.clear()
      highlights.dispose()
    }
  }, 'dsh-annotation: dynamic conversation integrations')
}

export type { AnnotationConfig, MessageIdentity }
