/** Measured annotation overlays that leave reply text and the current composer unobstructed when space permits. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { AnnotationId } from '../shared/types.ts'
import { FOCUS_CHANGED_EVENT } from './focus-adapter.ts'
import { rangeFromSelector, type SelectionCapture } from './selection.ts'

/** Viewport-relative CSS-pixel edges, shared by element and selection measurements. */
export type FloatingRect = Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left'>

/** A live element or a measured selection with its containing element for clipping and resize observation. */
export type AnnotationFloatingAnchor =
  HTMLElement | { readonly rect: FloatingRect; readonly contextElement: HTMLElement }

/** Placement and size limits for a fixed overlay; a panel occupies at most half the available height. */
export interface AnnotationFloatingPosition {
  readonly placement: 'left' | 'right' | 'top' | 'bottom' | 'panel'
  readonly left: number
  readonly top: number
  readonly maxWidth: number
  readonly maxHeight: number
}

const margin = 12
const gap = 8
const floatingAttribute = 'data-annotation-floating'

function intersects(left: FloatingRect, right: FloatingRect): boolean {
  return (
    left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
  )
}

function availableBounds(boundary: FloatingRect, composer: FloatingRect | null): FloatingRect {
  const top = boundary.top + margin
  const bottom =
    composer !== null && intersects(boundary, composer)
      ? Math.min(boundary.bottom - margin, composer.top - gap)
      : boundary.bottom - margin
  return {
    left: boundary.left + margin,
    right: Math.max(boundary.left + margin, boundary.right - margin),
    top,
    bottom: Math.max(top, bottom),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}

/**
 * Reply previews prefer side gutters; editors prefer the space below the final selected character.
 * @param geometry - Live anchor/body edges, visible scrollport, current composer, and measured unconstrained overlay size.
 * @returns Coordinates and scrollable size limits in viewport CSS pixels; missing or clipped anchors use a panel.
 */
export function computeAnnotationFloating(geometry: {
  readonly anchor: FloatingRect | null
  readonly body: FloatingRect | null
  readonly boundary: FloatingRect
  readonly composer: FloatingRect | null
  readonly size: { readonly width: number; readonly height: number }
  readonly preferBelow?: boolean
}): AnnotationFloatingPosition {
  const { anchor, body, boundary, composer, size, preferBelow = false } = geometry
  const bounds = availableBounds(boundary, composer)
  const maxWidth = bounds.right - bounds.left
  const maxHeight = bounds.bottom - bounds.top
  const width = Math.min(size.width, maxWidth)
  const placementGap = preferBelow ? 10 : gap
  const left = clamp((anchor?.left ?? bounds.left) - (preferBelow ? 8 : 0), bounds.left, bounds.right - width)
  const anchored = anchor !== null && intersects(anchor, bounds)

  if (anchored) {
    if (!preferBelow && body !== null && size.height <= maxHeight) {
      const top = clamp(anchor.top, bounds.top, bounds.bottom - size.height)
      const rightSide = Math.max(body.right, anchor.right) + gap
      if (rightSide + width <= bounds.right) {
        return { placement: 'right', left: rightSide, top, maxWidth, maxHeight }
      }
      const leftSide = Math.min(body.left, anchor.left) - gap - width
      if (leftSide >= bounds.left) {
        return { placement: 'left', left: leftSide, top, maxWidth, maxHeight }
      }
    }
    if (anchor.bottom + placementGap + size.height <= bounds.bottom) {
      return {
        placement: 'bottom',
        left,
        top: anchor.bottom + placementGap,
        maxWidth,
        maxHeight: preferBelow ? bounds.bottom - anchor.bottom - placementGap : maxHeight,
      }
    }
    if (anchor.top - placementGap - size.height >= bounds.top) {
      return {
        placement: 'top',
        left,
        top: anchor.top - placementGap - size.height,
        maxWidth,
        maxHeight: preferBelow ? anchor.top - placementGap - bounds.top : maxHeight,
      }
    }
  }

  if (anchor !== null && intersects(anchor, bounds)) {
    const above = Math.max(0, anchor.top - placementGap - bounds.top)
    const below = Math.max(0, bounds.bottom - anchor.bottom - placementGap)
    const placeBelow = below >= above
    const room = placeBelow ? below : above
    return {
      placement: 'panel',
      left: bounds.left + (maxWidth - width) / 2,
      top: placeBelow
        ? anchor.bottom + placementGap
        : anchor.top - placementGap - Math.min(size.height, room),
      maxWidth,
      maxHeight: room,
    }
  }
  const panelHeight = maxHeight / 2
  return {
    placement: 'panel',
    left: bounds.left + (maxWidth - width) / 2,
    top: bounds.bottom - Math.min(size.height, panelHeight),
    maxWidth,
    maxHeight: panelHeight,
  }
}

function viewportRect(view: Window): FloatingRect {
  const viewport = view.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  return {
    left,
    top,
    right: left + (viewport?.width ?? view.innerWidth),
    bottom: top + (viewport?.height ?? view.innerHeight),
  }
}

function ancestors(element: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = []
  for (let current = element.parentElement; current !== null; current = current.parentElement)
    result.push(current)
  return result
}

/** CSS zoom accumulates through ancestors; pinch zoom keeps the viewport's reported CSS-pixel units. */
function portalZoom(element: HTMLElement): number {
  const view = element.ownerDocument.defaultView!
  return [element, ...ancestors(element)].reduce((scale, current) => {
    const zoom = view.getComputedStyle(current).getPropertyValue('zoom')
    const value = Number.parseFloat(zoom)
    return value > 0 ? scale * (zoom.endsWith('%') ? value / 100 : value) : scale
  }, 1)
}

function rendered(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]') !== null)
    return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const view = element.ownerDocument.defaultView!
  return [element, ...ancestors(element)].every((current) => {
    const style = view.getComputedStyle(current)
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      style.contentVisibility !== 'hidden'
    )
  })
}

