import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(root, 'artifacts', 'browser')
const failures = []
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const readingVariants = [
  { name: 'wide-light', width: 1440, color: 'light', zoom: 1 },
  { name: 'wide-dark-125', width: 1440, color: 'dark', zoom: 1.25 },
  { name: 'narrow-dark', width: 390, color: 'dark', zoom: 1 },
  { name: 'narrow-light-200', width: 390, color: 'light', zoom: 2 },
  { name: 'no-safe-space', width: 390, color: 'light', zoom: 1, blocked: true },
]
const selectedCase = process.argv[2]
assert(
  process.argv.length <= 3 &&
    (selectedCase === undefined ||
      ['legacy', 'reply', ...readingVariants.map((variant) => variant.name)].includes(selectedCase)),
  'Pass one browser case name, or omit it to run every case',
)

async function selectExact(page, exact, release = 'inside') {
  await page.evaluate(
    ({ selectedText, release }) => {
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
          const target = release === 'outside' ? document.body : (node.parentElement ?? body)
          target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
          return
        }
        node = walker.nextNode()
      }
      throw new Error(`text not found: ${selectedText}`)
    },
    { selectedText: exact, release },
  )
}

async function painted(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function textLayout(body) {
  return body.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const rects = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          rects.push([rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height])
        }
      }
    }
    return {
      text: element.textContent,
      width: bounds.width,
      height: bounds.height,
      padding: getComputedStyle(element).padding,
      rects,
    }
  })
}

function assertSameTextLayout(before, after, label) {
  const close = (left, right) => Math.abs(left - right) <= 0.1
  assert(
    before.text === after.text &&
      before.padding === after.padding &&
      close(before.width, after.width) &&
      close(before.height, after.height) &&
      before.rects.length === after.rects.length &&
      before.rects.every((rect, index) =>
        rect.every((value, edge) => close(value, after.rects[index][edge])),
      ),
    `${label}: annotations must not change source width, padding, text, or line rectangles\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`,
  )
}

async function assertMarkersAvoidText(page) {
  const collisions = await page.locator('.dia-assistant').evaluateAll((roots) => {
    const collisions = []
    for (const root of roots) {
      const body = root.querySelector('.dia-assistant__body')
      if (body === null) continue
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      const obstacles = []
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        obstacles.push(...Array.from(range.getClientRects()))
      }
      for (const element of body.querySelectorAll('pre, table, img, button')) {
        obstacles.push(element.getBoundingClientRect())
      }
      for (const marker of root.querySelectorAll('.dia-marker')) {
        const rect = marker.getBoundingClientRect()
        if (
          obstacles.some(
            (text) =>
              text.width > 0 &&
              text.height > 0 &&
              Math.min(rect.right, text.right) - Math.max(rect.left, text.left) > 0.1 &&
              Math.min(rect.bottom, text.bottom) - Math.max(rect.top, text.top) > 0.1,
          )
        ) {
          collisions.push({ label: marker.getAttribute('aria-label'), rect: rect.toJSON() })
        }
      }
    }
    return collisions
  })
  assert(collisions.length === 0, `markers must not cover text or code: ${JSON.stringify(collisions)}`)
}

async function assertFloatingSafe(page, selector, expectedPlacement) {
  await painted(page)
  const geometry = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const scroller = document.querySelector('.browser-scroller')
    if (!(scroller instanceof HTMLElement)) throw new Error('fixture scrollport is unavailable')
    const port = scroller.getBoundingClientRect()
    const scaleX = port.width / scroller.offsetWidth
    const scaleY = port.height / scroller.offsetHeight
    const viewport = window.visualViewport
    const left = Math.max(viewport?.offsetLeft ?? 0, port.left + scroller.clientLeft * scaleX) + 12
    const right =
      Math.min(
        (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
        port.left + (scroller.clientLeft + scroller.clientWidth) * scaleX,
      ) - 12
    const top = Math.max(viewport?.offsetTop ?? 0, port.top + scroller.clientTop * scaleY) + 12
    let bottom =
      Math.min(
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
        port.top + (scroller.clientTop + scroller.clientHeight) * scaleY,
      ) - 12
    const composer = document.querySelector('[data-composer-card]')?.getBoundingClientRect()
    if (composer !== undefined && composer.top < bottom && composer.bottom > top) bottom = composer.top - 8
    return {
      rect: rect.toJSON(),
      bounds: { left, right, top, bottom },
      placement: element.getAttribute('data-floating-placement'),
      inDock: element.closest('.dia-dock-shell') !== null,
    }
  })
  const { rect, bounds, placement } = geometry
  assert(
    rect.left >= bounds.left - 1 &&
      rect.right <= bounds.right + 1 &&
      rect.top >= bounds.top - 1 &&
      rect.bottom <= bounds.bottom + 1,
    `${selector} must fit the visible scrollport above the composer: ${JSON.stringify(geometry)}`,
  )
  if (expectedPlacement !== undefined) {
    assert(
      placement === expectedPlacement,
      `${selector} placement must be ${expectedPlacement}: ${JSON.stringify(geometry)}`,
    )
  }
  if (placement === 'panel') {
    assert(
      rect.height <= Math.max(0, bounds.bottom - bounds.top) / 2 + 1,
      `${selector} panel must use at most half the safe height: ${JSON.stringify(geometry)}`,
    )
  }
  assert(!geometry.inDock, `${selector} must stay outside the annotation summary`)
  return geometry
}

async function textEndpoints(body, exact) {
  return body.evaluate((element, selectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = (node.textContent ?? '').indexOf(selectedText)
      if (start < 0) continue
      const first = document.createRange()
      first.setStart(node, start)
      first.setEnd(node, start + 1)
      const last = document.createRange()
      last.setStart(node, start + selectedText.length - 1)
      last.setEnd(node, start + selectedText.length)
      const a = first.getBoundingClientRect()
      const b = last.getBoundingClientRect()
      return {
        start: { x: a.left + 0.2, y: (a.top + a.bottom) / 2 },
        end: { x: b.right - 0.2, y: (b.top + b.bottom) / 2 },
      }
    }
    throw new Error(`selectable fixture text is missing: ${selectedText}`)
  }, exact)
}

async function dragAndCopy(page, body, exact) {
  const points = await textEndpoints(body, exact)
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 20 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString())
  assert(selected === exact, `native dragging must retain the complete text: ${JSON.stringify(selected)}`)
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert(copied === exact, `native copy must contain source text once: ${JSON.stringify(copied)}`)
  assert(
    (await page.locator('.dia-marker-popover, .dia-reply-popover').count()) === 0,
    'selecting source text must not open annotation previews',
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
}

