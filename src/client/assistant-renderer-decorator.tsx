/** Wrap the Host's assistant renderer with source selection and annotation bubbles. */
import { createElement, memo, useMemo, type ComponentType, type ReactElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationBoundProps, AnnotationInjected, AssistantAnnotationProps } from './contract.ts'
import { AnnotatedAssistantNode } from './components/AnnotatedAssistantNode.tsx'
import { stripMachineMarkersForDisplay } from '../shared/model-ack.ts'

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

function wrapAssistantRenderer(inner: ComponentType<BaseAssistantProps>) {
  const DecoratedAssistantRenderer = memo(function DecoratedAssistantRenderer(
    props: DecoratedAssistantProps,
  ) {
    const displayNode = useMemo(() => {
      let changed = false
      const blocks = props.node.data.blocks.map((block) => {
        if (block.kind !== 'text' && block.kind !== 'reasoning') return block
        const text = stripMachineMarkersForDisplay(block.text, props.node.data.status === 'running')
        if (text === block.text) return block
        changed = true
        return { ...block, text }
      })
      return changed ? { ...props.node, data: { ...props.node.data, blocks } } : props.node
    }, [props.node])
    const content = createElement(inner, { ...props, node: displayNode } as BaseAssistantProps)
    return createElement(AnnotatedAssistantNode, {
      ...props,
      t: props.annotationT,
      children: content,
    } as AssistantAnnotationProps & { readonly children: ReactElement })
  })
  DecoratedAssistantRenderer.displayName = `Annotation(${inner.displayName ?? inner.name ?? 'Assistant'})`
  return DecoratedAssistantRenderer
}

/**
 * Decorate assistant renderers without replacing their text or tool presentation.
 * @param ctx Plugin context owning the slot listener.
 * @param faceFor Annotation actions for the current Session.
 * @returns A disposer restoring the original renderer and injection.
 */
export function decorateAssistantRenderers(
  ctx: ClientContext,
  faceFor: (sessionId: SessionId) => AnnotationInjected,
): () => void {
  const decorated = new WeakSet<object>()
  const restores: Array<() => void> = []
  const decorateAll = (): void => {
    const entries = ctx.slots.entries('conversation.chat.node') as readonly MutableStoredEntry[]
    for (const entry of entries) {
      if (entry.options.key !== 'assistant-step') continue
      const current = entry.component
      if (!isComponent(current) || decorated.has(current)) continue
      const originalInject = entry.inject
      const next = wrapAssistantRenderer(current)
      const nextInject = (...args: unknown[]): Record<string, unknown> => {
        const original = originalInject?.(...args) ?? {}
        return mergeInjected(original, faceFor(args[0] as SessionId))
      }
      decorated.add(next)
      entry.component = next
      entry.inject = nextInject
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
    if (key === 'conversation.chat.node') decorateAll()
  })
  return () => {
    off()
    for (const restore of restores.reverse()) restore()
  }
}
