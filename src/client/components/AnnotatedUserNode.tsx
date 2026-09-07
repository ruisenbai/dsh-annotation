import { Fragment, useMemo } from 'react'
import {
  DocumentFileIcon,
  fileSizeText,
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconListPenOutline16,
  IconQueueOutline14,
  projectUserText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseAnnotationSource } from '../../shared/protocol.ts'
import type { AnnotationId, AnnotationStatus } from '../../shared/types.ts'
import type { UserAnnotationProps } from '../contract.ts'
import { MapPin } from '../icons.ts'

function TimelineStatusIcon({ status }: { status: AnnotationStatus }) {
  if (status === 'queued') return <IconQueueOutline14 size={14} />
  if (status === 'processed' || status === 'sent') return <IconCheckOutline14 size={14} />
  return <IconListPenOutline16 size={14} />
}

function AnnotationSubmissionRow<Key extends 'user' | 'steering'>({
  payload,
  useAnnotations,
  navigate,
  t,
}: Pick<UserAnnotationProps<Key>, 'useAnnotations' | 'navigate' | 't'> & {
  payload: NonNullable<ReturnType<typeof parseAnnotationSource>>
}) {
  const view = useAnnotations((state) => state)
  const byId = useMemo(
    () => new Map(view.annotations.map((item) => [item.annotationId, item])),
    [view.annotations],
  )
  const previousVersion =
    view.latestAssistantMessageId !== null &&
    payload.annotations.some((item) => item.messageId !== view.latestAssistantMessageId)
  return (
    <details className="dia-timeline">
      <summary>
        <span className="dia-timeline__summary-icon" aria-hidden="true">
          <IconListPenOutline16 size={16} />
        </span>
        <span className="dia-timeline__summary-copy">
          <strong>{t('timeline.summary', { count: payload.annotations.length })}</strong>
          <small>{previousVersion ? t('timeline.previousVersion') : payload.submissionId}</small>
        </span>
        <span className="dia-timeline__disclosure" aria-hidden="true">
          <span data-collapsed="true">
            <IconChevronRightOutline14 size={14} />
          </span>
          <span data-expanded="true">
            <IconChevronDownOutline14 size={14} />
          </span>
        </span>
      </summary>
      <div className="dia-timeline__body">
        <div className="dia-timeline__list">
          {payload.annotations.map((item) => {
            const local = byId.get(item.annotationId)
            const status = local?.status ?? 'sent'
            return (
              <article key={item.annotationId} className="dia-timeline-item" data-status={status}>
                <header className="dia-timeline-item__head">
                  <span className="dia-timeline-item__index" aria-hidden="true">
                    {item.ordinal}
                  </span>
                  <span className="dia-status" data-status={status}>
                    <TimelineStatusIcon status={status} />
                    {t(`status.${status}`)}
                  </span>
                  <code>{item.annotationId}</code>
                </header>
                <q>{item.quote.exact}</q>
                <p data-highlight-only={item.kind === 'highlight-only' ? 'true' : undefined}>
                  {item.annotation === '' ? t('highlightOnly') : item.annotation}
                </p>
                <button
                  type="button"
                  className="dia-text-button dia-timeline-item__locate"
                  onClick={() => void navigate(item.annotationId as AnnotationId)}
                >
                  <MapPin aria-hidden="true" size={12} strokeWidth={1.8} />
                  {t('list.locate')}
                </button>
              </article>
            )
          })}
        </div>
      </div>
    </details>
  )
}

/** Shadow renderer that upgrades annotation submissions while preserving ordinary user messages. */
export function AnnotatedUserNode<Key extends 'user' | 'steering'>({
  node,
  renderMessageImages,
  useAnnotations,
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
              <DocumentFileIcon className="dia-file-attachment__icon" />
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
        {requirement !== '' && (
          <article className="dia-user">{projectUserText(requirement, referenceLabels, skillNames)}</article>
        )}
        <AnnotationSubmissionRow
          payload={payload}
          useAnnotations={useAnnotations}
          navigate={navigate}
          t={t}
        />
        {attachmentRow}
      </div>
    )
  }
  const texts = node.data.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
  return (
    <article className="dia-user">
      {projectUserText(texts.join(''), referenceLabels, skillNames)}
      {attachmentRow}
    </article>
  )
}
