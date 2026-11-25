/** Wrap the Host's assistant renderer with source selection and annotation bubbles. */
import { createElement, Fragment, memo, useMemo, type ComponentType, type ReactElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChatFlowSlotProps, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FactoryComponentPropsOf, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationBoundProps, AnnotationInjected, AssistantAnnotationProps } from './contract.ts'
import { AnnotatedAssistantNode } from './components/AnnotatedAssistantNode.tsx'
import { stripMachineMarkersForDisplay } from '../shared/model-ack.ts'
import { emphasizeReplyLabels, knownReplyPairs } from './reply-emphasis.ts'

type BaseAssistantProps = ChatNodeViewProps<'assistant-step'>
type DecoratedAssistantProps = BaseAssistantProps & AnnotationBoundProps

interface MutableStoredEntry extends Omit<StoredEntry, 'inject'> {
  inject?: (...args: unknown[]) => Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isComponent(value: unknown): value is ComponentType<BaseAssistantProps> {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)
}

function mergeInjected(
  original: Record<string, unknown>,
  annotation: AnnotationInjected,
): Record<string, unknown> {
  const originalHooks = isRecord(original.hooks) ? original.hooks : {}
  return {
    ...original,
    ...annotation,
    hooks: { ...originalHooks, ...annotation.hooks },
  }
}

function useDisplayNode(
  node: BaseAssistantProps['node'],
  useAnnotations: AnnotationBoundProps['useAnnotations'],
) {
  const annotations = useAnnotations((view) => view.annotations)
  const outbox = useAnnotations((view) => view.outbox)
  const replyAssociations = useAnnotations((view) => view.replyAssociations)
  const known = useMemo(
    () =>
      knownReplyPairs({
        annotations,
        outbox,
        ...(replyAssociations === undefined ? {} : { replyAssociations }),
      }),
    [annotations, outbox, replyAssociations],
  )
  return useMemo(() => {
    let changed = false
    const blocks = node.data.blocks.map((block) => {
      if (block.kind !== 'text' && block.kind !== 'reasoning') return block
      const decorated = block.kind === 'text' ? emphasizeReplyLabels(block.text, known) : block.text
      const text = stripMachineMarkersForDisplay(decorated, node.data.status === 'running')
      if (text === block.text) return block
      changed = true
      return { ...block, text }
    })
    return changed ? { ...node, data: { ...node.data, blocks } } : node
  }, [node, known])
}

function wrapAssistantRenderer(inner: ComponentType<BaseAssistantProps>, sharedSelection: boolean) {
  const DecoratedAssistantRenderer = memo(function DecoratedAssistantRenderer(
    props: DecoratedAssistantProps,
  ) {
    const displayNode = useDisplayNode(props.node, props.useAnnotations)
    const content = createElement(inner, { ...props, node: displayNode } as BaseAssistantProps)
    return createElement(AnnotatedAssistantNode, {
      ...props,
      t: props.annotationT,
      sharedSelection,
      children: content,
    } as AssistantAnnotationProps & { readonly children: ReactElement })
  })
  DecoratedAssistantRenderer.displayName = `Annotation(${inner.displayName ?? inner.name ?? 'Assistant'})`
  return DecoratedAssistantRenderer
}

type Dispatch = ChatFlowSlotProps['renderSlot']
type RoutedOwner = Parameters<Dispatch>[1]
type Options = Parameters<Dispatch>[2]
const replyFactory = 'dsh-annotation.reply'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'dsh-annotation.reply': {
      scope: 'session'
      props: { owner: RoutedOwner; options: Options; node: BaseAssistantProps['node']; dispatch: Dispatch }
      inject: AnnotationInjected
    }
  }
}

function FlowReply({
  owner,
  options,
  node,
  dispatch,
  ...annotation
}: FactoryComponentPropsOf<typeof replyFactory>) {
  const displayNode = useDisplayNode(node, annotation.useAnnotations)
  return createElement(AnnotatedAssistantNode, {
    ...annotation,
    node,
    turnProcess: owner.turnProcess,
    t: annotation.annotationT,
    sharedSelection: true,
    children: createElement(
      Fragment,
      null,
      dispatch('conversation.chat.node', { ...owner, node: displayNode }, options),
    ),
  })
}

function wrapFlow(Inner: ComponentType<ChatFlowSlotProps>) {
  return function AnnotationFlow(flow: ChatFlowSlotProps) {
    const renderNode = (key: Parameters<Dispatch>[0], owner: RoutedOwner, options: Options) =>
      owner.node.kind === 'assistant-step'
        ? flow.renderFactorySlot(
            replyFactory,
            { owner, options, node: owner.node, dispatch: flow.renderSlot },
            { fallback: flow.renderSlot(key, owner, options) },
          )
        : flow.renderSlot(key, owner, options)
    return createElement(Inner, { ...flow, renderSlot: renderNode as Dispatch })
  }
}

/**
 * Decorate assistant renderers without replacing their text or tool presentation.
 * @param ctx Plugin context owning the slot listener.
 * @param faceFor Annotation actions for the current Session.
 * @param sharedSelection Whether the Host owns the message selection toolbar.
 * @returns A disposer restoring the original renderer and injection.
 */
export function decorateAssistantRenderers(
  ctx: ClientContext,
  faceFor: (sessionId: SessionId) => AnnotationInjected,
  sharedSelection = false,
): () => void {
  // Keep the annotation outside renderers that replace an assistant seat in place.
  const flow =
    sharedSelection &&
    ctx.slots.entries('conversation.chat.flow').some((entry) => entry.options.key === undefined)
  const slot = flow ? 'conversation.chat.flow' : 'conversation.chat.node'
  const decorated = new WeakSet<object>()
  const restores: Array<() => void> = []
  // A live flow already has cached Host bindings. Only the reply factory owns annotation bindings.
  if (flow)
    restores.push(
      ctx.slots.registerFactory({ name: replyFactory, scope: 'session', inject: faceFor }, FlowReply),
    )
  const decorateAll = (): void => {
    const entries = ctx.slots.entries(slot) as readonly MutableStoredEntry[]
    for (const entry of entries) {
      if (!flow && entry.options.key !== 'assistant-step') continue
      const current = entry.component
      if (!isComponent(current) || decorated.has(current)) continue
      const originalInject = entry.inject
      const next = flow
        ? wrapFlow(entry.component as ComponentType<ChatFlowSlotProps>)
        : wrapAssistantRenderer(current, sharedSelection)
      const nextInject = (...args: unknown[]): Record<string, unknown> => {
        const original = originalInject?.(...args) ?? {}
        return mergeInjected(original, faceFor(args[0] as SessionId))
      }
      decorated.add(next)
      entry.component = next
      if (!flow) entry.inject = nextInject
      restores.push(() => {
        if (entry.component === next) entry.component = current
        if (entry.inject !== nextInject) return
        if (originalInject === undefined) delete entry.inject
        else entry.inject = originalInject
      })
    }
  }
  decorateAll()
  const off = ctx.on('slots/changed', (key: string) => {
    if (key === slot) decorateAll()
  })
  return () => {
    off()
    for (const restore of restores.reverse()) restore()
  }
}
