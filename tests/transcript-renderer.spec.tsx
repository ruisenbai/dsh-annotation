// @vitest-environment jsdom

import { createElement, useState, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ChatConversationViewNode,
  ChatNodeViewProps,
  ChatSnapshot,
  ChatViewSlotProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  decorateTranscriptNodes,
  decorateTranscriptView,
  TranscriptSummary,
  type TranscriptVisibilityProps,
} from '../src/client/transcript-renderer.tsx'
import { createTranscriptPresentation } from '../src/client/transcript-visibility.ts'
import { en, zh, type AnnotationLocaleKey } from '../src/client/locales.ts'
import { styles } from '../src/client/styles.ts'
import {
  DEFAULT_TRANSCRIPT_VISIBILITY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type TranscriptVisibilitySettings,
} from '../src/shared/settings.ts'

const t = (key: string, params?: Record<string, unknown>) =>
  zh[key as AnnotationLocaleKey].replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name]))

afterEach(cleanup)

interface Entry {
  options: { key?: string; id?: string }
  component: unknown
  inject?: () => Record<string, unknown>
}

function context(entries: Record<string, Entry[]>) {
  const listeners = new Set<(key: string) => void>()
  const ctx = {
    slots: { entries: (key: string) => entries[key] ?? [] },
    on: (_event: string, listener: (key: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as Context
  return { ctx, changed: (key: string) => listeners.forEach((listener) => listener(key)) }
}

function toolNode(key: string, name: string): ChatConversationViewNode {
  return {
    key,
    target: 'chat',
    kind: 'tool-call',
    visibility: 'visible',
    anchorSeq: 1,
    location: { kind: 'turn', turn: { turn: 1 } },
    data: {
      root: { callId: key, name, argsRaw: 'private arguments', subCalls: [], time: 1, turn: 1, step: 1 },
    },
  } as unknown as ChatConversationViewNode
}

function chat(nodes: readonly ChatConversationViewNode[]): ChatSnapshot {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const keys = nodes.map((node) => node.key)
  return {
    nodes: { get: (key: string) => byKey.get(key) },
    order: keys,
    locations: { getTurn: () => keys },
  } as unknown as ChatSnapshot
}

function sources(settings: TranscriptVisibilitySettings): TranscriptVisibilityProps {
  return {
    useAnnotationTranscriptVisibility: (selector) => selector(settings),
    useAnnotationNormalTranscriptView: (selector) => selector('normal'),
    annotationTranscriptT: t,
  }
}

function props(
  node: ChatConversationViewNode,
  snapshot: ChatSnapshot,
  settings = DEFAULT_TRANSCRIPT_VISIBILITY,
) {
  return {
    ...sources(settings),
    node,
    useChat: <S,>(selector: (state: ChatSnapshot) => S) => selector(snapshot),
  } as unknown as ChatNodeViewProps & TranscriptVisibilityProps
}

describe('non-expandable transcript summaries', () => {
  it('renders localized counts as plain text without tool arguments, expand controls, or focus targets', () => {
    const counts = [
      { kind: 'reasoning' as const, count: 3 },
      { kind: 'tool' as const, name: 'functions.read', count: 2 },
      { kind: 'tool' as const, name: 'glob', count: 3 },
      { kind: 'tool' as const, name: 'custom/tool', count: 1 },
      { kind: 'tool' as const, count: 1 },
    ]
    const { container } = render(<TranscriptSummary counts={counts} t={t} />)
    expect(screen.getByText('think x 3')).toBeInTheDocument()
    expect(screen.getByText('读取 x 2')).toBeInTheDocument()
    expect(screen.getByText('Glob x 3')).toBeInTheDocument()
    expect(screen.getByText('custom/tool x 1')).toBeInTheDocument()
    expect(screen.getByText('工具 x 1')).toBeInTheDocument()
    expect(
      container.querySelector('button, details, summary, a, [tabindex], [aria-expanded], [title]'),
    ).toBeNull()
    expect(screen.getByRole('note')).toHaveAttribute('data-dsh-annotation-ignore')
    fireEvent.click(screen.getByRole('note'))
    fireEvent.keyDown(screen.getByRole('note'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('note'), { key: ' ' })
    fireEvent(screen.getByRole('note'), new Event('beforematch', { bubbles: true }))
    expect(container.querySelector('details, [aria-expanded]')).toBeNull()
  })

  it('does not mount hidden tool details and renders repeated tools only at the first turn anchor', ({
    onTestFinished,
  }) => {
    const seen = vi.fn()
    const Inner = (input: ChatNodeViewProps) => {
      seen(input)
      return (
        <details open>
          <summary>Original tool renderer</summary>
          <p>Private result: {input.node.key}</p>
        </details>
      )
    }
    const injected = () => ({ selectedRendererProp: true })
    const entry = { options: { key: 'tool-call' }, component: Inner, inject: injected }
    const fixture = context({ 'conversation.chat.node': [entry] })
    const dispose = decorateTranscriptNodes(fixture.ctx, createTranscriptPresentation())
    onTestFinished(dispose)
    const first = toolNode('read-1', 'read')
    const second = toolNode('read-2', 'read')
    const snapshot = chat([first, second])
    const View = entry.component as ComponentType<ChatNodeViewProps & TranscriptVisibilityProps>
    const { rerender, container } = render(
      <>
        <View {...props(first, snapshot)} />
        <View {...props(second, snapshot)} />
      </>,
    )
    expect(screen.getAllByText('Original tool renderer')).toHaveLength(2)
    expect(screen.getByText('Private result: read-1')).toBeInTheDocument()
    const settings = { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideTools: true }
    rerender(
      <>
        <View {...props(first, snapshot, settings)} />
        <View {...props(second, snapshot, settings)} />
      </>,
    )
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(screen.getByText('读取 x 2')).toBeInTheDocument()
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).not.toContain('Private result')
    expect(container.textContent).not.toContain('private arguments')
    expect(container.querySelectorAll('[data-dsh-annotation-transcript-hidden]')).toHaveLength(1)
    expect(styles).toContain('[data-chat-flow-key]:has([data-dsh-annotation-transcript-hidden])')
    fireEvent.click(screen.getByRole('note'))
    fireEvent.keyDown(screen.getByRole('note'), { key: 'Enter' })
    fireEvent(screen.getByRole('note'), new Event('beforematch', { bubbles: true }))
    expect(container.querySelector('details')).toBeNull()
    rerender(
      <>
        <View {...props(first, snapshot)} />
        <View {...props(second, snapshot)} />
      </>,
    )
    expect(screen.getAllByText('Original tool renderer')).toHaveLength(2)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(entry.inject).toBe(injected)
    expect(seen.mock.lastCall?.[0].node).toBe(second)
    dispose()
    expect(entry.component).toBe(Inner)
  })

  it('preserves ordinary user text while forwarding attachment-free display copies and the history flag', ({
    onTestFinished,
  }) => {
    const received = vi.fn()
    const Inner = (input: ChatNodeViewProps & { annotationHistoryHidden?: boolean }) => {
      received(input)
      return <p>Human instruction</p>
    }
    const entry = { options: { key: 'user' }, component: Inner }
    const fixture = context({ 'conversation.chat.node': [entry] })
    onTestFinished(decorateTranscriptNodes(fixture.ctx, createTranscriptPresentation()))
    const human = {
      ...toolNode('human', 'read'),
      kind: 'user',
      data: {
        content: [
          { type: 'text', text: 'Human instruction' },
          { type: 'image', attachment: {} },
        ],
        source: { kind: 'user' },
      },
    } as ChatConversationViewNode
    const View = entry.component as ComponentType<ChatNodeViewProps & TranscriptVisibilityProps>
    render(
      <View {...props(human, chat([human]), { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideAttachments: true })} />,
    )
    expect(screen.getByText('Human instruction')).toBeInTheDocument()
    expect(screen.getByText('附件 x 1')).toBeInTheDocument()
    expect(received.mock.lastCall?.[0].node.data.content).toEqual([
      { type: 'text', text: 'Human instruction' },
    ])
    expect((human.data as { content: unknown[] }).content).toHaveLength(2)
  })

  it('handles late registrations and restores components without touching actionable composer or unknown body rows', () => {
    const Original = () => <p>unchanged</p>
    const existing = { options: { key: 'command-input' }, component: Original }
    const pendingApproval = { options: { id: 'approval' }, component: Original }
    const entries: Record<string, Entry[]> = {
      'conversation.chat.node': [existing],
      'conversation.composer': [pendingApproval],
    }
    const fixture = context(entries)
    const dispose = decorateTranscriptNodes(fixture.ctx, createTranscriptPresentation())
    expect(existing.component).toBe(Original)
    expect(pendingApproval.component).toBe(Original)
    const added = { options: { key: 'tool-call' }, component: Original }
    entries['conversation.chat.node']!.push(added)
    fixture.changed('conversation.chat.node')
    expect(added.component).not.toBe(Original)
    const wrapped = added.component
    fixture.changed('conversation.chat.node')
    expect(added.component).toBe(wrapped)
    dispose()
    expect(added.component).toBe(Original)
    fixture.changed('conversation.chat.node')
    expect(added.component).toBe(Original)
  })

  it('has matching summary keys in both locales', () => {
    expect(Object.keys(zh).filter((key) => key.startsWith('transcript.'))).toEqual(
      Object.keys(en).filter((key) => key.startsWith('transcript.')),
    )
  })
})

describe('effective Normal mode while filtering', () => {
  it('forwards a framework-bound hook without changing saved mode or remounting body state', ({
    onTestFinished,
  }) => {
    const Original = (input: ChatViewSlotProps) => {
      const mode = input.useTranscriptView((value) => value)
      const [draft, setDraft] = useState('initial text')
      return (
        <>
          <output>{mode}</output>
          <input aria-label="local state" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </>
      )
    }
    const injected = vi.fn(() => ({ original: true }))
    const chatEntry = { options: { id: 'chat' }, component: Original, inject: injected }
    const trajectoryEntry = { options: { id: 'trajectory' }, component: Original }
    const fixture = context({ 'conversation.view': [chatEntry, trajectoryEntry] })
    onTestFinished(decorateTranscriptView(fixture.ctx))
    expect(trajectoryEntry.component).toBe(Original)
    expect(chatEntry.inject).toBe(injected)
    let savedMode: 'normal' | 'compact' = 'compact'
    const originalHook: ChatViewSlotProps['useTranscriptView'] = (selector) => selector(savedMode)
    const View = chatEntry.component as ComponentType<ChatViewSlotProps & TranscriptVisibilityProps>
    const renderProps = (settings: TranscriptVisibilitySettings) =>
      ({ ...sources(settings), useTranscriptView: originalHook }) as ChatViewSlotProps &
        TranscriptVisibilityProps
    const view = render(createElement(View, renderProps(DEFAULT_TRANSCRIPT_VISIBILITY)))
    expect(screen.getByRole('status')).toHaveTextContent('compact')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep local state' } })
    for (const key of TRANSCRIPT_VISIBILITY_KEYS) {
      view.rerender(createElement(View, renderProps({ ...DEFAULT_TRANSCRIPT_VISIBILITY, [key]: true })))
      expect(screen.getByRole('status')).toHaveTextContent('normal')
      expect(screen.getByRole('textbox')).toHaveValue('Keep local state')
      expect(savedMode).toBe('compact')
    }
    savedMode = 'normal'
    view.rerender(createElement(View, renderProps(DEFAULT_TRANSCRIPT_VISIBILITY)))
    expect(screen.getByRole('status')).toHaveTextContent('normal')
    savedMode = 'compact'
    view.rerender(createElement(View, renderProps(DEFAULT_TRANSCRIPT_VISIBILITY)))
    expect(screen.getByRole('status')).toHaveTextContent('compact')
    expect(screen.getByRole('textbox')).toHaveValue('Keep local state')
  })
})