async function assertAnnotationCopyReadable(container, label) {
  const visibleCopy = await container.locator('.dia-item__copy').evaluate((element) => {
    const copy = element.getBoundingClientRect()
    const quote = element.querySelector('q')
    const note = element.querySelector(':scope > span')
    const availableWidth = (part) => {
      const rect = part.getBoundingClientRect()
      return Math.max(0, Math.min(copy.right, rect.right) - Math.max(copy.left, rect.left))
    }
    const quoteRange = document.createRange()
    quoteRange.selectNodeContents(quote)
    const noteRange = document.createRange()
    noteRange.setStart(note.firstChild, 0)
    noteRange.setEnd(note.firstChild, 'Reading'.length)
    return {
      quoteWidth: availableWidth(quote),
      quoteTextWidth: quoteRange.getBoundingClientRect().width,
      noteWidth: availableWidth(note),
      firstWordWidth: noteRange.getBoundingClientRect().width,
    }
  })
  assert(
    visibleCopy.quoteWidth >= visibleCopy.quoteTextWidth &&
      visibleCopy.noteWidth >= visibleCopy.firstWordWidth,
    `${label}: the quote and annotation must remain visibly readable, not only named in ARIA: ${JSON.stringify(visibleCopy)}`,
  )
}

async function assertNoLocalDataTools(page) {
  const panel = page.locator('.dia-inline-panel')
  await panel.waitFor()
  assert(
    (await panel.locator('.dia-local-data, .dia-local-status, .dia-clear-confirm, a[download]').count()) ===
      0,
    'the annotation list must not render local-data usage, downloads, or bulk-clear controls',
  )
  assert(
    (await panel.getByText(/^Local data ·/).count()) === 0,
    'the annotation list must not display local storage usage',
  )
  assert(
    (await panel
      .getByRole('button', { name: /^(?:Export local data(?: for this Session)?|Clear local drafts)$/ })
      .count()) === 0,
    'the annotation list must not offer local-data export or bulk draft deletion',
  )
}

async function compactSummaryRegression(page, variant) {
  const shell = page.locator('.dia-dock-shell')
  await page.locator('.dia-dock-shell[data-compact-summary="true"]').waitFor()
  await page.getByRole('button', { name: 'Attach 6 annotations to the next send' }).click()
  const summary = page.getByRole('button', { name: 'Annotations ×6' })
  await summary.hover()
  const overview = page.locator('.dia-chip-overview')
  await overview.waitFor()
  await painted(page)
  const compact = await shell.evaluate((element) => {
    const body = element.querySelector('.dia-dock-body')
    const actions = element.querySelector('.dia-dock__actions')
    const title = element.querySelector('.dia-dock__main')
    const rect = element.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const visibleText = Array.from(title.children).filter((child) => child.getBoundingClientRect().width > 0)
    return {
      shell: rect.toJSON(),
      body: bodyRect.toJSON(),
      shellBackground: getComputedStyle(element).backgroundColor,
      shellBorder: getComputedStyle(element).borderTopWidth,
      bodyBackground: getComputedStyle(body).backgroundColor,
      bodyBorder: getComputedStyle(body).borderTopWidth,
      actionGap:
        actions.getBoundingClientRect().left -
        Math.max(...visibleText.map((child) => child.getBoundingClientRect().right)),
      iconCount: element.querySelectorAll('.dia-dock__icon').length,
      panelOpen: element.getAttribute('data-panel-open'),
      chevronOpen: element.querySelector('.dia-dock__chevron')?.getAttribute('data-open'),
    }
  })
  assert(
    compact.shellBackground === 'rgba(0, 0, 0, 0)' && parseFloat(compact.shellBorder) === 0,
    `compact summary must not leave a full-width painted shell: ${JSON.stringify(compact)}`,
  )
  assert(
    compact.bodyBackground !== 'rgba(0, 0, 0, 0)' && parseFloat(compact.bodyBorder) > 0,
    'the compact body must own the visible border and background',
  )
  assert(
    Math.abs(compact.body.right - compact.shell.right) <= 1 && compact.body.left >= compact.shell.left - 1,
    `the visible compact box must align to the composer right edge: ${JSON.stringify(compact)}`,
  )
  assert(
    compact.actionGap >= -1 && compact.actionGap <= 24 * variant.zoom,
    `the compact box must fit its text and actions without a stretched blank gap: ${JSON.stringify(compact)}`,
  )
  assert(compact.iconCount === 0, 'compact summaries must omit the left annotation icon')
  assert(
    compact.panelOpen === 'false' && compact.chevronOpen === 'false',
    `the collapsed shell and chevron must expose one closed state: ${JSON.stringify(compact)}`,
  )
  if (variant.width >= 1440) {
    assert(
      compact.body.width < compact.shell.width - 100,
      `wide compact summaries must shrink to their content: ${JSON.stringify(compact)}`,
    )
  }
  await summary.click()
  const panel = page.locator('.dia-inline-panel')
  await panel.waitFor()
  await overview.waitFor({ state: 'detached' })
  await page.mouse.move(0, 0)
  await summary.hover()
  await painted(page)
  assert((await overview.count()) === 0, 'the full panel must suppress the compact hover overview')
  const expanded = await panel.evaluate((element) => {
    const shellElement = element.closest('.dia-dock-shell')
    const body = shellElement.querySelector('.dia-dock-body')
    const actions = shellElement.querySelector('.dia-dock__actions')
    const main = shellElement.querySelector('.dia-dock__main')
    const chevron = shellElement.querySelector('.dia-dock__chevron')
    const shell = shellElement.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const bodyStyle = getComputedStyle(body)
    const panelStyle = getComputedStyle(element)
    const chevronStyle = getComputedStyle(chevron)
    const [originX, originY] = panelStyle.transformOrigin.split(' ').map(Number.parseFloat)
    return {
      shell: shell.toJSON(),
      body: bodyRect.toJSON(),
      panel: rect.toJSON(),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      panelOpen: shellElement.getAttribute('data-panel-open'),
      chevronOpen: chevron.getAttribute('data-open'),
      mainFlexGrow: getComputedStyle(main).flexGrow,
      bodyTopLeftRadius: bodyStyle.borderTopLeftRadius,
      bodyTopRightRadius: bodyStyle.borderTopRightRadius,
      bodyBottomLeftRadius: bodyStyle.borderBottomLeftRadius,
      bodyBottomRightRadius: bodyStyle.borderBottomRightRadius,
      panelBottomLeftRadius: panelStyle.borderBottomLeftRadius,
      panelBottomRightRadius: panelStyle.borderBottomRightRadius,
      panelAnimation: panelStyle.animationName,
      chevronTransition: chevronStyle.transitionDuration,
      originX,
      originY,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
      actionsRight: actions.getBoundingClientRect().right,
    }
  })
  assert(
    expanded.panel.left >= expanded.shell.left - 1 &&
      expanded.panel.right <= expanded.shell.right + 1 &&
      Math.abs(expanded.panel.right - expanded.shell.right) <= 1,
    `the expanded list must fit the composer and remain right-aligned: ${JSON.stringify(expanded)}`,
  )
  assert(
    Math.abs(expanded.body.width - expanded.panel.width) <= 1,
    `the compact open body and panel must use the same width: ${JSON.stringify(expanded)}`,
  )
  assert(
    Math.abs(expanded.body.top - expanded.panel.bottom) / variant.zoom <= 1,
    `the panel and bottom row must meet at a one-pixel seam: ${JSON.stringify(expanded)}`,
  )
  assert(
    expanded.panelOpen === 'true' &&
      expanded.chevronOpen === 'true' &&
      expanded.mainFlexGrow === '1' &&
      expanded.bodyTopLeftRadius === '0px' &&
      expanded.bodyTopRightRadius === '0px' &&
      expanded.bodyBottomLeftRadius !== '0px' &&
      expanded.bodyBottomRightRadius !== '0px' &&
      expanded.panelBottomLeftRadius === '0px' &&
      expanded.panelBottomRightRadius === '0px',
    `the compact open state must form one connected card: ${JSON.stringify(expanded)}`,
  )
  assert(
    (expanded.body.right - expanded.actionsRight) / variant.zoom <= 8,
    `the open compact toolbar actions must align to the card's right edge: ${JSON.stringify(expanded)}`,
  )
  assert(
    Math.abs(expanded.originX - expanded.offsetWidth) <= 1 &&
      Math.abs(expanded.originY - expanded.offsetHeight) <= 1,
    `the panel reveal must be anchored at bottom-right: ${JSON.stringify(expanded)}`,
  )
  assert(
    expanded.panelAnimation === 'none' && expanded.chevronTransition === '0s',
    `reduced motion must disable panel and chevron animation: ${JSON.stringify(expanded)}`,
  )
  assert(
    expanded.scrollWidth <= expanded.clientWidth + 1,
    `the expanded annotation list must not overflow horizontally: ${JSON.stringify(expanded)}`,
  )
  if (variant.width >= 1440) {
    assert(
      Math.abs(expanded.panel.width - 560 * variant.zoom) <= 2,
      `wide expanded lists must keep their independent readable width: ${JSON.stringify(expanded)}`,
    )
  }
  assert(
    (await panel.locator('.dia-item').count()) === 6,
    'expanding a compact summary must retain every note',
  )
  await assertAnnotationCopyReadable(
    panel.locator('.dia-item').first(),
    `${variant.name}, compact summary list`,
  )
  await assertNoLocalDataTools(page)
  if (['wide-light', 'narrow-dark', 'narrow-light-200'].includes(variant.name)) {
    await page.screenshot({
      path: join(artifacts, `reading-first-${variant.name}-summary.png`),
      fullPage: true,
    })
  }
  await page.locator('.dia-dock__fold').click()
  await panel.waitFor({ state: 'detached' })
  await page.getByTestId('summary-layout').dispatchEvent('click')
  await page.locator('.dia-dock-shell[data-compact-summary="false"]').waitFor()
  await painted(page)
  const full = await shell.evaluate((element) => ({
    shell: element.getBoundingClientRect().toJSON(),
    body: element.querySelector('.dia-dock-body').getBoundingClientRect().toJSON(),
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderTopWidth,
    iconCount: element.querySelectorAll('.dia-dock__icon').length,
  }))
  assert(
    full.iconCount === 1 && full.background !== 'rgba(0, 0, 0, 0)' && parseFloat(full.border) > 0,
    `disabling compact mode must restore the full-width shell and icon: ${JSON.stringify(full)}`,
  )
  assert(
    Math.abs(full.body.width - full.shell.width) <= 2 * variant.zoom + 1,
    `disabling compact mode must restore a full-width body: ${JSON.stringify(full)}`,
  )
  await page.locator('.dia-dock__main').click()
  await panel.waitFor()
  const fullExpanded = await panel.evaluate((element) => {
    const shell = element.closest('.dia-dock-shell')
    const body = shell.querySelector('.dia-dock-body')
    const shellRect = shell.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const panelRect = element.getBoundingClientRect()
    const shellStyle = getComputedStyle(shell)
    return {
      shell: shellRect.toJSON(),
      body: bodyRect.toJSON(),
      panel: panelRect.toJSON(),
      panelOpen: shell.getAttribute('data-panel-open'),
      topLeftRadius: shellStyle.borderTopLeftRadius,
      topRightRadius: shellStyle.borderTopRightRadius,
      bottomLeftRadius: shellStyle.borderBottomLeftRadius,
      bottomRightRadius: shellStyle.borderBottomRightRadius,
    }
  })
  assert(
    Math.abs(fullExpanded.body.width - fullExpanded.panel.width) <= 2 * variant.zoom + 1 &&
      Math.abs(fullExpanded.body.top - fullExpanded.panel.bottom) / variant.zoom <= 1 &&
      fullExpanded.panelOpen === 'true' &&
      fullExpanded.topLeftRadius === '0px' &&
      fullExpanded.topRightRadius === '0px' &&
      fullExpanded.bottomLeftRadius !== '0px' &&
      fullExpanded.bottomRightRadius !== '0px',
    `the full-width panel and summary must remain one connected card: ${JSON.stringify(fullExpanded)}`,
  )
  await assertAnnotationCopyReadable(
    panel.locator('.dia-item').first(),
    `${variant.name}, full-width summary list`,
  )
  await assertNoLocalDataTools(page)
  await page.locator('.dia-dock__fold').click()
  await panel.waitFor({ state: 'detached' })
  await page.getByTestId('summary-layout').dispatchEvent('click')
  await page.locator('.dia-dock-shell[data-compact-summary="true"]').waitFor()
  assert(
    (await page.locator('main').getAttribute('data-annotation-count')) === '6',
    'changing summary layout must not modify the annotation drafts',
  )
  await page.getByRole('button', { name: 'Detach 6 annotations' }).click()
}

