import { Fragment, type ReactElement } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { AnnotatedAssistantNode } from '../src/client/components/AnnotatedAssistantNode.tsx'
import type { AssistantAnnotationProps } from '../src/client/contract.ts'
import { stripMachineMarkersForDisplay } from '../src/shared/model-ack.ts'

type Props = AssistantAnnotationProps & { readonly children?: ReactElement | undefined }

/** A small Host-renderer stand-in for tests that exercise annotation DOM behavior directly. */
export function TestAnnotatedAssistantNode({ children, ...props }: Props): ReactElement {
  const data = props.node.data
  const hostContent =
    children === undefined ? (
      <>
        {data.blocks.map((block, index) => {
          if (block.kind === 'text')
            return (
              <MarkdownText
                key={`text:${index}`}
                text={stripMachineMarkersForDisplay(block.text, data.status === 'running')}
                streaming={data.status === 'running'}
                labels={{
                  code: { copyLabel: 'Copy code', copiedLabel: 'Copied' },
                  footnotes: 'Footnotes',
                }}
              />
            )
          if (block.kind === 'reasoning')
            return (
              <div key={`reasoning:${index}`} data-variant="think">
                {stripMachineMarkersForDisplay(block.text, data.status === 'running')}
              </div>
            )
          if (block.kind === 'image') {
            if (data.blocks[index - 1]?.kind === 'image') return null
            const images = []
            for (let cursor = index; cursor < data.blocks.length; cursor += 1) {
              const current = data.blocks[cursor]
              if (current?.kind !== 'image') break
              images.push({ attachment: current.attachment })
            }
            return (
              <Fragment key={`image:${index}`}>
                {props.renderMessageImages({ images, align: 'start' })}
              </Fragment>
            )
          }
          if (block.kind === 'other') return <pre key={`other:${index}`}>{JSON.stringify(block.block)}</pre>
          return null
        })}
        {data.status === 'interrupted' && <span>Host interruption</span>}
      </>
    ) : (
      children
    )
  return <AnnotatedAssistantNode {...props}>{children ?? hostContent}</AnnotatedAssistantNode>
}
