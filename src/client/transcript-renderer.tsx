/** Non-expandable activity summaries around the selected Chat renderers. */

import { createElement, memo, useMemo, type ComponentType } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ChatNodeViewProps,
  ChatViewSlotProps,
  TranscriptViewMode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HostObservable, InjectFace, PropsLocale, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranscriptVisibilitySettings } from '../shared/settings.ts'
import type { AnnotationLocaleKey } from './locales.ts'
import {
  hasLocalTranscriptSummary,
  hasTranscriptHiding,
  transcriptTurn,
  type TranscriptCount,
  type TranscriptNodePresentation,
  type TranscriptPresentation,
} from './transcript-visibility.ts'

/** Root-provided sources avoid the per-entry inject cache when the plugin loads late. */
export interface TranscriptVisibilityInjected {
  readonly hooks: {
    readonly annotationTranscriptVisibility: HostObservable<TranscriptVisibilitySettings>
    readonly annotationNormalTranscriptView: HostObservable<TranscriptViewMode>
  }
  readonly annotationTranscriptT: PropsLocale<'dshAnnotation'>['t']
}

/** Framework-bound visibility sources shared by the selected node and view renderers. */
export type TranscriptVisibilityProps = InjectFace<TranscriptVisibilityInjected>

const EMPTY_KEYS: readonly string[] = []
const EMPTY_COUNTS: readonly TranscriptCount[] = []

/**
 * Derive the current row and its turn summary through framework-provided Chat sources.
 * @param props - composed Chat node and root visibility props.
 * @param projector - shared pure turn cache.
 * @returns a display copy and counts owned by this row.
 */
export function useTranscriptPresentation(
  props: ChatNodeViewProps & TranscriptVisibilityProps,
  projector: TranscriptPresentation,
): { readonly presentation: TranscriptNodePresentation; readonly counts: readonly TranscriptCount[] } {
  const settings = props.useAnnotationTranscriptVisibility((value) => value)
  const active = hasTranscriptHiding(settings)
  const turn = transcriptTurn(props.node)
  const local = hasLocalTranscriptSummary(props.node)
  const keys = props.useChat((snapshot) =>
    active && !local && turn !== undefined ? snapshot.locations.getTurn(turn) : EMPTY_KEYS,
  )
  const store = props.useChat((snapshot) => snapshot.nodes)
  return useMemo(() => {
    if (!active || local) {
      const presentation = projector.node(props.node, settings)
      return { presentation, counts: presentation.counts }
    }
    const group = projector.turn(store, keys, settings)
    const presentation = group.nodes.get(props.node.key) ?? projector.node(props.node, settings)
    return { presentation, counts: group.anchorKey === props.node.key ? group.counts : EMPTY_COUNTS }
  }, [active, local, projector, props.node, settings, store, keys])
}

const TOOL_LABELS: Readonly<Record<string, AnnotationLocaleKey>> = {
  read: 'transcript.toolRead',
  glob: 'transcript.toolGlob',
  grep: 'transcript.toolGrep',
  bash: 'transcript.toolBash',
  edit: 'transcript.toolEdit',
  write: 'transcript.toolWrite',
}

function countLabel(count: TranscriptCount, t: PropsLocale<'dshAnnotation'>['t']): string {
  if (count.kind !== 'tool') return t(`transcript.${count.kind}`)
  if (count.name === undefined) return t('transcript.tool')
  const key = TOOL_LABELS[count.name.replace(/^functions\./u, '').toLowerCase()]
  return key === undefined ? count.name : t(key)
}

/**
 * Render counts without mounting hidden details or exposing an expansion control.
 * @param props - counted activity and localized copy.
 * @returns one wrapping summary line, or no element when nothing is hidden.
 */
export function TranscriptSummary({
  counts,
  t,
}: {
  readonly counts: readonly TranscriptCount[]
  readonly t: PropsLocale<'dshAnnotation'>['t']
}) {
  if (counts.length === 0) return null
  return (
    <div
      className="dia-transcript-summary"
      role="note"
      aria-label={t('transcript.summary')}
      data-dsh-annotation-ignore
    >
      {counts.map((count) => (
        <span className="dia-transcript-summary__count" key={JSON.stringify([count.kind, count.name])}>
          {t('transcript.count', { label: countLabel(count, t), count: count.count })}
        </span>
      ))}
    </div>
  )
}

/**
 * Mark a fully hidden renderer so the containing Chat flow row can collapse.
 * @returns a non-visible marker consumed only by the annotation stylesheet.
 */
