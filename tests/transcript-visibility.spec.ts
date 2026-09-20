import { describe, expect, it, vi } from 'vitest'
import type { ChatConversationViewNode, ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  createTranscriptPresentation,
  hasLocalTranscriptSummary,
  hasTranscriptHiding,
  transcriptTurn,
} from '../src/client/transcript-visibility.ts'
import {
  DEFAULT_TRANSCRIPT_VISIBILITY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type TranscriptVisibilityKey,
  type TranscriptVisibilitySettings,
} from '../src/shared/settings.ts'
import { fixturePayload } from './fixtures.ts'

function node(kind: string, key: string, data: unknown, turn: number | null = 1): ChatConversationViewNode {
  return {
    target: 'chat',
    kind,
    key,
    data,
    anchorSeq: 1,
    visibility: 'visible',
    location: turn === null ? { kind: 'root' } : { kind: 'turn', turn: { turn } },
  } as ChatConversationViewNode
}

function assistant(
  key: string,
  step: number,
  blocks: readonly AssistantBlock[],
  status = 'settled',
  turn = 1,
) {
  return node(
    'assistant-step',
    key,
    { turn, step, blocks, status, time: 1 },
    turn,
  ) as ChatNode<'assistant-step'>
}

function tool(callId: string, name = 'read', children: readonly ToolCallBlock[] = []): ToolCallBlock {
  return {
    callId,
    name,
    argsRaw: '{"path":"private-detail.txt"}',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: children,
  }
}

function settled(
  callId: string,
  name: string | null = 'read',
  children: readonly ToolCallBlock[] = [],
): ToolCallBlock {
  return {
    kind: 'tool-result',
    callId,
    call: name === null ? null : { name, argsRaw: '{}' },
    seq: 2,
    time: 2,
    callTime: 1,
    content: [{ type: 'text', text: 'private tool result' }],
    isError: false,
    subCalls: children,
  }
}

function nodes(initial: readonly ChatConversationViewNode[]) {
  const data = new Map(initial.map((entry) => [entry.key, entry]))
  const store: ChatSnapshot['nodes'] = {
    get: vi.fn((key) => data.get(key)),
    source: (key) => ({ getSnapshot: () => data.get(key), subscribe: () => () => undefined }),
    processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => undefined }),
    values: vi.fn(() => [...data.values()]),
  }
  return { data, store, keys: initial.map((entry) => entry.key) }
}

const allHidden = Object.fromEntries(
  TRANSCRIPT_VISIBILITY_KEYS.map((key) => [key, true]),
) as unknown as TranscriptVisibilitySettings
const reasoning: AssistantBlock = { kind: 'reasoning', text: 'private reasoning' }
const body: AssistantBlock = { kind: 'text', text: 'The **body** stays exactly as written.' }
const other: AssistantBlock = { kind: 'other', block: { private: 'opaque details' } }

function enabled(field: TranscriptVisibilityKey): TranscriptVisibilitySettings {
  return { ...DEFAULT_TRANSCRIPT_VISIBILITY, [field]: true }
}

