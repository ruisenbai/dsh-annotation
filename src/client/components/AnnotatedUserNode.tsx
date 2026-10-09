import { AnnotationSourceLabel, displayAnnotationQuote } from './AnnotationSourceLabel.tsx'
import { Fragment, useId, useState } from 'react'
import {
  FileTypeIcon,
  fileSizeText,
  IconChevronDownOutlineRegular,
  IconListPenOutlineRegular,
  projectUserText,
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

/** Shadow renderer that upgrades annotation submissions while preserving ordinary user messages. */
export function AnnotatedUserNode<Key extends 'user' | 'steering'>({
  node,
  renderMessageImages,
  openFile,
  openSkill,
  navigate,
  t,
}: UserAnnotationProps<Key>) {
  const payload = parseAnnotationSource(node.data.source)
  const referenceLabels = node.data.referenceLabels ?? []
  const skillNames = node.data.skillNames ?? []
  const attachments = node.data.content.filter((block) => block.type === 'image' || block.type === 'file')
  const attachmentRow =
    attachments.length === 0 ? null : (
      <div className="dia-message-attachments" data-message-attachments>
        {attachments.map((block, index) =>
          block.type === 'image' ? (
            <Fragment key={`image:${index}`}>
              {renderMessageImages({
                images: [{ attachment: block.attachment }],
                align: 'end',
                compact: attachments.length > 1,
              })}
            </Fragment>
          ) : (
            <span key={`file:${index}`} className="dia-file-attachment" title={block.attachment.name}>
              <FileTypeIcon path={block.attachment.name} className="dia-file-attachment__icon" />
              <span className="dia-file-attachment__content">
                <span className="dia-file-attachment__name">{block.attachment.name}</span>
                <span className="dia-file-attachment__size">{fileSizeText(block.attachment.bytes)}</span>
              </span>
            </span>
          ),
        )}
      </div>
    )
  if (payload !== null) {
    const requirement = payload.overallRequirement?.trim() ?? ''
    return (
      <div className="dia-user-submission">
        <AnnotationSubmissionRow payload={payload} navigate={navigate} t={t} />
        {requirement !== '' && (
          <article className="dia-user">
            {projectUserText(requirement, referenceLabels, skillNames, 'skill', { openFile, openSkill })}
          </article>
        )}
        {attachmentRow}
      </div>
    )
  }
  const texts = node.data.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
  return (
    <article className="dia-user">
      {projectUserText(texts.join(''), referenceLabels, skillNames, 'skill', { openFile, openSkill })}
      {attachmentRow}
    </article>
  )
}
