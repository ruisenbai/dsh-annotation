// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { useCallback, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeAnnotationFloating,
  markerElement,
  selectionAnchor,
  useAnnotationFloating,
  type AnnotationFloatingAnchor,
} from '../src/client/floating.ts'
import type { AnnotationId, MessageIdentity } from '../src/shared/types.ts'

const disposers: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function replaceProperty(target: object, key: PropertyKey, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(target, key)
  disposers.push(() => {
    if (previous === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, previous)
  })
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height)
}

function setZoom(element: HTMLElement, value: string): void {
  const previous = element.getAttribute('style')
  disposers.push(() => {
    if (previous === null) element.removeAttribute('style')
    else element.setAttribute('style', previous)
  })
  element.style.setProperty('zoom', value)
}

function geometry() {
  return {
    anchor: rect(820, 300, 24, 22),
    body: rect(400, 80, 500, 1000),
    boundary: rect(0, 0, 1440, 900),
    composer: null as DOMRect | null,
    size: { width: 360, height: 220 },
  }
}

describe('annotation floating geometry', () => {
  it('uses an existing right gutter before the available space below a selection', () => {
    expect(computeAnnotationFloating(geometry())).toEqual({
      placement: 'right',
      left: 908,
      top: 300,
      maxWidth: 1416,
      maxHeight: 876,
    })
  })

  it('uses the left gutter when the right gutter is too narrow', () => {
    const input = geometry()
    input.body = rect(430, 80, 950, 1000)
    expect(computeAnnotationFloating(input)).toMatchObject({ placement: 'left', left: 62, top: 300 })
  })

  it('uses the measured height to flip above a selection and clear the composer', () => {
    const input = geometry()
    input.body = rect(100, 80, 1240, 1000)
    input.anchor = rect(1340, 640, 20, 22)
    input.composer = rect(400, 710, 640, 160)
    input.size.height = 280
    expect(computeAnnotationFloating(input)).toMatchObject({
      placement: 'top',
      top: 352,
      left: 1068,
      maxHeight: 690,
    })
  })

  it('uses space below the selection when neither gutter fits', () => {
    const input = geometry()
    input.body = rect(100, 80, 1240, 1000)
    expect(computeAnnotationFloating(input)).toMatchObject({ placement: 'bottom', left: 820, top: 330 })
  })

  it('keeps a tall overlay inside the visible scrollport without covering the selected line', () => {
    const input = geometry()
    input.boundary = rect(100, 100, 1240, 460)
    input.size.height = 380
    expect(computeAnnotationFloating(input)).toMatchObject({ placement: 'right', top: 168, maxHeight: 436 })
  })

  it('uses a compact scrollable panel on a narrow screen above the current composer', () => {
    const input = geometry()
    input.boundary = rect(0, 0, 390, 844)
    input.composer = rect(0, 640, 390, 200)
    input.size = { width: 366, height: 700 }
    expect(computeAnnotationFloating(input)).toEqual({
      placement: 'panel',
      left: 12,
      top: 322,
      maxWidth: 366,
      maxHeight: 310,
    })
  })

  it('uses visual-viewport offsets and dimensions in CSS pixels after zoom or a keyboard resize', () => {
    const input = geometry()
    input.boundary = rect(140, 210, 360, 440)
    input.composer = rect(140, 560, 360, 90)
    input.size = { width: 336, height: 260 }
    expect(computeAnnotationFloating(input)).toEqual({
      placement: 'panel',
      left: 152,
      top: 387,
      maxWidth: 336,
      maxHeight: 165,
    })
  })

  it.each([
    { label: 'missing', anchor: null },
    { label: 'above the viewport', anchor: rect(200, -300, 20, 20) },
    { label: 'beside the viewport', anchor: rect(1600, 200, 20, 20) },
  ])('uses a panel instead of retaining coordinates for an anchor $label', ({ anchor }) => {
    const input = geometry()
    const position = computeAnnotationFloating({ ...input, anchor })
    expect(position).toMatchObject({ placement: 'panel', top: 668 })
  })

  it('caps an overlay that fits neither gutter nor the space above or below', () => {
    const input = geometry()
    input.size.height = 1300
    expect(computeAnnotationFloating(input)).toEqual({
      placement: 'panel',
      left: 540,
      top: 450,
      maxWidth: 1416,
      maxHeight: 438,
    })
  })

  it('does not reserve height for a composer in a separate horizontal pane', () => {
    const input = geometry()
    input.boundary = rect(600, 100, 840, 700)
    input.composer = rect(0, 200, 550, 500)
    const position = computeAnnotationFloating(input)
    expect(position.maxHeight).toBe(676)
    expect(position.left).toBeGreaterThanOrEqual(612)
    expect(position.left + input.size.width).toBeLessThanOrEqual(1428)
  })
})