describe('transcript visibility projections', () => {
  it('defaults every new switch off and preserves the original node references', () => {
    expect(Object.values(DEFAULT_TRANSCRIPT_VISIBILITY)).toEqual(
      Array(TRANSCRIPT_VISIBILITY_KEYS.length).fill(false),
    )
    expect(hasTranscriptHiding(DEFAULT_TRANSCRIPT_VISIBILITY)).toBe(false)
    const projector = createTranscriptPresentation()
    const samples = [assistant('a', 1, [reasoning, body, other]), node('tool-call', 't', { root: tool('t') })]
    for (const sample of samples) {
      expect(projector.node(sample, DEFAULT_TRANSCRIPT_VISIBILITY)).toEqual({
        node: sample,
        hidden: false,
        annotationHistoryHidden: false,
        counts: [],
      })
      expect(projector.node(sample, DEFAULT_TRANSCRIPT_VISIBILITY).node).toBe(sample)
    }
  })

  it('ignores enabled annotation preferences when checking for transcript filters', () => {
    const settings = {
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      enabled: true,
      autoAttach: true,
      compactSummary: true,
    }
    expect(hasTranscriptHiding(settings)).toBe(false)
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
      expect(hasTranscriptHiding({ ...settings, [field]: true })).toBe(true)
    }
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'keeps reasoning, tools, and opaque content independent (mask %s)',
    (mask) => {
      const settings = {
        ...DEFAULT_TRANSCRIPT_VISIBILITY,
        hideReasoning: Boolean(mask & 1),
        hideTools: Boolean(mask & 2),
        hideOther: Boolean(mask & 4),
      }
      const sample = assistant('a', 1, [
        reasoning,
        body,
        { kind: 'tool-call', callId: 't', name: 'read', argsRaw: '{}' },
        other,
      ])
      const original = structuredClone(sample)
      const projector = createTranscriptPresentation()
      const result = projector.node(sample, settings)
      const displayed = result.node as ChatNode<'assistant-step'>
      expect(displayed.data.blocks).toContain(body)
      expect(displayed.data.blocks.includes(reasoning)).toBe(!settings.hideReasoning)
      expect(displayed.data.blocks.includes(other)).toBe(!settings.hideOther)
      expect(result.counts.some((entry) => entry.kind === 'tool')).toBe(false)
      expect(projector.node(node('tool-call', 't', { root: tool('t') }), settings).hidden).toBe(
        settings.hideTools,
      )
      expect(sample).toEqual(original)
      expect(result.hidden).toBe(false)
    },
  )

  it.each([
    ['hideToolRead', 'read'],
    ['hideToolRead', 'functions.read_image'],
    ['hideToolGlob', 'glob'],
    ['hideToolGrep', 'grep'],
    ['hideToolGrep', 'functions.grep'],
    ['hideToolBash', 'bash'],
    ['hideToolBash', 'pwsh'],
    ['hideToolEdit', 'edit'],
    ['hideToolWrite', 'write'],
    ['hideToolOther', 'web_search'],
    ['hideToolOther', 'custom/tool'],
  ] as const)('hides the %s tool family for %s without hiding other tools', (field, name) => {
    const projector = createTranscriptPresentation()
    const hidden = node('tool-call', 'selected', { root: tool('selected', name) })
    const visible = node('tool-call', 'other', {
      root: tool('other', name.endsWith('grep') ? 'bash' : 'grep'),
    })
    expect(projector.node(hidden, enabled(field))).toMatchObject({
      hidden: true,
      counts: [{ kind: 'tool', name, count: 1 }],
    })
    expect(projector.node(visible, enabled(field))).toMatchObject({ hidden: false, counts: [] })
  })

  it('removes only selected tool heads from assistant activity', () => {
    const grepHead: AssistantBlock = { kind: 'tool-call', callId: 'grep', name: 'grep', argsRaw: '{}' }
    const bashHead: AssistantBlock = { kind: 'tool-call', callId: 'bash', name: 'bash', argsRaw: '{}' }
    const sample = assistant('assistant-tools', 1, [body, grepHead, bashHead])
    const result = createTranscriptPresentation().node(sample, enabled('hideToolGrep'))
    expect((result.node as ChatNode<'assistant-step'>).data.blocks).toEqual([body, bashHead])
    expect(sample.data.blocks).toEqual([body, grepHead, bashHead])
  })

  it('removes selected nested tools without mutating visible siblings or the recorded tree', () => {
    const grep = settled('grep-child', 'grep')
    const bash = settled('bash-child', 'bash')
    const root = settled('workflow-root', 'workflow', [grep, bash])
    const sample = node('tool-call', 'workflow', { root })
    const projector = createTranscriptPresentation()
    const result = projector.node(sample, enabled('hideToolGrep'))
    const display = result.node as ChatNode<'tool-call'>

    expect(result.hidden).toBe(false)
    expect(result.counts).toEqual([{ kind: 'tool', name: 'grep', count: 1 }])
    expect(display.data.root.subCalls).toEqual([bash])
    expect(root.subCalls).toEqual([grep, bash])
  })

  it('counts a selected root and its descendants when the root card is hidden', () => {
    const sample = node('tool-call', 'read-root', {
      root: settled('read-root', 'read', [settled('bash-child', 'bash')]),
    })
    const result = createTranscriptPresentation().node(sample, enabled('hideToolRead'))
    expect(result).toMatchObject({
      hidden: true,
      counts: [
        { kind: 'tool', name: 'read', count: 1 },
        { kind: 'tool', name: 'bash', count: 1 },
      ],
    })
  })

  it('combines three reasoning steps and repeated tool names into one turn summary without counting heads twice', () => {
    const samples = [
      assistant('a1', 1, [reasoning, { kind: 'tool-call', callId: 'r1', name: 'read', argsRaw: '{}' }]),
      node('tool-call', 'r1', { root: tool('r1', 'read', [settled('g1', 'glob'), tool('g2', 'glob')]) }),
      assistant('a2', 2, [reasoning]),
      node('tool-call', 'r2', { root: settled('r2') }),
      assistant('a3', 3, [reasoning, body]),
      node('tool-call', 'g3', { root: settled('g3', 'glob') }),
    ]
    const fixture = nodes(samples)
    const settings = { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideReasoning: true, hideTools: true }
    const projector = createTranscriptPresentation()
    const result = projector.turn(fixture.store, fixture.keys, settings)
    expect(result.anchorKey).toBe('a1')
    expect(result.counts).toEqual([
      { kind: 'reasoning', count: 3 },
      { kind: 'tool', name: 'read', count: 2 },
      { kind: 'tool', name: 'glob', count: 3 },
    ])
    expect(result.nodes.get('a1')?.hidden).toBe(true)
    expect(result.nodes.get('a2')?.hidden).toBe(true)
    expect(result.nodes.get('a3')?.hidden).toBe(false)
    expect((result.nodes.get('a3')!.node as ChatNode<'assistant-step'>).data.blocks).toEqual([body])
    expect(fixture.store.values).not.toHaveBeenCalled()
    expect(projector.turn(fixture.store, fixture.keys, settings)).toBe(result)
  })

  it('updates counts and body on streaming, settlement, interruption, retry replacement, and history prepend', () => {
    const running = assistant('a', 1, [reasoning], 'running')
    const fixture = nodes([running, node('tool-call', 'tool', { root: tool('r') })])
    const settings = { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideReasoning: true, hideTools: true }
    const projector = createTranscriptPresentation()
    const first = projector.turn(fixture.store, fixture.keys, settings)
    expect(first.counts).toEqual([
      { kind: 'reasoning', count: 1 },
      { kind: 'tool', name: 'read', count: 1 },
    ])

    fixture.data.set(
      'a',
      assistant('a', 1, [reasoning, { kind: 'reasoning', text: 'next block' }, body], 'running'),
    )
    const streaming = projector.turn(fixture.store, [...fixture.keys], settings)
    expect(streaming.counts[0]).toEqual({ kind: 'reasoning', count: 2 })
    expect((streaming.nodes.get('a')!.node as ChatNode<'assistant-step'>).data.blocks).toEqual([body])

    fixture.data.set('tool', node('tool-call', 'tool', { root: settled('r') }))
    fixture.data.set('a', assistant('a', 1, [reasoning, body], 'interrupted'))
    const interrupted = projector.turn(fixture.store, [...fixture.keys], settings)
    expect(interrupted.counts).toEqual(first.counts)
    expect((interrupted.nodes.get('a')!.node as ChatNode<'assistant-step'>).data.status).toBe('interrupted')
    const silent = projector.turn(fixture.store, [...fixture.keys], { ...settings, hideErrors: true })
    expect(silent.counts).toContainEqual({ kind: 'interruption', count: 1 })
    expect((silent.nodes.get('a')!.node as ChatNode<'assistant-step'>).data.status).toBe('settled')

    fixture.data.delete('a')
    const retried = projector.turn(fixture.store, [...fixture.keys], settings)
    expect(retried.anchorKey).toBe('tool')
    expect(retried.counts).toEqual([{ kind: 'tool', name: 'read', count: 1 }])

    fixture.data.set(
      'parent',
      node('tool-call', 'parent', {
        root: settled('parent', 'parallel', [settled('r', 'read', [settled('g-late', 'glob')])]),
      }),
    )
    const prepended = projector.turn(fixture.store, ['parent', ...fixture.keys], settings)
    expect(prepended.anchorKey).toBe('parent')
    expect(prepended.counts).toEqual([
      { kind: 'tool', name: 'parallel', count: 1 },
      { kind: 'tool', name: 'read', count: 1 },
      { kind: 'tool', name: 'glob', count: 1 },
    ])
  })

  it('keeps identical keys in separate Sessions isolated and counts unknown tool names without details', () => {
    const a = nodes([node('tool-call', 'same', { root: settled('id', null) })])
    const b = nodes([node('tool-call', 'same', { root: tool('id', 'custom/tool') })])
    const settings = enabled('hideTools')
    const projector = createTranscriptPresentation()
    expect(projector.turn(a.store, a.keys, settings).counts).toEqual([{ kind: 'tool', count: 1 }])
    expect(projector.turn(b.store, a.keys, settings).counts).toEqual([
      { kind: 'tool', name: 'custom/tool', count: 1 },
    ])
  })

  it.each([
    ['hideContext', 'context', {}, 'context', 1],
    ['hideContext', 'system-prompt', {}, 'systemPrompt', 1],
    ['hideCommandResults', 'command', { name: 'help' }, 'command', 1],
    ['hideCompaction', 'manual-compaction', {}, 'compaction', 1],
    ['hideCompaction', 'compaction', {}, 'compaction', 1],
    ['hideRetries', 'model-retry', { attempts: [{}, {}, {}] }, 'retry', 3],
    ['hideErrors', 'turn-error', {}, 'error', 1],
    ['hideErrors', 'turn-max-tokens', {}, 'error', 1],
    ['hideTurnDetails', 'turn-tail', { closing: {} }, 'turnDetails', 1],
    ['hideOther', 'unknown', {}, 'other', 1],
    ['hideOther', 'workflow-run', {}, 'workflow', 1],
  ] as const)('hides %s for %s independently', (field, kind, data, summaryKind, count) => {
    const sample = node(kind, 'one', data)
    const projector = createTranscriptPresentation()
    expect(projector.node(sample, enabled(field))).toMatchObject({
      hidden: true,
      counts: [{ kind: summaryKind, count }],
    })
    expect(projector.node(sample, DEFAULT_TRANSCRIPT_VISIBILITY)).toMatchObject({ hidden: false, counts: [] })
  })

  it('does not add counts for empty synthetic footers or already invisible transport and data nodes', () => {
    const projector = createTranscriptPresentation(['annotation_submit'])
    expect(projector.node(node('turn-tail', 'tail', { closing: null }), allHidden)).toMatchObject({
      hidden: false,
      counts: [],
    })
    expect(
      projector.node(node('command', 'internal', { name: 'annotation_submit' }), allHidden).counts,
    ).toEqual([])
    const hidden = { ...assistant('not-displayed', 1, [reasoning]), visibility: 'hidden' as const }
    const fixture = nodes([hidden])
    expect(projector.turn(fixture.store, fixture.keys, allHidden).counts).toEqual([])
  })

  it('keeps human text and command input while independently hiding attached files and submitted annotation details', () => {
    const payload = fixturePayload()
    const human = node('user', 'user', {
      content: [
        { type: 'text', text: 'serialized submission' },
        { type: 'image', attachment: {} },
        { type: 'file', attachment: {} },
      ],
      source: { kind: 'user', annotationSubmission: payload },
    })
    const projector = createTranscriptPresentation()
    const attachments = projector.node(human, enabled('hideAttachments'))
    expect(attachments.counts).toEqual([{ kind: 'attachment', count: 2 }])
    expect(attachments.annotationHistoryHidden).toBe(false)
    expect(attachments.hidden).toBe(false)
    expect((attachments.node as ChatNode<'user'>).data.content).toEqual([
      { type: 'text', text: 'serialized submission' },
    ])
    const history = projector.node(human, enabled('hideAnnotationHistory'))
    expect(history.counts).toEqual([{ kind: 'annotation', count: 1 }])
    expect(history.annotationHistoryHidden).toBe(true)
    expect(history.hidden).toBe(false)
    const ordinary = node('steering', 'human', {
      content: [{ type: 'text', text: 'Keep this instruction' }],
      source: { kind: 'user' },
    })
    expect(projector.node(ordinary, allHidden).node).toBe(ordinary)
    for (const kind of ['command-input', 'submitted-plan', 'future-message-kind']) {
      const sample = node(kind, kind, { text: 'Keep this message' })
      expect(projector.node(sample, allHidden)).toMatchObject({ hidden: false, node: sample, counts: [] })
    }
    const fixture = nodes([human, assistant('a', 1, [reasoning])])
    expect(projector.turn(fixture.store, fixture.keys, allHidden).counts).toEqual([
      { kind: 'reasoning', count: 1 },
    ])
    expect(hasLocalTranscriptSummary(human)).toBe(true)
  })

  it('keeps root events local and filters assistant image attachments without removing Markdown body', () => {
    const root = node('system-prompt', 'root', {}, null)
    const projector = createTranscriptPresentation()
    expect(transcriptTurn(root)).toBeUndefined()
    expect(hasLocalTranscriptSummary(root)).toBe(true)
    expect(projector.node(root, allHidden).counts).toEqual([{ kind: 'systemPrompt', count: 1 }])
    const image = { kind: 'image', attachment: {} } as AssistantBlock
    const sample = assistant('a', 1, [image, body])
    const result = projector.node(sample, enabled('hideAttachments'))
    expect(result.counts).toEqual([{ kind: 'attachment', count: 1 }])
    expect((result.node as ChatNode<'assistant-step'>).data.blocks).toEqual([body])
    expect(sample.data.blocks).toEqual([image, body])
  })
})
