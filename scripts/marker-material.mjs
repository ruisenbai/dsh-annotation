/** Browser evidence for source-bubble transparency, blur, and number contrast. */
import assert from 'node:assert/strict'

/**
 * Check the painted material without changing marker state or interaction handlers.
 * @param marker Visible source marker locator.
 * @param options Whether backdrop blur is available in this scene.
 * @returns Computed material and contrast for the browser evidence report.
 */
export async function assertMarkerMaterial(marker, { blur = true } = {}) {
  const material = await marker.evaluate(async (element) => {
    const surface = element.querySelector('span')
    const style = getComputedStyle(surface)
    // Resolve the current state after its color transition finishes.
    await Promise.all(surface.getAnimations().map((animation) => animation.finished))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    }
    const foreground = rgba(style.color)
    const fill = rgba(style.backgroundColor)
    const base = rgba(style.getPropertyValue('--dsw-alias-bg-base'))
    const alpha = fill[3] / 255
    const luminance = (rgb) => {
      const linear = rgb.slice(0, 3).map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const background = fill.slice(0, 3).map((channel, index) => channel * alpha + base[index] * (1 - alpha))
    return {
      alpha,
      emphasized:
        (matchMedia('(hover: hover)').matches && element.matches(':hover')) ||
        element.matches(':focus-visible') ||
        element.dataset.active === 'true' ||
        element.getAttribute('aria-expanded') === 'true',
      fill,
      topLeftRadius: style.borderTopLeftRadius,
      bottomLeftRadius: style.borderBottomLeftRadius,
      height: surface.getBoundingClientRect().height,
      numberFont: Number.parseFloat(style.fontSize),
      blur: style.backdropFilter,
      opacity: style.opacity,
      foreground,
      border: rgba(style.borderTopColor),
      contrast:
        (Math.max(luminance(foreground), luminance(background)) + 0.05) /
        (Math.min(luminance(foreground), luminance(background)) + 0.05),
    }
  })
  assert.equal(material.opacity, '1', 'Transparency belongs to the fill, not the number')
  assert.deepEqual(material.foreground, [255, 255, 255, 255], 'Blue bubbles retain clear white numbers')
  assert.ok(
    material.fill[2] > material.fill[0] && material.fill[2] > material.fill[1],
    'The translucent surface is blue',
  )
  assert.ok(
    Number.parseFloat(material.bottomLeftRadius) < Number.parseFloat(material.topLeftRadius),
    'The original lower-left speech-bubble corner remains distinct',
  )
  assert.ok(
    material.height >= material.numberFont * 1.8,
    'The surface is visibly larger than the superseded tiny marker',
  )
  assert.ok(
    material.contrast >= 4.5,
    `The marker number needs readable contrast: ${JSON.stringify(material)}`,
  )
  if (material.emphasized)
    assert.equal(material.alpha, 1, 'Hover, keyboard focus and open records use an opaque blue fill')
  else assert.ok(material.alpha > 0 && material.alpha < 0.8, 'Idle bubbles have a visibly translucent fill')
  if (blur) assert.match(material.blur, /blur\(/)
  else assert.equal(material.blur, 'none')
  return material
}

/**
 * Capture the marker and adjacent source, including its area above the text line.
 * @param page Browser page containing the source.
 * @param marker Visible marker locator.
 * @param path Screenshot output path.
 */
export async function captureMarker(page, marker, path) {
  const bounds = await marker.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(bounds && viewport, 'Marker evidence requires visible bounds and an explicit viewport')
  const width = Math.min(360, viewport.width)
  const height = Math.min(100, viewport.height)
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, Math.min(bounds.x - 28, viewport.width - width)),
      y: Math.max(0, Math.min(bounds.y - 18, viewport.height - height)),
      width,
      height,
    },
  })
}
