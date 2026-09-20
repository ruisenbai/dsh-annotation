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

function overlaps(left: MarkerRect, right: MarkerRect): boolean {
  return (
    left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
  )
}

function sameLine(left: MarkerRect, right: MarkerRect): boolean {
  return (
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) >
    Math.min(left.bottom - left.top, right.bottom - right.top) / 2
  )
}

/**
 * Place one marker per visual line without changing the source layout.
 * @param input - Measured endpoints, clipping limits, source obstacles, and the minimum hit target.
 * @returns Safe marker groups and ids that must be opened from the annotation summary.
 */
export function layoutMarkers(input: {
  readonly anchors: readonly MarkerAnchor[]
  readonly bounds: MarkerRect
  readonly bodyRight: number
  readonly obstacles: readonly MarkerRect[]
  readonly targetSize: number
}): MarkerLayout {
  const overflow: AnnotationId[] = []
  const measured: Array<MarkerAnchor & { readonly line: MarkerRect }> = []
  for (const anchor of input.anchors) {
    if (anchor.line === null) overflow.push(anchor.annotationId)
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
    const center =
      anchors.reduce((sum, anchor) => sum + (anchor.line.top + anchor.line.bottom) / 2, 0) / anchors.length
    const top = center - height / 2
    const lineRight = Math.max(...anchors.map((anchor) => anchor.line.right))
    const candidates = [lineRight + 5, Math.max(lineRight, input.bodyRight) + 5]
    const left = candidates.find((candidate) => {
      const rect = { left: candidate, right: candidate + width, top, bottom: top + height }
      return (
        rect.left >= input.bounds.left &&
        rect.right <= input.bounds.right &&
        rect.top >= input.bounds.top &&
        rect.bottom <= input.bounds.bottom &&
        !input.obstacles.some((obstacle) => overlaps(rect, obstacle)) &&
        !occupied.some((obstacle) => overlaps(rect, obstacle))
      )
    })
    if (left === undefined) {
      overflow.push(...annotationIds)
      continue
    }
    groups.push({ annotationIds, top, left, width, height })
    occupied.push({ top, bottom: top + height, left, right: left + width })
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