const firstId = 'annotation-1' as AnnotationId
const secondId = 'annotation-2' as AnnotationId
const messageId = 'reply-1' as MessageIdentity

function scene() {
  const root = document.createElement('div')
  root.dataset.conversationContent = ''
  document.body.append(root)
  disposers.push(() => root.remove())
  const scroll = document.createElement('div')
  // jsdom does not expand the overflow shorthand into computed longhands.
  scroll.style.overflowX = 'auto'
  scroll.style.overflowY = 'auto'
  const reply = document.createElement('section')
  reply.className = 'dia-assistant'
  reply.dataset.dshAnnotationMessageId = messageId
  const body = document.createElement('div')
  body.className = 'dia-assistant__body'
  body.textContent = 'A quoted sentence.'
  const marker = document.createElement('button')
  marker.className = 'dia-marker'
  marker.dataset.annotationId = firstId
  const composer = document.createElement('div')
  composer.dataset.composerCard = ''
  root.append(scroll)
  scroll.append(reply, composer)
  reply.append(body, marker)
  const bounds = {
    scroll: rect(100, 80, 1240, 790),
    body: rect(400, 100, 480, 1300),
    marker: rect(820, 400, 24, 22),
    composer: rect(450, 710, 580, 160),
    panelWidth: 360,
    panelHeight: 180,
    wrappedHeight: 540,
    portalScale: 1,
  }
  root.getBoundingClientRect = () => bounds.scroll
  scroll.getBoundingClientRect = () => bounds.scroll
  reply.getBoundingClientRect = () => bounds.body
  body.getBoundingClientRect = () => bounds.body
  marker.getBoundingClientRect = () => bounds.marker
  composer.getBoundingClientRect = () => bounds.composer
  const measurements = vi.fn((element: HTMLElement) => {
    const capWidth = Number.parseFloat(element.style.maxWidth)
    const capHeight = Number.parseFloat(element.style.maxHeight)
    const width = Math.min(bounds.panelWidth, Number.isNaN(capWidth) ? Infinity : capWidth)
    const height = width < bounds.panelWidth ? bounds.wrappedHeight : bounds.panelHeight
    return rect(
      (Number.parseFloat(element.style.left) || 0) * bounds.portalScale,
      (Number.parseFloat(element.style.top) || 0) * bounds.portalScale,
      width * bounds.portalScale,
      Math.min(height, Number.isNaN(capHeight) ? Infinity : capHeight) * bounds.portalScale,
    )
  })
  return {
    root,
    scroll,
    reply,
    body,
    marker,
    composer,
    bounds,
    measurements,
    anchor: () => markerElement(firstId, root),
  }
}

