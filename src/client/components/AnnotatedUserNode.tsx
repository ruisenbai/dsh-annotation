import { AnnotationSourceLabel, displayAnnotationQuote } from './AnnotationSourceLabel.tsx'
import { useId, useState } from 'react'
import type { UserContentAttachment } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  IconChevronDownOutlineRegular,
  IconListPenOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseAnnotationSource } from '../../shared/protocol.ts'
import type { AnnotationId } from '../../shared/types.ts'
import type { UserAnnotationProps } from '../contract.ts'
import { MapPin } from '../icons.ts'

function AnnotationSubmissionRow<Key extends 'user' | 'steering'>({
  payload,
  navigate,
  t,
}: Pick<UserAnnotationProps<Key>, 'navigate' | 't'> & {
  payload: NonNullable<ReturnType<typeof parseAnnotationSource>>
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const single = payload.annotations.length === 1
  const only = payload.annotations[0]
  const canLocateSingle = single && only?.source?.kind !== 'diff'
  const label = single ? t('timeline.single') : t('timeline.summary', { count: payload.annotations.length })
  const content = (
    <>
      <IconListPenOutlineRegular size={16} aria-hidden="true" />
      <span>{label}</span>
      {!single && (
        <span className="dia-timeline__chevron" aria-hidden="true">
          <IconChevronDownOutlineRegular size={14} />
        </span>
      )}
    </>
  )
  const trigger =
    single && !canLocateSingle ? (
      <span className="dia-timeline__trigger" tabIndex={0}>
        {content}
      </span>
    ) : (
      <button
        type="button"
        className="dia-timeline__trigger"
        {...(single
          ? {
              onDoubleClick: () => void navigate(only!.annotationId as AnnotationId),
              onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                void navigate(only!.annotationId as AnnotationId)
              },
              'aria-label': t('timeline.singleLocate'),
            }
          : {
              'aria-controls': listId,
              'aria-expanded': expanded,
              onClick: () => setExpanded((value) => !value),
            })}
      >
        {content}
      </button>
    )
  return (
    <div className="dia-timeline" data-expanded={expanded} data-single={single} aria-label={label}>
      {single && only !== undefined ? (
        <Tooltip
          label={
            only.annotation === ''
              ? t('timeline.previewSource', { quote: displayAnnotationQuote(only, t) })
              : t('timeline.preview', { quote: displayAnnotationQuote(only, t), annotation: only.annotation })
          }
          side="top"
          align="end"
          delayMs={250}
          portal
          maxWidth={340}
        >
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {!single && expanded && (
        <ol id={listId} className="dia-timeline__list">
          {payload.annotations.map((item) => (
            <li key={item.annotationId} className="dia-timeline-item">
              <span className="dia-timeline-item__index" aria-hidden="true">
                {item.ordinal}
              </span>
              <div className="dia-timeline-item__content">
                <AnnotationSourceLabel item={item} t={t} />
                <q>{displayAnnotationQuote(item, t)}</q>
                {item.annotation !== '' && <p>{item.annotation}</p>}
              </div>
              {item.source?.kind !== 'diff' && (
                <button
                  type="button"
                  className="dia-record-action dia-timeline-item__locate"
                  aria-label={t('list.locate')}
                  onClick={() => void navigate(item.annotationId as AnnotationId)}
                >
                  <MapPin aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Render annotation metadata with the Host's user-content factory and reference actions. */
export function AnnotatedUserNode<Key extends 'user' | 'steering'>({
  node,
  loadImage,
  renderFactorySlot,
  navigate,
  t,
}: UserAnnotationProps<Key>) {
  const payload = parseAnnotationSource(node.data.source)
  const attachments: UserContentAttachment[] = []
  const texts: string[] = []
  const extraBlocks: unknown[] = []
  for (const block of node.data.content) {
    if (block.type === 'text') texts.push(block.text)
    else if (block.type === 'image')
      attachments.push({ type: 'image', image: { attachment: block.attachment } })
    else if (block.type === 'file') attachments.push({ type: 'file', file: block.attachment })
    else extraBlocks.push(block)
  }
  const content = renderFactorySlot('conversation.chat.user.content', {
    content: {
      text: payload === null ? texts.join('') : (payload.overallRequirement?.trim() ?? ''),
      attachments,
      extraBlocks,
      ...(node.data.referenceLabels === undefined ? {} : { referenceLabels: node.data.referenceLabels }),
    },
    facts: {
      ...(node.data.referenceLabels === undefined ? {} : { sessionLabels: node.data.referenceLabels }),
      ...(node.data.skillNames === undefined ? {} : { skillNames: node.data.skillNames }),
    },
    loadImage,
    interactive: true,
  })
  return payload === null ? (
    content
  ) : (
    <div className="dia-user-submission">
      <AnnotationSubmissionRow payload={payload} navigate={navigate} t={t} />
      {content}
    </div>
  )
}
