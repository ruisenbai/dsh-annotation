// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { HighlightManager } from '../src/client/highlight.ts'

const originalCSS = globalThis.CSS
const originalHighlight = (globalThis as typeof globalThis & { Highlight?: unknown }).Highlight

afterEach(() => {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: originalCSS })
  Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: originalHighlight })
})

describe('CSS highlight manager', () => {
  it('aggregates message ranges, activates one range, and disposes names', () => {
    const values = new Map<string, unknown>()
    const highlights = {
      set: (name: string, value: unknown) => values.set(name, value),
      delete: (name: string) => values.delete(name),
    }
    class FakeHighlight {
      readonly ranges: readonly Range[]
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights } })
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: FakeHighlight })
    const manager = new HighlightManager()
    const first = document.createRange()
    const second = document.createRange()
    expect(manager.supported()).toBe(true)
    manager.update('message-1', [first])
    manager.update('message-2', [second])
    expect((values.get('dsh-inline-annotation') as FakeHighlight).ranges).toEqual([first, second])
    manager.activate('message-1', first)
    expect((values.get('dsh-inline-annotation-active') as FakeHighlight).ranges).toEqual([first])
    manager.remove('message-1')
    expect((values.get('dsh-inline-annotation') as FakeHighlight).ranges).toEqual([second])
    manager.dispose()
    expect(values.size).toBe(0)
  })

  it('fails soft when the browser API is absent', () => {
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: undefined })
    const manager = new HighlightManager()
    expect(manager.supported()).toBe(false)
    expect(() => {
      manager.update('message', [document.createRange()])
      manager.activate('message', null)
      manager.remove('message')
      manager.dispose()
    }).not.toThrow()
  })
})
