// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { decorateAssistantRenderers } from '../src/client/assistant-renderer-decorator.tsx'
import type { AnnotationInjected, AssistantAnnotationProps } from '../src/client/contract.ts'
import type { AnnotationView } from '../src/client/controller.ts'
import { parseModelAcknowledgements, parseReplyMarkers } from '../src/shared/model-ack.ts'

afterEach(cleanup)

const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const raw =
  '<!-- dsh-annotation-reply:{"submissionId":"sub-x","annotationId":"ann-y","ordinal":1} -->\n[注解 1] 已收到这条注解。 <!-- dsh-annotation:{"submissionId":"sub-x","processed":["ann-y"]} -->'

function mount(text: string, status: 'settled' | 'running' = 'settled') {
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
  const dispose = decorateAssistantRenderers(ctx, () => ({}) as AnnotationInjected)
  const node = {
    kind: 'assistant-step',
    location: { kind: 'root' },
    data: { status, blocks: [{ kind: 'text', text }], finalNode: { messageId: 'reply-test', seq: 42 } },
  }
  const view = {
    annotations: [],
    activeAnnotationId: null,
    markerAnnotationId: null,
  } as unknown as AnnotationView
  const t = (key: string) => key
  const props = {
    node,
    useAnnotations: (selector: (value: AnnotationView) => unknown) => selector(view),
    useTurnData: () => undefined,
    registerEndpoint: () => () => undefined,
    updateHighlightRanges: () => undefined,
    activateHighlight: () => undefined,
    removeHighlights: () => undefined,
    openFile: () => undefined,
    fileMentions: () => undefined,
    t,
    annotationT: t,
  } as unknown as AssistantAnnotationProps
  const Decorated = entry.component as unknown as ComponentType<AssistantAnnotationProps>
  const result = render(<Decorated {...props} />)
  return { ...result, node, received, dispose }
}

describe('decorated assistant protocol presentation', () => {
  it.each(['settled', 'running'] as const)(
    'hides protocol comments through the selected %s Markdown renderer while retaining raw receipts',
    (status) => {
      const { container, node, received, dispose, unmount } = mount(raw, status)
      expect(container).toHaveTextContent('[注解 1] 已收到这条注解。')
      expect(container.textContent).not.toContain('dsh-annotation')
      expect(container.textContent).not.toContain('submissionId')
      const projected = received.mock.lastCall?.[0] as ChatNodeViewProps<'assistant-step'>
      expect(projected.node).not.toBe(node)
      expect(projected.node.data.finalNode).toBe(node.data.finalNode)
      expect(node.data.blocks[0]?.text).toBe(raw)
      expect(parseReplyMarkers(node.data.blocks[0]!.text)).toHaveLength(1)
      expect(parseModelAcknowledgements(node.data.blocks[0]!.text)[0]?.processed).toEqual(['ann-y'])
      unmount()
      dispose()
    },
  )

  it('passes ordinary nodes through unchanged and retains the selected renderer', () => {
    const text = 'Ordinary **Markdown**\n\n<!-- ordinary comment -->  '
    const { container, node, received, dispose, unmount } = mount(text)
    expect(container.querySelector('strong')).toHaveTextContent('Markdown')
    expect(container).toHaveTextContent('<!-- ordinary comment -->')
    expect(received.mock.lastCall?.[0].node).toBe(node)
    expect(node.data.blocks[0]?.text).toBe(text)
    unmount()
    dispose()
  })
})
