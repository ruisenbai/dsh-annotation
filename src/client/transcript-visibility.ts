/** Presentation-only transcript filtering and turn-local activity counts. */

import type { ChatConversationViewNode, ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseAnnotationSource } from '../shared/protocol.ts'
import {
  TRANSCRIPT_VISIBILITY_KEYS,
  type TranscriptVisibilityKey,
  type TranscriptVisibilitySettings,
} from '../shared/settings.ts'

/** A hidden category, with tool names retained as data rather than translated identifiers. */
export type TranscriptCountKind =
  | 'reasoning'
  | 'tool'
  | 'context'
  | 'systemPrompt'
  | 'command'
  | 'compaction'
  | 'retry'
  | 'error'
  | 'interruption'
  | 'attachment'
  | 'annotation'
  | 'turnDetails'
  | 'other'
  | 'workflow'

/** One non-interactive summary item. */
export interface TranscriptCount {
  readonly kind: TranscriptCountKind
  readonly name?: string
  readonly count: number
}

/** A display copy; the shared Chat node and its recorded contents remain unchanged. */
export interface TranscriptNodePresentation {
  readonly node: ChatConversationViewNode
  readonly hidden: boolean
  readonly annotationHistoryHidden: boolean
  readonly counts: readonly TranscriptCount[]
}

/** Turn-local counts are rendered only by their first participating activity row. */
export interface TranscriptTurnPresentation {
  readonly anchorKey: string | undefined
  readonly counts: readonly TranscriptCount[]
  readonly nodes: ReadonlyMap<string, TranscriptNodePresentation>
}

const EMPTY_COUNTS: readonly TranscriptCount[] = []

/**
 * Test whether the plugin needs its non-expandable transcript presentation.
 * @param settings - saved visibility settings.
 * @returns whether any category is hidden.
 */
export function hasTranscriptHiding(settings: TranscriptVisibilitySettings): boolean {
  return TRANSCRIPT_VISIBILITY_KEYS.some((key) => settings[key])
}

/**
 * Resolve the owning turn without assigning root events to an unrelated conversation turn.
 * @param node - currently rendered Chat node.
 * @returns its turn number, or absence for a root event.
 */
export function transcriptTurn(node: ChatConversationViewNode): number | undefined {
  return node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn.turn : undefined
}

/**
 * Keep user attachment and annotation summaries beside their own human message.
 * @param node - currently rendered Chat node.
 * @returns whether its counts are local rather than part of assistant activity.
 */
export function hasLocalTranscriptSummary(node: ChatConversationViewNode): boolean {
  return node.kind === 'user' || node.kind === 'steering' || transcriptTurn(node) === undefined
}

const TOOL_VISIBILITY_FIELDS: Readonly<Record<string, TranscriptVisibilityKey>> = {
  read: 'hideToolRead',
  read_image: 'hideToolRead',
  glob: 'hideToolGlob',
  grep: 'hideToolGrep',
  bash: 'hideToolBash',
  pwsh: 'hideToolBash',
  edit: 'hideToolEdit',
  write: 'hideToolWrite',
}

function normalizedToolName(name: string): string {
  return name.toLowerCase().replace(/^functions\./u, '')
}

function toolName(call: ToolCallBlock): string | undefined {
  return 'kind' in call ? call.call?.name : call.name
}

function hiddenTool(name: string | undefined, settings: TranscriptVisibilitySettings): boolean {
  if (settings.hideTools) return true
  const field =
    name === undefined
      ? 'hideToolOther'
      : (TOOL_VISIBILITY_FIELDS[normalizedToolName(name)] ?? 'hideToolOther')
  return settings[field]
}

function hiddenAssistantBlock(block: AssistantBlock, settings: TranscriptVisibilitySettings): boolean {
  switch (block.kind) {
    case 'text':
      return false
    case 'reasoning':
      return settings.hideReasoning
    case 'image':
      return settings.hideAttachments
    case 'tool-call':
      return hiddenTool(block.name, settings)
    case 'other':
      return settings.hideOther
  }
}

function toolCounts(root: ToolCallBlock, seen: Set<string>): TranscriptCount[] {
  const counts: TranscriptCount[] = []
  const pending = [root]
  const expanded = new WeakSet<object>()
  while (pending.length > 0) {
    const call = pending.pop()!
    if (expanded.has(call)) continue
    expanded.add(call)
    for (let index = call.subCalls.length - 1; index >= 0; index -= 1) pending.push(call.subCalls[index]!)
    if (seen.has(call.callId)) continue
    seen.add(call.callId)
    const name = toolName(call)
    counts.push({ kind: 'tool', ...(name === undefined ? {} : { name }), count: 1 })
  }
  return counts
}

