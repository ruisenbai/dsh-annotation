// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { decorateAssistantRenderers } from '../src/client/assistant-renderer-decorator.tsx'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import type {
  AnnotationInjected,
  AssistantAnnotationProps,
  UserAnnotationProps,
} from '../src/client/contract.ts'
import type { AnnotationView } from '../src/client/controller.ts'
import type { TranscriptVisibilityProps } from '../src/client/transcript-renderer.tsx'
import { parseModelAcknowledgements, parseReplyMarkers } from '../src/shared/model-ack.ts'
import { DEFAULT_TRANSCRIPT_VISIBILITY, type TranscriptVisibilitySettings } from '../src/shared/settings.ts'
import { fixturePayload } from './fixtures.ts'

const decorators: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const dispose of decorators.splice(0).reverse()) dispose()
})

const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const raw =
  '<!-- dsh-annotation-reply:{"submissionId":"sub-x","annotationId":"ann-y","ordinal":1} -->\n[注解 1] 已收到这条注解。 <!-- dsh-annotation:{"submissionId":"sub-x","processed":["ann-y"]} -->'

type BoundAssistantProps = AssistantAnnotationProps & TranscriptVisibilityProps

function mount(
  text: string,
  status: 'settled' | 'running' = 'settled',
  options: {
    visibility?: Partial<TranscriptVisibilitySettings>
    blocks?: readonly AssistantBlock[]
  } = {},
) {
  const received = vi.fn()
  const Inner = (props: ChatNodeViewProps<'assistant-step'>) => {
    received(props)
    return (
      <div>
        {props.node.data.blocks.map((block, index) =>
          block.kind === 'text' || block.kind === 'reasoning' ? (
            <MarkdownText
              key={index}
              text={block.text}
              streaming={props.node.data.status === 'running'}
              labels={labels}
            />
          ) : null,
        )}
      </div>
    )
  }
  const entry = {
    options: { key: 'assistant-step' },
    component: Inner as ComponentType<ChatNodeViewProps<'assistant-step'>>,
  }
  const ctx = { slots: { entries: () => [entry] }, on: () => () => undefined } as unknown as Context
  decorators.push(decorateAssistantRenderers(ctx, () => ({}) as AnnotationInjected))
  const node = {
    key: 'assistant-test',
    kind: 'assistant-step',
    visibility: 'visible',
    location: { kind: 'session' },
    data: {
      status,
      blocks: options.blocks ?? [{ kind: 'text' as const, text }],
      finalNode: { messageId: 'reply-test', seq: 42 },
    },
  }
  const snapshot = { nodes: { get: () => node } } as unknown as ChatSnapshot
  const visibility = { ...DEFAULT_TRANSCRIPT_VISIBILITY, ...options.visibility }
  const view = {
    annotations: [],
    activeAnnotationId: null,
    markerAnnotationId: null,
  } as unknown as AnnotationView
  const useAnnotations = vi.fn((selector: (value: AnnotationView) => unknown) => selector(view))
  const registerEndpoint = vi.fn(() => () => undefined)
  const t = (key: string, params?: { label?: string; count?: number }) =>
    key === 'transcript.count' ? `${params?.label} ×${params?.count}` : key
  const props = {
    node,
    useAnnotations,
    useChat: (selector: (value: ChatSnapshot) => unknown) => selector(snapshot),
    useAnnotationTranscriptVisibility: (selector: (value: TranscriptVisibilitySettings) => unknown) =>
      selector(visibility),
    useAnnotationNormalTranscriptView: (selector: (value: 'normal' | 'compact') => unknown) =>
      selector('normal'),
    useTurnData: () => undefined,
    registerEndpoint,
    updateHighlightRanges: () => undefined,
    activateHighlight: () => undefined,
    removeHighlights: () => undefined,
    openFile: () => undefined,
    fileMentions: () => undefined,
    t,
    annotationT: t,
    annotationTranscriptT: t,
  } as unknown as BoundAssistantProps
  const Decorated = entry.component as unknown as ComponentType<BoundAssistantProps>
  const result = render(<Decorated {...props} />)
  return { ...result, node, received, useAnnotations, registerEndpoint }
}