describe('live annotation anchors', () => {
  it('matches a grouped id exactly, skips hidden copies, and prefers a displayed focus marker', () => {
    const regular = scene()
    regular.marker.dataset.annotationIds = `${firstId} ${secondId}`
    const hidden = scene()
    hidden.root.hidden = true
    const focused = scene()
    focused.root.dataset.focusFlow = ''
    focused.marker.dataset.annotationIds = `${firstId} ${secondId}`
    const prefixOnly = scene()
    prefixOnly.marker.dataset.annotationIds = `${secondId}-other`
    expect(markerElement(secondId)).toBe(focused.marker)
    expect(markerElement(secondId, regular.root)).toBe(regular.marker)
    focused.root.setAttribute('aria-hidden', 'true')
    expect(markerElement(secondId)).toBe(regular.marker)
    regular.root.style.display = 'none'
    expect(markerElement(secondId)).toBeNull()
  })

  it('does not require an offset parent but excludes zero-sized or fully clipped markers', () => {
    const current = scene()
    expect(current.marker.offsetParent).toBeNull()
    expect(markerElement(firstId, current.root)).toBe(current.marker)
    current.bounds.marker = rect(820, 40, 24, 22)
    expect(markerElement(firstId, current.root)).toBeNull()
    current.bounds.marker = rect(820, 400, 0, 0)
    expect(markerElement(firstId, current.root)).toBeNull()
  })

  it('rebuilds a quote in the visible reply and does not reuse saved coordinates', () => {
    const hidden = scene()
    hidden.root.hidden = true
    const visible = scene()
    visible.root.dataset.focusFlow = ''
    let selected = rect(430, 340, 150, 44)
    replaceProperty(Range.prototype, 'getBoundingClientRect', function (this: Range) {
      expect(this.startContainer.parentElement).toBe(visible.body)
      return selected
    })
    const capture = {
      messageId,
      messageSeq: 1,
      responseVersion: messageId,
      quote: { exact: 'quoted', prefix: 'A ', suffix: ' sentence.', start: 2, end: 8 },
      rect: { top: 0, bottom: 1, left: 0, right: 1 },
    }
    expect(selectionAnchor(capture)).toMatchObject({ rect: selected, contextElement: visible.body })
    selected = rect(430, 210, 150, 44)
    expect(selectionAnchor(capture)).toMatchObject({ rect: selected })
    visible.body.textContent = 'The quote has disappeared.'
    expect(selectionAnchor(capture)).toBeNull()
    visible.root.remove()
    expect(selectionAnchor(capture)).toBeNull()
  })
})

function layoutEvents() {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame += 1
    frames.set(nextFrame, callback)
    return nextFrame
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  const observers: TestResizeObserver[] = []
  class TestResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>()
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.push(this)
    }
    observe(target: Element): void {
      this.targets.add(target)
    }
    unobserve(target: Element): void {
      this.targets.delete(target)
    }
    disconnect = vi.fn(() => {
      this.targets.clear()
    })
    notify(): void {
      this.callback([], this)
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  replaceProperty(window, 'innerWidth', 1440)
  replaceProperty(window, 'innerHeight', 900)
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 1440,
    height: 900,
    scale: 1,
  })
  replaceProperty(window, 'visualViewport', viewport)
  let resolveFonts!: () => void
  const fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => {
      resolveFonts = resolve
    }),
  })
  replaceProperty(document, 'fonts', fonts)
  return {
    frames,
    request,
    cancel,
    observers,
    viewport,
    fonts,
    resolveFonts,
    flush: () => {
      const pending = [...frames.values()]
      frames.clear()
      act(() => {
        for (const callback of pending) callback(0)
      })
    },
  }
}

function FloatingProbe({
  current,
  enabled = true,
  anchor,
  composer,
}: {
  current: ReturnType<typeof scene>
  enabled?: boolean
  anchor?: () => AnnotationFloatingAnchor | null
  composer?: () => HTMLElement | null
}) {
  const floatingRef = useRef<HTMLElement | null>(null)
  const attach = useCallback(
    (element: HTMLElement | null) => {
      floatingRef.current = element
      if (element !== null) element.getBoundingClientRect = () => current.measurements(element)
    },
    [current],
  )
  const floating = useAnnotationFloating({
    floatingRef,
    anchor: anchor ?? current.anchor,
    enabled,
    ...(composer === undefined ? {} : { composer }),
  })
  return (
    <aside ref={attach} data-testid="floating" style={floating.style} data-placement={floating.placement}>
      Comment
    </aside>
  )
}

