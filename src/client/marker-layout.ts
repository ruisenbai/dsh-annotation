import type { AnnotationId } from '../shared/types.ts'

/** Source and marker rectangles in the assistant wrapper's unscaled CSS coordinates. */
export interface MarkerRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** A restored quote endpoint, or a quote that remains available only in the summary. */
export interface MarkerAnchor {
  readonly annotationId: AnnotationId
  readonly ordinal: number
  readonly line: MarkerRect | null
}

/** One button represents every annotation ending on the same visual line. */
export interface MarkerGroup {
  readonly annotationIds: readonly AnnotationId[]
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/** Markers that cannot fit without covering source content remain in the existing summary. */
export interface MarkerLayout {
  readonly groups: readonly MarkerGroup[]
  readonly overflow: readonly AnnotationId[]
}

function sameLine(left: MarkerRect, right: MarkerRect): boolean {
  return (
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) >
    Math.min(left.bottom - left.top, right.bottom - right.top) / 2
  )
}

/**
 * Place one marker per visual line without changing the source layout.
 * @param input - Measured endpoints, clipping limits, and the minimum hit target.
 * @returns Safe marker groups and ids that must be opened from the annotation summary.
 */
export function layoutMarkers(input: {
  readonly anchors: readonly MarkerAnchor[]
  readonly bounds: MarkerRect
  readonly targetSize: number
}): MarkerLayout {
  const overflow: AnnotationId[] = []
  const measured: Array<MarkerAnchor & { readonly line: MarkerRect }> = []
  for (const anchor of input.anchors) {
    if (
      anchor.line === null ||
      anchor.line.bottom <= input.bounds.top ||
      anchor.line.top >= input.bounds.bottom
    )
      overflow.push(anchor.annotationId)
    else measured.push({ ...anchor, line: anchor.line })
  }
  measured.sort((left, right) => left.line.top - right.line.top || left.ordinal - right.ordinal)
  const lines: Array<{ line: MarkerRect; anchors: typeof measured }> = []
  for (const anchor of measured) {
    const previous = lines.at(-1)
    if (previous !== undefined && sameLine(previous.line, anchor.line)) previous.anchors.push(anchor)
    else lines.push({ line: anchor.line, anchors: [anchor] })
  }

  const groups: MarkerGroup[] = []
  const occupied: MarkerRect[] = []
  for (const { anchors } of lines) {
    anchors.sort((left, right) => left.ordinal - right.ordinal)
    const annotationIds = anchors.map((anchor) => anchor.annotationId)
    const labelLength =
      anchors.length > 1 ? String(anchors.length).length + 1 : String(anchors[0]!.ordinal).length
    const width = Math.max(input.targetSize, labelLength * 7 + 8)
    const height = input.targetSize
    const lineTop = Math.min(...anchors.map((anchor) => anchor.line.top))
    const top = Math.max(input.bounds.top, Math.min(lineTop - height + 2, input.bounds.bottom - height))
    const left = Math.max(...anchors.map((anchor) => anchor.line.right)) + 2
    const rect = { left, right: left + width, top, bottom: top + height }
    if (
      rect.left < input.bounds.left ||
      rect.right > input.bounds.right ||
      rect.top < input.bounds.top ||
      rect.bottom > input.bounds.bottom ||
      occupied.some(
        (other) =>
          rect.left < other.right &&
          rect.right > other.left &&
          rect.top < other.bottom &&
          rect.bottom > other.top,
      )
    ) {
      overflow.push(...annotationIds)
      continue
    }
    groups.push({ annotationIds, top, left, width, height })
    occupied.push(rect)
  }
  return { groups, overflow }
}

/**
 * Compare measured marker layouts without publishing identical resize observations.
 * @param left - Previously rendered groups.
 * @param right - Newly measured groups.
 * @returns Whether geometry, membership, and summary-only ids are unchanged.
 */
export function sameMarkerLayout(left: MarkerLayout, right: MarkerLayout): boolean {
  return (
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
        group.annotationIds.length === other.annotationIds.length &&
        group.annotationIds.every((id, member) => id === other.annotationIds[member])
      )
    })
  )
}