function visibleBoundary(element: HTMLElement, viewport: FloatingRect): FloatingRect {
  let bounds = viewport
  const view = element.ownerDocument.defaultView!
  for (const parent of ancestors(element)) {
    const style = view.getComputedStyle(parent)
    const clipX = /auto|scroll|hidden|clip|overlay/.test(style.overflowX || style.overflow)
    const clipY = /auto|scroll|hidden|clip|overlay/.test(style.overflowY || style.overflow)
    if (!clipX && !clipY) continue
    const rect = parent.getBoundingClientRect()
    const scaleX = parent.offsetWidth > 0 ? rect.width / parent.offsetWidth : 1
    const scaleY = parent.offsetHeight > 0 ? rect.height / parent.offsetHeight : 1
    const left = rect.left + parent.clientLeft * scaleX
    const top = rect.top + parent.clientTop * scaleY
    const right = parent.clientWidth > 0 ? left + parent.clientWidth * scaleX : rect.right
    const bottom = parent.clientHeight > 0 ? top + parent.clientHeight * scaleY : rect.bottom
    bounds = {
      left: clipX ? Math.max(bounds.left, left) : bounds.left,
      right: clipX ? Math.min(bounds.right, right) : bounds.right,
      top: clipY ? Math.max(bounds.top, top) : bounds.top,
      bottom: clipY ? Math.min(bounds.bottom, bottom) : bounds.bottom,
    }
  }
  return bounds
}

function visibleElement(elements: readonly HTMLElement[]): HTMLElement | null {
  const visible = elements.filter(
    (element) =>
      rendered(element) &&
      intersects(
        element.getBoundingClientRect(),
        visibleBoundary(element, viewportRect(element.ownerDocument.defaultView!)),
      ),
  )
  return visible.find((element) => element.closest('[data-focus-flow]') !== null) ?? visible[0] ?? null
}

/**
 * Resolve a displayed marker, including a member of a same-line marker group; hidden focus-view copies are excluded.
 * @param annotationId - Annotation represented by the marker's single id or space-separated id list.
 * @param root - Subtree to search; defaults to the current document.
 * @returns A visible matching button, preferring the focus view, or null when no matching marker is visible.
 */
export function markerElement(annotationId: AnnotationId, root: ParentNode = document): HTMLElement | null {
  return visibleElement(
    Array.from(root.querySelectorAll<HTMLElement>('button.dia-marker')).filter(
      (element) =>
        element.dataset.annotationId === annotationId ||
        element.dataset.annotationIds?.split(/\s+/).includes(annotationId),
    ),
  )
}

/**
 * Rebuild a selection's current position instead of reusing its saved viewport coordinates after scrolling.
 * @param capture - The message and text quote retained by an unfinished editor.
 * @param root - Subtree containing mounted assistant replies; defaults to the current document.
 * @returns The final visible non-whitespace character in the displayed quote, or null when its reply is unavailable.
 */
