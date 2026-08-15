import { useMemo } from 'react'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconListPenOutline16,
  IconQueueOutline14,
  IconRightUpOutline14,
  MessageText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseInlineAnnotationSource } from '../../shared/protocol.ts'
import type { AnnotationId, AnnotationStatus } from '../../shared/types.ts'
import type { UserAnnotationProps } from '../contract.ts'

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
  payload: NonNullable<ReturnType<typeof parseInlineAnnotationSource>>
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
        {payload.overallRequirement !== undefined && payload.overallRequirement.trim() !== '' && (
          <section className="dia-timeline__overall">
            <strong>{t('timeline.overall')}</strong>
            <p>{payload.overallRequirement}</p>
          </section>
        )}
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
                <p>{item.comment}</p>
                <button
                  type="button"
                  className="dia-text-button dia-timeline-item__locate"
                  onClick={() => void navigate(item.annotationId as AnnotationId)}
                >
                  <IconRightUpOutline14 size={12} />
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
  loadImage,
  useAnnotations,
  navigate,
  t,
}: UserAnnotationProps<Key>) {
  const payload = parseInlineAnnotationSource(node.data.source)
  const imageLabels = useMemo(
    () => ({
      image: t('image.label'),
      open: t('image.open'),
      openNamed: (name: string) => t('image.openNamed', { name }),
      loading: t('image.loading'),
      loadFailed: t('image.failed'),
      lightbox: { dialog: t('image.open'), close: t('image.close') },
    }),
    [t],
  )
  if (payload !== null) {
    return (
      <AnnotationSubmissionRow payload={payload} useAnnotations={useAnnotations} navigate={navigate} t={t} />
    )
  }
  const texts = node.data.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
  const images = node.data.content.flatMap((block) =>
    block.type === 'image' ? [{ attachment: block.attachment }] : [],
  )
  return (
    <article className="dia-user">
      {texts.map((text, index) => (
        <MessageText key={`text:${index}`} text={text} />
      ))}
      <ImageGallery images={images} load={loadImage} align="end" labels={imageLabels} />
    </article>
  )
}