describe('decorated assistant protocol presentation', () => {
  it.each(['settled', 'running'] as const)(
    'hides protocol comments through the selected %s Markdown renderer while retaining raw receipts',
    (status) => {
      const { container, node, received } = mount(raw, status)
      expect(container).toHaveTextContent('[注解 1] 已收到这条注解。')
      expect(container.textContent).not.toContain('dsh-annotation')
      expect(container.textContent).not.toContain('submissionId')
      const projected = received.mock.lastCall?.[0] as ChatNodeViewProps<'assistant-step'>
      expect(projected.node).not.toBe(node)
      expect(projected.node.data.finalNode).toBe(node.data.finalNode)
      const text = node.data.blocks.find((block) => block.kind === 'text')!.text
      expect(text).toBe(raw)
      expect(parseReplyMarkers(text)).toHaveLength(1)
      expect(parseModelAcknowledgements(text)[0]?.processed).toEqual(['ann-y'])
    },
  )

  it('passes ordinary nodes through unchanged and retains the selected renderer', () => {
    const text = 'Ordinary **Markdown**\n\n<!-- ordinary comment -->  '
    const { container, node, received, queryByRole } = mount(text)
    expect(container.querySelector('strong')).toHaveTextContent('Markdown')
    expect(container).toHaveTextContent('<!-- ordinary comment -->')
    expect(received.mock.lastCall?.[0].node).toBe(node)
    expect(node.data.blocks).toEqual([{ kind: 'text', text }])
    expect(queryByRole('note')).toBeNull()
  })

  it('renders hidden-only activity without mounting its renderer or annotation endpoint', () => {
    const blocks: readonly AssistantBlock[] = [{ kind: 'reasoning', text: 'Hidden private reasoning' }]
    const { container, getByRole, node, received, useAnnotations, registerEndpoint } = mount('', 'running', {
      blocks,
      visibility: { hideReasoning: true },
    })
    expect(getByRole('note')).toHaveTextContent('transcript.reasoning ×1')
    expect(container).not.toHaveTextContent('Hidden private reasoning')
    expect(container.querySelector('details, button')).toBeNull()
    expect(received).not.toHaveBeenCalled()
    expect(useAnnotations).not.toHaveBeenCalled()
    expect(registerEndpoint).not.toHaveBeenCalled()
    expect(node.data.blocks).toBe(blocks)
  })

  it('keeps body receipts raw and puts activity counts outside the annotation selection root', () => {
    const blocks: readonly AssistantBlock[] = [
      { kind: 'reasoning', text: 'Hidden private reasoning' },
      { kind: 'text', text: raw },
    ]
    const { container, getByRole, node, received, registerEndpoint } = mount(raw, 'settled', {
      blocks,
      visibility: { hideReasoning: true },
    })
    const summary = getByRole('note')
    expect(summary).toHaveTextContent('transcript.reasoning ×1')
    expect(container).toHaveTextContent('[注解 1] 已收到这条注解。')
    expect(container).not.toHaveTextContent('Hidden private reasoning')
    expect(container).not.toHaveTextContent('submissionId')
    expect(container.firstElementChild).toBe(summary)
    expect(summary.nextElementSibling).toBeTruthy()
    expect(summary.nextElementSibling!.contains(summary)).toBe(false)
    expect(registerEndpoint).toHaveBeenCalled()
    const projected = received.mock.lastCall?.[0] as ChatNodeViewProps<'assistant-step'>
    expect(projected.node.data.blocks).toHaveLength(1)
    expect(projected.node.data.blocks[0]?.kind).toBe('text')
    expect(node.data.blocks).toBe(blocks)
    expect(node.data.blocks[1]).toEqual({ kind: 'text', text: raw })
  })

  it('keeps reasoning visible when only an unrelated category is hidden', () => {
    const { container, queryByRole, received, node } = mount('Visible body', 'settled', {
      blocks: [
        { kind: 'reasoning', text: 'Visible reasoning' },
        { kind: 'text', text: 'Visible body' },
      ],
      visibility: { hideContext: true },
    })
    expect(container).toHaveTextContent('Visible reasoning')
    expect(container).toHaveTextContent('Visible body')
    expect(queryByRole('note')).toBeNull()
    expect(received.mock.lastCall?.[0].node).toBe(node)
  })
})

describe('submitted annotation history presentation', () => {
  it('omits the history component but preserves the requirement, attachments, and recorded payload', () => {
    const payload = fixturePayload()
    const useAnnotations = vi.fn((selector: (value: AnnotationView) => unknown) =>
      selector({
        annotations: [],
        latestAssistantMessageId: payload.annotations[0]!.messageId,
      } as unknown as AnnotationView),
    )
    const props = {
      node: {
        data: {
          source: { kind: 'user', annotationSubmission: payload },
          content: [
            { type: 'text', text: 'Recorded protocol body' },
            { type: 'file', attachment: { name: 'brief.txt', bytes: 13 } },
          ],
        },
      },
      useAnnotations,
      navigate: () => undefined,
      openFile: () => undefined,
      openSkill: () => undefined,
      renderMessageImages: () => null,
      t: (key: string) => key,
    } as unknown as UserAnnotationProps<'user'>
    const { container, getByText, rerender } = render(
      <AnnotatedUserNode {...props} annotationHistoryHidden />,
    )
    expect(getByText(payload.overallRequirement!)).toBeTruthy()
    expect(getByText('brief.txt')).toBeTruthy()
    expect(container.querySelector('details')).toBeNull()
    expect(container).not.toHaveTextContent(payload.annotations[0]!.annotation)
    expect(useAnnotations).not.toHaveBeenCalled()
    expect(props.node.data.source).toEqual({ kind: 'user', annotationSubmission: payload })

    rerender(<AnnotatedUserNode {...props} />)
    expect(container.querySelector('details')).toBeTruthy()
    expect(container).toHaveTextContent(payload.annotations[0]!.annotation)
    expect(useAnnotations).toHaveBeenCalled()
    expect(getByText('brief.txt')).toBeTruthy()
  })
})
