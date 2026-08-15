import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function selectExact(page, exact) {
  await page.evaluate((selectedText) => {
    const body = document.querySelector('.dia-assistant__body')
    if (!(body instanceof HTMLElement)) throw new Error('assistant body is unavailable')
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      const start = text.indexOf(selectedText)
      if (start >= 0) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + selectedText.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        ;(node.parentElement ?? body).dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        return
      }
      node = walker.nextNode()
    }
    throw new Error(`text not found: ${selectedText}`)
  }, exact)
}

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [
    {
      name: 'inline-annotation-browser-fixture',
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? '/', 'http://fixture.local').pathname
          if (pathname !== '/') {
            next()
            return
          }
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/fixture.tsx"></script></body></html>',
          )
        })
      },
    },
  ],
})

let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || typeof address === 'string' || address === undefined) {
    throw new Error('Vite did not expose a TCP address')
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })

  const paragraph = page.locator('.dia-assistant__body p').last()
  await paragraph.scrollIntoViewIfNeeded()
  await selectExact(page, 'selected phrase')
  await page.getByRole('button', { name: 'Add annotation' }).click()

  let dialog = page.getByRole('dialog', { name: 'Add annotation' })
  await dialog.waitFor()
  assert((await dialog.locator('textarea').count()) === 1, 'compact editor must expose one direct textarea')
  assert(
    (await dialog.locator('blockquote, header').count()) === 0,
    'compact editor must not render legacy chrome',
  )
  const editorButtons = dialog.locator('button')
  assert((await editorButtons.count()) === 2, 'compact editor must expose exactly cancel and save buttons')
  for (let index = 0; index < 2; index += 1) {
    const button = editorButtons.nth(index)
    assert((await button.locator('svg').count()) === 1, 'editor action must use an icon')
    assert((await button.textContent())?.trim() === '', 'editor icon action must not show text')
  }

  await page.locator('h1').dispatchEvent('pointerdown')
  await dialog.waitFor({ state: 'detached' })

  await selectExact(page, 'selected phrase')
  await page.getByRole('button', { name: 'Add annotation' }).click()
  dialog = page.getByRole('dialog', { name: 'Add annotation' })
  const input = dialog.getByRole('textbox', { name: 'Your comment' })
  await input.fill('Needs a concrete explanation.')
  await page.getByText('Automatically saved locally').waitFor()
  const stored = await page.evaluate(() => localStorage.getItem('dsh-inline-annotations:v1:browser-session'))
  assert(stored?.includes('Needs a concrete explanation.') === true, 'unfinished input must be autosaved')

  await page.locator('h1').dispatchEvent('pointerdown')
  assert((await dialog.count()) === 1, 'dirty outside click must keep the editor open')
  assert(
    (await dialog.getAttribute('data-decision-required')) === 'true',
    'dirty editor must require a decision',
  )
  const borderColor = await input.evaluate((element) => getComputedStyle(element).borderColor)
  assert(borderColor === 'rgb(211, 58, 58)', `dirty editor border must be red, received ${borderColor}`)
  const animationName = await input.evaluate((element) => getComputedStyle(element).animationName)
  assert(animationName.startsWith('dia-editor-shake-'), 'dirty editor must shake after an outside click')
  await dialog.getByRole('button', { name: 'Save annotation' }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.locator('.dia-marker').waitFor()

  const placement = await page.evaluate(() => {
    const marker = document.querySelector('.dia-marker')?.getBoundingClientRect()
    const paragraphElement = document.querySelector('.dia-assistant__body p')
    if (marker === undefined || !(paragraphElement instanceof HTMLElement)) return null
    const text = paragraphElement.textContent ?? ''
    const start = text.indexOf('selected phrase')
    const textNode = paragraphElement.firstChild
    if (!(textNode instanceof Text) || start < 0) return null
    const selected = document.createRange()
    selected.setStart(textNode, start)
    selected.setEnd(textNode, start + 'selected phrase'.length)
    const selectedLine = Array.from(selected.getClientRects()).at(-1)
    const whole = document.createRange()
    whole.selectNodeContents(paragraphElement)
    const sameLine = Array.from(whole.getClientRects()).filter(
      (rect) => selectedLine !== undefined && Math.abs(rect.top - selectedLine.top) < 1,
    )
    return {
      markerLeft: marker.left,
      lineRight: Math.max(...sameLine.map((rect) => rect.right)),
    }
  })
  assert(
    placement !== null && placement.markerLeft >= placement.lineRight + 2,
    'marker must follow the complete visual line',
  )

  await page.getByTestId('seed-same-line').click()
  await page.locator('.dia-marker').nth(4).waitFor()
  const readMarkers = () =>
    page.locator('.dia-marker').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { ordinal: Number(element.textContent), left: rect.left, right: rect.right, top: rect.top }
      }),
    )
  const markerLayout = await readMarkers()
  assert(markerLayout.length === 5, 'fixture must render five annotated selections')
  const sameRowPairs = markerLayout.flatMap((left, index) =>
    markerLayout
      .slice(index + 1)
      .filter((right) => Math.abs(left.top - right.top) < 2)
      .map((right) => [left, right]),
  )
  assert(sameRowPairs.length > 0, 'fixture must exercise multiple markers on one visual line')
  assert(
    sameRowPairs.every(([left, right]) => left.ordinal < right.ordinal && left.left < right.left),
    'same-row marker numbers must ascend from left to right',
  )

  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.25'
    window.dispatchEvent(new Event('resize'))
  })
  await page.waitForTimeout(150)
  const zoomLayout = await readMarkers()
  const viewportWidth = page.viewportSize()?.width ?? 390
  assert(
    zoomLayout.every((rect) => rect.right <= viewportWidth + 0.5),
    'mobile markers must remain inside the viewport after zoom',
  )

  const firstMarkerTop = zoomLayout[0].top
  await page.locator('.dia-assistant__reasoning summary').click()
  await page.waitForFunction(
    (before) => (document.querySelector('.dia-marker')?.getBoundingClientRect().top ?? before) > before + 5,
    firstMarkerTop,
  )
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert(background === 'rgb(21, 25, 30)', `dark-mode fixture must use dark tokens, received ${background}`)

  await page.locator('.dia-dock').click()
  await page.locator('.dia-item').first().getByRole('button', { name: 'Locate source' }).click()
  await page.waitForTimeout(1200)
  const centering = await page.evaluate(() => {
    const scroller = document.querySelector('.browser-scroller')?.getBoundingClientRect()
    const marker = document.querySelector('.dia-marker')?.getBoundingClientRect()
    if (scroller === undefined || marker === undefined) return null
    return Math.abs((marker.top + marker.bottom) / 2 - (scroller.top + scroller.bottom) / 2)
  })
  assert(
    centering !== null && centering < 36,
    `located marker line must be vertically centered (delta ${String(centering)})`,
  )

  assert(failures.length === 0, `browser console errors:\n${failures.join('\n')}`)
  console.log(
    'browser regression passed: compact editor, autosave, mobile markers, dark mode, zoom, reasoning, locate',
  )
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
