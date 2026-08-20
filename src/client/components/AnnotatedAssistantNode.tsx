import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DisclosureRow,
  IconThinkOutline14,
  JsonBlock,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

function AnnotationReasoningRow({
  text,
  running,
  t,
}: {
  text: string
  running: boolean
  t: AssistantAnnotationProps['t']
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)

  useLayoutEffect(() => {
    const element = summaryRef.current
    if (element !== null) element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  }, [running, summary])

  const toggle = () => {
    setOpen((value) => !value)
    rootRef.current?.dispatchEvent(new Event('toggle', { bubbles: true }))
  }

  return (
    <div
      ref={rootRef}
      className="dia-assistant__reasoning"
      data-state={running ? 'running' : 'ok'}
      data-dsh-inline-comment-ignore="true"
    >
      <DisclosureRow
        rowClassName="dia-assistant__reasoning-row"
        leadingClassName="dia-assistant__reasoning-leading"
        titleClassName="dia-assistant__reasoning-title"
        chevronClassName="dia-assistant__reasoning-chevron"
        icon={<IconThinkOutline14 size={14} />}
        title={t('assistant.reasoning')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={toggle}
        collapsedContent={
          <>
            <span className="dia-assistant__reasoning-separator" aria-hidden="true" />
            <span
              ref={summaryRef}
              className="dia-assistant__reasoning-summary"
              data-follow-end={running || undefined}
            >
              {summary}
            </span>
          </>
        }
      >
        <div className="dia-assistant__reasoning-body">{text}</div>
      </DisclosureRow>
    </div>
  )
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

function scrollContainer(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current !== null && current !== document.body && current !== document.documentElement) {
    const overflowY = window.getComputedStyle(current).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return null
}

function preferredScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}

function visualLineFromRect(rect: DOMRect): VisualLine {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height }
}

function centerVisualLine(element: HTMLElement, line: VisualLine): void {
  const lineCenter = (line.top + line.bottom) / 2
  const behavior = preferredScrollBehavior()
  const container = scrollContainer(element)
  if (container !== null) {
    const bounds = container.getBoundingClientRect()
    const viewportTop = window.visualViewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight)
    const visibleTop = Math.max(bounds.top, viewportTop)
    const visibleBottom = Math.min(bounds.bottom, viewportBottom)
    const visualDelta = lineCenter - (visibleTop + visibleBottom) / 2
    const scale = container.offsetHeight > 0 ? bounds.height / container.offsetHeight : 1
    container.scrollBy({ top: visualDelta / (scale > 0 ? scale : 1), behavior })
    return
  }
  const viewportTop = window.visualViewport?.offsetTop ?? 0
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const root = document.documentElement
  const rootBounds = root.getBoundingClientRect()
  const scale = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
  const visualDelta = lineCenter - (viewportTop + viewportHeight / 2)
  window.scrollBy({ top: visualDelta / (scale > 0 ? scale : 1), behavior })
}

