/** Browser half: selection capture, durable provenance cards, and local draft recovery. */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { resolveConfig } from '../shared/config.ts'
import { encodeSubmissionCommand } from '../shared/codec.ts'
import type {
  AnnotationConfig,
  DeliveryMode,
  MessageIdentity,
  SessionIdentity,
  SubmissionId,
} from '../shared/types.ts'
import { AnnotationController } from './controller.ts'
import type { AnnotationInjected, UserAnnotationProps } from './contract.ts'
import { HighlightManager } from './highlight.ts'
import { AnnotationStorage } from './storage.ts'
import type { StorageLike } from './storage.ts'
import { styles } from './styles.ts'
import { en, zh } from './locales.ts'
import { AnnotatedAssistantNode } from './components/AnnotatedAssistantNode.tsx'
import { AnnotatedUserNode } from './components/AnnotatedUserNode.tsx'
import { AnnotationDock } from './components/AnnotationDock.tsx'
import { AssistantAnnotationAction } from './components/AssistantAnnotationAction.tsx'
import { HiddenCommandRow } from './components/HiddenCommandRow.tsx'

const NS = 'inlineAnnotations'
export const inject = ['slots', 'sessions', 'locale']

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

/** Mount every UI contribution and bind one controller to each encountered Session. */
export function apply(ctx: ClientContext, input?: Partial<AnnotationConfig>): void {
  const config = resolveConfig(input)
  const sessions = ctx.sessions as unknown as ISessions
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-inline-annotations: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshInlineAnnotations = 'true'
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-inline-annotations: styles')

  const highlights = new HighlightManager()
  const controllers = new Map<SessionId, { controller: AnnotationController; dispose: () => void }>()
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
  }, 'dsh-inline-annotations: Session controller pruning')

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
      dispose: () => {
        unsubscribe()
        controller.dispose()
      },
    })
    reconnectMirrors(sessionId, controller)
    reconcile()
    return controller
  }

  const send = async (
    origin: AnnotationController,
    archived: boolean,
    delivery: DeliveryMode,
  ): Promise<void> => {
    const retry = origin
      .getSnapshot()
      .outbox.find((item) => item.status === 'failed' || item.status === 'ready')
    const draftCount = origin.getSnapshot().annotations.filter((item) => item.status === 'draft').length
    if (retry === undefined && draftCount > config.maxAnnotationsPerSubmission) {
      origin.setNotice('error', 'items')
      throw new Error(`annotation batch exceeds ${config.maxAnnotationsPerSubmission} annotations`)
    }
    let targetId = retry?.targetSessionId as unknown as SessionId | undefined
    if (targetId === undefined) {
      targetId = origin.sessionId as unknown as SessionId
      if (archived) {
        const draftSeqs = origin
          .getSnapshot()
          .annotations.filter((item) => item.status === 'draft')
          .map((item) => item.messageSeq)
        const atSeq = draftSeqs.length === 0 ? undefined : Math.max(...draftSeqs)
        try {
          targetId = await sessions.fork({
            sessionId: targetId,
            ...(atSeq === undefined ? {} : { atSeq }),
            increaseTitle: true,
          })
        } catch (cause: unknown) {
          const message = failureMessage(cause)
          origin.setNotice('error', message)
          throw cause instanceof Error ? cause : new Error(message)
        }
      }
    }
    const entry = origin.createOutbox(delivery, targetId as unknown as SessionIdentity)
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
    if (archived) sessions.open(targetId)
    origin.markSending(entry.payload.submissionId)
    if (target !== origin) target.markSending(entry.payload.submissionId)
    let result: Awaited<ReturnType<typeof binding.session.command>>
    try {
      result = await binding.session.command(encodeSubmissionCommand(config.commandName, entry.payload))
    } catch (cause: unknown) {
      const message = failureMessage(cause)
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw cause instanceof Error ? cause : new Error(message)
    }
    if (!result.ok || !result.value.matched) {
      const message = transportMessage(result)
      origin.markFailed(entry.payload.submissionId, message)
      if (target !== origin) target.markFailed(entry.payload.submissionId, message)
      throw new Error(message)
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

  const faceFor = (sessionId: SessionId): AnnotationInjected => {
    const controller = controllerFor(sessionId)
    return {
      hooks: { annotations: controller },
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
      setOverallRequirementDraft: (value) => controller.setOverallRequirementDraft(value),
      submit: (archived, delivery) => send(controller, archived, delivery),
      withdraw: (submissionId) => withdraw(controller, submissionId),
      navigate: (annotationId) => controller.navigate(annotationId),
      annotateMessage: (messageId) => controller.annotateMessage(messageId),
      registerEndpoint: (messageId, endpoint) => controller.registerEndpoint(messageId, endpoint),
      updateHighlightRanges: (messageId, ranges) => highlights.update(messageId, ranges),
      activateHighlight: (messageId, range) => highlights.activate(messageId, range),
      removeHighlights: (messageId) => highlights.remove(messageId),
      highlightsSupported: () => highlights.supported(),
    }
  }

  ctx.slots.inject('conversation.chat.node', () => [
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'assistant-step',
        priority: -100,
        locale: NS,
        inject: faceFor,
      },
      AnnotatedAssistantNode,
    ),
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'user',
        priority: -100,
        locale: NS,
        inject: faceFor,
      },
      UserNode,
    ),
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'steering',
        priority: -100,
        locale: NS,
        inject: faceFor,
      },
      SteeringNode,
    ),
  ])
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'inline-annotations',
        order: -20,
        locale: NS,
        inject: faceFor,
      },
      AnnotationDock,
    ),
  )
  ctx.slots.inject('conversation.chat.assistant-actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.assistant-actions',
        id: 'inline-annotations',
        order: 15,
        locale: NS,
        inject: faceFor,
      },
      AssistantAnnotationAction,
    ),
  )
  ctx.slots.inject('conversation.chat.commandview', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.commandview',
        key: config.commandName,
        inject: faceFor,
      },
      HiddenCommandRow,
    ),
  )

  ctx.effect(
    () => () => {
      highlights.dispose()
      for (const entry of controllers.values()) entry.dispose()
      controllers.clear()
      mirrorGroups.clear()
    },
    'dsh-inline-annotations: controller cleanup',
  )
}

export type { AnnotationConfig, MessageIdentity }
