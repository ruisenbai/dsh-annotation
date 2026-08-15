import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, MessageSquarePlus } from '../icons.ts'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { stripModelAcknowledgementMarkers } from '../../shared/model-ack.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity } from '../../shared/types.ts'
import type { AssistantAnnotationProps } from '../contract.ts'
import { captureSelection, rangeFromSelector, selectableTextNodes, textOffsetAtPoint } from '../selection.ts'

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

interface MarkerPosition {
  readonly top: number
  readonly left: number
}

function sameMarkerPositions(
  left: ReadonlyMap<AnnotationId, MarkerPosition>,
  right: ReadonlyMap<AnnotationId, MarkerPosition>,
): boolean {
  if (left.size !== right.size) return false
  for (const [id, position] of left) {
    const candidate = right.get(id)
    if (candidate?.top !== position.top || candidate.left !== position.left) return false
  }
  return true
}

function finalVisibleRect(range: Range): DOMRect | null {
  const rects =
    typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      : []
  const finalLine = rects.at(-1)
  if (finalLine !== undefined) return finalLine
  if (typeof range.getBoundingClientRect !== 'function') return null
  const bounds = range.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 ? bounds : null
}

interface VisualLine {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly height: number
}

function sharesVisualLine(rect: VisualLine, line: VisualLine): boolean {
  const overlap = Math.min(rect.bottom, line.bottom) - Math.max(rect.top, line.top)
  return overlap > Math.min(rect.height, line.height) / 2
}

