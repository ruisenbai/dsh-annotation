import { Fragment, type ReactNode } from 'react'
import type { UserContentInput } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import type { UserAnnotationProps } from '../src/client/contract.ts'

type ImageRenderer = (input: { images: readonly unknown[]; align: 'end'; compact: boolean }) => ReactNode

/** Minimal Host content seat; real profile tests own reference actions and image loading. */
export function userContentFactory(
  renderImages: ImageRenderer = () => null,
): PropsRenderFactories['renderFactorySlot'] {
  return (name, props) => {
    if (name !== 'conversation.chat.user.content') throw new Error(`Unexpected factory: ${name}`)
    const { content } = props as UserContentInput
    return (
      <>
        {content.text !== '' && <article className="dia-user">{content.text}</article>}
        {content.attachments.length > 0 && (
          <div data-message-attachments>
            {content.attachments.map((item, index) =>
              item.type === 'image' ? (
                <Fragment key={index}>
                  {renderImages({
                    images: [item.image],
                    align: 'end',
                    compact: content.attachments.length > 1,
                  })}
                </Fragment>
              ) : (
                <span key={index} title={item.file.name}>
                  {item.file.name}
                  {fileSizeText(item.file.bytes)}
                </span>
              ),
            )}
          </div>
        )}
      </>
    )
  }
}

/** Supply the declared Host factory when testing annotation-only interactions. */
export function TestAnnotatedUserNode<Key extends 'user' | 'steering'>(
  props: UserAnnotationProps<Key> & { renderMessageImages?: ImageRenderer },
) {
  return (
    <AnnotatedUserNode
      {...props}
      renderFactorySlot={props.renderFactorySlot ?? userContentFactory(props.renderMessageImages)}
    />
  )
}
