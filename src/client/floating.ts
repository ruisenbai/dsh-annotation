/** Measured annotation overlays that leave reply text and the current composer unobstructed when space permits. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { AnnotationId } from '../shared/types.ts'
import { sourceKey } from '../shared/annotation-source.ts'
import { FOCUS_CHANGED_EVENT } from './focus-adapter.ts'
import { rangeFromSelector, type SelectionCapture } from './selection.ts'

/** Viewport-relative CSS-pixel edges, shared by element and selection measurements. */
export type FloatingRect = Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left'>

/** A live element or a measured selection with its containing element for clipping and resize observation. */
export type AnnotationFloatingAnchor =
  | HTMLElement
  | {
      readonly rect: FloatingRect
      readonly contextElement: HTMLElement
      readonly selectionRect?: FloatingRect
    }

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
const officialAnchors = new Map<string, Set<(capture: SelectionCapture) => Range | HTMLElement | null>>()

/** Register a mounted official view for live editor placement. */
export function registerOfficialAnchor(
  key: string,
  resolve: (capture: SelectionCapture) => Range | HTMLElement | null,
): () => void {
  const entries = officialAnchors.get(key) ?? new Set()
  entries.add(resolve)
  officialAnchors.set(key, entries)
  return () => {
    entries.delete(resolve)
    if (entries.size === 0) officialAnchors.delete(key)
  }
}

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
  /** Region the overlay may occupy, already bounded by the source's own scrolling band. */
  readonly boundary: FloatingRect
  readonly composer: FloatingRect | null
  readonly size: { readonly width: number; readonly height: number }
  readonly preferBelow?: boolean
  readonly selectionRect?: FloatingRect
  /** Every clipping edge, including non-scrolling wrappers; only decides whether the source shows. */
  readonly visibleBoundary?: FloatingRect
}): AnnotationFloatingPosition {
  const { anchor, body, boundary, composer, size, preferBelow = false } = geometry
  const bounds = availableBounds(boundary, composer)
  const maxWidth = bounds.right - bounds.left
  const maxHeight = bounds.bottom - bounds.top
  const width = Math.min(size.width, maxWidth)
  const placementGap = preferBelow ? 10 : gap
  const rightPreferred = preferBelow && anchor !== null && anchor.right + gap + width <= bounds.right
  const left = clamp(
    rightPreferred ? anchor.right + gap : (anchor?.left ?? bounds.left) - (preferBelow ? 8 : 0),
    bounds.left,
    bounds.right - width,
  )
  const anchored = anchor !== null && intersects(anchor, geometry.visibleBoundary ?? bounds)
  const selectionTop = preferBelow
    ? (geometry.selectionRect?.top ?? anchor?.top ?? bounds.top)
    : (anchor?.top ?? bounds.top)

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
    if (selectionTop - placementGap - size.height >= bounds.top) {
      return {
        placement: 'top',
        left,
        top: selectionTop - placementGap - size.height,
        maxWidth,
        maxHeight: preferBelow ? selectionTop - placementGap - bounds.top : maxHeight,
      }
    }
  }

  if (anchored) {
    const above = Math.max(0, selectionTop - placementGap - bounds.top)
    const below = Math.max(0, bounds.bottom - anchor.bottom - placementGap)
    const placeBelow = below >= above
    const room = placeBelow ? below : above

    return {
      placement: 'panel',
      left: bounds.left + (maxWidth - width) / 2,
      top: placeBelow
        ? anchor.bottom + placementGap
        : selectionTop - placementGap - Math.min(size.height, room),
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

/** Whether a source is mounted and visible, excluding hidden retained sidebar tabs. */
export function rendered(element: HTMLElement): boolean {
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

/** Intersect viewport edges with every clipping ancestor's client area. */
export function visibleBoundary(
  element: HTMLElement,
  viewport: FloatingRect = viewportRect(element.ownerDocument.defaultView!),
): FloatingRect {
  let bounds = viewport
  const view = element.ownerDocument.defaultView!
  for (const parent of ancestors(element)) {
    const style = view.getComputedStyle(parent)
    const clipX = /auto|scroll|hidden|clip|overlay/.test(style.overflowX || style.overflow)
    const clipY = /auto|scroll|hidden|clip|overlay/.test(style.overflowY || style.overflow)
    if (!clipX && !clipY) continue
    const box = clientBox(parent)
    bounds = {
      left: clipX ? Math.max(bounds.left, box.left) : bounds.left,
      right: clipX ? Math.min(bounds.right, box.right) : bounds.right,
      top: clipY ? Math.max(bounds.top, box.top) : bounds.top,
      bottom: clipY ? Math.min(bounds.bottom, box.bottom) : bounds.bottom,
    }
  }
  return bounds
}

function clipsOnScroll(style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean {
  const value = axis === 'y' ? style.overflowY || style.overflow : style.overflowX || style.overflow
  return /auto|scroll|overlay/.test(value)
}

/** The nearest ancestor that actually scrolls its content, in either axis. */
function nearestScrollport(element: HTMLElement, axis: 'x' | 'y' = 'y'): HTMLElement | undefined {
  const view = element.ownerDocument.defaultView!
  return ancestors(element).find((parent) => clipsOnScroll(view.getComputedStyle(parent), axis))
}

/**
 * The band an overlay may occupy: the visible part of the source's own scrolling surfaces.
 *
 * Only real scrollports bound this band. A decorative `overflow: hidden` or `clip` wrapper does
 * not, because the overlay is portalled outside it and stays visible; letting such a wrapper
 * bound the band is what pushed editors above the selection while the page still had room below.
 *
 * @param source - Live element whose overlay is being placed.
 * @param viewport - Visible viewport edges in CSS pixels.
 * @returns The largest rectangle the overlay may use before the composer is subtracted.
 */
export function overlayRegion(source: HTMLElement, viewport: FloatingRect): FloatingRect {
  const view = source.ownerDocument.defaultView!
  let bounds = viewport
  for (const parent of ancestors(source)) {
    const style = view.getComputedStyle(parent)
    const clipX = clipsOnScroll(style, 'x')
    const clipY = clipsOnScroll(style, 'y')
    if (!clipX && !clipY) continue
    const box = clientBox(parent)
    bounds = {
      left: clipX ? Math.max(bounds.left, box.left) : bounds.left,
      right: clipX ? Math.min(bounds.right, box.right) : bounds.right,
      top: clipY ? Math.max(bounds.top, box.top) : bounds.top,
      bottom: clipY ? Math.min(bounds.bottom, box.bottom) : bounds.bottom,
    }
  }
  return bounds
}

function clientBox(element: HTMLElement): FloatingRect {
  const rect = element.getBoundingClientRect()
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
  const left = rect.left + element.clientLeft * scaleX
  const top = rect.top + element.clientTop * scaleY
  return {
    left,
    top,
    right: element.clientWidth > 0 ? left + element.clientWidth * scaleX : rect.right,
    bottom: element.clientHeight > 0 ? top + element.clientHeight * scaleY : rect.bottom,
  }
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
  if (capture.source?.kind === 'file' || capture.source?.kind === 'official-diff') {
    for (const resolve of officialAnchors.get(sourceKey(capture)) ?? []) {
      const target = resolve(capture)
      const element = target instanceof Range ? target.startContainer.parentElement : target
      if (target !== null && element !== null && rendered(element))
        return target instanceof Range ? rangeAnchor(target) : target
    }
    return null
  }
  const reply = visibleElement(
    Array.from(root.querySelectorAll<HTMLElement>('[data-dsh-annotation-message-id]')).filter(
      (element) => element.dataset.dshAnnotationMessageId === capture.messageId,
    ),
  )
  const body = reply?.querySelector<HTMLElement>('.dia-assistant__body')
  if (body == null) return null
  const range = rangeFromSelector(body, capture.quote)
  if (range === null) return null
  return rangeAnchor(range)
}

/** Anchor a floating editor to the final visible character of a live DOM Range. */
export function rangeAnchor(range: Range): {
  readonly rect: FloatingRect
  readonly contextElement: HTMLElement
  readonly selectionRect: FloatingRect
} {
  const body =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : (range.commonAncestorContainer.parentElement ?? document.body)
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
      const rect =
        typeof character.getBoundingClientRect === 'function'
          ? character.getBoundingClientRect()
          : range.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        finalRect = rect
        break
      }
    }
  }
  return {
    rect: finalRect ?? range.getBoundingClientRect(),
    contextElement: range.startContainer.parentElement ?? body,
    selectionRect: range.getBoundingClientRect(),
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
    let reserved: { element: HTMLElement; value: string; priority: string; base: number } | null = null
    let reserveKey = ''
    const releaseSpace = (): void => {
      if (reserved === null) return
      if (reserved.value === '') reserved.element.style.removeProperty('padding-bottom')
      else reserved.element.style.setProperty('padding-bottom', reserved.value, reserved.priority)
      reserved = null
      reserveKey = ''
    }
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
      let resolved = latest.current.anchor()
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
      // Visibility still honours every clip; placement uses only the source's own scrolling band.
      const boundary = source === null ? viewport : visibleBoundary(source, viewport)
      const region = source === null ? viewport : overlayRegion(source, viewport)
      const body =
        context?.closest('.dia-assistant')?.querySelector<HTMLElement>('.dia-assistant__body') ?? null
      const composerRect = composerElement?.getBoundingClientRect() ?? null
      const bounds = availableBounds(region, composerRect)
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
      if (latest.current.preferBelow && context !== null && resolved !== null) {
        const scrollport = nearestScrollport(context)
        if (scrollport === undefined) releaseSpace()
        else {
          // The official composer seat is a sticky child of the conversation scrollport, so any
          // padding there lifts the input box. Only a source scrollport without the composer may
          // be given temporary room; the conversation band is widened by scrolling instead.
          const shared = composerElement !== null && scrollport.contains(composerElement)
          const required = shared
            ? 0
            : Math.min(size.height, Math.max(0, (bounds.bottom - bounds.top) / 2)) + 10
          const key = `${shared ? 's' : 'r'}:${Math.round(required)}:${Math.round(bounds.top)}:${Math.round(bounds.bottom)}:${Math.round(bounds.right - bounds.left)}`
          if (shared) releaseSpace()
          else if (reserved?.element !== scrollport) {
            releaseSpace()
            reserved = {
              element: scrollport,
              value: scrollport.style.getPropertyValue('padding-bottom'),
              priority: scrollport.style.getPropertyPriority('padding-bottom'),
              base: Number.parseFloat(view.getComputedStyle(scrollport).paddingBottom) || 0,
            }
          }
          if (reserveKey !== key) {
            reserveKey = key
            if (!shared && reserved !== null)
              scrollport.style.setProperty('padding-bottom', `${reserved.base + required}px`)
            const rect = resolved instanceof HTMLElement ? resolved.getBoundingClientRect() : resolved.rect
            // Bring the selection into the band above the composer before choosing a side, so a
            // selection hidden behind the sticky input never decides the placement on its own.
            const targetBottom = bounds.bottom - (shared ? size.height + 10 : required)
            const delta =
              rect.bottom > targetBottom
                ? rect.bottom - targetBottom
                : rect.top < bounds.top
                  ? rect.top - bounds.top
                  : 0
            if (delta !== 0) {
              const before = scrollport.scrollTop
              scrollport.scrollTop += delta
              if (scrollport.scrollTop !== before) resolved = latest.current.anchor()
            }
          }
        }
      } else releaseSpace()
      const visual = computeAnnotationFloating({
        anchor:
          context === null || resolved === null
            ? null
            : resolved instanceof HTMLElement
              ? resolved.getBoundingClientRect()
              : resolved.rect,
        body: body?.getBoundingClientRect() ?? null,
        boundary: region,
        visibleBoundary: boundary,
        composer: composerRect,
        size,
        preferBelow: latest.current.preferBelow,
        ...(resolved !== null && !(resolved instanceof HTMLElement) && resolved.selectionRect !== undefined
          ? { selectionRect: resolved.selectionRect }
          : {}),
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
      releaseSpace()
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