function completeFinalLine(nodes: readonly Text[], range: Range): VisualLine | null {
  const selected = finalVisibleRect(range)
  if (selected === null) return null
  const line: VisualLine = {
    top: selected.top,
    right: selected.right,
    bottom: selected.bottom,
    height: selected.height,
  }
  const endIndex = nodes.findIndex((node) => node === range.endContainer)
  if (endIndex < 0) return line

  let right = line.right
  for (let index = endIndex; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const probe = document.createRange()
    probe.setStart(node, index === endIndex ? range.endOffset : 0)
    probe.setEnd(node, node.length)
    let reachedLaterLine = false
    for (const rect of Array.from(probe.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue
      if (sharesVisualLine(rect, line)) {
        right = Math.max(right, rect.right)
      } else if (rect.top >= line.bottom - 0.5) {
        reachedLaterLine = true
        break
      }
    }
    if (reachedLaterLine) break
  }
  return { ...line, right }
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
  const [selectionCopyStatus, setSelectionCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [markerPositions, setMarkerPositions] = useState<ReadonlyMap<AnnotationId, MarkerPosition>>(
    () => new Map(),
  )
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

  useLayoutEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || annotations.length === 0) {
      setMarkerPositions((current) => (current.size === 0 ? current : new Map()))
      return undefined
    }

    const measure = () => {
      const rootRect = root.getBoundingClientRect()
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0
      const minLeft = viewportLeft - rootRect.left + 4
      const occupied: MarkerPosition[] = []
      const next = new Map<AnnotationId, MarkerPosition>()
      const textNodes = selectableTextNodes(body)
      const measured: Array<{ annotation: AnnotationDraft; line: VisualLine }> = []
      const unresolved: Array<{ annotation: AnnotationDraft; index: number }> = []

      annotations.forEach((annotation, index) => {
        const range = rangeFromSelector(body, annotation.quote)
        const line = range === null ? null : completeFinalLine(textNodes, range)
        if (line === null) unresolved.push({ annotation, index })
        else measured.push({ annotation, line })
      })

      measured.sort((left, right) => {
        const lineOrder = left.line.top + left.line.bottom - right.line.top - right.line.bottom
        return lineOrder === 0 ? left.annotation.ordinal - right.annotation.ordinal : lineOrder
      })
      const groups: Array<{
        anchor: VisualLine
        markers: Array<{ annotation: AnnotationDraft; line: VisualLine }>
      }> = []
      for (const marker of measured) {
        const group = groups.at(-1)
        if (group !== undefined && sharesVisualLine(marker.line, group.anchor)) {
          group.markers.push(marker)
        } else {
          groups.push({ anchor: marker.line, markers: [marker] })
        }
      }

      for (const group of groups) {
        group.markers.sort((left, right) => left.annotation.ordinal - right.annotation.ordinal)
        const lineCenter =
          group.markers.reduce((sum, marker) => sum + (marker.line.top + marker.line.bottom) / 2, 0) /
          group.markers.length
        const baseTop = Math.round(lineCenter - rootRect.top - 12)
        const lineRight = Math.max(...group.markers.map((marker) => marker.line.right))
        let groupLeft = Math.round(Math.max(minLeft, lineRight - rootRect.left + 5))
        while (
          group.markers.some((_, index) =>
            occupied.some(
              (position) =>
                Math.abs(position.top - baseTop) < 24 &&
                Math.abs(position.left - (groupLeft + index * 26)) < 24,
            ),
          )
        ) {
          groupLeft += 26
        }
        group.markers.forEach((marker, index) => {
          const position = Object.freeze({ top: baseTop, left: groupLeft + index * 26 })
          occupied.push(position)
          next.set(marker.annotation.annotationId, position)
        })
      }

      unresolved
        .sort((left, right) => left.annotation.ordinal - right.annotation.ordinal)
        .forEach(({ annotation, index }) => {
          const top = index * 30
          let left = Math.round(Math.max(minLeft, rootRect.width + 6))
          while (
            occupied.some(
              (position) => Math.abs(position.top - top) < 24 && Math.abs(position.left - left) < 24,
            )
          ) {
            left += 26
          }
          const position = Object.freeze({ top, left })
          occupied.push(position)
          next.set(annotation.annotationId, position)
        })

      setMarkerPositions((current) => (sameMarkerPositions(current, next) ? current : next))
    }

    measure()
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            measure()
          })
    resizeObserver?.observe(root)
    resizeObserver?.observe(body)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    document.addEventListener('toggle', measure, true)
    document.fonts?.addEventListener('loadingdone', measure)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      document.removeEventListener('toggle', measure, true)
      document.fonts?.removeEventListener('loadingdone', measure)
    }
  }, [annotations])

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
        setSelectionCopyStatus('idle')
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

  const copySelection = useCallback(async () => {
    if (selection === null) return
    let copied = false
    try {
      await navigator.clipboard.writeText(selection.quote.exact)
      copied = true
    } catch {
      const helper = document.createElement('textarea')
      helper.value = selection.quote.exact
      helper.setAttribute('readonly', '')
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.append(helper)
      helper.select()
      try {
        copied = document.execCommand('copy')
      } catch {
        copied = false
      } finally {
        helper.remove()
      }
    }
    setSelectionCopyStatus(copied ? 'copied' : 'failed')
  }, [selection])

  const selectionCopyLabel =
    selectionCopyStatus === 'copied'
      ? t('selection.copied')
      : selectionCopyStatus === 'failed'
        ? t('selection.copyFailed')
        : t('action.copy')

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
              <details
                key={`reasoning:${index}`}
                className="dia-assistant__reasoning"
                data-dsh-inline-annotation-ignore="true"
              >
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
        {data.status === 'interrupted' && (
          <p className="dia-warning" data-dsh-inline-annotation-ignore="true">
            {t('assistant.interrupted')}
          </p>
        )}
      </div>
      {selection !== null && (
        <div
          className="dia-selection-toolbar"
          role="toolbar"
          aria-label={t('selection.actions')}
          style={{
            top: Math.min(window.innerHeight - 48, selection.rect.bottom + 7),
            left: Math.max(8, Math.min(window.innerWidth - 168, selection.rect.left)),
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="dia-selection-action"
            onClick={() => {
              beginSelection(selection)
              setSelection(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            <MessageSquarePlus aria-hidden="true" size={14} strokeWidth={1.8} />
            {t('selection.add')}
          </button>
          <span className="dia-selection-divider" aria-hidden="true" />
          <button
            type="button"
            className="dia-selection-action dia-selection-action--icon"
            data-copy-status={selectionCopyStatus}
            aria-label={selectionCopyLabel}
            title={selectionCopyLabel}
            aria-live="polite"
            onClick={() => void copySelection()}
          >
            {selectionCopyStatus === 'copied' ? (
              <Check aria-hidden="true" size={14} strokeWidth={1.8} />
            ) : (
              <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
            )}
          </button>
        </div>
      )}
      {annotations.length > 0 && (
        <nav className="dia-markers" aria-label={t('list.title')}>
          {annotations.map((annotation) => (
            <button
              key={annotation.annotationId}
              type="button"
              className="dia-marker"
              data-status={annotation.status}
              data-active={annotation.annotationId === activeId}
              style={{
                top: markerPositions.get(annotation.annotationId)?.top ?? (annotation.ordinal - 1) * 30,
                left: markerPositions.get(annotation.annotationId)?.left ?? 'calc(100% + 6px)',
              }}
              title={annotation.comment}
              aria-label={`#${annotation.ordinal}: ${annotation.comment}`}
              onClick={() => openAnnotation(annotation.annotationId)}
            >
              <span>{annotation.ordinal}</span>
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
