/** Independent superscript bubbles in the owning content area's unscaled CSS coordinates. */
import type { AnnotationId } from '../shared/types.ts'
import type { SideChatReferenceId } from '../shared/side-chat-types.ts'

/** Identity of one saved annotation or reference; selected text never identifies a record. */
export type MarkerId = AnnotationId | SideChatReferenceId

/** Source and marker rectangles in the same unscaled CSS coordinates. */
export interface MarkerRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** Measured surface and non-overlapping hit area for one complete number. */
export interface MarkerSize {
  readonly width: number
  readonly height: number
  readonly fontSize: number
  readonly labelWidth: number
  readonly labelHeight: number
  readonly fontFamily: string
}

/** One restored final character and its content-relative button measurements. */
export interface MarkerAnchor {
  readonly annotationId: MarkerId
  readonly ordinal: number
  readonly line: MarkerRect | null
  readonly ceiling?: number
  readonly size?: MarkerSize
}

/** One button always represents exactly one saved record. */
export interface MarkerGroup {
  readonly annotationIds: readonly [MarkerId]
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly fontSize: number
  readonly labelWidth?: number
  readonly labelHeight?: number
  readonly labelLeft?: number
  readonly labelTop?: number
  readonly fontFamily?: string
}

/** Independent bubbles; extra height is needed only when avoidance passes the content's end. */
export interface MarkerLayout {
  readonly groups: readonly MarkerGroup[]
  readonly overflow: readonly MarkerId[]
  readonly contentHeight?: number
}

function intersects(left: MarkerRect, right: MarkerRect, gap = 0): boolean {
  return (
    left.left < right.right + gap &&
    left.right + gap > right.left &&
    left.top < right.bottom + gap &&
    left.bottom + gap > right.top
  )
}

/**
 * Start at each final character's upper-right corner, then avoid text and other hit areas.
 * @param input - Live character rectangles, measured bubbles, content bounds and painted obstacles.
 * @returns Separate bubbles in stable source order, without reserving any text width.
 */
export function layoutMarkers(input: {
  readonly anchors: readonly MarkerAnchor[]
  readonly bounds: MarkerRect
  readonly targetSize: number
  readonly obstacles?: readonly MarkerRect[]
}): MarkerLayout {
  const overflow: MarkerId[] = []
  const measured: Array<MarkerAnchor & { readonly line: MarkerRect }> = []
  for (const anchor of input.anchors) {
    if (anchor.line === null) overflow.push(anchor.annotationId)
    else measured.push({ ...anchor, line: anchor.line })
  }
  measured.sort(
    (left, right) =>
      left.line.top - right.line.top ||
      left.line.left - right.line.left ||
      left.ordinal - right.ordinal ||
      String(left.annotationId).localeCompare(String(right.annotationId)),
  )
  const groups: MarkerGroup[] = []
  const occupied: MarkerRect[] = []
  const obstacles = input.obstacles ?? measured.map((item) => item.line)
  let previous: { readonly line: MarkerRect; readonly rect: MarkerRect } | undefined
  let contentHeight = input.bounds.bottom
  for (const anchor of measured) {
    const fontSize = anchor.size?.fontSize ?? (anchor.line.bottom - anchor.line.top) * 0.8
    const labelHeight = anchor.size?.labelHeight ?? fontSize * 1.9
    const labelWidth =
      anchor.size?.labelWidth ?? Math.max(labelHeight, fontSize * String(anchor.ordinal).length)
    const width = anchor.size?.width ?? Math.max(input.targetSize, labelWidth)
    const height = anchor.size?.height ?? Math.max(input.targetSize, labelHeight)
    const gap = fontSize * 0.2
    const ceiling = Math.max(input.bounds.top, anchor.ceiling ?? input.bounds.top)
    const surfaceLeft = Math.max(
      input.bounds.left,
      Math.min(anchor.line.right + gap, input.bounds.right - labelWidth),
    )
    let surfaceTop = anchor.line.top - labelHeight * 0.85
    if (surfaceLeft < anchor.line.right) surfaceTop = anchor.line.top - labelHeight - gap
    surfaceTop = Math.max(ceiling, surfaceTop)
    if (
      surfaceLeft < anchor.line.right &&
      surfaceTop < anchor.line.bottom &&
      surfaceTop + labelHeight > anchor.line.top
    )
      surfaceTop = anchor.line.bottom + gap
    const start = Math.max(input.bounds.left, Math.min(surfaceLeft, input.bounds.right - width))
    const initialTop = Math.max(ceiling, surfaceTop - (height - labelHeight))
    const labelLeft = surfaceLeft - start
    const labelTop = surfaceTop - initialTop
    const sameEndpoint =
      previous !== undefined &&
      previous.line.left === anchor.line.left &&
      previous.line.top === anchor.line.top &&
      previous.line.right === anchor.line.right &&
      previous.line.bottom === anchor.line.bottom
    let preferredLeft = sameEndpoint ? previous!.rect.right + gap : start
    let preferredTop = sameEndpoint ? previous!.rect.top : initialTop
    if (preferredLeft + width > input.bounds.right) {
      preferredLeft = start
      if (sameEndpoint) preferredTop = previous!.rect.bottom + gap
    }
    const minTop = Math.max(input.bounds.top, ceiling, sameEndpoint ? previous!.rect.top : input.bounds.top)
    const queue: Array<{ left: number; top: number; cost: number }> = []
    const visited = new Set<string>()
    const add = (left: number, top: number): void => {
      if (left < input.bounds.left || left + width > input.bounds.right || top < minTop) return
      if (
        sameEndpoint &&
        top < previous!.rect.bottom + gap &&
        (top !== previous!.rect.top || left < previous!.rect.right + gap)
      )
        return
      const key = `${left}:${top}`
      if (visited.has(key)) return
      visited.add(key)
      queue.push({ left, top, cost: Math.abs(left - preferredLeft) + Math.abs(top - preferredTop) * 3 })
    }
    add(preferredLeft, Math.max(minTop, preferredTop))
    // A new row after all content is reachable without covering or reflowing text.
    add(start, Math.max(minTop, contentHeight + gap))
    let placed: MarkerRect | undefined
    while (queue.length > 0) {
      queue.sort((left, right) => left.cost - right.cost || left.top - right.top || left.left - right.left)
      const candidate = queue.shift()!
      const hit = {
        left: candidate.left,
        right: candidate.left + width,
        top: candidate.top,
        bottom: candidate.top + height,
      }
      const surface = {
        left: hit.left + labelLeft,
        right: hit.left + labelLeft + labelWidth,
        top: hit.top + labelTop,
        bottom: hit.top + labelTop + labelHeight,
      }
      // Bubbles sharing an endpoint keep the same superscript row.
      const text =
        sameEndpoint && hit.top !== initialTop
          ? obstacles.find((rect) => intersects(surface, rect, gap / 2))
          : undefined
      const endpoint = intersects(surface, anchor.line, gap / 2) ? anchor.line : undefined
      const peer = occupied.find((rect) => intersects(hit, rect, gap))
      const blocker = peer ?? endpoint ?? text
      if (blocker === undefined) {
        placed = hit
        break
      }
      add(blocker.right + gap, hit.top)
      add(start, blocker.top - (peer === undefined ? labelTop + labelHeight : height) - gap)
      add(start, blocker.bottom + gap - (peer === undefined ? labelTop : 0))
    }
    if (placed === undefined) {
      overflow.push(anchor.annotationId)
      continue
    }
    groups.push({
      annotationIds: [anchor.annotationId],
      top: placed.top,
      left: placed.left,
      width,
      height,
      fontSize,
      labelWidth,
      labelHeight,
      labelLeft,
      labelTop,
      ...(anchor.size === undefined ? {} : { fontFamily: anchor.size.fontFamily }),
    })
    occupied.push(placed)
    previous = { line: anchor.line, rect: placed }
    contentHeight = Math.max(contentHeight, placed.bottom)
  }
  return { groups, overflow, contentHeight }
}

