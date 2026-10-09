// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { showSourceFlash, SOURCE_FLASH_MS } from '../src/client/source-flash.ts'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('fades the measured source text, follows scrolling, and removes the overlay', () => {
  vi.useFakeTimers()
  const root = document.createElement('div')
  root.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
  document.body.append(root)
  const range = document.createRange()
  let top = 30
  Object.defineProperty(range, 'getClientRects', {
    value: () => {
      const rects = [new DOMRect(20, top, 100, 18)]
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null })
    },
  })

  const dispose = showSourceFlash(root, [range])
  const flash = document.querySelector<HTMLElement>('.dia-source-flash')
  expect(dispose).not.toBeNull()
  expect(flash?.style.top).toBe('30px')
  top = 70
  window.dispatchEvent(new Event('scroll'))
  expect(flash?.style.top).toBe('70px')
  vi.advanceTimersByTime(SOURCE_FLASH_MS)
  expect(document.querySelector('.dia-source-flash-layer')).toBeNull()
  dispose?.()
})

it('leaves unmeasurable text to the existing custom-highlight fallback', () => {
  const root = document.createElement('div')
  document.body.append(root)
  const range = document.createRange()
  Object.defineProperty(range, 'getClientRects', { value: () => [] })
  expect(showSourceFlash(root, [range])).toBeNull()
  expect(document.querySelector('.dia-source-flash-layer')).toBeNull()
})
