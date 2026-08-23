/** Browser half: selection capture, durable provenance cards, and local draft recovery. */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  CommandClaim,
  InputTriggerServiceContract,
  SubmitImageAttachment,
  SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveConfig, LEGACY_COMMAND_NAMES } from '../shared/config.ts'
import { encodeSubmissionCommand } from '../shared/codec.ts'
import { ANNOTATION_SETTINGS_NAMESPACE, type AnnotationSettings } from '../shared/settings.ts'
import type {
  AnnotationConfig,
  MessageIdentity,
  OutboxImages,
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
import { AnnotationController } from './controller.ts'
import type { AnnotationInjected, UserAnnotationProps } from './contract.ts'
import { AnnotationSettingsController } from './feature-toggle.ts'
import { createFocusChatAdapter } from './focus-adapter.ts'
import { HighlightManager } from './highlight.ts'
import { AnnotationStorage } from './storage.ts'
import type { StorageLike } from './storage.ts'
import { styles } from './styles.ts'
import { en, zh } from './locales.ts'
import { decorateAssistantRenderers } from './assistant-renderer-decorator.tsx'
import { AnnotatedUserNode } from './components/AnnotatedUserNode.tsx'
import { AnnotationDock } from './components/AnnotationDock.tsx'
import { AssistantAnnotationAction } from './components/AssistantAnnotationAction.tsx'
import { HiddenCommandRow } from './components/HiddenCommandRow.tsx'
import { AnnotationPluginCard } from './components/AnnotationPluginCard.tsx'

const NS = 'dshAnnotation'
export const inject = ['slots', 'sessions', 'locale', 'conversation', 'inputTriggers', 'settingsScope']

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
}

/** Structural mirror of the Host wire image shape; the plugin never depends on the attachment package. */
interface WireImageAttachment {
  readonly mediaType: string
  readonly data: string
  readonly name?: string
}

/** Structural mirror of the mounted `commands/execute` remote, typed without the attachment package. */
interface CommandRemoteFace {
  execute(
    agentId: SessionId,
    line: string,
    images: readonly WireImageAttachment[],
    signal?: AbortSignal,
  ): Promise<{
    readonly ok: boolean
    readonly value?: { readonly result: { readonly kind: 'success' | 'error'; readonly text?: string } }
    readonly error?: unknown
  }>
}

/** Non-base64 image metadata retained on the outbox entry for refresh-safe retries. */
function imageMetadata(images: readonly SubmitImageAttachment[]): OutboxImages | undefined {
  if (images.length === 0) return undefined
  return Object.freeze({
    count: images.length,
    mediaTypes: Object.freeze(images.map((image) => image.mediaType)),
    names: Object.freeze(images.map((image) => image.name ?? '').filter((name) => name !== '')),
  })
}

