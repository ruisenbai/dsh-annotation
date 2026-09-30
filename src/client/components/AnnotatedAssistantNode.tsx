import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { parseReplyMarkers, stripMachineMarkers } from '../../shared/model-ack.ts'
import { replyHeadingNeedles } from '../../shared/protocol.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity, TextQuoteSelector } from '../../shared/types.ts'
import type { AssistantAnnotationProps } from '../contract.ts'
import { FOCUS_CHANGED_EVENT, isDuplicatedByFocusView, isFocusViewHidden } from '../focus-adapter.ts'
import { markerElement, useAnnotationFloating } from '../floating.ts'
import { layoutMarkers, sameMarkerLayout, type MarkerLayout, type MarkerRect } from '../marker-layout.ts'
import { buildTextIndex, captureSelection, rangeFromSelector, textBlockIndexOf } from '../selection.ts'
import type { TextIndex } from '../selection.ts'
import { SelectionAction } from './SelectionAction.tsx'
import { AnnotationMarkerButton } from './AnnotationMarkerButton.tsx'

function sameAnnotations(left: readonly AnnotationDraft[], right: readonly AnnotationDraft[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function previewText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}

function markerBounds(root: HTMLElement, rootRect: DOMRect, scaleX: number): MarkerRect {
  const viewport = window.visualViewport
  let left = viewport?.offsetLeft ?? 0
  let right = left + (viewport?.width ?? window.innerWidth)
  let top = viewport?.offsetTop ?? 0
  let bottom = top + (viewport?.height ?? window.innerHeight)
  for (let element: HTMLElement | null = root; element !== null; element = element.parentElement) {
    const style = window.getComputedStyle(element)
    const clipX = /(auto|scroll|hidden|clip|overlay)/.test(style.overflowX || style.overflow)
    const clipY = /(auto|scroll|hidden|clip|overlay)/.test(style.overflowY || style.overflow)
    if (!clipX && !clipY) continue
    const rect = element.getBoundingClientRect()
    const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
    const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
    const startX = rect.left + element.clientLeft * scaleX
    const startY = rect.top + element.clientTop * scaleY
    if (clipX) {
      left = Math.max(left, startX)
      right = Math.min(right, element.clientWidth > 0 ? startX + element.clientWidth * scaleX : rect.right)
    }
    if (clipY) {
      top = Math.max(top, startY)
      bottom = Math.min(
        bottom,
        element.clientHeight > 0 ? startY + element.clientHeight * scaleY : rect.bottom,
      )
    }
  }
  const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
  return {
    left: (left - rootRect.left) / scaleX + 4,
    right: (right - rootRect.left) / scaleX - 4,
    top: (top - rootRect.top) / scaleY + 4,
    bottom: (bottom - rootRect.top) / scaleY - 4,
  }
}

function visibleRangeRects(range: Range): DOMRect[] {
  return typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
    : []
}

function finalVisibleRect(range: Range): DOMRect | null {
  const finalLine = visibleRangeRects(range).at(-1)
  if (finalLine !== undefined) return finalLine
  if (typeof range.getBoundingClientRect !== 'function') return null
  const bounds = range.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 ? bounds : null
}

function finalVisibleCharacterRect(range: Range, textNodes: readonly Text[]): DOMRect | null {
  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    const node = textNodes[index]!
    if (!range.intersectsNode(node)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    for (let offset = end - 1; offset >= start; offset -= 1) {
      if (/\s/u.test(node.data[offset] ?? '')) continue
      const character = document.createRange()
      character.setStart(node, offset)
      character.setEnd(node, offset + 1)
      const rect = finalVisibleRect(character)
      if (rect !== null) return rect
    }
  }
  return finalVisibleRect(range)
}

interface VisualLine {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly height: number
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

function quoteVisualBounds(range: Range): VisualLine | null {
  const rects = visibleRangeRects(range)
  if (rects.length === 0) {
    const bounds = finalVisibleRect(range)
    return bounds === null ? null : visualLineFromRect(bounds)
  }
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return { top, right, bottom, height: bottom - top }
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

interface QuoteFlashRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

interface QuoteFlashState {
  readonly id: number
  readonly navigationEpoch: number
  readonly rects: readonly QuoteFlashRect[]
}

const QUOTE_FLASH_MS = 1_300

function quoteFlashRects(root: HTMLElement, range: Range): readonly QuoteFlashRect[] {
  const rootRect = root.getBoundingClientRect()
  const scaleX = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1
  const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
  const visible = visibleRangeRects(range)
  const fallback = visible.length === 0 ? finalVisibleRect(range) : null
  const rects = fallback === null ? visible : [fallback]
  return rects.map((rect) => ({
    top: (rect.top - rootRect.top) / scaleY,
    left: (rect.left - rootRect.left) / scaleX,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  }))
}

function annotationKey(submissionId: string, annotationId: string): string {
  return `${submissionId}\u0000${annotationId}`
}

/** A validated association whose original heading remains owned by the Markdown renderer. */
interface ReplyChipTarget {
  readonly key: string
  readonly annotation: AnnotationDraft
  readonly ordinal: number
  readonly start: number
  readonly text: string
  readonly occurrence: number
}

function completeHeadingStarts(text: string, heading: string, from = 0, until = text.length): number[] {
  const starts: number[] = []
  for (
    let start = text.indexOf(heading, from);
    start >= 0 && start < until;
    start = text.indexOf(heading, start + heading.length)
  ) {
    const before = text[start - 1] ?? ''
    const after = text.slice(start + heading.length, until)
    if (/\p{L}|\p{N}|_/u.test(before) || !/^\s*(?:[*_]{1,3})?\s*[:：]/u.test(after)) continue
    starts.push(start)
  }
  return starts
}

function displayedPrefixLength(raw: string, rawOffset: number): number {
  return stripMachineMarkers(raw.slice(0, rawOffset)).length
}

/** Unknown or duplicate associations leave their headings as ordinary Markdown. */
function buildReplyChipTargets(
  blocks: readonly { kind: string; text?: unknown }[],
  known: ReadonlyMap<string, AnnotationDraft>,
): readonly ReplyChipTarget[] {
  const targets: Omit<ReplyChipTarget, 'occurrence'>[] = []
  const seen = new Set<string>()
  let joined = ''
  for (const block of blocks) {
    if (block.kind !== 'text' || typeof block.text !== 'string') continue
    const raw = block.text
    const markers = parseReplyMarkers(raw)
    const stripped = stripMachineMarkers(raw)
    const blockStart = joined.length
    joined += stripped
    for (const [markerIndex, marker] of markers.entries()) {
      const key = annotationKey(marker.submissionId, marker.annotationId)
      const annotation = known.get(key)
      if (annotation === undefined || seen.has(key)) continue
      seen.add(key)
      const searchFrom = blockStart + displayedPrefixLength(raw, marker.offset)
      const nextMarker = markers[markerIndex + 1]
      const searchUntil =
        nextMarker === undefined ? joined.length : blockStart + displayedPrefixLength(raw, nextMarker.offset)
      const candidates = replyHeadingNeedles(marker.ordinal)
        .map((text) => ({ text, starts: completeHeadingStarts(joined, text, searchFrom, searchUntil) }))
        .filter((candidate) => candidate.starts.length > 0)
        .sort((left, right) => left.starts[0]! - right.starts[0]!)
      const nearest = candidates[0]
      if (nearest?.starts.length === 1) {
        targets.push({
          key,
          annotation,
          ordinal: marker.ordinal,
          start: nearest.starts[0]!,
          text: nearest.text,
        })
      }
    }
  }
  return targets.flatMap((target) => {
    const occurrence = completeHeadingStarts(joined, target.text).indexOf(target.start)
    return occurrence < 0 ? [] : [{ ...target, occurrence }]
  })
}

function selectorForTarget(target: ReplyChipTarget): TextQuoteSelector {
  return {
    exact: target.text,
    prefix: '',
    suffix: '',
    start: target.start,
    end: target.start + target.text.length,
  }
}

interface ReplyChipState {
  readonly key: string
  readonly annotation: AnnotationDraft
  readonly ordinal: number
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly fragments: readonly {
    readonly top: number
    readonly left: number
    readonly width: number
    readonly height: number
  }[]
}

function sameReplyChips(left: readonly ReplyChipState[], right: readonly ReplyChipState[]): boolean {
  return (
    left.length === right.length &&
    left.every((chip, index) => {
      const other = right[index]!
      return (
        chip.key === other.key &&
        chip.annotation === other.annotation &&
        chip.top === other.top &&
        chip.left === other.left &&
        chip.width === other.width &&
        chip.height === other.height &&
        chip.fragments.length === other.fragments.length &&
        chip.fragments.every((fragment, fragmentIndex) => {
          const previous = other.fragments[fragmentIndex]!
          return (
            fragment.top === previous.top &&
            fragment.left === previous.left &&
            fragment.width === previous.width &&
            fragment.height === previous.height
          )
        })
      )
    })
  )
}

type AnnotatedAssistantNodeProps = AssistantAnnotationProps & {
  /** Rendered output from the selected Host assistant renderer. */
  readonly children: ReactElement
}

/** 给已有助手消息渲染器套一层注解界面，不接管其正文渲染。 */
export const AnnotatedAssistantNode = memo(function AnnotatedAssistantNode({
  node,
  turnProcess,
  useAnnotations,
  beginSelection,
  openAnnotation,
  navigate,
  registerEndpoint,
  updateHighlightRanges,
  activateHighlight,
  removeHighlights,
  t,
  children,
}: AnnotatedAssistantNodeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textIndexRef = useRef<TextIndex | null>(null)
  const currentTextIndex = useCallback((body: HTMLElement): TextIndex => {
    const cached = textIndexRef.current
    if (cached?.isCurrent(body)) return cached
    const next = buildTextIndex(body)
    textIndexRef.current = next
    return next
  }, [])
  const [markerLayout, setMarkerLayout] = useState<MarkerLayout>({ groups: [], overflow: [] })
  const [quoteFlash, setQuoteFlash] = useState<QuoteFlashState | null>(null)
  const quoteFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteFlashId = useRef(0)
  const quoteFlashNavigationEpoch = useRef<number | null>(null)
  const [revealRequest, setRevealRequest] = useState<{
    annotationId: AnnotationId
    navigationEpoch: number
  } | null>(null)
  const [replyChips, setReplyChips] = useState<readonly ReplyChipState[]>([])
  const [replyHover, setReplyHover] = useState<ReplyChipState | null>(null)
  const replyNodes = useRef(new Map<string, HTMLButtonElement>())
  const replyPreviewRef = useRef<HTMLElement>(null)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replyPointerKey = useRef<string | null>(null)
  const replyFloating = useAnnotationFloating({
    floatingRef: replyPreviewRef,
    anchor: () => (replyHover === null ? null : (replyNodes.current.get(replyHover.key) ?? null)),
    enabled: replyHover !== null,
  })
  const clearReplyPreview = useCallback(() => {
    if (replyTimer.current !== null) clearTimeout(replyTimer.current)
    replyTimer.current = null
    replyPointerKey.current = null
    setReplyHover(null)
  }, [])
  useEffect(
    () => () => {
      if (replyTimer.current !== null) clearTimeout(replyTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (replyHover === null) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearReplyPreview()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [clearReplyPreview, replyHover])
  const [selectionBar, setSelectionBar] = useState<{
    readonly capture: ReturnType<typeof captureSelection>
  } | null>(null)
  const [domRevision, setDomRevision] = useState(0)
  const [focusDuplicated, setFocusDuplicated] = useState(false)
  const selectionBarRef = useRef<HTMLDivElement>(null)
  const data = node.data
  const messageId = data.finalNode?.messageId as unknown as MessageIdentity | undefined
  const messageSeq = data.finalNode?.seq

  useLayoutEffect(() => {
    textIndexRef.current?.invalidate()
    textIndexRef.current = null
  }, [data.blocks, messageId])
  useEffect(
    () => () => {
      textIndexRef.current?.invalidate()
      textIndexRef.current = null
    },
    [],
  )

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
  const outbox = useAnnotations((view) => view.outbox)
  const replyAssociations = useAnnotations((view) => view.replyAssociations)
  const knownSubmissions = useMemo(() => {
    const byId = new Map(allAnnotations.map((item) => [item.annotationId, item] as const))
    const known = new Map<string, AnnotationDraft>()
    const add = (submissionId: string, annotationId: AnnotationId) => {
      const annotation = byId.get(annotationId)
      if (annotation !== undefined) known.set(annotationKey(submissionId, annotationId), annotation)
    }
    for (const item of allAnnotations) {
      if (item.submissionId !== undefined) add(item.submissionId, item.annotationId)
    }
    for (const association of replyAssociations ?? []) add(association.submissionId, association.annotationId)
    for (const entry of outbox) {
      if (entry.status !== 'sent') continue
      for (const item of entry.payload.annotations) add(entry.payload.submissionId, item.annotationId)
    }
    return known
  }, [allAnnotations, outbox, replyAssociations])
  const replyTargets = useMemo(
    () => buildReplyChipTargets(data.blocks, knownSubmissions),
    [data.blocks, knownSubmissions],
  )
  const activeId = useAnnotations((view) => view.activeAnnotationId)
  const activeEditor = useAnnotations((view) => view.editor)
  const navigationEpoch = useAnnotations((view) => view.navigationEpoch)
  const cancelQuoteFlashTimer = useCallback(() => {
    quoteFlashId.current += 1
    quoteFlashNavigationEpoch.current = null
    if (quoteFlashTimer.current !== null) clearTimeout(quoteFlashTimer.current)
    quoteFlashTimer.current = null
  }, [])
  const flashQuote = useCallback(
    (root: HTMLElement, range: Range | null, ownerEpoch: number) => {
      cancelQuoteFlashTimer()
      setQuoteFlash(null)
      if (range === null) return
      const id = quoteFlashId.current
      const rects = quoteFlashRects(root, range)
      quoteFlashNavigationEpoch.current = ownerEpoch
      if (rects.length > 0) setQuoteFlash({ id, navigationEpoch: ownerEpoch, rects })
      quoteFlashTimer.current = setTimeout(() => {
        if (quoteFlashId.current !== id) return
        quoteFlashTimer.current = null
        quoteFlashNavigationEpoch.current = null
        setQuoteFlash(null)
      }, QUOTE_FLASH_MS)
    },
    [cancelQuoteFlashTimer],
  )
  useEffect(() => {
    setQuoteFlash(null)
    return cancelQuoteFlashTimer
  }, [cancelQuoteFlashTimer, messageId])
  useLayoutEffect(() => {
    if (quoteFlashNavigationEpoch.current === null || quoteFlashNavigationEpoch.current === navigationEpoch) {
      return
    }
    cancelQuoteFlashTimer()
    setQuoteFlash(null)
  }, [cancelQuoteFlashTimer, navigationEpoch])
  useEffect(() => {
    if (activeId === null) return
    cancelQuoteFlashTimer()
    setQuoteFlash(null)
  }, [activeId, cancelQuoteFlashTimer])
  const editorOpen = useAnnotations((view) => view.editor !== null)
  const detailsOpen = useAnnotations(
    (view) => view.markerAnnotationId !== null || view.editor !== null || view.panelOpen,
  )
  useEffect(clearReplyPreview, [clearReplyPreview, detailsOpen, messageId, replyTargets])
  useEffect(() => {
    const key = replyPointerKey.current ?? replyHover?.key
    if (focusDuplicated || (key !== undefined && !replyChips.some((chip) => chip.key === key))) {
      clearReplyPreview()
    }
  }, [clearReplyPreview, focusDuplicated, replyChips, replyHover?.key])
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
  const reveal = useCallback((annotationId: AnnotationId, ownerEpoch: number) => {
    setRevealRequest({ annotationId, navigationEpoch: ownerEpoch })
  }, [])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null || messageId === undefined || typeof MutationObserver === 'undefined') {
      return undefined
    }
    let frame: number | null = null
    const observer = new MutationObserver(() => {
      textIndexRef.current?.invalidate()
      textIndexRef.current = null
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
    if (revealRequest.navigationEpoch !== navigationEpoch) {
      setRevealRequest(null)
      return
    }
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || messageId === undefined) {
      setRevealRequest(null)
      return
    }
    const hiddenByTurnProcess = root.closest('[data-turn-process-hidden], [hidden="until-found"]') !== null
    if (hiddenByTurnProcess && turnProcess?.foldable === true && !turnProcess.open) {
      turnProcess.setOpen(true)
      return
    }
    const annotation = annotations.find((item) => item.annotationId === revealRequest.annotationId)
    const measure = (): { line: VisualLine | null; range: Range | null } => {
      const range =
        annotation === undefined ? null : rangeFromSelector(body, annotation.quote, currentTextIndex(body))
      const rangeBounds = range === null ? null : quoteVisualBounds(range)
      const marker = markerElement(revealRequest.annotationId, root)
      const markerRect = marker?.getBoundingClientRect()
      const line =
        rangeBounds ??
        (markerRect === undefined || markerRect.height <= 0 ? null : visualLineFromRect(markerRect))
      return { line, range }
    }
    const settle = (line: VisualLine | null, range: Range | null) => {
      if (line === null) root.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' })
      else centerVisualLine(root, line)
      flashQuote(root, range, revealRequest.navigationEpoch)
      setRevealRequest(null)
      root.focus({ preventScroll: true })
    }
    const first = measure()
    if (first.line !== null) {
      settle(first.line, first.range)
      return
    }
    // 目标引用尚未参与布局（滚动区外的懒渲染或 content-visibility 节点）：
    // 先把整条回复滚入视口，等一帧渲染完成后再重新测量并居中。
    root.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' })
    let cancelled = false
    const retryFrame = requestAnimationFrame(() => {
      if (cancelled) return
      const retry = measure()
      settle(retry.line, retry.range)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(retryFrame)
    }
  }, [
    annotations,
    flashQuote,
    messageId,
    navigationEpoch,
    revealRequest,
    currentTextIndex,
    turnProcess?.foldable,
    turnProcess?.open,
    turnProcess?.setOpen,
  ])

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
    const textIndex = currentTextIndex(body)
    const ranges = annotations.flatMap((annotation) => {
      const range = rangeFromSelector(body, annotation.quote, textIndex)
      return range === null ? [] : [range]
    })
    updateHighlightRanges(messageId, ranges)
    return () => removeHighlights(messageId)
  }, [annotations, currentTextIndex, domRevision, messageId, removeHighlights, updateHighlightRanges])

  useEffect(() => {
    if (messageId === undefined) return
    const body = bodyRef.current
    if (body === null) return
    const textIndex = currentTextIndex(body)
    const active = annotations.find((item) => item.annotationId === activeId)
    const editorQuote =
      activeEditor?.kind === 'new' && activeEditor.capture.messageId === messageId
        ? activeEditor.capture.quote
        : undefined
    activateHighlight(
      messageId,
      editorQuote === undefined
        ? active === undefined
          ? null
          : rangeFromSelector(body, active.quote, textIndex)
        : rangeFromSelector(body, editorQuote, textIndex),
    )
  }, [activeId, activeEditor, activateHighlight, annotations, currentTextIndex, domRevision, messageId])

  useLayoutEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    if (root === null || body === null || annotations.length === 0 || isFocusViewHidden(root)) {
      setMarkerLayout((current) =>
        current.groups.length === 0 && current.overflow.length === 0 ? current : { groups: [], overflow: [] },
      )
      return undefined
    }

    let frame: number | null = null
    const measure = () => {
      const textIndex = currentTextIndex(body)
      const rootRect = root.getBoundingClientRect()
      const scaleX = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1
      const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
      const localRect = (rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): MarkerRect => ({
        left: (rect.left - rootRect.left) / scaleX,
        right: (rect.right - rootRect.left) / scaleX,
        top: (rect.top - rootRect.top) / scaleY,
        bottom: (rect.bottom - rootRect.top) / scaleY,
      })
      const anchors = annotations.map((annotation) => {
        const range = rangeFromSelector(body, annotation.quote, textIndex)
        const final = range === null ? null : finalVisibleCharacterRect(range, textIndex.nodes)
        return {
          annotationId: annotation.annotationId,
          ordinal: annotation.ordinal,
          line: final === null ? null : localRect(final),
        }
      })
      const next = layoutMarkers({
        anchors,
        bounds: markerBounds(root, rootRect, scaleX),
        targetSize:
          typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 44 : 24,
      })
      setMarkerLayout((current) => (sameMarkerLayout(current, next) ? current : next))
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
    window.addEventListener('scroll', scheduleMeasure, true)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
    document.addEventListener('toggle', scheduleMeasure, true)
    document.fonts?.addEventListener('loadingdone', scheduleMeasure)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
      document.removeEventListener('toggle', scheduleMeasure, true)
      document.fonts?.removeEventListener('loadingdone', scheduleMeasure)
    }
  }, [currentTextIndex, data.blocks, domRevision, geometryKey])

  /** A single-line heading gets an exact-sized keyboard target; wrapped or unmeasurable headings stay plain text. */
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
      const textIndex = currentTextIndex(body)
      const rootRect = root.getBoundingClientRect()
      const scaleX = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1
      const scaleY = root.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / root.offsetHeight : 1
      const next: ReplyChipState[] = []
      const renderedText = textIndex.rendered
      for (const target of replyTargets) {
        const start = completeHeadingStarts(renderedText, target.text)[target.occurrence]
        if (start === undefined) continue
        const range = rangeFromSelector(
          body,
          { ...selectorForTarget(target), start, end: start + target.text.length },
          textIndex,
        )
        if (range === null) continue
        const rects =
          typeof range.getClientRects === 'function'
            ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
            : []
        const first = rects[0]
        const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : first
        if (rect === undefined || rect.width <= 0 || rect.height <= 0) continue
        const fragments = (rects.length === 0 ? [rect] : rects).map((fragment) => ({
          top: (fragment.top - rootRect.top) / scaleY,
          left: (fragment.left - rootRect.left) / scaleX,
          width: fragment.width / scaleX,
          height: fragment.height / scaleY,
        }))
        next.push({
          key: target.key,
          annotation: target.annotation,
          ordinal: target.ordinal,
          top: (rect.top - rootRect.top) / scaleY,
          left: (rect.left - rootRect.left) / scaleX,
          width: rect.width / scaleX,
          height: rect.height / scaleY,
          fragments,
        })
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
  }, [currentTextIndex, data.status, domRevision, messageId, replyTargets])

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

  const replyAtPoint = (target: EventTarget, x: number, y: number): ReplyChipState | undefined => {
    if (
      editorOpen ||
      !(target instanceof Element) ||
      target.closest('a, button, input, textarea, [data-dsh-annotation-ignore="true"]') !== null
    )
      return undefined
    const root = rootRef.current
    if (root === null) return undefined
    const rect = root.getBoundingClientRect()
    const scaleX = root.offsetWidth > 0 ? rect.width / root.offsetWidth : 1
    const scaleY = root.offsetHeight > 0 ? rect.height / root.offsetHeight : 1
    const left = (x - rect.left) / scaleX
    const top = (y - rect.top) / scaleY
    return replyChips.find((chip) =>
      chip.fragments.some(
        (fragment) =>
          left >= fragment.left &&
          left <= fragment.left + fragment.width &&
          top >= fragment.top &&
          top <= fragment.top + fragment.height,
      ),
    )
  }

  const previewAnnotation = (annotationId: AnnotationId | null) => {
    if (detailsOpen) return
    const annotation = annotations.find((item) => item.annotationId === annotationId)
    const body = bodyRef.current
    if (messageId !== undefined && body !== null) {
      activateHighlight(
        messageId,
        annotation === undefined ? null : rangeFromSelector(body, annotation.quote, currentTextIndex(body)),
      )
    }
  }

  return (
    <section
      ref={rootRef}
      className="dia-assistant dia-assistant--decorator"
      tabIndex={-1}
      data-dsh-annotation-message-id={messageId}
    >
      <div
        ref={bodyRef}
        className="dia-assistant__body"
        onPointerDown={clearReplyPreview}
        onPointerMove={(event) => {
          const chip =
            !detailsOpen && event.buttons === 0 && window.getSelection()?.isCollapsed !== false
              ? replyAtPoint(event.target, event.clientX, event.clientY)
              : undefined
          if (chip === undefined) {
            clearReplyPreview()
            return
          }
          if (replyPointerKey.current === chip.key) return
          clearReplyPreview()
          replyPointerKey.current = chip.key
          replyTimer.current = setTimeout(() => {
            replyTimer.current = null
            setReplyHover(chip)
          }, 300)
        }}
        onPointerLeave={clearReplyPreview}
        onClick={(event) => {
          if (editorOpen || window.getSelection()?.isCollapsed === false) return
          const chip = replyAtPoint(event.target, event.clientX, event.clientY)
          if (chip === undefined) return
          clearReplyPreview()
          void navigate(chip.annotation.annotationId)
        }}
      >
        {children}
      </div>
      {quoteFlash?.rects.map((rect, index) => (
        <span
          key={`${quoteFlash.id}:${index}`}
          className="dia-quote-flash"
          data-navigation-epoch={quoteFlash.navigationEpoch}
          data-dsh-annotation-ignore="true"
          aria-hidden="true"
          style={rect}
        />
      ))}
      {!focusDuplicated && markerLayout.groups.length > 0 && (
        <nav className="dia-markers" aria-label={t('list.title')}>
          {markerLayout.groups.map((group) => (
            <AnnotationMarkerButton
              key={group.annotationIds[0]}
              group={group}
              annotations={annotations}
              t={t}
              activeId={activeId}
              detailsOpen={detailsOpen}
              editorOpen={editorOpen}
              onPreview={previewAnnotation}
              onOpen={(annotation) =>
                openAnnotation(
                  annotation.annotationId,
                  annotation.status === 'draft' ? 'marker-edit' : 'marker',
                )
              }
            />
          ))}
        </nav>
      )}
      {!focusDuplicated && replyChips.length > 0 && (
        <nav className="dia-reply-chips" aria-label={t('list.title')}>
          {replyChips.map((chip) => (
            <button
              key={chip.key}
              ref={(element) => {
                if (element === null) replyNodes.current.delete(chip.key)
                else replyNodes.current.set(chip.key, element)
              }}
              type="button"
              className="dia-reply-chip"
              style={{ top: chip.top, left: chip.left, width: chip.width, height: chip.height }}
              data-active={replyHover?.key === chip.key}
              data-wrapped={chip.fragments.length > 1 || undefined}
              disabled={editorOpen}
              aria-label={t('reply.chipLabel', {
                ordinal: chip.ordinal,
                quote: chip.annotation.quote.exact,
                annotation:
                  chip.annotation.annotation === '' ? t('highlightOnly') : chip.annotation.annotation,
              })}
              onFocus={() => {
                clearReplyPreview()
                if (!detailsOpen) setReplyHover(chip)
              }}
              onBlur={clearReplyPreview}
              onClick={() => {
                clearReplyPreview()
                void navigate(chip.annotation.annotationId)
              }}
            >
              {chip.fragments.length > 1 &&
                chip.fragments.map((fragment, index) => (
                  <span
                    key={index}
                    className="dia-reply-chip__fragment"
                    aria-hidden="true"
                    style={{
                      top: fragment.top - chip.top,
                      left: fragment.left - chip.left,
                      width: fragment.width,
                      height: fragment.height,
                    }}
                  />
                ))}
            </button>
          ))}
        </nav>
      )}
      {replyHover !== null &&
        createPortal(
          <aside
            ref={replyPreviewRef}
            className="dia-hover dia-reply-popover"
            role="tooltip"
            aria-label={t('reply.chip', { ordinal: replyHover.ordinal })}
            data-floating-placement={replyFloating.placement}
            style={replyFloating.style}
          >
            <strong>{t('reply.chip', { ordinal: replyHover.ordinal })}</strong>
            <q>{previewText(replyHover.annotation.quote.exact)}</q>
            <p data-highlight-only={replyHover.annotation.kind === 'highlight-only' ? 'true' : undefined}>
              {previewText(replyHover.annotation.annotation || t('highlightOnly'))}
            </p>
          </aside>,
          document.body,
        )}
      {selectionBar !== null && (
        <SelectionAction
          elementRef={selectionBarRef}
          rect={selectionBar.capture.rect}
          label={t('selection.annotate')}
          toolbarLabel={t('selection.toolbar')}
          onAnnotate={() => {
            beginSelection(selectionBar.capture)
            setSelectionBar(null)
          }}
        />
      )}
    </section>
  )
})