export function TranscriptHiddenNode() {
  return <span hidden data-dsh-annotation-transcript-hidden />
}

type TranscriptNodeProps = ChatNodeViewProps & TranscriptVisibilityProps

type TranscriptChatViewProps = ChatViewSlotProps & TranscriptVisibilityProps

function wrapNode(inner: ComponentType<ChatNodeViewProps>, projector: TranscriptPresentation) {
  const Wrapped = memo(function TranscriptNode(props: TranscriptNodeProps) {
    const { presentation, counts } = useTranscriptPresentation(props, projector)
    const displayProps = {
      ...props,
      node: presentation.node as ChatNodeViewProps['node'],
      annotationHistoryHidden: presentation.annotationHistoryHidden,
    }
    const content = presentation.hidden ? (
      counts.length === 0 ? (
        <TranscriptHiddenNode />
      ) : null
    ) : (
      createElement(inner, displayProps as ChatNodeViewProps)
    )
    const summary = <TranscriptSummary counts={counts} t={props.annotationTranscriptT} />
    return hasLocalTranscriptSummary(props.node) ? (
      <>
        {content}
        {summary}
      </>
    ) : (
      <>
        {summary}
        {content}
      </>
    )
  })
  Wrapped.displayName = `Transcript(${inner.displayName ?? inner.name ?? 'Node'})`
  return Wrapped
}

function wrapView(inner: ComponentType<ChatViewSlotProps>) {
  const Wrapped = memo(function TranscriptChatView(props: TranscriptChatViewProps) {
    const active = props.useAnnotationTranscriptVisibility(hasTranscriptHiding)
    // Both hooks are framework-bound. The saved Chat preference remains untouched.
    return createElement(
      inner,
      active
        ? {
            ...props,
            useTranscriptView: props.useAnnotationNormalTranscriptView,
          }
        : props,
    )
  })
  Wrapped.displayName = `Transcript(${inner.displayName ?? inner.name ?? 'Chat'})`
  return Wrapped
}

function isComponent<Props>(value: unknown): value is ComponentType<Props> {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)
}

const NODE_KINDS = new Set([
  'user',
  'steering',
  'tool-call',
  'context',
  'system-prompt',
  'command',
  'manual-compaction',
  'compaction',
  'model-retry',
  'turn-error',
  'turn-max-tokens',
  'turn-tail',
  'unknown',
  'workflow-run',
])

function decorate(
  ctx: ClientContext,
  slot: 'conversation.chat.node' | 'conversation.view',
  transform: (entry: StoredEntry) => unknown,
): () => void {
  const decorated = new WeakSet<object>()
  const restores: Array<() => void> = []
  const refresh = () => {
    for (const entry of ctx.slots.entries(slot)) {
      const current = entry.component
      if (!isComponent(current) || decorated.has(current)) continue
      const next = transform(entry)
      if (!isComponent(next) || next === current) continue
      decorated.add(next)
      entry.component = next
      restores.push(() => {
        if (entry.component === next) entry.component = current
      })
    }
  }
  refresh()
  const off = ctx.on('slots/changed', (key: string) => {
    if (key === slot) refresh()
  })
  return () => {
    off()
    for (const restore of restores.reverse()) restore()
  }
}

/**
 * Decorate non-assistant rows without replacing their inject/store/children registrations.
 * @param ctx - plugin context owning the slot listener.
 * @param projector - pure presentation cache shared with the assistant decorator.
 * @returns a disposer restoring the original components.
 */
export function decorateTranscriptNodes(ctx: ClientContext, projector: TranscriptPresentation): () => void {
  return decorate(ctx, 'conversation.chat.node', (entry) =>
    NODE_KINDS.has(String(entry.options.key)) && isComponent<ChatNodeViewProps>(entry.component)
      ? wrapNode(entry.component, projector)
      : entry.component,
  )
}

/**
 * Use effective Normal presentation while filtering so outer Compact rows cannot conceal body text.
 * @param ctx - plugin context owning the slot listener.
 * @returns a disposer restoring the selected Chat view; saved preferences are never changed.
 */
export function decorateTranscriptView(ctx: ClientContext): () => void {
  return decorate(ctx, 'conversation.view', (entry) =>
    entry.options.id === 'chat' && isComponent<ChatViewSlotProps>(entry.component)
      ? wrapView(entry.component)
      : entry.component,
  )
}
