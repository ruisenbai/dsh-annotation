// @vitest-environment jsdom
/** Capsule padding stays stable when zoomed DOM measurements round between adjacent fractions. */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useComposerChipLayout } from '../src/client/composer-chip-layout.ts'

function Capsule() {
  const ref = useComposerChipLayout(true)
  return (
    <div ref={ref} data-dia-annotation-chip="" className="dia-composer-chip">
      Annotations
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps one CSS padding height through fractional zoom measurements without repeated writes', () => {
  let width = 685.1
  let notify = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(548)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 100, width, this.hasAttribute('data-dia-annotation-chip') ? 30 : 0)
  })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ): DOMRectList {
    const rect = this.getBoundingClientRect()
    return {
      0: rect,
      length: 1,
      item: () => rect,
      [Symbol.iterator]: function* () {
        yield rect
        return undefined
      },
    }
  })
  const view = render(
    <div data-composer-card="">
      <div data-composer-overlay="">
        <Capsule />
      </div>
    </div>,
  )
  const card = view.container.querySelector<HTMLElement>('[data-composer-card]')!
  expect(card.style.getPropertyValue('--dia-composer-chip-space')).toBe('28px')
  const writes = vi.spyOn(card.style, 'setProperty')
  for (width of [684.9, 685.1, 685]) act(() => notify())
  expect(card.style.getPropertyValue('--dia-composer-chip-space')).toBe('28px')
  expect(writes).not.toHaveBeenCalled()
})