interface ToolProjection {
  readonly block: ToolCallBlock | null
  readonly counts: readonly TranscriptCount[]
}

function projectToolCall(
  root: ToolCallBlock,
  settings: TranscriptVisibilitySettings,
  seen: Set<string>,
): ToolProjection {
  const memo = new WeakMap<object, ToolProjection>()
  const visiting = new WeakSet<object>()
  const visit = (call: ToolCallBlock): ToolProjection => {
    const previous = memo.get(call)
    if (previous !== undefined) return previous
    if (hiddenTool(toolName(call), settings)) {
      const result = { block: null, counts: toolCounts(call, seen) } satisfies ToolProjection
      memo.set(call, result)
      return result
    }
    if (visiting.has(call)) return { block: call, counts: EMPTY_COUNTS }
    visiting.add(call)
    let changed = false
    const subCalls: ToolCallBlock[] = []
    const counts: TranscriptCount[] = []
    for (const child of call.subCalls) {
      const projected = visit(child)
      counts.push(...projected.counts)
      if (projected.block === null) {
        changed = true
        continue
      }
      subCalls.push(projected.block)
      if (projected.block !== child) changed = true
    }
    visiting.delete(call)
    const result = {
      block: changed ? { ...call, subCalls } : call,
      counts,
    } satisfies ToolProjection
    memo.set(call, result)
    return result
  }
  return visit(root)
}

function mergeCounts(items: readonly TranscriptCount[]): readonly TranscriptCount[] {
  if (items.length === 0) return EMPTY_COUNTS
  const grouped = new Map<string, TranscriptCount>()
  for (const item of items) {
    if (item.count === 0) continue
    const key = JSON.stringify([item.kind, item.name])
    const previous = grouped.get(key)
    grouped.set(key, previous === undefined ? item : { ...previous, count: previous.count + item.count })
  }
  return [...grouped.values()]
}

function projectNode(
  original: ChatConversationViewNode,
  settings: TranscriptVisibilitySettings,
  ignoredCommands: ReadonlySet<string>,
  seenTools: Set<string>,
): TranscriptNodePresentation {
  const unchanged: TranscriptNodePresentation = {
    node: original,
    hidden: false,
    annotationHistoryHidden: false,
    counts: EMPTY_COUNTS,
  }
  if (!hasTranscriptHiding(settings) || original.visibility === 'hidden') return unchanged
  const node = original as ChatNode
  const hide = (kind: TranscriptCountKind, count = 1): TranscriptNodePresentation => ({
    ...unchanged,
    hidden: true,
    counts: count === 0 ? EMPTY_COUNTS : [{ kind, count }],
  })
  switch (node.kind) {
    case 'assistant-step': {
      const { data } = node
      const counts: TranscriptCount[] = []
      const blocks = data.blocks.filter((block) => {
        if (!hiddenAssistantBlock(block, settings)) return true
        if (block.kind === 'reasoning') counts.push({ kind: 'reasoning', count: 1 })
        if (block.kind === 'image') counts.push({ kind: 'attachment', count: 1 })
        if (block.kind === 'other') counts.push({ kind: 'other', count: 1 })
        // Protocol tool heads are counted only by their separate tool-call rows.
        return false
      })
      const hideInterruption = settings.hideErrors && data.status === 'interrupted'
      if (hideInterruption) counts.push({ kind: 'interruption', count: 1 })
      if (blocks.length === data.blocks.length && !hideInterruption) return unchanged
      const displayNode: ChatNode<'assistant-step'> = {
        ...node,
        data: {
          ...data,
          blocks: blocks.length === data.blocks.length ? data.blocks : blocks,
          status: hideInterruption ? 'settled' : data.status,
        },
      }
      return {
        ...unchanged,
        node: displayNode,
        hidden:
          !blocks.some((block) => block.kind !== 'tool-call') &&
          (data.status !== 'interrupted' || hideInterruption),
        counts: mergeCounts(counts),
      }
    }
    case 'user':
    case 'steering': {
      const payload = parseAnnotationSource(node.data.source)
      const content = settings.hideAttachments
        ? node.data.content.filter((block) => block.type !== 'image' && block.type !== 'file')
        : node.data.content
      const removed = node.data.content.length - content.length
      const annotationHistoryHidden = settings.hideAnnotationHistory && payload !== null
      const counts: TranscriptCount[] = []
      if (removed > 0) counts.push({ kind: 'attachment', count: removed })
      if (annotationHistoryHidden) counts.push({ kind: 'annotation', count: payload.annotations.length })
      const textRemains =
        payload === null
          ? content.some((block) => block.type === 'text' && block.text.length > 0)
          : (payload.overallRequirement?.trim().length ?? 0) > 0
      const attachmentsRemain = content.some((block) => block.type === 'image' || block.type === 'file')
      return {
        node: removed === 0 ? original : { ...node, data: { ...node.data, content } },
        hidden:
          counts.length > 0 &&
          !textRemains &&
          !attachmentsRemain &&
          (payload === null || annotationHistoryHidden),
        annotationHistoryHidden,
        counts,
      }
    }
    case 'tool-call': {
      const projected = projectToolCall(node.data.root, settings, seenTools)
      const counts = mergeCounts(projected.counts)
      if (projected.block === null) return { ...unchanged, hidden: true, counts }
      if (projected.block === node.data.root && counts.length === 0) return unchanged
      return {
        ...unchanged,
        node: { ...node, data: { ...node.data, root: projected.block } },
        counts,
      }
    }
    case 'context':
      return settings.hideContext ? hide('context') : unchanged
    case 'system-prompt':
      return settings.hideContext ? hide('systemPrompt') : unchanged
    case 'command':
      return settings.hideCommandResults
        ? hide('command', node.data.name !== null && ignoredCommands.has(node.data.name) ? 0 : 1)
        : unchanged
    case 'manual-compaction':
    case 'compaction':
      return settings.hideCompaction ? hide('compaction') : unchanged
    case 'model-retry':
      return settings.hideRetries ? hide('retry', node.data.attempts.length) : unchanged
    case 'turn-error':
    case 'turn-max-tokens':
      return settings.hideErrors ? hide('error') : unchanged
    case 'turn-tail':
      return settings.hideTurnDetails && node.data.closing !== null ? hide('turnDetails') : unchanged
    case 'unknown':
      return settings.hideOther ? hide('other') : unchanged
    default:
      // Chat kinds are merge-extensible. Only known non-body extension rows are hidden.
      return original.kind === 'workflow-run' && settings.hideOther ? hide('workflow') : unchanged
  }
}

