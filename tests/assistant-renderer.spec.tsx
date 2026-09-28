// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { decorateAssistantRenderers } from '../src/client/assistant-renderer-decorator.tsx'
import type { AnnotationInjected, AssistantAnnotationProps } from '../src/client/contract.ts'
import type { AnnotationView } from '../src/client/controller.ts'
import { parseModelAcknowledgements, parseReplyMarkers } from '../src/shared/model-ack.ts'

const decorators: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const dispose of decorators.splice(0).reverse()) dispose()
})

const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const raw =
  '<!-- dsh-annotation-reply:{"submissionId":"sub-x","annotationId":"ann-y","ordinal":1} -->\n[注解 1] 已收到这条注解。 <!-- dsh-annotation:{"submissionId":"sub-x","processed":["ann-y"]} -->'

type BoundAssistantProps = AssistantAnnotationProps

function mount(
  text: string,
  status: 'settled' | 'running' | 'interrupted' = 'settled',
  options: {
    blocks?: readonly AssistantBlock[]
  } = {},
) {
  const received = vi.fn()
  const renderMessageImages = vi.fn(() => <span>Host image</span>)
  const Inner = (props: ChatNodeViewProps<'assistant-step'>) => {
    received(props)
    return (
      <div>
        {props.node.data.blocks.map((block, index) => {
          if (block.kind === 'text' || block.kind === 'reasoning')
            return (
              <MarkdownText
                key={index}
                text={block.text}
                streaming={props.node.data.status === 'running'}
                labels={labels}
              />
            )
          if (block.kind === 'image')
            return (
              <div key={index}>
                {props.renderMessageImages({ images: [{ attachment: block.attachment }], align: 'start' })}
              </div>
            )
          if (block.kind === 'tool-call') return <span key={index}>Host tool: {block.name}</span>
          if (block.kind === 'other')
            return <span key={index}>Host other: {JSON.stringify(block.block)}</span>
          return null
        })}
        {props.node.data.status === 'interrupted' && <span>Host interruption</span>}
      </div>
    )
  }
  const entry = {
    options: { key: 'assistant-step' },
    component: Inner as ComponentType<ChatNodeViewProps<'assistant-step'>>,
  }
  let slotsChanged: ((key: string) => void) | null = null
  const ctx = {
    slots: { entries: () => [entry] },
    on: (_event: string, callback: (key: string) => void) => {
      slotsChanged = callback
      return () => {
        slotsChanged = null
      }
    },
  } as unknown as Context
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
  const view = {
    annotations: [],
    outbox: [],
    activeAnnotationId: null,
    markerAnnotationId: null,
  } as unknown as AnnotationView
  const useAnnotations = vi.fn((selector: (value: AnnotationView) => unknown) => selector(view))
  const registerEndpoint = vi.fn(() => () => undefined)
  const t = (key: string) => key
  const hostT = (key: string) => `host:${key}`
  const props = {
    node,
    useAnnotations,
    useChat: (selector: (value: ChatSnapshot) => unknown) => selector(snapshot),
    useTurnData: () => undefined,
    registerEndpoint,
    updateHighlightRanges: () => undefined,
    activateHighlight: () => undefined,
    removeHighlights: () => undefined,
    renderMessageImages,
    openFile: () => undefined,
    fileMentions: () => undefined,
    t: hostT,
    annotationT: t,
  } as unknown as BoundAssistantProps & ChatNodeViewProps<'assistant-step'>
  const Decorated = entry.component
  const result = render(<Decorated {...props} />)
  return {
    ...result,
    node,
    received,
    useAnnotations,
    registerEndpoint,
    renderMessageImages,
    entry,
    ctx,
    Inner,
    props,
    notifySlotsChanged: () => slotsChanged?.('conversation.chat.node'),
  }
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

  it('keeps reasoning visible when only an unrelated category is hidden', () => {
    const { container, queryByRole, received, node } = mount('Visible body', 'settled', {
      blocks: [
        { kind: 'reasoning', text: 'Visible reasoning' },
        { kind: 'text', text: 'Visible body' },
      ],
    })
    expect(container).toHaveTextContent('Visible reasoning')
    expect(container).toHaveTextContent('Visible body')
    expect(queryByRole('note')).toBeNull()
    expect(received.mock.lastCall?.[0].node).toBe(node)
  })

  it('lets the selected Host render images, tools, other blocks, and interruption once', () => {
    const image = { kind: 'image', attachment: { attachmentId: 'image-test' } } as AssistantBlock
    const { container, received, renderMessageImages } = mount('', 'interrupted', {
      blocks: [
        { kind: 'text', text: 'Host **answer**' },
        image,
        { kind: 'tool-call', callId: 'call-test', name: 'search', argsRaw: '{}' },
        { kind: 'other', block: { summary: 'host-owned' } },
      ],
    })
    expect(container.querySelector('strong')).toHaveTextContent('answer')
    expect(container).toHaveTextContent('Host image')
    expect(container).toHaveTextContent('Host tool: search')
    expect(container).toHaveTextContent('Host other: {"summary":"host-owned"}')
    expect(container).toHaveTextContent('Host interruption')
    expect(renderMessageImages).toHaveBeenCalledOnce()
    expect(received.mock.lastCall?.[0].t('example')).toBe('host:example')
  })

  it('restores a coexisting renderer and decorates a later slot replacement', () => {
    const { entry, ctx, Inner, props, notifySlotsChanged } = mount('Initial Host output')
    const firstDispose = decorators.pop()!
    firstDispose()
    expect(entry.component).toBe(Inner)

    const OtherRenderer = () => <div>Other renderer output</div>
    entry.component = OtherRenderer
    const dispose = decorateAssistantRenderers(ctx, () => ({}) as AnnotationInjected)
    decorators.push(dispose)
    cleanup()
    const DecoratedOther = entry.component
    const other = render(<DecoratedOther {...props} />)
    expect(other.container).toHaveTextContent('Other renderer output')

    const Replacement = () => <div>Replacement Host output</div>
    entry.component = Replacement
    notifySlotsChanged()
    other.unmount()
    const DecoratedReplacement = entry.component
    const replacement = render(<DecoratedReplacement {...props} />)
    expect(replacement.container).toHaveTextContent('Replacement Host output')
    dispose()
    expect(entry.component).toBe(Replacement)
  })
})