/** Mount every UI contribution and bind one controller to each encountered Session. */
export function apply(ctx: ClientContext, input?: Partial<AnnotationConfig>): void {
  const config = resolveConfig(input)
  const sessions = ctx.sessions as unknown as ISessions
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
  const settingsController = new AnnotationSettingsController(
    ctx.settingsScope.bind<AnnotationSettings>({ namespace: ANNOTATION_SETTINGS_NAMESPACE }),
    browserStorage,
  )
  const featureEnabled = settingsController.feature()
  const autoAttachEnabled = settingsController.autoAttach()
  const localToolsEnabled = settingsController.localTools()
  ctx.effect(() => () => settingsController.dispose(), 'dsh-annotation: settings controller')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-annotation: dictionaries')
  const annotationT = ctx.locale.bind(NS)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshAnnotation = 'true'
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-annotation: styles')

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
  const controllers = new Map<
    SessionId,
    { controller: AnnotationController; dispose: () => void; commandReleased: boolean }
  >()
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
          linkMirrors(outbox.payload.submissionId, controller, entry.controller)
        }
      }
      for (const outbox of entry.controller.getSnapshot().outbox) {
        if (outbox.targetSessionId === (sessionId as unknown as SessionIdentity)) {
          linkMirrors(outbox.payload.submissionId, entry.controller, controller)
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
  ctx.effect(() => {
    const prune = () => {
      const list = sessions.list.getSnapshot()
      if (list.phase !== 'ready') return
      for (const sessionId of controllers.keys()) {
        if (!Object.prototype.hasOwnProperty.call(list.byId, sessionId)) dropController(sessionId)
      }
    }
    const unsubscribe = sessions.list.subscribe(prune)
    prune()
    return unsubscribe
  }, 'dsh-annotation: Session controller pruning')

  const controllerFor = (sessionId: SessionId): AnnotationController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing.controller
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`Session ${String(sessionId)} has no client binding`)
    const controller = new AnnotationController(
      sessionId as unknown as SessionIdentity,
      new AnnotationStorage(browserStorage, sessionId as unknown as SessionIdentity),
      binding.session,
      config,
    )
    const reconcile = () => {
      controller.reconcile(binding.session.getSnapshot())
      syncMirrors(controller)
    }
    const unsubscribe = binding.session.subscribe(reconcile)
    controllers.set(sessionId, {
      controller,
      commandReleased: false,
      dispose: () => {
        unsubscribe()
        controller.dispose()
      },
    })
    reconnectMirrors(sessionId, controller)
    reconcile()
    return controller
  }

  /** Execute one slash-command line through the rc.2 official command interface, images included. */
  const executeCommand = async (
    targetId: SessionId,
    line: string,
    images: readonly SubmitImageAttachment[],
  ): Promise<CommandOutcome> => {
    const remoteCommands = (ctx.remote as { commands?: CommandRemoteFace } | undefined)?.commands
    if (remoteCommands !== undefined) {
      const result = await remoteCommands.execute(
        targetId,
        line,
        images as unknown as readonly WireImageAttachment[],
      )
      if (!result.ok) return { ok: false, errorText: transportMessage(result) }
      const value = result.value
      if (value === undefined) return { ok: false, errorText: 'command was not matched' }
      if (value.result.kind === 'error')
        return { ok: false, errorText: value.result.text ?? 'command failed' }
      return { ok: true, errorText: '' }
    }
    const binding = sessions.binding(targetId)
    if (binding === undefined) {
      return { ok: false, errorText: `Target Session ${String(targetId)} is unavailable` }
    }
    if (images.length > 0) return { ok: false, errorText: 'image attachments are unavailable' }
    const result = await binding.session.command(line)
    if (!result.ok) return { ok: false, errorText: transportMessage(result) }
    if (!result.value.matched) return { ok: false, errorText: 'command was not matched' }
    return { ok: true, errorText: '' }
  }

  const submitAttached = async (
    origin: AnnotationController,
    overallRequirement: string,
    images: readonly SubmitImageAttachment[],
    protocolLocale: ProtocolLocale,
  ): Promise<void> => {
    const snapshot = origin.getSnapshot()
    const retry = snapshot.outbox.find((item) => item.status === 'failed' || item.status === 'ready')
    const draftCount = snapshot.annotations.filter((item) => item.status === 'draft').length
    if (retry === undefined && draftCount > config.maxAnnotationsPerSubmission) {
      origin.setNotice('error', 'items')
      throw new Error(`annotation batch exceeds ${config.maxAnnotationsPerSubmission} annotations`)
    }
    // A refresh loses browser-owned draft images: never silently resubmit a
    // recorded image batch without images.
    if (retry !== undefined && (retry.images?.count ?? 0) > 0 && images.length === 0) {
      const count = retry.images?.count ?? 0
      const message = annotationT('error.imagesRequired', { count })
      origin.setNotice('error', message)
      throw new Error(message)
    }
    const targetId = (retry?.targetSessionId ?? origin.sessionId) as unknown as SessionId
    const entry = origin.createOutbox(
      'queue',
      targetId as unknown as SessionIdentity,
      overallRequirement,
      retry === undefined ? imageMetadata(images) : undefined,
      protocolLocale,
    )
    const target = targetId === (origin.sessionId as unknown as SessionId) ? origin : controllerFor(targetId)
    if (target !== origin) {
      target.adoptOutbox(entry)
      linkMirrors(entry.payload.submissionId, origin, target)
    }
    const rejectLocal = (notice: 'items' | 'payload', message: string): never => {
      origin.markWithdrawn(entry.payload.submissionId)
      if (target !== origin) target.markWithdrawn(entry.payload.submissionId)
      origin.setNotice('error', notice)
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
        images,
      )
    } catch (cause: unknown) {
      const message = failureMessage(cause)
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw cause instanceof Error ? cause : new Error(message)
    }
    if (!outcome.ok) {
      origin.markFailed(entry.payload.submissionId, outcome.errorText)
      if (target !== origin) target.markFailed(entry.payload.submissionId, outcome.errorText)
      throw new Error(outcome.errorText)
    }
    origin.markAccepted(entry.payload.submissionId)
    if (target !== origin) target.markAccepted(entry.payload.submissionId)
  }

  const withdraw = async (origin: AnnotationController, submissionId: SubmissionId): Promise<void> => {
    const entry = origin.getSnapshot().outbox.find((item) => item.payload.submissionId === submissionId)
    if (entry === undefined || entry.status !== 'queued') return
    const targetId = entry.targetSessionId as unknown as SessionId
    const binding = sessions.binding(targetId)
    if (binding === undefined) {
      origin.setNotice('error', 'Target Session is unavailable')
      return
    }
    const result = await binding.session.updateQueue(entry.messageId as unknown as MessageId, {
      kind: 'remove',
    })
    const target =
      targetId === (origin.sessionId as unknown as SessionId) ? origin : controllers.get(targetId)?.controller
    if (!result.ok) {
      if (result.error.code === 'queue-item-not-found') {
        target?.reconcile(binding.session.getSnapshot())
        if (target !== undefined && target !== origin) {
          origin.syncSubmissionState(target.getSnapshot(), submissionId, target.sessionId)
        }
        origin.markQueueClaimed(submissionId)
        if (target !== undefined && target !== origin) target.markQueueClaimed(submissionId)
        return
      }
      origin.setNotice('error', transportMessage(result))
      return
    }
    origin.markWithdrawn(submissionId)
    if (target !== undefined && target !== origin) target.markWithdrawn(submissionId)
  }

  const claimFor = (sessionId: SessionId): CommandClaim =>
    Object.freeze({
      token: COMPOSER_ATTACHMENT_TOKEN,
      images: true,
      async submit(
        args: string,
        actx: ClientContext,
        images: readonly SubmitImageAttachment[],
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
          return executeCommand(sessionId, visible, images).then(
            (outcome) =>
              outcome.ok ? { kind: 'success' as const } : { kind: 'error' as const, text: outcome.errorText },
            (cause: unknown) => ({ kind: 'error' as const, text: failureMessage(cause) }),
          )
        }
        const serialization = new AbortController()
        try {
          const controller = controllerFor(sessionId)
          const snapshot = controller.getSnapshot()
          const hasAttachable =
            snapshot.outbox.some((item) => item.status === 'failed' || item.status === 'ready') ||
            snapshot.annotations.some((item) => item.status === 'draft')
          if (!hasAttachable) {
            // 注解已被清空而 claim 仍被占用：不要用英文报错卡住发送。
            // 结算后释放 claim，下一次 Enter 走官方普通消息通道，文字不丢失。
            scheduleDetachRetry(sessionId)
            return { kind: 'error', text: annotationT('error.emptySubmit') }
          }
          const overallRequirement = await serializeComposerRequirement(
            state,
            inputTriggers.sessionOf(actx),
            serialization.signal,
          )
          await submitAttached(controller, overallRequirement, images, resolveProtocolLocale())
          return { kind: 'success' }
        } catch (cause: unknown) {
          return { kind: 'error', text: failureMessage(cause) }
        } finally {
          serialization.abort()
        }
      },
    })

  const ensureComposerAttachment = (sessionId: SessionId): boolean => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return false
    const controller = controllerFor(sessionId)
    const input = conversation.input.for(binding.ctx)
    const state = input.state.getSnapshot()
    if (hasComposerAttachment(state)) return true
    if (state.phase !== 'plain') return false
    // Never arm the composer while it carries an official slash command.
    if (isSlashCommandLine(state)) return false
    const snapshot = controller.getSnapshot()
    const retry = snapshot.outbox.some((item) => item.status === 'failed' || item.status === 'ready')
    if (!retry && !snapshot.annotations.some((item) => item.status === 'draft')) return false
    const legacy = snapshot.overallRequirementDraft
    if (legacy.trim() !== '') input.setDraft(mergeLegacyRequirement(state.draft, legacy))
    const attached = attachComposer(binding.ctx, input, claimFor(sessionId))
    if (attached && legacy.trim() !== '') controller.setOverallRequirementDraft('')
    return attached
  }

  const toggleComposerAttachment = (sessionId: SessionId): boolean => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return false
    const input = conversation.input.for(binding.ctx)
    return hasComposerAttachment(input.state.getSnapshot())
      ? detachComposer(binding.ctx, input)
      : ensureComposerAttachment(sessionId)
  }

  /**
   * Keep the invisible attachment in sync with the composer on every input
   * change: release the claim while a slash command occupies the line (and
   * re-arm it once the command state ends), withdraw the token entirely when
   * nothing attachable remains, and never override a manual detach.
   */
  const repairComposerAttachment = (sessionId: SessionId): void => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const controller = controllerFor(sessionId)
    const entry = controllers.get(sessionId)
    if (entry === undefined) return
    const input = conversation.input.for(binding.ctx)
    const state = input.state.getSnapshot()
    const snapshot = controller.getSnapshot()
    const attachable =
      snapshot.outbox.some((item) => item.status === 'failed' || item.status === 'ready') ||
      snapshot.annotations.some((item) => item.status === 'draft')
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
    if (state.phase !== 'plain') return
    // Arm the claim only when this plugin owns the release: a surviving
    // unclaimed token, or an exit from our slash-command release. A manual
    // detach stays detached until the user (or auto-attach) arms it again.
    if (state.claim?.token !== COMPOSER_ATTACHMENT_TOKEN) {
      if (state.draft.startsWith(COMPOSER_ATTACHMENT_TOKEN) || commandReleased) {
        attachComposer(binding.ctx, input, claimFor(sessionId))
      }
    }
  }

  const faceFor = (sessionId: SessionId): AnnotationInjected => {
    const controller = controllerFor(sessionId)
    return {
      hooks: { annotations: controller, localTools: localToolsEnabled },
      annotationT,
      beginSelection: (capture) => controller.beginSelection(capture),
      openAnnotation: (annotationId) => controller.openAnnotation(annotationId),
      updateEditorText: (text) => controller.updateEditorText(text),
      confirmLongSelection: () => controller.confirmLongSelection(),
      saveEditor: () => controller.saveEditor(),
      closeEditor: (force) => controller.closeEditor(force),
      deleteDraft: (annotationId) => controller.deleteDraft(annotationId),
      undoDelete: () => controller.undoDelete(),
      dismissDeleteUndo: () => controller.dismissDeleteUndo(),
      exportLocalData: () => controller.exportLocalData(),
      clearLocalDrafts: () => controller.clearLocalDrafts(),
      setPanelOpen: (open) => controller.setPanelOpen(open),
      autoAttachEnabled: () => autoAttachEnabled.getSnapshot(),
      ensureComposerAttachment: () => ensureComposerAttachment(sessionId),
      toggleComposerAttachment: () => toggleComposerAttachment(sessionId),
      repairComposerAttachment: () => repairComposerAttachment(sessionId),
      withdraw: (submissionId) => withdraw(controller, submissionId),
      discardOutbox: (submissionId) => controller.discardOutbox(submissionId),
      navigate: (annotationId) => controller.navigate(annotationId),
      annotateMessage: (messageId) => controller.annotateMessage(messageId),
      registerEndpoint: (messageId, endpoint) => controller.registerEndpoint(messageId, endpoint),
      updateHighlightRanges: (messageId, ranges) => highlights.update(messageId, ranges),
      activateHighlight: (messageId, range) => highlights.activate(messageId, range),
      removeHighlights: (messageId) => highlights.remove(messageId),
      highlightsSupported: () => highlights.supported(),
    }
  }

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: ANNOTATION_SETTINGS_NAMESPACE,
        locale: NS,
        inject: () => settingsController.inject(),
      },
      AnnotationPluginCard,
    ),
  )

  const installConversationIntegrations = (): (() => void) => {
    const disposers = [
      ctx.slots.inject('conversation.chat.node', () => {
        const restoreAssistantRenderers = decorateAssistantRenderers(ctx, faceFor)
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
          // 先还原组件，再借后续注销事件刷新 Slot 视图，避免留下旧包装。
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
          AnnotationDock,
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
        ...LEGACY_COMMAND_NAMES.filter((name) => name !== config.commandName).map((name) =>
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
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  const pendingDetachRetries = new Map<SessionId, () => void>()

  const cancelPendingDetachRetries = (): void => {
    for (const cancel of pendingDetachRetries.values()) cancel()
    pendingDetachRetries.clear()
  }

  /**
   * Retry a submit-time attachment detach once the official input leaves `submitting`.
   *
   * A failed submit returns the composer to this plugin's claim; while disabled there is
   * no UI left to release it, so the invisible claim token would otherwise survive until
   * the plugin is re-enabled.
   */
  const scheduleDetachRetry = (sessionId: SessionId): void => {
    if (pendingDetachRetries.has(sessionId)) return
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const input = conversation.input.for(binding.ctx)
    let unsubscribe: () => void = () => undefined
    const cancel = () => {
      unsubscribe()
      pendingDetachRetries.delete(sessionId)
    }
    unsubscribe = input.state.subscribe(() => {
      if (sessions.binding(sessionId) === undefined) {
        cancel()
        return
      }
      if (input.state.getSnapshot().phase === 'submitting') return
      cancel()
      if (hasComposerAttachment(input.state.getSnapshot())) detachComposer(binding.ctx, input)
    })
    pendingDetachRetries.set(sessionId, cancel)
  }

  const detachAllComposerAttachments = (): void => {
    for (const [sessionId, entry] of controllers) {
      entry.commandReleased = false
      const binding = sessions.binding(sessionId)
      if (binding === undefined) continue
      const input = conversation.input.for(binding.ctx)
      if (!hasComposerAttachment(input.state.getSnapshot())) continue
      if (detachComposer(binding.ctx, input)) continue
      scheduleDetachRetry(sessionId)
    }
  }

  ctx.effect(
    () => () => {
      highlights.dispose()
      for (const entry of controllers.values()) entry.dispose()
      controllers.clear()
      mirrorGroups.clear()
    },
    'dsh-annotation: controller cleanup',
  )

  ctx.effect(() => {
    let disposeIntegrations: (() => void) | undefined
    const sync = (): void => {
      if (featureEnabled.getSnapshot()) {
        cancelPendingDetachRetries()
        disposeIntegrations ??= installConversationIntegrations()
        return
      }
      detachAllComposerAttachments()
      const dispose = disposeIntegrations
      disposeIntegrations = undefined
      dispose?.()
      highlights.dispose()
    }
    const unsubscribe = featureEnabled.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      cancelPendingDetachRetries()
      disposeIntegrations?.()
    }
  }, 'dsh-annotation: dynamic conversation integrations')
}

export type { AnnotationConfig, MessageIdentity }