export function selectionAnchor(
  capture: SelectionCapture,
  root: ParentNode = document,
): AnnotationFloatingAnchor | null {
  const reply = visibleElement(
    Array.from(root.querySelectorAll<HTMLElement>('[data-dsh-annotation-message-id]')).filter(
      (element) => element.dataset.dshAnnotationMessageId === capture.messageId,
    ),
  )
  const body = reply?.querySelector<HTMLElement>('.dia-assistant__body')
  if (body == null) return null
  const range = rangeFromSelector(body, capture.quote)
  if (range === null) return null
  const nodes: Text[] = []
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && range.intersectsNode(node)) nodes.push(node)
  }
  let finalRect: DOMRect | null = null
  for (let index = nodes.length - 1; index >= 0 && finalRect === null; index -= 1) {
    const node = nodes[index]!
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    for (let offset = end - 1; offset >= start; offset -= 1) {
      if (/\s/u.test(node.data[offset] ?? '')) continue
      const character = body.ownerDocument.createRange()
      character.setStart(node, offset)
      character.setEnd(node, offset + 1)
      const rect = character.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        finalRect = rect
        break
      }
    }
  }
  return {
    rect: finalRect ?? range.getBoundingClientRect(),
    contextElement: range.startContainer.parentElement ?? body,
  }
}

function currentComposer(context: HTMLElement | null, doc: Document): HTMLElement | null {
  for (let current = context; current !== null; current = current.parentElement) {
    const composer = visibleElement(Array.from(current.querySelectorAll<HTMLElement>('[data-composer-card]')))
    if (composer !== null) return composer
    if (current.matches('[data-conversation-content]')) return null
  }
  return visibleElement(Array.from(doc.querySelectorAll<HTMLElement>('[data-composer-card]')))
}

/** Options for annotation cards, selection editors, and reply previews sharing the same placement rules. */
export interface AnnotationFloatingOptions {
  /** The hook owns data-annotation-floating on this element while enabled. */
  readonly floatingRef: RefObject<HTMLElement | null>
  /** Resolved on each measurement so replaced markers and mounted focus views do not leave stale coordinates. */
  readonly anchor: () => AnnotationFloatingAnchor | null
  readonly enabled: boolean
  /** Editors sit below the last selected character before considering other available space. */
  readonly preferBelow?: boolean
  /** The current Dock can provide its exact composer; previews otherwise use the anchor's nearest composer region. */
  readonly composer?: () => HTMLElement | null
}

function samePosition(left: AnnotationFloatingPosition | null, right: AnnotationFloatingPosition): boolean {
  return (
    left !== null &&
    left.placement === right.placement &&
    left.left === right.left &&
    left.top === right.top &&
    left.maxWidth === right.maxWidth &&
    left.maxHeight === right.maxHeight
  )
}

/**
 * Measure before first paint and coalesce subsequent layout, font, viewport, and scroll changes into one animation frame.
 * @param options - Mounted overlay, live anchor resolver, enabled state, and optional current composer resolver.
 * @returns Fixed styles in the portal's CSS coordinates and placement; never changes focus, selection,
 * or editor state, including when an anchor disappears.
 */