/** Full replacement renderer required because DSH exposes no slot inside assistant Markdown. */
export const AnnotatedAssistantNode = memo(function AnnotatedAssistantNode({
  node,
  useTurnData,
  openFile,
  renderMessageImages,
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
  const [markerPositions, setMarkerPositions] = useState<ReadonlyMap<AnnotationId, MarkerPosition>>(
    () => new Map(),
  )
  const [markerGutterState, setMarkerGutterState] = useState<{ key: string; width: number }>({
    key: '',
    width: 0,
  })
  const [flash, setFlash] = useState(false)
  const [revealRequest, setRevealRequest] = useState<{ annotationId: AnnotationId } | null>(null)
  const [hover, setHover] = useState<{ annotation: AnnotationDraft; x: number; y: number } | null>(null)
  const [selectionBar, setSelectionBar] = useState<{
    readonly capture: ReturnType<typeof captureSelection>
  } | null>(null)
  const selectionBarRef = useRef<HTMLDivElement>(null)
  const data = node.data
  const messageId = data.finalNode?.messageId as unknown as MessageIdentity | undefined
  const messageSeq = data.finalNode?.seq
  const annotations = useAnnotations(
    (view) =>
      messageId === undefined ? [] : view.annotations.filter((item) => item.messageId === messageId),
    sameAnnotations,
  )
  const activeId = useAnnotations((view) => view.activeAnnotationId)
  const geometryKey = useMemo(
    () =>
      annotations
        .map(
          (item) =>
            `${item.annotationId}:${item.ordinal}:${item.quote.start}:${item.quote.end}:${item.quote.exact}`,
        )
        .join('|'),
    [annotations],
  )
  const markerGutter = markerGutterState.key === geometryKey ? markerGutterState.width : 0
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

  const reveal = useCallback((annotationId: AnnotationId) => {
    setRevealRequest({ annotationId })
  }, [])

  useLayoutEffect(() => {
    if (revealRequest === null) return
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || messageId === undefined) {
      setRevealRequest(null)
      return
    }
    const annotation = annotations.find((item) => item.annotationId === revealRequest.annotationId)
    const range = annotation === undefined ? null : rangeFromSelector(body, annotation.quote)
    const rangeLine = range === null ? null : completeFinalLine(selectableTextNodes(body), range)
    const marker = Array.from(root.querySelectorAll<HTMLElement>('.dia-marker')).find(
      (candidate) => candidate.dataset.annotationId === revealRequest.annotationId,
    )
    const markerRect = marker?.getBoundingClientRect()
    const line =
      rangeLine ??
      (markerRect === undefined || markerRect.height <= 0 ? null : visualLineFromRect(markerRect))
    if (line === null) root.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' })
    else centerVisualLine(root, line)
    activateHighlight(messageId, range)
    setRevealRequest(null)
    setFlash(false)
    requestAnimationFrame(() => setFlash(true))
    root.focus({ preventScroll: true })
  }, [activateHighlight, annotations, messageId, revealRequest])

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

    const textNodes = selectableTextNodes(body)
    let frame: number | null = null
    const measure = () => {
      const rootRect = root.getBoundingClientRect()
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const rootWidth = root.offsetWidth > 0 ? root.offsetWidth : rootRect.width
      const scaleX = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1
      const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
      const minLeft = (viewportLeft - rootRect.left) / scaleX + 4
      const maxColumns = Math.max(1, Math.min(4, Math.floor(Math.max(26, rootWidth * 0.34) / 26)))
      const maxAllowedGutter = maxColumns * 26 + 7
      const occupied: MarkerPosition[] = []
      const next = new Map<AnnotationId, MarkerPosition>()
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
        if (group !== undefined && sharesVisualLine(marker.line, group.anchor)) group.markers.push(marker)
        else groups.push({ anchor: marker.line, markers: [marker] })
      }

      const widestGroup = Math.max(1, unresolved.length, ...groups.map((group) => group.markers.length))
      const requiredGutter = Math.min(widestGroup, maxColumns) * 26 + 7
      if (markerGutter > maxAllowedGutter || markerGutter < requiredGutter) {
        setMarkerGutterState({
          key: geometryKey,
          width: markerGutter > maxAllowedGutter ? maxAllowedGutter : requiredGutter,
        })
        return
      }

      const rootRight = Math.min(rootWidth - 28, (viewportLeft + viewportWidth - rootRect.left) / scaleX - 28)
      for (const group of groups) {
        group.markers.sort((left, right) => left.annotation.ordinal - right.annotation.ordinal)
        const columns = Math.min(group.markers.length, maxColumns)
        const lineCenter =
          group.markers.reduce((sum, marker) => sum + (marker.line.top + marker.line.bottom) / 2, 0) /
          group.markers.length
        const baseTop = Math.round((lineCenter - rootRect.top) / scaleY - 12)
        const lineRight = Math.max(...group.markers.map((marker) => marker.line.right))
        const groupWidth = (columns - 1) * 26 + 24
        let groupLeft = Math.round(
          Math.max(minLeft, Math.min((lineRight - rootRect.left) / scaleX + 5, rootRight - groupWidth + 24)),
        )
        while (
          group.markers.some((_, index) => {
            const row = Math.floor(index / columns)
            const column = index % columns
            return occupied.some(
              (position) =>
                Math.abs(position.top - (baseTop + row * 26)) < 24 &&
                Math.abs(position.left - (groupLeft + column * 26)) < 24,
            )
          }) &&
          groupLeft + groupWidth + 26 <= rootRight + 24
        ) {
          groupLeft += 26
        }
        group.markers.forEach((marker, index) => {
          const position = Object.freeze({
            top: baseTop + Math.floor(index / columns) * 26,
            left: groupLeft + (index % columns) * 26,
          })
          occupied.push(position)
          next.set(marker.annotation.annotationId, position)
        })
      }

      const unresolvedColumns = Math.min(Math.max(1, unresolved.length), maxColumns)
      const unresolvedLeft = Math.max(
        minLeft,
        Math.min(rootWidth - markerGutter + 5, rootRight - (unresolvedColumns - 1) * 26),
      )
      unresolved
        .sort((left, right) => left.annotation.ordinal - right.annotation.ordinal)
        .forEach(({ annotation }, index) => {
          const position = Object.freeze({
            top: Math.floor(index / unresolvedColumns) * 30,
            left: unresolvedLeft + (index % unresolvedColumns) * 26,
          })
          occupied.push(position)
          next.set(annotation.annotationId, position)
        })

      setMarkerPositions((current) => (sameMarkerPositions(current, next) ? current : next))
    }
    const scheduleMeasure = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        measure()
      })
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    resizeObserver?.observe(root)
    resizeObserver?.observe(body)
    window.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    document.addEventListener('toggle', scheduleMeasure, true)
    document.fonts?.addEventListener('loadingdone', scheduleMeasure)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      document.removeEventListener('toggle', scheduleMeasure, true)
      document.fonts?.removeEventListener('loadingdone', scheduleMeasure)
    }
  }, [data.blocks, geometryKey, markerGutter])

  useEffect(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || messageSeq === undefined) return undefined
    const capture = () => {
      const selected = window.getSelection()
      if (selected === null || selected.rangeCount === 0 || selected.isCollapsed) return
      const range = selected.getRangeAt(0)
      if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return
      try {
        setSelectionBar({ capture: captureSelection(body, range, messageId, messageSeq) })
      } catch {
        // Selections crossing ignored or non-text content do not offer the selection bar.
      }
    }
    body.addEventListener('pointerup', capture)
    body.addEventListener('keyup', capture)
    return () => {
      body.removeEventListener('pointerup', capture)
      body.removeEventListener('keyup', capture)
    }
  }, [messageId, messageSeq])

  const selectionBarActive = selectionBar !== null
  useEffect(() => {
    if (!selectionBarActive) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && selectionBarRef.current?.contains(event.target) === true) return
      setSelectionBar(null)
    }
    const onSelectionChange = () => {
      const selected = window.getSelection()
      if (selected === null || selected.rangeCount === 0 || selected.isCollapsed) setSelectionBar(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionBar(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [selectionBarActive])

  const inspectPoint = (x: number, y: number): AnnotationDraft | undefined => {
    const body = bodyRef.current
    return body === null ? undefined : annotationAtOffset(annotations, textOffsetAtPoint(body, x, y))
  }

  const copySelectionText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setSelectionBar(null)
    } catch {
      // Clipboard write denied or unavailable: keep the bar open so Ctrl+C remains usable.
    }
  }, [])

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
        style={markerGutter === 0 ? undefined : { paddingRight: markerGutter }}
        onPointerMove={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-dsh-inline-comment-ignore="true"]') !== null
          ) {
            setHover(null)
            return
          }
          const annotation = inspectPoint(event.clientX, event.clientY)
          setHover(
            annotation === undefined ? null : { annotation, x: event.clientX + 12, y: event.clientY + 12 },
          )
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-dsh-inline-comment-ignore="true"]') !== null
          ) {
            return
          }
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
              <AnnotationReasoningRow
                key={`reasoning:${index}`}
                text={stripModelAcknowledgementMarkers(block.text)}
                running={data.status === 'running' && index === data.blocks.length - 1}
                t={t}
              />
            )
          if (block.kind === 'image') {
            const previous = data.blocks[index - 1]
            if (previous !== undefined && previous.kind === 'image') return null
            const group: Array<{ attachment: typeof block.attachment }> = []
            for (let cursor = index; cursor < data.blocks.length; cursor += 1) {
              const current = data.blocks[cursor]
              if (current?.kind !== 'image') break
              group.push({ attachment: current.attachment })
            }
            return (
              <Fragment key={`image:${block.attachment.attachmentId}:${index}`}>
                {renderMessageImages({ images: group, align: 'start' })}
              </Fragment>
            )
          }
          if (block.kind === 'other')
            return (
              <JsonBlock
                key={`other:${index}`}
                label={t('assistant.other')}
                payload={block.block}
                truncatedLabel={(total) => t('json.truncated', { total })}
              />
            )
          return null
        })}
        {data.status === 'interrupted' && (
          <span className="dia-assistant__stopped" data-dsh-inline-comment-ignore="true">
            {t('assistant.interrupted')}
          </span>
        )}
      </div>
      {annotations.length > 0 && (
        <nav className="dia-markers" aria-label={t('list.title')}>
          {annotations.map((annotation) => (
            <Tooltip key={annotation.annotationId} label={annotation.comment} side="top" delayMs={300}>
              <button
                type="button"
                className="dia-marker"
                data-annotation-id={annotation.annotationId}
                data-status={annotation.status}
                data-active={annotation.annotationId === activeId}
                style={{
                  top: markerPositions.get(annotation.annotationId)?.top ?? (annotation.ordinal - 1) * 30,
                  left: markerPositions.get(annotation.annotationId)?.left ?? 'calc(100% + 6px)',
                }}
                aria-label={`#${annotation.ordinal}: ${annotation.comment}`}
                onClick={() => openAnnotation(annotation.annotationId)}
              >
                <span>{annotation.ordinal}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
      )}
      {hover !== null && (
        <aside className="dia-hover" style={{ left: hover.x, top: hover.y }}>
          <strong>#{hover.annotation.ordinal}</strong> {hover.annotation.comment}
        </aside>
      )}
      {selectionBar !== null && (
        <div
          ref={selectionBarRef}
          className="dia-selection-bar"
          role="toolbar"
          aria-label={t('selection.toolbar')}
          style={{
            left: Math.max(12, Math.min(selectionBar.capture.rect.left, window.innerWidth - 212)),
            top: Math.max(12, Math.min(selectionBar.capture.rect.bottom + 8, window.innerHeight - 44)),
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="dia-selection-bar__action"
            onClick={() => {
              beginSelection(selectionBar.capture)
              setSelectionBar(null)
            }}
          >
            {t('selection.annotate')}
          </button>
          <button
            type="button"
            className="dia-selection-bar__action"
            onClick={() => {
              void copySelectionText(selectionBar.capture.quote.exact)
            }}
          >
            {t('selection.copy')}
          </button>
        </div>
      )}
    </section>
  )
})