async function readingRegression(browser, url, variant) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: 960 },
    colorScheme: variant.color,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}?scenario=${variant.blocked ? 'blocked' : 'reading'}`, {
      waitUntil: 'domcontentloaded',
    })
    const body = page.getByTestId('reading-source').locator('.dia-assistant__body')
    await body.waitFor()
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    assert(
      background === (variant.color === 'dark' ? 'rgb(21, 25, 30)' : 'rgb(255, 255, 255)'),
      `${variant.name}: the fixture must use the requested color scheme`,
    )
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom)
      document.documentElement.style.setProperty('--fixture-zoom', String(zoom))
      window.dispatchEvent(new Event('resize'))
    }, variant.zoom)
    await painted(page)
    const before = await textLayout(body)
    if (variant.name === 'wide-light') {
      const priorStyle = await body.getAttribute('style')
      try {
        await body.evaluate((element) => {
          element.style.paddingRight = '40px'
        })
        let rejected = false
        try {
          assertSameTextLayout(before, await textLayout(body), 'reserved-gutter negative control')
        } catch (error) {
          rejected = error.message.startsWith('reserved-gutter negative control:')
        }
        assert(rejected, 'the layout comparison must reject a reserved text gutter')
      } finally {
        await body.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style')
          else element.setAttribute('style', style)
        }, priorStyle)
      }
      await painted(page)
    }
    for (const [control, count] of [
      ['reading-one', 1],
      ['reading-six', 6],
    ]) {
      await page.getByTestId(control).dispatchEvent('click')
      await page.locator(`main[data-annotation-count="${count}"]`).waitFor()
      await painted(page)
      assertSameTextLayout(before, await textLayout(body), `${variant.name}, ${count} annotations`)
      await assertMarkersAvoidText(page)
      if (!variant.blocked) {
        const marker = page.getByTestId('reading-source').locator('.dia-marker')
        assert((await marker.count()) === 1, `${variant.name}: one visual line must have one marker`)
        const ids = (await marker.getAttribute('data-annotation-ids')).split(' ')
        assert(
          ids.length === count && new Set(ids).size === count,
          'one marker must retain every annotation id',
        )
        assert(
          (await marker.getAttribute('data-annotation-id')) === ids[0],
          'the first grouped id must remain the marker id',
        )
        assert(
          (await marker.textContent()).trim() === (count === 1 ? '1' : '×6'),
          'grouped markers must display the annotation count',
        )
        assert(
          (await marker.getAttribute('aria-label')) ===
            (count === 1
              ? '#1: Reading note 1.'
              : 'View 6 annotations on this line, numbered 1, 2, 3, 4, 5, 6'),
          'marker accessible names must identify every member',
        )
      }
    }
    await compactSummaryRegression(page, variant)
    assertSameTextLayout(before, await textLayout(body), `${variant.name}, summary setting changes`)
    if (variant.blocked) {
      assert(
        (await page.locator('.dia-marker').count()) === 0,
        'a full-width code block must not receive a marker over its content',
      )
      await page.locator('.dia-dock__main').click()
      assert(
        (await page.locator('.dia-inline-panel .dia-item').count()) === 6,
        'all overflow annotations must remain available in the Dock',
      )
    } else {
      const lead = body.locator('p').first()
      await lead.scrollIntoViewIfNeeded()
      await dragAndCopy(page, lead, 'A B C D E F.')
      await page.clock.install()
      await page.clock.pauseAt(new Date())
      try {
        const points = await textEndpoints(lead, 'C')
        await page.mouse.move(points.start.x + 2, points.start.y)
        await page.clock.runFor(600)
        assert(
          (await page.locator('.dia-hover, .dia-marker-popover, .dia-reply-popover').count()) === 0,
          'moving over an ordinary annotated range must not open a preview',
        )
        await page.mouse.click(points.start.x + 2, points.start.y)
        await page.clock.runFor(600)
        assert(
          (await page.locator('.dia-editor, .dia-marker-popover').count()) === 0,
          'clicking an ordinary annotated range must not open a card or editor',
        )
      } finally {
        await page.clock.resume()
      }
      await page.getByTestId('reading-source').locator('.dia-marker').click()
      const popover = page.locator('.dia-marker-popover')
      await popover.waitFor()
      await assertFloatingSafe(page, '.dia-marker-popover', variant.width <= 760 ? 'panel' : undefined)
      const sharedCard = await popover.elementHandle()
      for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
        const tab = popover.getByRole('button', { name: `Annotation ${ordinal}`, exact: true })
        await tab.click()
        assert(
          (await tab.getAttribute('aria-pressed')) === 'true',
          `annotation ${ordinal} must be selectable from the group`,
        )
        assert(
          (await popover.getAttribute('aria-label')).startsWith(`#${ordinal}: Reading note ${ordinal}.`),
          `the shared card must display annotation ${ordinal}`,
        )
        assert(
          (await page.locator('.dia-marker-popover').count()) === 1 &&
            (await sharedCard.evaluate((element) => element.isConnected)),
          'switching grouped annotations must reuse one card',
        )
        await assertAnnotationCopyReadable(popover, `${variant.name}, marker annotation ${ordinal}`)
      }
      await sharedCard.dispose()
      const placement = await assertFloatingSafe(
        page,
        '.dia-marker-popover',
        variant.width <= 760 ? 'panel' : undefined,
      )
      if (variant.width >= 1440 && variant.zoom === 1) {
        assert(
          ['left', 'right'].includes(placement.placement),
          'wide replies with unused side space must use a side card',
        )
      }
      await page.screenshot({ path: join(artifacts, `reading-first-${variant.name}.png`), fullPage: true })
      await popover.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('dialog', { name: 'Edit annotation' }).waitFor()
      await assertFloatingSafe(page, '.dia-editor', variant.width <= 760 ? 'panel' : undefined)
      const editorInput = page.getByRole('textbox', { name: 'Your annotation' })
      assert(
        (await editorInput.inputValue()) === 'Reading note 6.',
        'editing the selected group member must retain its own note',
      )
      assert(
        await page
          .locator('.dia-marker')
          .evaluateAll((elements) => elements.every((element) => element.disabled)),
        'body markers must not bypass an open editor',
      )
      if (variant.name === 'wide-light') {
        await editorInput.evaluate((element) => {
          element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
          )
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
          )
          element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
          )
        })
        assert(
          (await editorInput.inputValue()) === 'Reading note 6.',
          'IME Enter, Escape, and the same-task post-composition Enter must not save or close the editor',
        )
        await editorInput.press('End')
        await editorInput.press('Shift+Enter')
        assert((await editorInput.inputValue()).includes('\n'), 'Shift+Enter must insert an editor newline')
        await editorInput.fill('Reading note 6.')
        await editorInput.press('Enter')
        await page.getByRole('dialog', { name: 'Edit annotation' }).waitFor({ state: 'detached' })
      } else {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    }
    if (variant.blocked) {
      await page.screenshot({ path: join(artifacts, `reading-first-${variant.name}.png`), fullPage: true })
      await page
        .locator('.dia-inline-panel .dia-item')
        .last()
        .getByRole('button', { name: 'Edit', exact: true })
        .click()
      const input = page.getByRole('textbox', { name: 'Your annotation' })
      await input.waitFor()
      assert(
        (await input.inputValue()) === 'Reading note 6.',
        'a note without an inline marker must remain editable through the Dock',
      )
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    assert(errors.length === 0, `${variant.name} browser errors: ${errors.join('\n')}`)
    console.log(`PASS reading layout ${variant.name}`)
  } catch (error) {
    await page.screenshot({
      path: join(artifacts, `reading-first-${variant.name}-failure.png`),
      fullPage: true,
    })
    throw error
  } finally {
    await context.close()
  }
}

