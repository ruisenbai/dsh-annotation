/** Browser evidence for source-bubble transparency, blur, and number contrast. */
import assert from 'node:assert/strict'

/**
 * Check the painted material without changing marker state or interaction handlers.
 * @param marker Visible source marker locator.
 * @param opaque Whether its annotation or group has been opened.
 * @returns Computed material and contrast for the browser evidence report.
 */
export async function assertMarkerMaterial(marker, opaque) {
  const material = await marker.evaluate((element) => {
    const style = getComputedStyle(element)
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
      blur: style.backdropFilter,
      opacity: style.opacity,
      foreground,
      border: rgba(style.borderTopColor),
      contrast: (luminance(foreground) + 0.05) / (luminance(background) + 0.05),
    }
  })
  assert.equal(material.opacity, '1', 'Transparency belongs to the fill, not the number')
  assert.deepEqual(material.foreground, [255, 255, 255, 255])
  assert.deepEqual(material.border, [255, 255, 255, 255])
  assert.ok(
    material.contrast >= 4.5,
    `The marker number needs readable contrast: ${JSON.stringify(material)}`,
  )
  if (opaque) {
    assert.equal(material.alpha, 1, 'An opened marker must be opaque')
    assert.equal(material.blur, 'none')
  } else {
    assert.ok(material.alpha > 0 && material.alpha < 1, 'An unopened marker must be translucent')
    assert.match(material.blur, /blur\(/)
  }
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
