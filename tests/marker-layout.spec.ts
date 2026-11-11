// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  layoutMarkers,
  markerSize,
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
const id = (n: number) => `ann-${n}` as AnnotationId
const anchor = (n: number, line: MarkerRect | null): MarkerAnchor => ({
  annotationId: id(n),
  ordinal: n,
  line,
})
const bounds = rect(0, 0, 300, 80)
const layout = (anchors: readonly MarkerAnchor[], targetSize = 24) =>
  layoutMarkers({ anchors, bounds, targetSize })
describe('independent character-anchored bubbles', () => {
  it('keeps a mid-line endpoint beside its own final character in dense text', () => {
    const character = rect(120, 110, 136, 131)
    const result = layoutMarkers({
      anchors: [
        {
          ...anchor(1, character),
          size: {
            width: 28,
            height: 28,
            fontSize: 12.8,
            labelWidth: 24,
            labelHeight: 24,
            fontFamily: 'Arial',
          },
        },
      ],
      bounds: rect(0, 0, 300, 200),
      targetSize: 24,
      obstacles: [rect(0, 78, 300, 99), rect(0, 110, 300, 131), rect(0, 142, 300, 163)],
    })
    const bubble = result.groups[0]!
    const left = bubble.left + (bubble.labelLeft ?? 0)
    const top = bubble.top + (bubble.labelTop ?? bubble.height - bubble.labelHeight!)
    expect(left - character.right).toBeGreaterThan(0)
    expect(left - character.right).toBeLessThan(4.8)
    expect(top).toBeLessThan(character.top)
    expect(Math.abs(top + bubble.labelHeight! - character.top)).toBeLessThan(4)
  })
  it('clamps a large hit area without moving its visible endpoint bubble', () => {
    const character = rect(248, 30, 264, 51)
    const result = layoutMarkers({
      anchors: [
        {
          ...anchor(1, character),
          ceiling: 0,
          size: {
            width: 44,
            height: 44,
            fontSize: 12.8,
            labelWidth: 24,
            labelHeight: 24,
            fontFamily: 'Arial',
          },
        },
      ],
      bounds: rect(0, 0, 300, 200),
      targetSize: 44,
      obstacles: [rect(0, 0, 300, 20), rect(0, 30, 300, 51)],
    })
    const bubble = result.groups[0]!
    expect(bubble.left + bubble.width).toBe(300)
    expect(bubble.top).toBe(0)
    expect(bubble.left + bubble.labelLeft!).toBeCloseTo(character.right + 12.8 * 0.2)
    expect(bubble.top + bubble.labelTop!).toBeCloseTo(character.top - 24 * 0.85)
  })
  it('keeps multiple records in the same superscript row beside a mid-line endpoint', () => {
    const character = rect(120, 110, 136, 131)
    const size = {
      width: 28,
      height: 28,
      fontSize: 12.8,
      labelWidth: 24,
      labelHeight: 24,
      fontFamily: 'Arial',
    }
    const result = layoutMarkers({
      anchors: [
        { ...anchor(1, character), size },
        { ...anchor(2, character), size },
      ],
      bounds: rect(0, 0, 300, 200),
      targetSize: 24,
      obstacles: [rect(0, 78, 300, 99), rect(0, 110, 300, 131), rect(0, 142, 300, 163)],
    })
    expect(result.groups).toHaveLength(2)
    expect(result.groups[1]!.top).toBe(result.groups[0]!.top)
    expect(result.groups[1]!.left).toBeGreaterThan(result.groups[0]!.left + result.groups[0]!.width)
  })
  it('reuses numeric measurements while keeping each content font and pointer hit area independent', () => {
    const first = document.createElement('p')
    const second = document.createElement('p')
    first.style.fontSize = '16px'
    second.style.fontSize = '24px'
    const cache = new Map<string, ReturnType<typeof markerSize>>()
    const measured = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return Number.parseFloat(this.parentElement?.style.fontSize ?? '0') * 1.9
    })
    const append = vi.spyOn(document.body, 'append')
    try {
      const small = markerSize(first, 100, 24, cache)
      expect(markerSize(first, 100, 24, cache)).toBe(small)
      expect(append).toHaveBeenCalledTimes(1)
      const large = markerSize(second, 100, 24, cache)
      expect(large.fontSize).toBeGreaterThan(small.fontSize)
      expect(large.labelHeight).toBeGreaterThan(small.labelHeight)
      expect(markerSize(first, 100, 44, cache).height).toBe(44)
      cache.clear()
      expect(markerSize(first, 100, 24, cache)).not.toBe(small)
      expect(document.body.querySelector('span')).toBeNull()
    } finally {
      measured.mockRestore()
      append.mockRestore()
    }
  })
  it('preserves every identical, overlapping and adjacent occurrence in source order', () => {
    const result = layout([
      anchor(3, rect(70, 40, 90, 60)),
      anchor(1, rect(70, 40, 90, 60)),
      anchor(2, rect(70, 40, 90, 60)),
      anchor(4, rect(90, 40, 110, 60)),
    ])
    expect(result.groups.map((item) => item.annotationIds)).toEqual([[id(1)], [id(2)], [id(3)], [id(4)]])
    expect(result.overflow).toEqual([])
    expect(result.groups[0]!.left).toBeGreaterThan(90)
    expect(result.groups[0]!.left).toBeLessThan(114)
    expect(result.groups[1]!.top).toBe(result.groups[0]!.top)
    expect(result.groups[1]!.left).toBeGreaterThan(result.groups[0]!.left + result.groups[0]!.width)
    for (const [index, current] of result.groups.entries())
      for (const other of result.groups.slice(index + 1))
        expect(
          current.left + current.width <= other.left ||
            other.left + other.width <= current.left ||
            current.top + current.height <= other.top ||
            other.top + other.height <= current.top,
        ).toBe(true)
  })
  it('moves above edge text rather than squeezing or covering it', () => {
    const result = layout([anchor(1, rect(290, 40, 300, 60))])
    const bubble = result.groups[0]!
    expect(bubble.left + bubble.width).toBeLessThanOrEqual(bounds.right)
    expect(bubble.left + (bubble.labelLeft ?? 0) + bubble.labelWidth!).toBe(bounds.right)
    expect(bubble.width).toBeGreaterThanOrEqual(24)
    expect(result.groups[0]!.top + result.groups[0]!.height).toBeLessThan(40)
    expect(result.overflow).toEqual([])
  })
  it('does not lose offscreen source records; unresolved selectors stay identifiable', () => {
    expect(layout([anchor(1, rect(50, 500, 60, 520)), anchor(2, null)]).overflow).toEqual([id(2)])
    expect(layout([anchor(1, rect(50, 500, 60, 520))]).groups).toHaveLength(1)
  })
  it('uses measured font and multi-digit widths without overlapping hit areas', () => {
    const result = layout([
      {
        ...anchor(100, rect(10, 40, 20, 60)),
        size: { width: 52, height: 36, fontSize: 18, labelWidth: 40, labelHeight: 20, fontFamily: 'Arial' },
      },
      anchor(101, rect(10, 40, 20, 60)),
    ])
    expect(result.groups[0]).toMatchObject({ width: 52, height: 36, fontSize: 18, left: 23.6 })
    expect(result.groups[1]!.left).toBeGreaterThan(result.groups[0]!.left + 52)
    expect(layout([anchor(1, rect(50, 10, 60, 30))], 44).groups[0]!.height).toBe(44)
  })
  it('keeps order stable after reflow and removes exactly the missing id', () => {
    const items = [
      anchor(1, rect(40, 20, 50, 40)),
      anchor(2, rect(40, 20, 50, 40)),
      anchor(3, rect(40, 20, 50, 40)),
    ]
    expect(
      layout(items.filter((item) => item.annotationId !== id(2))).groups.map((item) => item.annotationIds[0]),
    ).toEqual([id(1), id(3)])
    const first = layout(items)
    expect(sameMarkerLayout(first, layout([...items].reverse()))).toBe(true)
    expect(sameMarkerLayout(first, layout(items, 44))).toBe(false)
  })
})