async function replyRegression(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}?scenario=reading`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('seed-reading-reply').dispatchEvent('click')
    const reply = page.getByTestId('reading-reply')
    const body = reply.locator('.dia-assistant__body')
    await body.waitFor()
    await body.scrollIntoViewIfNeeded()
    await painted(page)
    const before = await textLayout(body)
    await page.getByTestId('reply-finish').dispatchEvent('click')
    const chips = reply.locator('.dia-reply-chip')
    const chip = chips.first()
    await chip.waitFor()
    await painted(page)
    assert((await chips.count()) === 4, 'all four restored reply headings must be interactive')
    assertSameTextLayout(before, await textLayout(body), 'reply labels')
    const geometry = await chip.evaluate((element) => {
      const body = element.closest('.dia-assistant').querySelector('.dia-assistant__body')
      const text = body.querySelector('p').firstChild
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 'Annotation 1'.length)
      return {
        chip: element.getBoundingClientRect().toJSON(),
        text: range.getBoundingClientRect().toJSON(),
        pointerEvents: getComputedStyle(element).pointerEvents,
        content: element.textContent,
      }
    })
    assert(
      geometry.content === '' && geometry.pointerEvents === 'none',
      'reply targets must add no text and must allow native pointer selection',
    )
    assert(
      ['left', 'top', 'width', 'height'].every(
        (edge) => Math.abs(geometry.chip[edge] - geometry.text[edge]) < 0.5,
      ),
      `reply target must fit its exact text rectangle: ${JSON.stringify(geometry)}`,
    )
    await dragAndCopy(page, body, 'Annotation 1: The first answer stays selectable.')
    for (const [index, quote] of ['A', 'B', 'C', 'D'].entries()) {
      await chips.nth(index).focus()
      const preview = page.locator('.dia-reply-popover')
      await preview.waitFor()
      const previewQuote = await preview.locator('q').textContent()
      const previewNote = await preview.locator('p').textContent()
      assert(
        previewQuote === quote && previewNote === `Reading note ${index + 1}.`,
        `reply heading ${index + 1} must expose its matching quote and annotation: ${previewQuote} / ${previewNote}`,
      )
      await page.keyboard.press('Escape')
      await preview.waitFor({ state: 'detached' })
    }
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    try {
      const point = await textEndpoints(body, 'Annotation 1')
      await page.mouse.move(point.start.x + 3, point.start.y)
      await page.clock.runFor(299)
      assert(
        (await page.locator('.dia-reply-popover').count()) === 0,
        'reply preview must not open before 300 ms',
      )
      await page.clock.runFor(1)
      await page.locator('.dia-reply-popover').waitFor()
    } finally {
      await page.clock.resume()
    }
    await assertFloatingSafe(page, '.dia-reply-popover')
    // A viewport capture does not resize the page and invalidate its hover target.
    await page.screenshot({ path: join(artifacts, 'reading-first-reply-preview.png') })
    await page.mouse.move(0, 0)
    await page.locator('.dia-reply-popover').waitFor({ state: 'detached' })
    const source = page.getByTestId('reading-source')
    assert(await source.isHidden(), 'the reply source must begin inside a folded Turn wrapper')
    await page.getByTestId('reply-keyboard-start').focus()
    await page.keyboard.press('Tab')
    assert(
      await chip.evaluate((element) => element === document.activeElement),
      'reply targets must remain reachable with Tab',
    )
    await page.locator('.dia-reply-popover').waitFor()
    await page.keyboard.press('Enter')
    await source.waitFor({ state: 'visible' })
    assert(
      (await source.getAttribute('data-turn-process-hidden')) === null,
      'reply activation must expand the genuinely folded source before measuring it',
    )
    assert(
      (await page.locator('.dia-reply-popover').count()) === 0,
      'source navigation must close its reply preview',
    )
    assert(
      (await page.getByRole('dialog', { name: 'Add annotation' }).count()) === 0,
      'reply activation must navigate instead of opening an annotation editor',
    )
    const flash = source.locator('.dia-quote-flash').first()
    await flash.waitFor()
    const initialOpacity = Number.parseFloat(
      await flash.evaluate((element) => getComputedStyle(element).opacity),
    )
    await page.waitForFunction(
      () => {
        const element = document.querySelector('[data-testid="reading-source"] .dia-quote-flash')
        const port = element?.closest('.browser-scroller')
        if (!(element instanceof HTMLElement) || !(port instanceof HTMLElement)) return false
        const quote = element.getBoundingClientRect()
        const bounds = port.getBoundingClientRect()
        return Math.abs((quote.top + quote.bottom) / 2 - (bounds.top + bounds.bottom) / 2) < 2
      },
      undefined,
      { polling: 'raf', timeout: 1_000 },
    )
    const faded = await page.waitForFunction(
      ({ threshold }) => {
        const element = document.querySelector('[data-testid="reading-source"] .dia-quote-flash')
        if (!(element instanceof HTMLElement)) return false
        const opacity = Number.parseFloat(getComputedStyle(element).opacity)
        return opacity < threshold ? { opacity } : false
      },
      { threshold: initialOpacity - 0.05 },
      { polling: 'raf', timeout: 1_000 },
    )
    const { opacity: fadedOpacity } = await faded.jsonValue()
    assert(
      initialOpacity > 0.5 && fadedOpacity < initialOpacity - 0.05,
      `the quote background must fade smoothly: ${initialOpacity} -> ${fadedOpacity}`,
    )
    await flash.waitFor({ state: 'detached', timeout: 2_000 })
    await chip.focus()
    await page.locator('.dia-reply-popover').waitFor()
    await page.getByTestId('reply-wrap').dispatchEvent('click')
    await chip.waitFor({ state: 'detached' })
    await page.locator('.dia-reply-popover').waitFor({ state: 'detached' })
    assert(
      (await body.textContent()) === before.text,
      'wrapping a reply label must preserve its complete text',
    )
    assert(errors.length === 0, `reply browser errors: ${errors.join('\n')}`)
    console.log(
      'PASS four reply headings, previews, native selection, folded-source navigation, quote flash, wrapped-label fallback',
    )
  } catch (error) {
    await page.screenshot({ path: join(artifacts, 'reading-first-reply-failure.png'), fullPage: true })
    throw error
  } finally {
    await context.close()
  }
}

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [
    {
      name: 'annotation-browser-fixture',
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
let page
try {
  await mkdir(artifacts, { recursive: true })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || typeof address === 'string' || address === undefined) {
    throw new Error('Vite did not expose a TCP address')
  }
  browser = await chromium.launch({ headless: true })
  if (selectedCase === undefined || selectedCase === 'legacy') {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    page = await context.newPage()
    page.on('pageerror', (error) => failures.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text())
    })
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })

    const composer = page.getByRole('textbox', { name: 'Official composer' })
    await composer.fill('draft text')
    await composer.press('Home')
    await composer.press('ArrowRight')
    await composer.press('ArrowRight')
    await composer.press('ArrowRight')

    const paragraph = page.locator('.dia-assistant__body p').last()
    await paragraph.scrollIntoViewIfNeeded()
    const assistantChrome = await page.locator('.dia-assistant').evaluate((element) => {
      const body = element.querySelector('.dia-assistant__body')
      const reasoningSummary = element.querySelector('.dia-assistant__reasoning-summary')
      return {
        fontSize: getComputedStyle(element).fontSize,
        lineHeight: getComputedStyle(element).lineHeight,
        body:
          body === null
            ? null
            : {
                display: getComputedStyle(body).display,
                direction: getComputedStyle(body).flexDirection,
                gap: getComputedStyle(body).gap,
              },
        reasoning:
          reasoningSummary === null
            ? null
            : {
                fontSize: getComputedStyle(reasoningSummary).fontSize,
                lineHeight: getComputedStyle(reasoningSummary).lineHeight,
              },
        legacyPre: element.querySelectorAll('.dia-assistant__reasoning pre').length,
      }
    })
    assert(
      assistantChrome.fontSize === '16px' &&
        assistantChrome.lineHeight === '28px' &&
        assistantChrome.body?.display === 'flex' &&
        assistantChrome.body.direction === 'column' &&
        assistantChrome.body.gap === '16px',
      `assistant body must match official flow metrics, received ${JSON.stringify(assistantChrome)}`,
    )
    assert(
      assistantChrome.reasoning?.fontSize === '14px' &&
        assistantChrome.reasoning.lineHeight === '24px' &&
        assistantChrome.legacyPre === 0,
      `reasoning must use official disclosure typography, received ${JSON.stringify(assistantChrome.reasoning)}`,
    )
    await selectExact(page, 'selected phrase')
    const selectionBar = page.locator('.dia-selection-bar')
    await selectionBar.waitFor()
    assert(
      (await selectionBar.getByRole('button', { name: 'Add annotation' }).count()) === 1 &&
        (await selectionBar.getByRole('button', { name: 'Copy' }).count()) === 1,
      'selection must offer add-annotation and copy actions',
    )
    const liveSelection = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    assert(liveSelection === 'selected phrase', 'selection must stay alive while the action bar is open')

    await selectionBar.getByRole('button', { name: 'Copy' }).click()
    await selectionBar.waitFor({ state: 'detached' })
    assert(
      (await page.evaluate(() => window.getSelection()?.toString())) === 'selected phrase',
      'copying must keep the selection alive',
    )
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    assert(copied === 'selected phrase', `copy must copy the selected text, received ${copied}`)

    await selectExact(page, 'selected phrase')
    await selectionBar.waitFor()
    await page.keyboard.press('Control+c')
    const keyboardCopy = await page.evaluate(() => navigator.clipboard.readText())
    assert(keyboardCopy === 'selected phrase', 'Ctrl+C must copy while the action bar is open')
    await page.locator('h1').dispatchEvent('pointerdown')
    await selectionBar.waitFor({ state: 'detached' })
    assert(
      (await page.evaluate(() => window.getSelection()?.isCollapsed)) === false,
      'dismissal must not clear the selection',
    )

    await selectExact(page, 'selected phrase', 'outside')
    await selectionBar.waitFor()
    assert(
      (await page.evaluate(() => window.getSelection()?.toString())) === 'selected phrase',
      'outside release must keep the selection alive',
    )
    await page.locator('h1').dispatchEvent('pointerdown')
    await selectionBar.waitFor({ state: 'detached' })

    await selectExact(page, 'selected phrase')
    await selectionBar.waitFor()
    await selectionBar.getByRole('button', { name: 'Add annotation' }).click()

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
    const editorChrome = await dialog.evaluate((element) => {
      const buttons = Array.from(element.querySelectorAll('button'))
      const textarea = element.querySelector('textarea')
      return {
        background: getComputedStyle(element).backgroundColor,
        buttonBoxes: buttons.map((button) => {
          const rect = button.getBoundingClientRect()
          const icon = button.querySelector('svg')?.getBoundingClientRect()
          return { width: rect.width, height: rect.height, iconWidth: icon?.width, iconHeight: icon?.height }
        }),
        saveColor: buttons[1] === undefined ? null : getComputedStyle(buttons[1]).color,
        input:
          textarea === null
            ? null
            : {
                background: getComputedStyle(textarea).backgroundColor,
                borderRadius: getComputedStyle(textarea).borderRadius,
                fontSize: getComputedStyle(textarea).fontSize,
                lineHeight: getComputedStyle(textarea).lineHeight,
              },
      }
    })
    assert(
      editorChrome.background === 'rgb(32, 38, 45)',
      'editor must use the official elevated menu surface',
    )
    assert(
      editorChrome.buttonBoxes.every(
        ({ width, height, iconWidth, iconHeight }) =>
          width === 28 && height === 28 && iconWidth === 14 && iconHeight === 14,
      ),
      `editor actions must match official 28/14 icon metrics, received ${JSON.stringify(editorChrome.buttonBoxes)}`,
    )
    assert(
      editorChrome.saveColor === 'rgb(91, 121, 255)',
      'editor save action must use the official business color',
    )
    assert(
      editorChrome.input?.background === 'rgb(21, 25, 30)' &&
        editorChrome.input.borderRadius === '8px' &&
        editorChrome.input.fontSize === '13px' &&
        editorChrome.input.lineHeight === '20px',
      `editor input must match official compact input metrics, received ${JSON.stringify(editorChrome.input)}`,
    )

    await page.locator('h1').dispatchEvent('pointerdown')
    await dialog.waitFor({ state: 'detached' })

    await selectExact(page, 'selected phrase')
    await selectionBar.waitFor()
    await selectionBar.getByRole('button', { name: 'Add annotation' }).click()
    dialog = page.getByRole('dialog', { name: 'Add annotation' })
    const input = dialog.getByRole('textbox', { name: 'Your annotation' })
    await input.fill('Needs a concrete explanation.')
    await page.getByText('Automatically saved locally').waitFor()
    const stored = await page.evaluate(() => localStorage.getItem('dsh-annotation:v1:browser-session'))
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
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-composer-input]')
      const selection = document.getSelection()
      if (root === null || document.activeElement !== root || root.textContent !== '\u200Bdraft text')
        return false
      if (
        selection?.focusNode === null ||
        selection?.focusNode === undefined ||
        !root.contains(selection.focusNode)
      )
        return false
      const range = document.createRange()
      range.selectNodeContents(root)
      range.setEnd(selection.focusNode, selection.focusOffset)
      return selection.isCollapsed && range.toString().length === 4
    })
    await page.keyboard.insertText('X')
    await page.waitForFunction(
      () => document.querySelector('[data-composer-input]')?.textContent === '\u200BdraXft text',
    )
    assert(
      (await composer.getAttribute('data-lexical-editor')) === 'true',
      'focus recovery must preserve the real Lexical editor and its insertion point',
    )
    await page.screenshot({ path: join(artifacts, 'lexical-composer-focus.png'), fullPage: true })
    await composer.fill('')
    await dialog.waitFor({ state: 'detached' })
    const autoDetach = page.getByRole('button', { name: 'Detach 1 annotations' })
    await autoDetach.waitFor()
    assert((await autoDetach.count()) === 1, 'saving a new annotation must attach it by default')
    const attachedChip = page.getByRole('button', { name: 'Annotations ×1' })
    await attachedChip.hover()
    const attachedOverview = page.locator('.dia-chip-overview')
    await attachedOverview.waitFor()
    const overviewPlacement = await page.evaluate(() => {
      const shell = document.querySelector('.dia-dock-shell')
      const compact = shell?.getAttribute('data-compact-summary') === 'true'
      const anchor = shell
        ?.querySelector(compact ? '.dia-dock-body' : '.dia-dock__main')
        ?.getBoundingClientRect()
      const overview = document.querySelector('.dia-chip-overview')?.getBoundingClientRect()
      if (anchor === undefined || overview === undefined) return null
      return { gap: anchor.top - overview.bottom }
    })
    assert(
      overviewPlacement !== null && Math.abs(overviewPlacement.gap - 6) < 1,
      `an attached-annotation hover overview must open six pixels above the summary button, received ${JSON.stringify(overviewPlacement)}`,
    )
    await autoDetach.click()
    await page.getByRole('button', { name: 'Attach 1 annotations to the next send' }).waitFor()
    await page.locator('.browser-scroller').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.locator('.dia-dock').click()
    const firstLocate = page.locator('.dia-item').first().getByRole('button', { name: 'Locate source' })
    assert(
      (await firstLocate.locator('svg.lucide-map-pin').count()) === 1,
      'Locate source must retain the original map-pin icon',
    )
    await firstLocate.click()
    await page.waitForFunction(() => {
      const scroller = document.querySelector('.browser-scroller')?.getBoundingClientRect()
      const marker = document.querySelector('.dia-marker')?.getBoundingClientRect()
      return (
        scroller !== undefined &&
        marker !== undefined &&
        Math.abs((marker.top + marker.bottom) / 2 - (scroller.top + scroller.bottom) / 2) < 36
      )
    })
    await page.locator('.dia-marker').waitFor()
    const locatedMarker = page.locator('.dia-marker').first()
    assert(
      (await locatedMarker.getAttribute('data-active')) === 'false',
      'source navigation must not take ownership of the persistent active marker',
    )
    const quoteFlash = page.locator('.dia-quote-flash').first()
    await quoteFlash.waitFor()
    const quoteFlashBackground = await quoteFlash.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    assert(
      quoteFlashBackground !== 'rgba(0, 0, 0, 0)',
      'source navigation must render a visible local quote flash',
    )

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

    await page.getByTestId('seed-same-line').dispatchEvent('click')
    await page.locator('main[data-annotation-count="5"]').waitFor()
    await painted(page)
    const readMarkers = () =>
      page.locator('.dia-marker').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            ids: element.dataset.annotationIds.split(' '),
            left: rect.left,
            right: rect.right,
            top: rect.top,
          }
        }),
      )
    const markerLayout = await readMarkers()
    assert(
      markerLayout.some((marker) => marker.ids.length > 1),
      'same-line annotations must share a marker',
    )
    const visibleIds = markerLayout.flatMap((marker) => marker.ids)
    assert(
      new Set(visibleIds).size === visibleIds.length,
      'each annotation must appear in at most one marker',
    )
    await assertMarkersAvoidText(page)

    await page.locator('.dia-marker').first().click()
    const markerPreview = page.locator('.dia-marker-popover')
    await markerPreview.waitFor()
    const secondTab = markerPreview.getByRole('button', { name: 'Annotation 2', exact: true })
    if ((await secondTab.count()) === 1) await secondTab.click()
    const selectedOrdinal = (await markerPreview.getAttribute('aria-label')).match(/^#(\d+):/)[1]
    await assertFloatingSafe(page, '.dia-marker-popover', 'panel')
    await markerPreview.getByRole('button', { name: 'Edit' }).click()
    const editDialog = page.getByRole('dialog', { name: 'Edit annotation' })
    await editDialog.waitFor()
    await assertFloatingSafe(page, '.dia-editor', 'panel')
    assert(
      await editDialog.evaluate((element) => !element.classList.contains('dia-editor--inline')),
      'marker editing must not move into the summary',
    )
    const markerDelete = editDialog.getByRole('button', { name: 'Delete' })
    assert((await markerDelete.count()) === 1, 'editing a draft from its marker must expose a delete action')
    const storedComment = await editDialog.getByRole('textbox', { name: 'Your annotation' }).inputValue()
    assert(
      storedComment === `Browser marker ${selectedOrdinal}`,
      `the marker editor must load its selected draft, received ${storedComment}`,
    )
    await markerDelete.click()
    await editDialog.waitFor({ state: 'detached' })
    await page.locator('main[data-annotation-count="4"]').waitFor()
    await painted(page)
    assert(
      (await readMarkers()).flatMap((marker) => marker.ids).length <= 4,
      'deleting from the marker editor must remove that annotation from its group',
    )
    if ((await page.locator('.dia-dock__main').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('.dia-dock__main').click()
    }
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.locator('main[data-annotation-count="5"]').waitFor()

    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25'
      window.dispatchEvent(new Event('resize'))
    })
    await painted(page)
    const zoomLayout = await readMarkers()
    const viewportWidth = page.viewportSize()?.width ?? 390
    assert(
      zoomLayout.every((rect) => rect.right <= viewportWidth + 0.5),
      'mobile markers must remain inside the viewport after zoom',
    )

    if ((await page.locator('.dia-dock__main').getAttribute('aria-expanded')) === 'true') {
      await page.locator('.dia-dock__main').click()
    }
    const paragraphTop = await paragraph.evaluate((element) => element.getBoundingClientRect().top)
    await page.locator('.dia-assistant__reasoning [data-disclosure-row]').click()
    await page.waitForFunction(
      (before) =>
        (document.querySelector('.dia-assistant__body p')?.getBoundingClientRect().top ?? before) >
        before + 5,
      paragraphTop,
    )
    await painted(page)
    await assertMarkersAvoidText(page)
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    assert(background === 'rgb(21, 25, 30)', `dark-mode fixture must use dark tokens, received ${background}`)

    const dockMain = page.locator('.dia-dock__main')
    if ((await dockMain.getAttribute('aria-expanded')) !== 'true') await dockMain.click()
    const attach = page.getByRole('button', { name: 'Attach 5 annotations to the next send' })
    const fold = page.getByRole('button', { name: 'Collapse annotations' })
    await attach.waitFor()
    assert(
      (await page.locator('.dia-inline-panel textarea').count()) === 0,
      'annotation list must not own a task textarea',
    )
    assert(
      (await page.locator('.dia-inline-panel__send').count()) === 0,
      'annotation list must not own a send button',
    )
    await assertNoLocalDataTools(page)
    assert(
      await attach.evaluate(
        (element, next) => element.compareDocumentPosition(next) === Node.DOCUMENT_POSITION_FOLLOWING,
        await fold.elementHandle(),
      ),
      'attachment action must sit immediately before the fold action',
    )
    const summaryChrome = await page.locator('.dia-dock').evaluate((element) => {
      const actions = element.querySelector('.dia-dock__actions')
      const attachment = element.querySelector('.dia-dock__attach')
      const folding = element.querySelector('.dia-dock__fold')
      return {
        compact: element.closest('.dia-dock-shell')?.getAttribute('data-compact-summary') === 'true',
        gap: actions === null ? null : getComputedStyle(actions).gap,
        attachment:
          attachment === null
            ? null
            : {
                width: getComputedStyle(attachment).width,
                height: getComputedStyle(attachment).height,
                borderRadius: getComputedStyle(attachment).borderRadius,
              },
        folding:
          folding === null
            ? null
            : {
                width: getComputedStyle(folding).width,
                height: getComputedStyle(folding).height,
                borderRadius: getComputedStyle(folding).borderRadius,
              },
      }
    })
    assert(
      summaryChrome.gap === (summaryChrome.compact ? '6px' : '10px') &&
        summaryChrome.attachment?.width === '28px' &&
        summaryChrome.attachment.height === '28px' &&
        summaryChrome.attachment.borderRadius === '999px' &&
        summaryChrome.folding?.width === '28px' &&
        summaryChrome.folding.height === '28px' &&
        summaryChrome.folding.borderRadius === '999px',
      `summary actions must match the official action geometry, received ${JSON.stringify(summaryChrome)}`,
    )
    const foldMargin = await page.evaluate(() => {
      // 该阶段页面处于 zoom 1.25；getBoundingClientRect 返回视觉坐标，先临时还原 zoom。
      const zoom = document.documentElement.style.zoom
      document.documentElement.style.zoom = '1'
      const shell = document.querySelector('.dia-dock-shell')
      const fold = document.querySelector('.dia-dock__fold')
      const margin =
        shell instanceof HTMLElement && fold instanceof HTMLElement
          ? Math.round(shell.getBoundingClientRect().right - fold.getBoundingClientRect().right)
          : null
      document.documentElement.style.zoom = zoom
      return margin
    })
    assert(foldMargin === 6, `fold button must keep the official 6px right margin, received ${foldMargin}`)
    await attach.hover()
    const hoverBackground = await attach.evaluate((element) => getComputedStyle(element).backgroundColor)
    const officialHoverBackground = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--dsw-alias-interactive-bg-hover)'
      document.body.append(probe)
      const background = getComputedStyle(probe).backgroundColor
      probe.remove()
      return background
    })
    assert(
      hoverBackground === officialHoverBackground,
      `summary action hover must use the official background token, received ${hoverBackground}`,
    )
    const dockChrome = await page.locator('.dia-dock-shell').evaluate((element) => {
      const title = element.querySelector('.dia-dock__title')
      const action = element.querySelector('.dia-row-action')
      const actionIcon = action?.querySelector('svg')
      const paintedBox =
        element.dataset.compactSummary === 'true' ? element.querySelector('.dia-dock-body') : element
      return {
        background: getComputedStyle(paintedBox).backgroundColor,
        borderRadius: getComputedStyle(paintedBox).borderRadius,
        title:
          title === null
            ? null
            : { fontSize: getComputedStyle(title).fontSize, lineHeight: getComputedStyle(title).lineHeight },
        action:
          action === null || actionIcon === null
            ? null
            : {
                width: getComputedStyle(action).width,
                height: getComputedStyle(action).height,
                iconWidth: getComputedStyle(actionIcon).width,
                iconHeight: getComputedStyle(actionIcon).height,
              },
      }
    })
    assert(
      dockChrome.background === 'rgb(36, 43, 51)' && dockChrome.borderRadius === '0px 0px 12px 12px',
      `open annotation dock must join the panel above its official tip-card body, received ${JSON.stringify(dockChrome)}`,
    )
    assert(
      dockChrome.title?.fontSize === '13px' && dockChrome.title.lineHeight === '24px',
      `dock title must match official composer typography, received ${JSON.stringify(dockChrome.title)}`,
    )
    assert(
      dockChrome.action?.width === '28px' &&
        dockChrome.action.height === '28px' &&
        dockChrome.action.iconWidth === '12px' &&
        dockChrome.action.iconHeight === '12px',
      `Locate source must pair the official 28px action target with the original 12px map pin, received ${JSON.stringify(dockChrome.action)}`,
    )
    assert(
      (await page.locator('.dia-group__title [data-state="warning"]').count()) > 0,
      'annotation groups must use official DSH state dots',
    )
    await attach.click()
    assert(
      (await fold.getAttribute('aria-expanded')) === 'true',
      'attaching must not fold the annotation list',
    )
    const detach = page.getByRole('button', { name: 'Detach 5 annotations' })
    await detach.waitFor()
    const attachColors = await detach.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
    }))
    assert(
      attachColors.color === 'rgb(91, 121, 255)',
      `armed attachment must use the business color, received ${JSON.stringify(attachColors)}`,
    )
    await page.getByRole('textbox', { name: 'Official composer' }).fill('Rewrite the proposal coherently.')
    await page.locator('.dia-item').first().getByRole('button', { name: 'Locate source' }).click()
    await page.waitForFunction(() => {
      const scroller = document.querySelector('.browser-scroller')?.getBoundingClientRect()
      const paragraph = document.querySelector('.dia-assistant__body p')
      if (scroller === undefined || paragraph?.firstChild === null || paragraph === null) return false
      const range = document.createRange()
      range.setStart(paragraph.firstChild, 0)
      range.setEnd(paragraph.firstChild, 1)
      const line = range.getBoundingClientRect()
      return Math.abs((line.top + line.bottom) / 2 - (scroller.top + scroller.bottom) / 2) < 36
    })
    const centering = await page.evaluate(() => {
      const scroller = document.querySelector('.browser-scroller').getBoundingClientRect()
      const range = document.createRange()
      const text = document.querySelector('.dia-assistant__body p').firstChild
      range.setStart(text, 0)
      range.setEnd(text, 1)
      const line = range.getBoundingClientRect()
      return Math.abs((line.top + line.bottom) / 2 - (scroller.top + scroller.bottom) / 2)
    })
    assert(
      centering !== null && centering < 36,
      `located marker line must be vertically centered (delta ${String(centering)})`,
    )

    await page.getByRole('textbox', { name: 'Official composer' }).press('Enter')
    await page
      .getByRole('alert')
      .filter({ hasText: '5 annotations queued; withdraw remains available in the list' })
      .waitFor()
    assert(
      (await page.getByRole('textbox', { name: 'Official composer' }).textContent()) === '',
      'one official submission must clear the composer text',
    )
    if ((await dockMain.getAttribute('aria-expanded')) !== 'true') await dockMain.click()
    assert(
      (await page.getByRole('button', { name: 'Withdraw queued batch' }).count()) === 1,
      'an authoritatively queued batch must remain withdrawable',
    )
    await assertNoLocalDataTools(page)
    await page.getByTestId('settle-sent').click()
    await page
      .getByRole('alert')
      .filter({ hasText: '5 annotations sent; durable history cannot be withdrawn' })
      .waitFor()
    assert(
      (await page.getByRole('button', { name: 'Withdraw queued batch' }).count()) === 0,
      'a durable sent batch must not expose withdrawal',
    )
    await assertNoLocalDataTools(page)
    await page.getByTestId('seed-failed').click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Send failed; annotations remain attached and retry with submission id sub-' })
      .waitFor()
    const retryDetach = page.getByRole('button', { name: 'Detach 1 annotations' })
    await retryDetach.waitFor()
    await page.getByRole('textbox', { name: 'Official composer' }).fill('')
    await page.getByRole('button', { name: 'Send official task' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: '1 annotations queued; withdraw remains available in the list' })
      .waitFor()

    assert(failures.length === 0, `browser console errors:\n${failures.join('\n')}`)
    await page.getByRole('alert').waitFor({ state: 'detached' })
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1'
    })
    await page.screenshot({ path: join(artifacts, 'annotation-submission.png'), fullPage: true })
    console.log(
      'browser regression passed: selection action bar with copy, compact editor, autosave, default auto-attach, upward attachment overview, official action geometry and hover, marker-anchored preview and editing with delete, mobile markers, dark mode, zoom, reasoning, attach toggle, Enter submission, attachment-only retry, authoritative Toasts, locate',
    )
    await context.close()
    page = undefined
  }
  const fixtureURL = `http://127.0.0.1:${address.port}/`
  for (const variant of readingVariants) {
    if (selectedCase === undefined || selectedCase === variant.name)
      await readingRegression(browser, fixtureURL, variant)
  }
  if (selectedCase === undefined || selectedCase === 'reply') await replyRegression(browser, fixtureURL)
} catch (error) {
  await page?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
  throw error
} finally {
  try {
    await browser?.close()
  } finally {
    await server.close()
  }
}
