import { createElement, memo, useMemo, type ComponentType, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationBoundProps, AnnotationInjected, AssistantAnnotationProps } from './contract.ts'
import { AnnotatedAssistantNode } from './components/AnnotatedAssistantNode.tsx'
import { stripMachineMarkersForDisplay } from '../shared/model-ack.ts'
import {
  TranscriptHiddenNode,
  TranscriptSummary,
  useTranscriptPresentation,
  type TranscriptVisibilityProps,
} from './transcript-renderer.tsx'
import { createTranscriptPresentation, type TranscriptPresentation } from './transcript-visibility.ts'

type BaseAssistantProps = ChatNodeViewProps<'assistant-step'>
type DecoratedAssistantProps = BaseAssistantProps & AnnotationBoundProps & TranscriptVisibilityProps

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

function wrapAssistantRenderer(inner: ComponentType<BaseAssistantProps>, projector: TranscriptPresentation) {
  const DecoratedAssistantRenderer = memo(function DecoratedAssistantRenderer(
    props: DecoratedAssistantProps,
  ) {
    const { presentation, counts } = useTranscriptPresentation(props, projector)
    const presentedNode = presentation.node as BaseAssistantProps['node']
    const displayNode = useMemo(() => {
      let changed = false
      const blocks = presentedNode.data.blocks.map((block) => {
        if (block.kind !== 'text' && block.kind !== 'reasoning') return block
        const text = stripMachineMarkersForDisplay(block.text, presentedNode.data.status === 'running')
        if (text === block.text) return block
        changed = true
        return { ...block, text }
      })
      return changed ? { ...presentedNode, data: { ...presentedNode.data, blocks } } : presentedNode
    }, [presentedNode])
    const summary = <TranscriptSummary counts={counts} t={props.annotationTranscriptT} />
    if (presentation.hidden) return counts.length === 0 ? <TranscriptHiddenNode /> : summary
    // Only the selected renderer receives display text; annotation receipts retain the raw node.
    const content = createElement(inner, { ...props, node: displayNode } as BaseAssistantProps)
    return (
      <>
        {summary}
        {createElement(AnnotatedAssistantNode, {
          ...props,
          t: props.annotationT,
          children: content,
        } as AssistantAnnotationProps & { readonly children: ReactNode })}
      </>
    )
  })
  DecoratedAssistantRenderer.displayName = `Annotation(${inner.displayName ?? inner.name ?? 'Assistant'})`
  return DecoratedAssistantRenderer
}

/**
 * Decorate selected assistant renderers without adding another assistant-step entry.
 * @param ctx - plugin context owning the slot listener.
 * @param faceFor - existing session-scoped annotation actions and sources.
 * @param projector - shared transcript cache, or a local cache for standalone consumers.
 * @returns a disposer restoring the original components and inject functions.
 */
export function decorateAssistantRenderers(
  ctx: ClientContext,
  faceFor: (sessionId: SessionId) => AnnotationInjected,
  projector: TranscriptPresentation = createTranscriptPresentation(),
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
      const next = wrapAssistantRenderer(current, projector)
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
