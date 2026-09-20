import { describe, expect, it } from 'vitest'
import {
  layoutMarkers,
  sameMarkerLayout,
  type MarkerAnchor,
  type MarkerRect,
} from '../src/client/marker-layout.ts'
import type { AnnotationId } from '../src/shared/types.ts'

const rect = (left: number, top: number, right: number, bottom: number): MarkerRect => ({
  left,
  top,
  right,
  bottom,
})
const id = (ordinal: number) => `ann-${ordinal}` as AnnotationId
const anchor = (ordinal: number, line: MarkerRect | null): MarkerAnchor => ({
  annotationId: id(ordinal),
  ordinal,
  line,
})
const bounds = rect(0, 0, 400, 200)

function layout(
  anchors: readonly MarkerAnchor[],
  overrides: Partial<Parameters<typeof layoutMarkers>[0]> = {},
) {
  return layoutMarkers({ anchors, bounds, bodyRight: 300, obstacles: [], targetSize: 24, ...overrides })
}

describe('reading-first annotation markers', () => {
  it('uses existing line-end whitespace and groups ordinals without reserving source width', () => {
    const line = rect(0, 20, 200, 40)
    const single = layout([anchor(2, line)], { obstacles: [line] })
    const multiple = layout([anchor(3, line), anchor(1, line), anchor(2, line)], { obstacles: [line] })
    expect(single.groups[0]).toMatchObject({ top: 18, left: 205, width: 24, height: 24 })
    expect(multiple).toEqual({
      groups: [{ annotationIds: [id(1), id(2), id(3)], top: 18, left: 205, width: 24, height: 24 }],
      overflow: [],
    })
    expect(line).toEqual(rect(0, 20, 200, 40))
  })

  it('keeps full-width and unresolved quotes in the summary instead of covering text', () => {
    const line = rect(0, 20, 300, 40)
    const result = layout([anchor(1, line), anchor(2, line), anchor(3, null)], {
      bounds: rect(0, 0, 300, 200),
      obstacles: [line],
    })
    expect(result.groups).toEqual([])
    expect(result.overflow).toEqual([id(3), id(1), id(2)])
  })

  it('uses external whitespace when a marker would overlap text on the next line', () => {
    const line = rect(0, 20, 200, 40)
    const nextLine = rect(0, 39, 300, 59)
    const result = layout([anchor(1, line)], { obstacles: [line, nextLine] })
    expect(result.groups[0]).toMatchObject({ left: 305 })
    expect(
      layout([anchor(1, line)], { bounds: rect(0, 0, 320, 200), obstacles: [line, nextLine] }).groups,
    ).toEqual([])
  })

  it('places markers outside code blocks and tables, not inside their empty cells or padding', () => {
    const line = rect(20, 20, 180, 40)
    const codeOrTable = rect(0, 10, 300, 100)
    expect(layout([anchor(1, line)], { obstacles: [line, codeOrTable] }).groups[0]?.left).toBe(305)
    expect(
      layout([anchor(1, line)], { bounds: rect(0, 0, 300, 200), obstacles: [codeOrTable] }).overflow,
    ).toEqual([id(1)])
  })

  it('does not stack intersecting hit targets on tightly spaced lines', () => {
    const lines = [rect(0, 22, 100, 34), rect(0, 38, 100, 50)]
    const result = layout([anchor(1, lines[0]!), anchor(2, lines[1]!)], { obstacles: lines })
    expect(result.groups.map((group) => group.left)).toEqual([105, 305])
    const narrow = layout([anchor(1, lines[0]!), anchor(2, lines[1]!)], {
      bounds: rect(0, 0, 300, 200),
      obstacles: lines,
    })
    expect(narrow.groups).toHaveLength(1)
    expect(narrow.overflow).toEqual([id(2)])
  })

  it('keeps wider ordinals and touch hit targets within the measured available area', () => {
    const line = rect(0, 60, 280, 80)
    expect(layout([anchor(100, line)]).groups[0]?.width).toBe(29)
    expect(layout([anchor(1, line)], { targetSize: 44 }).groups[0]).toMatchObject({
      width: 44,
      height: 44,
      top: 48,
    })
    expect(layout([anchor(1, line)], { bounds: rect(0, 0, 320, 200), targetSize: 44 }).overflow).toEqual([
      id(1),
    ])
  })

  it('does not draw into neighboring messages when a hit target exceeds the reply height', () => {
    const line = rect(0, 0, 100, 14)
    expect(layout([anchor(1, line)], { bounds: rect(0, 0, 400, 16) }).groups).toEqual([])
  })

  it('reuses only identical geometry, group membership, and summary-only ids', () => {
    const first = layout([anchor(1, rect(0, 20, 100, 40)), anchor(3, null)])
    expect(sameMarkerLayout(first, layout([anchor(1, rect(0, 20, 100, 40)), anchor(3, null)]))).toBe(true)
    expect(sameMarkerLayout(first, layout([anchor(1, rect(0, 20, 110, 40)), anchor(3, null)]))).toBe(false)
    expect(sameMarkerLayout(first, layout([anchor(2, rect(0, 20, 100, 40)), anchor(3, null)]))).toBe(false)
    expect(sameMarkerLayout(first, layout([anchor(1, rect(0, 20, 100, 40)), anchor(4, null)]))).toBe(false)
    expect(sameMarkerLayout(first, { groups: [], overflow: [id(1), id(3)] })).toBe(false)
    expect(sameMarkerLayout(first, { groups: first.groups, overflow: [] })).toBe(false)
  })
})
