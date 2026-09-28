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
  return layoutMarkers({ anchors, bounds, targetSize: 24, ...overrides })
}

describe('source-anchored annotation markers', () => {
  it('places a bubble beside the final selected character rather than at the reply edge', () => {
    const lastCharacter = rect(95, 60, 105, 80)
    expect(layout([anchor(1, lastCharacter)]).groups[0]).toMatchObject({
      left: 107,
      top: 38,
      width: 24,
      height: 24,
    })
  })

  it('groups endings on the same visual line and retains the source-end position', () => {
    const result = layout([
      anchor(3, rect(80, 60, 90, 80)),
      anchor(1, rect(95, 60, 105, 80)),
      anchor(2, rect(90, 60, 100, 80)),
    ])
    expect(result.groups).toEqual([
      {
        annotationIds: [id(1), id(2), id(3)],
        top: 38,
        left: 107,
        width: 24,
        height: 24,
      },
    ])
  })

  it('hides bubbles when their source scrolls away or the final character has no room', () => {
    expect(
      layout([anchor(1, rect(95, 20, 105, 40))], {
        bounds: rect(0, 45, 400, 200),
      }).groups,
    ).toEqual([])
    expect(layout([anchor(1, rect(390, 60, 400, 80))]).overflow).toEqual([id(1)])
    expect(layout([anchor(1, null)]).overflow).toEqual([id(1)])
  })

  it('does not move colliding bubbles to the right edge of the reply', () => {
    const result = layout([anchor(1, rect(95, 60, 105, 80)), anchor(2, rect(95, 82, 105, 102))])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.left).toBe(107)
    expect(result.overflow).toEqual([id(2)])
  })

  it('uses the larger touch target only when it fits at the selected character', () => {
    expect(layout([anchor(1, rect(280, 60, 290, 80))], { targetSize: 44 }).groups[0]).toMatchObject({
      left: 292,
      width: 44,
      height: 44,
    })
    expect(layout([anchor(1, rect(370, 60, 380, 80))], { targetSize: 44 }).overflow).toEqual([id(1)])
  })

  it('reuses only identical geometry, group membership, and hidden ids', () => {
    const first = layout([anchor(1, rect(95, 60, 105, 80)), anchor(3, null)])
    expect(sameMarkerLayout(first, layout([anchor(1, rect(95, 60, 105, 80)), anchor(3, null)]))).toBe(true)
    expect(sameMarkerLayout(first, layout([anchor(1, rect(105, 60, 115, 80)), anchor(3, null)]))).toBe(false)
    expect(sameMarkerLayout(first, { groups: [], overflow: [id(1), id(3)] })).toBe(false)
  })
})