describe('annotation floating lifecycle', () => {
  it('measures the panel and visible scrollport, and resolves the composer from the current region', () => {
    const events = layoutEvents()
    const unrelated = scene()
    unrelated.bounds.composer = rect(0, 100, 90, 700)
    const current = scene()
    render(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveAttribute('data-placement', 'right')
    expect(panel).toHaveStyle({ left: '888px', top: '400px', maxHeight: '610px', maxWidth: '1216px' })
    expect(events.observers[0]!.targets.has(current.body)).toBe(true)
    expect(events.observers[0]!.targets.has(current.scroll)).toBe(true)
    expect(events.observers[0]!.targets.has(current.composer)).toBe(true)
  })

  it('clips to the scaled client box without including its border or scrollbar', () => {
    layoutEvents()
    const current = scene()
    for (const [key, value] of Object.entries({
      offsetWidth: 620,
      offsetHeight: 395,
      clientLeft: 4,
      clientTop: 3,
      clientWidth: 600,
      clientHeight: 370,
    }))
      replaceProperty(current.scroll, key, value)
    render(<FloatingProbe current={current} />)
    expect(screen.getByTestId('floating')).toHaveStyle({
      left: '888px',
      maxWidth: '1176px',
      maxHeight: '604px',
    })
  })

  it('uses the window viewport when visualViewport is unavailable', () => {
    const events = layoutEvents()
    replaceProperty(window, 'visualViewport', null)
    const current = scene()
    render(<FloatingProbe current={current} />)
    window.innerHeight = 580
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    events.flush()
    expect(screen.getByTestId('floating')).toHaveStyle({ top: '388px', maxHeight: '476px' })
  })

  it('coalesces scrolling, resizing, font completion, viewport movement, and observer callbacks into one frame', async () => {
    const events = layoutEvents()
    const current = scene()
    render(<FloatingProbe current={current} />)
    const initial = current.measurements.mock.calls.length
    current.bounds.marker = rect(820, 250, 24, 22)
    await act(async () => {
      events.resolveFonts()
      current.scroll.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
      events.viewport.dispatchEvent(new Event('resize'))
      events.viewport.dispatchEvent(new Event('scroll'))
      events.fonts.dispatchEvent(new Event('loadingdone'))
      events.observers[0]!.notify()
    })
    expect(events.frames.size).toBe(1)
    expect(current.measurements).toHaveBeenCalledTimes(initial)
    events.flush()
    expect(current.measurements).toHaveBeenCalledTimes(initial + 1)
    expect(screen.getByTestId('floating')).toHaveStyle({ top: '250px' })
  })

  it('remeasures grown content without preserving an earlier height cap, then returns to a gutter after shrink', () => {
    const events = layoutEvents()
    const current = scene()
    render(<FloatingProbe current={current} />)
    current.bounds.panelHeight = 1100
    act(() => {
      events.observers[0]!.notify()
    })
    events.flush()
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveAttribute('data-placement', 'panel')
    expect(panel).toHaveStyle({ top: '397px', maxHeight: '305px' })
    current.bounds.panelHeight = 240
    act(() => {
      events.observers[0]!.notify()
    })
    events.flush()
    expect(panel).toHaveAttribute('data-placement', 'right')
    expect(panel).toHaveStyle({ top: '400px', maxHeight: '610px' })
  })

  it('constrains width before measuring wrapped content in the resized visual viewport', () => {
    const events = layoutEvents()
    const current = scene()
    render(<FloatingProbe current={current} />)
    Object.assign(events.viewport, { offsetLeft: 200, offsetTop: 120, width: 360, height: 480, scale: 2 })
    current.bounds.composer = rect(200, 520, 360, 80)
    act(() => {
      events.viewport.dispatchEvent(new Event('resize'))
    })
    events.flush()
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveAttribute('data-placement', 'panel')
    expect(panel).toHaveStyle({ left: '212px', top: '322px', maxWidth: '336px', maxHeight: '190px' })
    expect(panel.getBoundingClientRect().bottom).toBe(512)
    expect(panel.getBoundingClientRect().right).toBe(548)
  })

  it.each([
    { label: 'root 200%', rootZoom: '2', bodyZoom: '1', scale: 2 },
    { label: 'body 200%', rootZoom: '1', bodyZoom: '2', scale: 2 },
    { label: 'root 125%', rootZoom: '125%', bodyZoom: '1', scale: 1.25 },
    { label: 'body 125%', rootZoom: '1', bodyZoom: '1.25', scale: 1.25 },
    { label: 'nested 250%', rootZoom: '1.25', bodyZoom: '2', scale: 2.5 },
  ])('converts fixed styles from visual coordinates at CSS zoom $label', ({ rootZoom, bodyZoom, scale }) => {
    const events = layoutEvents()
    Object.assign(events.viewport, { width: 390, height: 844 })
    const current = scene()
    current.bounds.scroll = rect(0, 0, 390, 844)
    current.bounds.composer = rect(12, 640, 366, 200)
    current.bounds.portalScale = scale
    setZoom(document.documentElement, rootZoom)
    setZoom(document.body, bodyZoom)
    render(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveAttribute('data-placement', 'panel')
    expect(Number.parseFloat(panel.style.left)).toBeCloseTo(12 / scale, 4)
    expect(Number.parseFloat(panel.style.top)).toBeCloseTo(322 / scale, 4)
    expect(Number.parseFloat(panel.style.maxWidth)).toBeCloseTo(366 / scale, 4)
    expect(Number.parseFloat(panel.style.maxHeight)).toBeCloseTo(310 / scale, 4)
    const visible = panel.getBoundingClientRect()
    expect(visible.left).toBeCloseTo(12, 4)
    expect(visible.right).toBeCloseTo(378, 4)
    expect(visible.top).toBeCloseTo(322, 4)
    expect(visible.bottom).toBeCloseTo(632, 4)
  })

  it.each([2, 1.25])('keeps visualViewport offsets independent of CSS zoom %s', (scale) => {
    const events = layoutEvents()
    const current = scene()
    current.bounds.portalScale = scale
    current.bounds.composer = rect(200, 520, 360, 80)
    Object.assign(events.viewport, { offsetLeft: 200, offsetTop: 120, width: 360, height: 480, scale: 3 })
    setZoom(document.documentElement, String(scale))
    render(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    expect(Number.parseFloat(panel.style.left)).toBeCloseTo(212 / scale, 4)
    expect(Number.parseFloat(panel.style.top)).toBeCloseTo(322 / scale, 4)
    expect(Number.parseFloat(panel.style.maxWidth)).toBeCloseTo(336 / scale, 4)
    expect(Number.parseFloat(panel.style.maxHeight)).toBeCloseTo(190 / scale, 4)
    const visible = panel.getBoundingClientRect()
    expect(visible.left).toBeCloseTo(212, 4)
    expect(visible.right).toBeCloseTo(548, 4)
    expect(visible.top).toBeCloseTo(322, 4)
    expect(visible.bottom).toBeCloseTo(512, 4)
  })

  it('remeasures when root CSS zoom changes while the panel is open', async () => {
    const events = layoutEvents()
    const current = scene()
    Object.assign(events.viewport, { width: 390, height: 844 })
    current.bounds.scroll = rect(0, 0, 390, 844)
    current.bounds.composer = rect(12, 640, 366, 200)
    render(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveStyle({ left: '15px', top: '452px' })
    await act(async () => {
      current.bounds.portalScale = 2
      setZoom(document.documentElement, '2')
    })
    expect(events.frames.size).toBe(1)
    events.flush()
    expect(panel).toHaveStyle({ left: '6px', top: '161px', maxWidth: '183px', maxHeight: '155px' })
    expect(panel.getBoundingClientRect().bottom).toBe(632)
    await act(async () => {
      current.bounds.portalScale = 1
      setZoom(document.documentElement, '1')
    })
    events.flush()
    expect(panel).toHaveStyle({ left: '15px', top: '452px', maxWidth: '366px', maxHeight: '310px' })
  })

  it('preserves panel scrolling during measurement and ignores scroll events inside the panel', () => {
    const events = layoutEvents()
    const current = scene()
    current.bounds.panelHeight = 900
    render(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    panel.scrollTop = 120
    act(() => {
      panel.dispatchEvent(new Event('scroll'))
    })
    expect(events.frames.size).toBe(0)
    current.measurements.mockImplementationOnce((element) => {
      // Removing a height cap makes the browser clamp its former scroll offset to zero.
      element.scrollTop = 0
      return rect(0, 0, 360, 900)
    })
    act(() => {
      events.observers[0]!.notify()
    })
    events.flush()
    expect(panel.scrollTop).toBe(120)
  })

  it('responds to real content mutations without requiring a scroll or resize event', async () => {
    const events = layoutEvents()
    const current = scene()
    render(<FloatingProbe current={current} />)
    current.bounds.panelHeight = 720
    await act(async () => {
      screen.getByTestId('floating').append(' Additional detail')
    })
    expect(events.frames.size).toBe(1)
    events.flush()
    expect(screen.getByTestId('floating')).toHaveAttribute('data-placement', 'panel')
  })

  it('falls back when an anchor scrolls away or is removed, without changing focus', async () => {
    const events = layoutEvents()
    const current = scene()
    const input = document.createElement('textarea')
    current.composer.append(input)
    input.focus()
    const composer = () => current.composer
    render(<FloatingProbe current={current} composer={composer} />)
    current.bounds.marker = rect(820, -100, 24, 22)
    act(() => {
      current.scroll.dispatchEvent(new Event('scroll'))
    })
    events.flush()
    expect(screen.getByTestId('floating')).toHaveAttribute('data-placement', 'panel')
    expect(screen.getByTestId('floating')).toHaveStyle({ top: '522px' })
    await act(async () => {
      current.reply.remove()
    })
    events.flush()
    expect(screen.getByTestId('floating')).toHaveAttribute('data-placement', 'panel')
    expect(document.activeElement).toBe(input)
  })

  it('rebinds resize observation after a marker is replaced', async () => {
    const events = layoutEvents()
    const current = scene()
    render(<FloatingProbe current={current} />)
    const replacement = current.marker.cloneNode() as HTMLButtonElement
    replacement.getBoundingClientRect = () => rect(820, 180, 24, 22)
    await act(async () => {
      current.marker.replaceWith(replacement)
    })
    events.flush()
    expect(screen.getByTestId('floating')).toHaveStyle({ top: '180px' })
    expect(events.observers[0]!.targets.has(current.marker)).toBe(false)
    expect(events.observers[0]!.targets.has(replacement)).toBe(true)
  })

  it('does not create measurement feedback between two open overlays', async () => {
    const events = layoutEvents()
    const first = scene()
    const second = scene()
    render(
      <>
        <FloatingProbe current={first} />
        <FloatingProbe current={second} />
      </>,
    )
    await act(async () => {})
    act(() => {
      for (const observer of events.observers) observer.notify()
    })
    events.flush()
    await act(async () => {})
    expect(events.frames.size).toBe(0)
  })

  it('cancels pending frames and disconnects every event source on disable and unmount', async () => {
    const events = layoutEvents()
    const current = scene()
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const mounted = render(<FloatingProbe current={current} enabled={false} />)
    expect(events.observers).toHaveLength(0)
    mounted.rerender(<FloatingProbe current={current} />)
    const panel = screen.getByTestId('floating')
    expect(panel).toHaveAttribute('data-annotation-floating')
    act(() => {
      events.observers[0]!.notify()
    })
    expect(events.frames.size).toBe(1)
    mounted.rerender(<FloatingProbe current={current} enabled={false} />)
    expect(panel).not.toHaveAttribute('data-annotation-floating')
    expect(events.cancel).toHaveBeenCalled()
    expect(events.frames.size).toBe(0)
    expect(events.observers[0]!.disconnect).toHaveBeenCalledTimes(1)
    mounted.rerender(<FloatingProbe current={current} />)
    act(() => {
      events.observers[1]!.notify()
    })
    mounted.unmount()
    expect(panel).not.toHaveAttribute('data-annotation-floating')
    expect(events.frames.size).toBe(0)
    expect(events.observers[1]!.disconnect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(2)
    const scheduled = events.request.mock.calls.length
    await act(async () => {
      events.resolveFonts()
      window.dispatchEvent(new Event('resize'))
      current.scroll.dispatchEvent(new Event('scroll'))
      events.viewport.dispatchEvent(new Event('resize'))
      events.viewport.dispatchEvent(new Event('scroll'))
      events.fonts.dispatchEvent(new Event('loadingdone'))
      events.fonts.dispatchEvent(new Event('loadingerror'))
      for (const observer of events.observers) observer.notify()
      current.body.append('late content')
    })
    expect(events.request).toHaveBeenCalledTimes(scheduled)
    expect(events.frames.size).toBe(0)
  })
})
