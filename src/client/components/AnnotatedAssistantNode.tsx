import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DisclosureRow,
  IconThinkOutline14,
  JsonBlock,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  machineMarkerSpans,
  parseReplyMarkers,
  strippedOffset,
  stripMachineMarkers,
} from '../../shared/model-ack.ts'
import { replyHeadingNeedles } from '../../shared/protocol.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity, TextQuoteSelector } from '../../shared/types.ts'
import type { AssistantAnnotationProps } from '../contract.ts'
import { FOCUS_CHANGED_EVENT, isDuplicatedByFocusView, isFocusViewHidden } from '../focus-adapter.ts'
import {
  captureSelection,
  rangeFromSelector,
  selectableTextNodes,
  textBlockIndexOf,
  textOffsetAtPoint,
} from '../selection.ts'

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
      data-dsh-annotation-ignore="true"
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

function annotationKey(submissionId: string, annotationId: string): string {
  return `${submissionId}\u0000${annotationId}`
}

/** One validated reply marker target: where its "注解 N" heading should be overlaid. */
interface ReplyChipTarget {
  readonly key: string
  readonly annotation: AnnotationDraft
  readonly ordinal: number
  readonly start: number
  readonly length: number
}

function replyNeedle(ordinal: number): string {
  return `注解 ${ordinal}`
}

/**
 * Derive chip targets from raw model text. Only markers whose
 * submissionId+annotationId pair exists in the current Session survive;
 * unknown, duplicate, forged, and malformed markers are ignored and their
 * "注解 N"/"Annotation N" text stays plain Markdown.
 */
function buildReplyChipTargets(
  blocks: readonly { kind: string; text?: unknown }[],
  known: ReadonlyMap<string, AnnotationDraft>,
): readonly ReplyChipTarget[] {
  const targets: ReplyChipTarget[] = []
  const seen = new Set<string>()
  let joined = ''
  for (const block of blocks) {
    if (block.kind !== 'text' || typeof block.text !== 'string') continue
    const raw = block.text
    const markers = parseReplyMarkers(raw)
    const spans = machineMarkerSpans(raw)
    const stripped = stripMachineMarkers(raw)
    const blockStart = joined.length
    joined += stripped
    for (const marker of markers) {
      const key = annotationKey(marker.submissionId, marker.annotationId)
      const annotation = known.get(key)
      if (annotation === undefined || seen.has(key)) continue
      seen.add(key)
      const searchFrom = blockStart + strippedOffset(marker.offset, spans)
      let found: { start: number; length: number } | null = null
      for (const needle of replyHeadingNeedles(marker.ordinal)) {
        const index = joined.indexOf(needle, searchFrom)
        if (index >= 0) {
          found = { start: index, length: needle.length }
          break
        }
      }
      if (found === null) continue
      targets.push(
        Object.freeze({
          key,
          annotation,
          ordinal: marker.ordinal,
          start: found.start,
          length: found.length,
        }),
      )
    }
  }
  return Object.freeze(targets)
}

function selectorForTarget(target: ReplyChipTarget): TextQuoteSelector {
  return Object.freeze({
    exact: replyNeedle(target.ordinal),
    prefix: '',
    suffix: '',
    start: target.start,
    end: target.start + target.length,
  })
}

interface ReplyChipState {
  readonly key: string
  readonly annotation: AnnotationDraft
  readonly ordinal: number
  readonly top: number
  readonly left: number
  readonly viewportLeft: number
  readonly viewportTop: number
}

function sameReplyChips(left: readonly ReplyChipState[], right: readonly ReplyChipState[]): boolean {
  if (left.length !== right.length) return false
  return left.every(
    (chip, index) =>
      chip.key === right[index]?.key &&
      chip.top === right[index]?.top &&
      chip.left === right[index]?.left &&
      chip.viewportLeft === right[index]?.viewportLeft &&
      chip.viewportTop === right[index]?.viewportTop,
  )
}