/**
 * Measure the same compact surface used by the rendered bubble, with a separate pointer target.
 * @param content - Text element owning the final painted character.
 * @param ordinal - Complete record number including multiple digits.
 * @param targetSize - Minimum hit area for the current pointer capability.
 * @param cache - View-owned measurements, cleared when document fonts finish loading.
 * @returns Unscaled CSS sizes; browser zoom is applied only by the browser.
 */
export function markerSize(
  content: Element,
  ordinal: number,
  targetSize: number,
  cache?: Map<string, MarkerSize>,
): MarkerSize {
  const style = content.ownerDocument.defaultView!.getComputedStyle(content)
  const fontSize = Number.parseFloat(style.fontSize) * 0.8
  const key = JSON.stringify([style.fontFamily, fontSize, ordinal, targetSize])
  const cached = cache?.get(key)
  if (cached !== undefined) return cached
  const probe = content.ownerDocument.createElement('button')
  probe.className = 'dia-marker'
  probe.dataset.dshAnnotationIgnore = 'true'
  const label = content.ownerDocument.createElement('span')
  label.textContent = String(ordinal)
  probe.append(label)
  Object.assign(probe.style, {
    position: 'fixed',
    visibility: 'hidden',
    fontFamily: style.fontFamily,
    fontSize: `${fontSize}px`,
    width: 'max-content',
    height: 'max-content',
  })
  Object.assign(label.style, { position: 'relative' })
  content.ownerDocument.body.append(probe)
  const rendered = content.ownerDocument.defaultView!.getComputedStyle(label)
  const labelWidth = rendered.width.endsWith('px') ? Number.parseFloat(rendered.width) : label.offsetWidth
  const labelHeight = rendered.height.endsWith('px') ? Number.parseFloat(rendered.height) : label.offsetHeight
  probe.remove()
  const size = {
    fontSize,
    fontFamily: style.fontFamily,
    labelWidth,
    labelHeight,
    width: Math.max(targetSize, labelWidth + fontSize * 0.25),
    height: Math.max(targetSize, labelHeight + fontSize * 0.25),
  }
  cache?.set(key, size)
  return size
}

/**
 * Compare record identity and measured geometry before publishing a reflow.
 * @param left - Previous layout.
 * @param right - Current layout.
 * @returns Whether all marker sizes, positions and unresolved identities agree.
 */
export function sameMarkerLayout(left: MarkerLayout, right: MarkerLayout): boolean {
  return (
    left.contentHeight === right.contentHeight &&
    left.groups.length === right.groups.length &&
    left.overflow.length === right.overflow.length &&
    left.overflow.every((id, index) => id === right.overflow[index]) &&
    left.groups.every((group, index) => {
      const other = right.groups[index]!
      return (
        group.top === other.top &&
        group.left === other.left &&
        group.width === other.width &&
        group.height === other.height &&
        group.fontSize === other.fontSize &&
        group.fontFamily === other.fontFamily &&
        group.labelWidth === other.labelWidth &&
        group.labelHeight === other.labelHeight &&
        group.labelLeft === other.labelLeft &&
        group.labelTop === other.labelTop &&
        group.annotationIds[0] === other.annotationIds[0]
      )
    })
  )
}
