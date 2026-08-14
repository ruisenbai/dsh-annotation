import { useMemo } from 'react'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseInlineAnnotationSource } from '../../shared/protocol.ts'
import type { AnnotationId } from '../../shared/types.ts'
import type { UserAnnotationProps } from '../contract.ts'

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
      <summary>{t('timeline.summary', { count: payload.annotations.length })}</summary>
      <div className="dia-timeline__body">
        {previousVersion && <p className="dia-warning">{t('timeline.previousVersion')}</p>}
        {payload.overallRequirement !== undefined && payload.overallRequirement.trim() !== '' && (
          <section>
            <strong>{t('timeline.overall')}</strong>
            <p className="dia-item__comment">{payload.overallRequirement}</p>
          </section>
        )}
        <div className="dia-list">
          {payload.annotations.map((item) => {
            const local = byId.get(item.annotationId)
            const status = local?.status ?? 'sent'
            return (
              <article key={item.annotationId} className="dia-item" data-status={status}>
                <div className="dia-item__head">
                  <span>
                    #{item.ordinal} · {t(`status.${status}`)}
                  </span>
                  <span>{item.annotationId}</span>
                </div>
                <p className="dia-item__quote">“{item.quote.exact}”</p>
                <p className="dia-item__comment">{item.comment}</p>
                <div className="dia-actions">
                  <button
                    type="button"
                    className="dia-button"
                    onClick={() => void navigate(item.annotationId as AnnotationId)}
                  >
                    {t('list.locate')}
                  </button>
                </div>
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