type AnnotatedAssistantNodeProps = AssistantAnnotationProps & {
  /** 已有渲染器的输出；未传时保留原来的独立渲染能力，便于单独测试。 */
  readonly children?: ReactNode
}

/** 给已有助手消息渲染器套一层注解界面，不接管其正文渲染。 */
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
  children,
}: AnnotatedAssistantNodeProps) {
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
  const [replyChips, setReplyChips] = useState<readonly ReplyChipState[]>([])
  const [replyHover, setReplyHover] = useState<ReplyChipState | null>(null)
  const [selectionBar, setSelectionBar] = useState<{
    readonly capture: ReturnType<typeof captureSelection>
  } | null>(null)
  const [domRevision, setDomRevision] = useState(0)
  const [focusDuplicated, setFocusDuplicated] = useState(false)
  const selectionBarRef = useRef<HTMLDivElement>(null)
  const data = node.data
  const messageId = data.finalNode?.messageId as unknown as MessageIdentity | undefined
  const messageSeq = data.finalNode?.seq

  // dsh-focus-chat 聚焦切换：重新测量标记与芯片；普通视图的重复节点暂停展示。
  useEffect(() => {
    const onFocusChanged = () => setDomRevision((value) => value + 1)
    window.addEventListener(FOCUS_CHANGED_EVENT, onFocusChanged)
    return () => window.removeEventListener(FOCUS_CHANGED_EVENT, onFocusChanged)
  }, [])
  useEffect(() => {
    setFocusDuplicated(isDuplicatedByFocusView(rootRef.current ?? document.body))
  }, [domRevision, messageId])
  const annotations = useAnnotations(
    (view) =>
      messageId === undefined ? [] : view.annotations.filter((item) => item.messageId === messageId),
    sameAnnotations,
  )
  const allAnnotations = useAnnotations((view) => view.annotations, sameAnnotations)
  const knownSubmissions = useMemo(
    () =>
      new Map(
        allAnnotations
          .filter((item) => item.submissionId !== undefined)
          .map((item) => [annotationKey(item.submissionId as string, item.annotationId), item] as const),
      ),
    [allAnnotations],
  )
  const replyTargets = useMemo(
    () => buildReplyChipTargets(data.blocks, knownSubmissions),
    [data.blocks, knownSubmissions],
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
    const body = bodyRef.current
    if (body === null || messageId === undefined || typeof MutationObserver === 'undefined') {
      return undefined
    }
    let frame: number | null = null
    const observer = new MutationObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setDomRevision((value) => value + 1)
      })
    })
    observer.observe(body, { childList: true, characterData: true, subtree: true })
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [messageId])

  useLayoutEffect(() => {
    if (revealRequest === null) return
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || messageId === undefined) {
      setRevealRequest(null)
      return
    }
    const annotation = annotations.find((item) => item.annotationId === revealRequest.annotationId)
    const measure = (): { line: VisualLine | null; range: Range | null } => {
      const range = annotation === undefined ? null : rangeFromSelector(body, annotation.quote)
      const rangeLine = range === null ? null : completeFinalLine(selectableTextNodes(body), range)
      const marker = Array.from(root.querySelectorAll<HTMLElement>('.dia-marker')).find(
        (candidate) => candidate.dataset.annotationId === revealRequest.annotationId,
      )
      const markerRect = marker?.getBoundingClientRect()
      const line =
        rangeLine ??
        (markerRect === undefined || markerRect.height <= 0 ? null : visualLineFromRect(markerRect))
      return { line, range }
    }
    const settle = (line: VisualLine | null, range: Range | null) => {
      if (line === null) root.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' })
      else centerVisualLine(root, line)
      activateHighlight(messageId, range)
      setRevealRequest(null)
      setFlash(false)
      requestAnimationFrame(() => setFlash(true))
      root.focus({ preventScroll: true })
    }
    const first = measure()
    if (first.line !== null) {
      settle(first.line, first.range)
      return
    }
    // 目标行尚未参与布局（滚动区外的懒渲染或 content-visibility 节点）：
    // 先把整条回复滚入视口，等一帧渲染完成后再重新测量并居中。
    root.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' })
    let cancelled = false
    let retryFrame = requestAnimationFrame(() => {
      if (cancelled) return
      const retry = measure()
      settle(retry.line, retry.range)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(retryFrame)
    }
  }, [activateHighlight, annotations, messageId, revealRequest])

  const annotateAll = useCallback(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || messageSeq === undefined) return
    const range = document.createRange()
    range.selectNodeContents(body)
    try {
      const capture = captureSelection(body, range, messageId, messageSeq)
      const blockIndex = textBlockIndexOf(data.blocks, capture.quote.start)
      beginSelection(blockIndex === undefined ? capture : { ...capture, blockIndex })
    } catch {
      // An assistant with only images or tool calls has no text annotation target.
    }
  }, [beginSelection, data.blocks, messageId, messageSeq])

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
  }, [
    activeId,
    activateHighlight,
    annotations,
    domRevision,
    messageId,
    removeHighlights,
    updateHighlightRanges,
  ])

  useLayoutEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || annotations.length === 0) {
      setMarkerPositions((current) => (current.size === 0 ? current : new Map()))
      return undefined
    }
    if (isFocusViewHidden(root)) {
      // 聚焦模式下被隐藏或懒渲染的节点不参与位置计算。
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
  }, [data.blocks, domRevision, geometryKey, markerGutter])

  /** Overlay one React chip over each validated "注解 N"/"Annotation N" heading once streaming settles. */
  useLayoutEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || messageId === undefined || data.status === 'running') {
      setReplyChips((current) => (current.length === 0 ? current : []))
      return undefined
    }
    if (isFocusViewHidden(root)) {
      // 聚焦模式下被隐藏的节点暂停芯片测量，恢复后重新测量。
      setReplyChips((current) => (current.length === 0 ? current : []))
      return undefined
    }
    if (replyTargets.length === 0) {
      setReplyChips((current) => (current.length === 0 ? current : []))
      return undefined
    }
    let frame: number | null = null
    const measure = () => {
      const rootRect = root.getBoundingClientRect()
      const scaleX = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1
      const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
      const next: ReplyChipState[] = []
      for (const target of replyTargets) {
        const range = rangeFromSelector(body, selectorForTarget(target))
        const rect = range === null ? null : finalVisibleRect(range)
        if (rect === null) continue
        next.push(
          Object.freeze({
            key: target.key,
            annotation: target.annotation,
            ordinal: target.ordinal,
            top: Math.round((rect.top - rootRect.top) / scaleY),
            left: Math.round((rect.left - rootRect.left) / scaleX),
            viewportLeft: rect.left,
            viewportTop: rect.bottom + 6,
          }),
        )
      }
      setReplyChips((current) => (sameReplyChips(current, next) ? current : next))
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
  }, [data.status, domRevision, messageId, replyTargets])

  useEffect(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || messageSeq === undefined) return undefined
    const capture = () => {
      const selected = window.getSelection()
      if (selected === null || selected.rangeCount === 0 || selected.isCollapsed) return
      const range = selected.getRangeAt(0)
      if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return
      try {
        const capture = captureSelection(body, range, messageId, messageSeq)
        const blockIndex = textBlockIndexOf(data.blocks, capture.quote.start)
        setSelectionBar({
          capture: blockIndex === undefined ? capture : { ...capture, blockIndex },
        })
      } catch {
        // Selections crossing ignored or non-text content do not offer the selection bar.
      }
    }
    // A selection drag can be released anywhere in the page, so pointerup is observed on the
    // document in the capture phase; the range checks below keep the bar per-message. keyup
    // always fires on the focused element inside the body that owns the keyboard selection.
    document.addEventListener('pointerup', capture, true)
    body.addEventListener('keyup', capture)
    return () => {
      document.removeEventListener('pointerup', capture, true)
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
      className={`dia-assistant${children === undefined ? '' : ' dia-assistant--decorator'}${flash ? ' dia-flash' : ''}`}
      tabIndex={-1}
      data-dsh-annotation-message-id={messageId}
    >
      <div
        ref={bodyRef}
        className="dia-assistant__body"
        style={markerGutter === 0 ? undefined : { paddingRight: markerGutter }}
        onPointerMove={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-dsh-annotation-ignore="true"]') !== null
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
            event.target.closest('[data-dsh-annotation-ignore="true"]') !== null
          ) {
            return
          }
          if (!window.getSelection()?.isCollapsed) return
          const annotation = inspectPoint(event.clientX, event.clientY)
          if (annotation !== undefined) openAnnotation(annotation.annotationId)
        }}
      >
        {children ??
          data.blocks.map((block, index) => {
            if (block.kind === 'text')
              return (
                <MarkdownText
                  key={`text:${index}`}
                  text={stripMachineMarkers(block.text)}
                  streaming={data.status === 'running'}
                  codeLabels={codeLabels}
                  fileMentions={mentions}
                />
              )
            if (block.kind === 'reasoning')
              return (
                <AnnotationReasoningRow
                  key={`reasoning:${index}`}
                  text={stripMachineMarkers(block.text)}
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
        {children === undefined && data.status === 'interrupted' && (
          <span className="dia-assistant__stopped" data-dsh-annotation-ignore="true">
            {t('assistant.interrupted')}
          </span>
        )}
      </div>
      {!focusDuplicated && annotations.length > 0 && (
        <nav className="dia-markers" aria-label={t('list.title')}>
          {annotations.map((annotation) => (
            <Tooltip
              key={annotation.annotationId}
              label={annotation.annotation === '' ? t('highlightOnly') : annotation.annotation}
              side="top"
              delayMs={300}
            >
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
                aria-label={`#${annotation.ordinal}: ${annotation.annotation === '' ? t('highlightOnly') : annotation.annotation}`}
                onClick={() => openAnnotation(annotation.annotationId)}
              >
                <span>{annotation.ordinal}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
      )}
      {!focusDuplicated && replyChips.length > 0 && (
        <nav className="dia-reply-chips">
          {replyChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="dia-reply-chip"
              style={{ top: chip.top, left: chip.left }}
              aria-label={t('reply.chipLabel', {
                ordinal: chip.ordinal,
                quote: chip.annotation.quote.exact,
                annotation:
                  chip.annotation.annotation === '' ? t('highlightOnly') : chip.annotation.annotation,
              })}
              onPointerEnter={() => setReplyHover(chip)}
              onPointerLeave={() => setReplyHover(null)}
              onFocus={() => setReplyHover(chip)}
              onBlur={() => setReplyHover(null)}
              onClick={() => openAnnotation(chip.annotation.annotationId)}
            >
              {t('reply.chip', { ordinal: chip.ordinal })}
            </button>
          ))}
        </nav>
      )}
      {replyHover !== null && (
        <aside
          className="dia-hover dia-reply-popover"
          style={{
            left: Math.max(12, Math.min(replyHover.viewportLeft, window.innerWidth - 320)),
            top: Math.min(replyHover.viewportTop, window.innerHeight - 120),
          }}
        >
          <strong>{t('reply.chip', { ordinal: replyHover.ordinal })}</strong>
          <q>{replyHover.annotation.quote.exact}</q>
          <p data-highlight-only={replyHover.annotation.kind === 'highlight-only' ? 'true' : undefined}>
            {replyHover.annotation.annotation === '' ? t('highlightOnly') : replyHover.annotation.annotation}
          </p>
        </aside>
      )}
      {hover !== null && (
        <aside className="dia-hover" style={{ left: hover.x, top: hover.y }}>
          <strong>#{hover.annotation.ordinal}</strong>{' '}
          {hover.annotation.annotation === '' ? t('highlightOnly') : hover.annotation.annotation}
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
