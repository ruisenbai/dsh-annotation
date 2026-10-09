/** Temporary viewport overlay for the exact source characters found by navigation. */
export const SOURCE_FLASH_MS = 2_200

function measuredRects(range: Range): DOMRect[] {
  return typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
}

/**
 * Draw selected Range fragments above a file or Diff preview while its scroll position settles.
 * @param root - mounted source view that clips the flash.
 * @param ranges - verified text ranges in that view.
 * @returns a cleanup function, or null when the browser cannot measure the text.
 */
export function showSourceFlash(root: HTMLElement, ranges: readonly Range[]): (() => void) | null {
  const measurable = ranges.some((range) =>
    measuredRects(range).some((rect) => rect.width > 0 && rect.height > 0),
  )
  if (!measurable) return null
  const layer = document.createElement('div')
  layer.className = 'dia-source-flash-layer'
  layer.setAttribute('aria-hidden', 'true')
  let disposed = false
  const draw = (): void => {
    if (disposed) return
    if (!root.isConnected) {
      dispose()
      return
    }
    const bounds = root.getBoundingClientRect()
    const fragments = ranges.flatMap(measuredRects)
    const visible = fragments
      .map((rect) => ({
        left: Math.max(0, bounds.left, rect.left),
        top: Math.max(0, bounds.top, rect.top),
        right: Math.min(window.innerWidth, bounds.right, rect.right),
        bottom: Math.min(window.innerHeight, bounds.bottom, rect.bottom),
      }))
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    while (layer.childElementCount > visible.length) layer.lastElementChild?.remove()
    while (layer.childElementCount < visible.length) {
      const fragment = document.createElement('span')
      fragment.className = 'dia-source-flash'
      layer.append(fragment)
    }
    visible.forEach((rect, index) => {
      const fragment = layer.children.item(index) as HTMLElement
      fragment.style.left = `${rect.left}px`
      fragment.style.top = `${rect.top}px`
      fragment.style.width = `${rect.right - rect.left}px`
      fragment.style.height = `${rect.bottom - rect.top}px`
    })
  }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    window.clearTimeout(timer)
    window.removeEventListener('scroll', draw, true)
    window.removeEventListener('resize', draw)
    observer?.disconnect()
    layer.remove()
  }
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw)
  const timer = window.setTimeout(dispose, SOURCE_FLASH_MS)
  document.body.append(layer)
  window.addEventListener('scroll', draw, true)
  window.addEventListener('resize', draw)
  observer?.observe(root)
  draw()
  return dispose
}