export function useAnnotationFloating(options: AnnotationFloatingOptions): {
  readonly style: CSSProperties
  readonly placement: AnnotationFloatingPosition['placement']
} {
  const { enabled, floatingRef, anchor, composer, preferBelow = false } = options
  const latest = useRef({ anchor, composer, preferBelow })
  const request = useRef<(() => void) | null>(null)
  const [position, setPosition] = useState<AnnotationFloatingPosition | null>(null)

  useLayoutEffect(() => {
    latest.current = { anchor, composer, preferBelow }
    request.current?.()
  }, [anchor, composer, preferBelow])

  useLayoutEffect(() => {
    if (!enabled) return undefined
    const doc = floatingRef.current?.ownerDocument ?? document
    const view = doc.defaultView!
    let disposed = false
    let frame: number | null = null
    let lastContext: HTMLElement | null = null
    let floatingElement: HTMLElement | null = null
    const observed = new Set<HTMLElement>()
    const schedule = () => {
      if (disposed || frame !== null) return
      frame = view.requestAnimationFrame(() => {
        frame = null
        if (!disposed) measure()
      })
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && floatingRef.current?.contains(event.target)) return
      schedule()
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    const observe = (targets: Set<HTMLElement>) => {
      for (const element of observed) {
        if (!targets.has(element)) {
          resize?.unobserve(element)
          observed.delete(element)
        }
      }
      for (const element of targets) {
        if (!observed.has(element)) {
          resize?.observe(element)
          observed.add(element)
        }
      }
    }
    const measure = () => {
      const floating = floatingRef.current
      if (floating === null) return
      if (floatingElement !== floating) {
        floatingElement?.removeAttribute(floatingAttribute)
        floating.setAttribute(floatingAttribute, '')
        floatingElement = floating
      }
      const resolved = latest.current.anchor()
      const candidate = resolved instanceof HTMLElement ? resolved : (resolved?.contextElement ?? null)
      const context = candidate !== null && rendered(candidate) ? candidate : null
      if (context !== null) lastContext = context
      const retained = context ?? (lastContext !== null && rendered(lastContext) ? lastContext : null)
      const proposedComposer =
        latest.current.composer === undefined ? currentComposer(retained, doc) : latest.current.composer()
      const composerElement =
        proposedComposer !== null && rendered(proposedComposer) ? proposedComposer : null
      const source = retained ?? composerElement
      const viewport = viewportRect(view)
      const boundary = source === null ? viewport : visibleBoundary(source, viewport)
      const body =
        context?.closest('.dia-assistant')?.querySelector<HTMLElement>('.dia-assistant__body') ?? null
      const composerRect = composerElement?.getBoundingClientRect() ?? null
      const bounds = availableBounds(boundary, composerRect)
      const zoom = portalZoom(floating)
      const priorWidth = floating.style.maxWidth
      const priorHeight = floating.style.maxHeight
      const scrollTop = floating.scrollTop
      const scrollLeft = floating.scrollLeft
      // Measure uncapped content without losing the reader's position when the temporary expansion removes overflow.
      floating.style.maxWidth = `${(bounds.right - bounds.left) / zoom}px`
      floating.style.maxHeight = 'none'
      const size = floating.getBoundingClientRect()
      floating.style.maxWidth = priorWidth
      floating.style.maxHeight = priorHeight
      floating.scrollTop = scrollTop
      floating.scrollLeft = scrollLeft
      const visual = computeAnnotationFloating({
        anchor:
          context === null || resolved === null
            ? null
            : resolved instanceof HTMLElement
              ? resolved.getBoundingClientRect()
              : resolved.rect,
        body: body?.getBoundingClientRect() ?? null,
        boundary,
        composer: composerRect,
        size,
        preferBelow: latest.current.preferBelow,
      })
      // DOMRects already include CSS zoom; fixed styles use the portal's unzoomed CSS coordinates.
      const next = {
        ...visual,
        left: visual.left / zoom,
        top: visual.top / zoom,
        maxWidth: visual.maxWidth / zoom,
        maxHeight: visual.maxHeight / zoom,
      }
      setPosition((previous) => (samePosition(previous, next) ? previous : next))
      observe(
        new Set([
          floating,
          ...(context === null ? [] : [context, ...ancestors(context)]),
          ...(body === null ? [] : [body]),
          ...(composerElement === null ? [] : [composerElement, ...ancestors(composerElement)]),
        ]),
      )
    }
    // Temporary size writes on one fixed overlay must not trigger another overlay's measurement.
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type !== 'attributes' ||
            record.attributeName !== 'style' ||
            !(record.target instanceof Element) ||
            !record.target.hasAttribute(floatingAttribute),
        )
      )
        schedule()
    })
    mutations.observe(doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'inert',
        'aria-hidden',
        'data-annotation-id',
        'data-annotation-ids',
      ],
    })
    mutations.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const viewport = view.visualViewport
    const fonts = doc.fonts
    view.addEventListener('resize', schedule)
    view.addEventListener('scroll', onScroll, true)
    view.addEventListener(FOCUS_CHANGED_EVENT, schedule)
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    fonts?.addEventListener('loadingdone', schedule)
    fonts?.addEventListener('loadingerror', schedule)
    void fonts?.ready.then(schedule)
    request.current = schedule
    measure()
    return () => {
      disposed = true
      request.current = null
      if (frame !== null) view.cancelAnimationFrame(frame)
      resize?.disconnect()
      mutations.disconnect()
      floatingElement?.removeAttribute(floatingAttribute)
      view.removeEventListener('resize', schedule)
      view.removeEventListener('scroll', onScroll, true)
      view.removeEventListener(FOCUS_CHANGED_EVENT, schedule)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      fonts?.removeEventListener('loadingdone', schedule)
      fonts?.removeEventListener('loadingerror', schedule)
    }
  }, [enabled, floatingRef])

  return {
    placement: position?.placement ?? 'panel',
    style: {
      position: 'fixed',
      left: position?.left ?? 0,
      top: position?.top ?? 0,
      right: 'auto',
      bottom: 'auto',
      ...(position === null ? {} : { maxWidth: position.maxWidth, maxHeight: position.maxHeight }),
      boxSizing: 'border-box',
      overflow: 'auto',
    },
  }
}
