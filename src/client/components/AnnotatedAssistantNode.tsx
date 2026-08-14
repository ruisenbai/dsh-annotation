import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { stripModelAcknowledgementMarkers } from '../../shared/model-ack.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity } from '../../shared/types.ts'
import type { AssistantAnnotationProps } from '../contract.ts'
import { captureSelection, rangeFromSelector, textOffsetAtPoint } from '../selection.ts'

function sameAnnotations(left: readonly AnnotationDraft[], right: readonly AnnotationDraft[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function annotationAtOffset(
  annotations: readonly AnnotationDraft[],
  offset: number | null,
): AnnotationDraft | undefined {
  if (offset === null) return undefined
  return annotations.find((item) => item.quote.start <= offset && offset < item.quote.end)
}

/** Full replacement renderer required because DSH exposes no slot inside assistant Markdown. */
export const AnnotatedAssistantNode = memo(function AnnotatedAssistantNode({
  node,
  useTurnData,
  openFile,
  loadImage,
  fileMentions,
  useAnnotations,
  beginSelection,
  openAnnotation,
  registerEndpoint,
  updateHighlightRanges,
  activateHighlight,
  removeHighlights,
  t,
}: AssistantAnnotationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<ReturnType<typeof captureSelection> | null>(null)
  const [flash, setFlash] = useState(false)
  const [hover, setHover] = useState<{ annotation: AnnotationDraft; x: number; y: number } | null>(null)
  const data = node.data
  const messageId = data.finalNode?.messageId as unknown as MessageIdentity | undefined
  const messageSeq = data.finalNode?.seq
  const annotations = useAnnotations(
    (view) =>
      messageId === undefined ? [] : view.annotations.filter((item) => item.messageId === messageId),
    sameAnnotations,
  )
  const activeId = useAnnotations((view) => view.activeAnnotationId)
  const tail = useTurnData('turn-tail')
  const turn = node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn : undefined
  const mentionOwner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => (mentionOwner === undefined ? undefined : fileMentions(mentionOwner)),
    [fileMentions, mentionOwner],
  )
  const codeLabels = useMemo(() => ({ copyLabel: t('code.copy'), copiedLabel: t('code.copied') }), [t])
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

  const reveal = useCallback(
    (annotationId: AnnotationId) => {
      const root = rootRef.current
      const body = bodyRef.current
      if (root === null || body === null) return
      root.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const annotation = annotations.find((item) => item.annotationId === annotationId)
      const range = annotation === undefined ? null : rangeFromSelector(body, annotation.quote)
      activateHighlight(messageId as MessageIdentity, range)
      setFlash(false)
      requestAnimationFrame(() => setFlash(true))
      root.focus({ preventScroll: true })
    },
    [activateHighlight, annotations, messageId],
  )

  const annotateAll = useCallback(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || messageSeq === undefined) return
    const range = document.createRange()
    range.selectNodeContents(body)
    try {
      beginSelection(captureSelection(body, range, messageId, messageSeq))
    } catch {
      // An assistant with only images or tool calls has no text annotation target.
    }
  }, [beginSelection, messageId, messageSeq])

  useEffect(() => {
    if (messageId === undefined) return undefined
    return registerEndpoint(messageId, { reveal, annotateAll })
  }, [annotateAll, messageId, registerEndpoint, reveal])

  useEffect(() => {
    if (messageId === undefined) return undefined
    const body = bodyRef.current
    if (body === null) return undefined
    const ranges = annotations.flatMap((annotation) => {
      const range = rangeFromSelector(body, annotation.quote)
      return range === null ? [] : [range]
    })
    updateHighlightRanges(messageId, ranges)
    const active = annotations.find((item) => item.annotationId === activeId)
    activateHighlight(messageId, active === undefined ? null : rangeFromSelector(body, active.quote))
    return () => removeHighlights(messageId)
  }, [activeId, activateHighlight, annotations, messageId, removeHighlights, updateHighlightRanges])

  useEffect(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || messageSeq === undefined) return undefined
    const capture = () => {
      const selected = window.getSelection()
      if (selected === null || selected.rangeCount === 0 || selected.isCollapsed) return
      const range = selected.getRangeAt(0)
      if (!body.contains(range.startContainer)) return
      if (!body.contains(range.endContainer)) {
        setSelection(null)
        return
      }
      try {
        setSelection(captureSelection(body, range, messageId, messageSeq))
      } catch {
        setSelection(null)
      }
    }
    body.addEventListener('pointerup', capture)
    body.addEventListener('keyup', capture)
    return () => {
      body.removeEventListener('pointerup', capture)
      body.removeEventListener('keyup', capture)
    }
  }, [messageId, messageSeq])

  const inspectPoint = (x: number, y: number): AnnotationDraft | undefined => {
    const body = bodyRef.current
    return body === null ? undefined : annotationAtOffset(annotations, textOffsetAtPoint(body, x, y))
  }

  return (
    <section
      ref={rootRef}
      className={`dia-assistant${flash ? ' dia-flash' : ''}`}
      tabIndex={-1}
      data-dsh-inline-message-id={messageId}
    >
      <div
        ref={bodyRef}
        className="dia-assistant__body"
        onPointerMove={(event) => {
          const annotation = inspectPoint(event.clientX, event.clientY)
          setHover(
            annotation === undefined ? null : { annotation, x: event.clientX + 12, y: event.clientY + 12 },
          )
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          if (!window.getSelection()?.isCollapsed) return
          const annotation = inspectPoint(event.clientX, event.clientY)
          if (annotation !== undefined) openAnnotation(annotation.annotationId)
        }}
      >
        {data.blocks.map((block, index) => {
          if (block.kind === 'text')
            return (
              <MarkdownText
                key={`text:${index}`}
                text={stripModelAcknowledgementMarkers(block.text)}
                streaming={data.status === 'running'}
                codeLabels={codeLabels}
                fileMentions={mentions}
              />
            )
          if (block.kind === 'reasoning')
            return (
              <details key={`reasoning:${index}`} className="dia-assistant__reasoning">
                <summary>{t('assistant.reasoning')}</summary>
                <pre>{stripModelAcknowledgementMarkers(block.text)}</pre>
              </details>
            )
          if (block.kind === 'image')
            return (
              <ImageGallery
                key={`image:${block.attachment.attachmentId}:${index}`}
                images={[{ attachment: block.attachment }]}
                load={loadImage}
                align="start"
                labels={imageLabels}
              />
            )
          if (block.kind === 'other')
            return <JsonBlock key={`other:${index}`} label={t('assistant.other')} payload={block.block} />
          return null
        })}
        {data.status === 'interrupted' && <p className="dia-warning">{t('assistant.interrupted')}</p>}
      </div>
      {selection !== null && (
        <button
          type="button"
          className="dia-selection-button"
          style={{
            top: Math.min(window.innerHeight - 48, selection.rect.bottom + 7),
            left: selection.rect.left,
          }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            beginSelection(selection)
            setSelection(null)
            window.getSelection()?.removeAllRanges()
          }}
        >
          {t('selection.add')}
        </button>
      )}
      {annotations.length > 0 && (
        <nav className="dia-markers" aria-label={t('list.title')}>
          {annotations.map((annotation) => (
            <button
              key={annotation.annotationId}
              type="button"
              className="dia-marker"
              title={annotation.comment}
              aria-label={`#${annotation.ordinal}: ${annotation.comment}`}
              onClick={() => openAnnotation(annotation.annotationId)}
            >
              {annotation.ordinal}
            </button>
          ))}
        </nav>
      )}
      {hover !== null && (
        <aside className="dia-hover" style={{ left: hover.x, top: hover.y }}>
          <strong>#{hover.annotation.ordinal}</strong> {hover.annotation.comment}
        </aside>
      )}
    </section>
  )
})