/** Shared pure projection cache for one plugin lifetime, weakly keyed by each Session's live node store. */
export interface TranscriptPresentation {
  /** Project a standalone/root or human-message row without reading other turns. */
  node(node: ChatConversationViewNode, settings: TranscriptVisibilitySettings): TranscriptNodePresentation
  /** Read only supplied turn keys, whose identities change on streaming, settlement, and paging. */
  turn(
    store: ChatSnapshot['nodes'],
    keys: readonly string[],
    settings: TranscriptVisibilitySettings,
  ): TranscriptTurnPresentation
}

/**
 * Create a presentation cache shared by the installed node decorators.
 * @param ignoredCommandNames - plugin transport commands whose rows already render nothing.
 * @returns display projections that never write to the Chat store or the session log.
 */
export function createTranscriptPresentation(
  ignoredCommandNames: readonly string[] = [],
): TranscriptPresentation {
  const ignoredCommands = new Set(ignoredCommandNames)
  const cache = new WeakMap<
    ChatSnapshot['nodes'],
    WeakMap<readonly string[], WeakMap<TranscriptVisibilitySettings, TranscriptTurnPresentation>>
  >()
  return {
    node: (node, settings) => projectNode(node, settings, ignoredCommands, new Set()),
    turn(store, keys, settings) {
      let turns = cache.get(store)
      if (turns === undefined) {
        turns = new WeakMap()
        cache.set(store, turns)
      }
      let variants = turns.get(keys)
      if (variants === undefined) {
        variants = new WeakMap()
        turns.set(keys, variants)
      }
      const previous = variants.get(settings)
      if (previous !== undefined) return previous
      const nodes = new Map<string, TranscriptNodePresentation>()
      const counts: TranscriptCount[] = []
      const seenTools = new Set<string>()
      let anchorKey: string | undefined
      for (const key of keys) {
        const node = store.get(key)
        if (node === undefined || node.visibility === 'hidden' || hasLocalTranscriptSummary(node)) continue
        const presentation = projectNode(node, settings, ignoredCommands, seenTools)
        nodes.set(key, presentation)
        if (presentation.counts.length === 0) continue
        anchorKey ??= key
        counts.push(...presentation.counts)
      }
      const result = { anchorKey, counts: mergeCounts(counts), nodes }
      variants.set(settings, result)
      return result
    },
  }
}
