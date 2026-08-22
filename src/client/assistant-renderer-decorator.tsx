import { createElement, memo, type ComponentType, type ReactNode } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationBoundProps, AnnotationInjected, AssistantAnnotationProps } from './contract.ts'
import { AnnotatedAssistantNode } from './components/AnnotatedAssistantNode.tsx'

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
    // 先生成原渲染器元素，保留它自己的 conversation 翻译函数和全部运行时属性。
    const content = createElement(inner, props as BaseAssistantProps)
    return createElement(AnnotatedAssistantNode, {
      ...props,
      t: props.annotationT,
      children: content,
    } as AssistantAnnotationProps & { readonly children: ReactNode })
  })
  DecoratedAssistantRenderer.displayName = `Annotation(${inner.displayName ?? inner.name ?? 'Assistant'})`
  return DecoratedAssistantRenderer
}

/**
 * 原地装饰已经注册的助手渲染器，不再向 assistant-step 单元新增条目。
 * 这与 dsh-smooth-stream 包装其他 Chat 行的做法一致，因此两者可以组合。
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
