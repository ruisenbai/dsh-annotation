import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

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
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || typeof address === 'string' || address === undefined) {
    throw new Error('Vite did not expose a TCP address')
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })

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
  assert(editorChrome.background === 'rgb(32, 38, 45)', 'editor must use the official elevated menu surface')
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
  await dialog.waitFor({ state: 'detached' })
  const autoDetach = page.getByRole('button', { name: 'Detach 1 annotations' })
  await autoDetach.waitFor()
  assert((await autoDetach.count()) === 1, 'saving a new annotation must attach it by default')
  const attachedChip = page.getByRole('button', { name: 'Annotations ×1' })
  await attachedChip.hover()
  const attachedOverview = page.locator('.dia-chip-overview')
  await attachedOverview.waitFor()
  const overviewPlacement = await page.evaluate(() => {
    const chip = document.querySelector('.dia-dock__main')?.getBoundingClientRect()
    const overview = document.querySelector('.dia-chip-overview')?.getBoundingClientRect()
    if (chip === undefined || overview === undefined) return null
    return { gap: chip.top - overview.bottom }
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
  const draftMarkerColor = await page
    .locator('.dia-marker')
    .first()
    .evaluate((element) => getComputedStyle(element, '::before').backgroundColor)
  assert(
    draftMarkerColor === 'rgb(91, 121, 255)',
    `draft markers must use the official business color, received ${draftMarkerColor}`,
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

  await page.locator('.dia-marker').nth(1).click()
  const markerPreview = page.locator('.dia-marker-popover')
  await markerPreview.waitFor()
  const previewPlacement = await page.evaluate(() => {
    const marker = document.querySelector('.dia-marker[data-active="true"]')?.getBoundingClientRect()
    const preview = document.querySelector('.dia-marker-popover')?.getBoundingClientRect()
    if (marker === undefined || preview === undefined) return null
    return {
      gap: preview.top - marker.bottom,
      inDock: document.querySelector('.dia-marker-popover')?.closest('.dia-dock-shell') !== null,
    }
  })
  assert(
    previewPlacement !== null && Math.abs(previewPlacement.gap - 8) < 1 && !previewPlacement.inDock,
    `a marker preview must open eight pixels below the clicked number outside the summary box, received ${JSON.stringify(previewPlacement)}`,
  )
  await markerPreview.getByRole('button', { name: 'Edit' }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit annotation' })
  await editDialog.waitFor()
  const editPlacement = await page.evaluate(() => {
    const active = document.querySelector('.dia-marker[data-active="true"]')
    const marker = active?.getBoundingClientRect()
    const element = document.querySelector('.dia-editor')
    const editor = element?.getBoundingClientRect()
    if (marker === undefined || editor === undefined) return null
    const annotationId = active instanceof HTMLElement ? active.dataset.annotationId : undefined
    return {
      gap: editor.top - marker.bottom,
      marker: { top: marker.top, bottom: marker.bottom },
      editor: { top: editor.top, styleTop: element instanceof HTMLElement ? element.style.top : '' },
      matchingMarkers: Array.from(document.querySelectorAll('.dia-marker'))
        .filter(
          (candidate) => candidate instanceof HTMLElement && candidate.dataset.annotationId === annotationId,
        )
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom }
        }),
      scrollerTop: document.querySelector('.browser-scroller')?.scrollTop,
      inlineClass: element?.classList.contains('dia-editor--inline') === true,
      inDock: element?.closest('.dia-dock-shell') !== null,
    }
  })
  assert(
    editPlacement !== null &&
      Math.abs(editPlacement.gap - 8) < 1 &&
      !editPlacement.inlineClass &&
      !editPlacement.inDock,
    `a marker editor must open eight pixels below the clicked number outside the summary box, received ${JSON.stringify(editPlacement)}`,
  )
  const markerDelete = editDialog.getByRole('button', { name: 'Delete' })
  assert((await markerDelete.count()) === 1, 'editing a draft from its marker must expose a delete action')
  const storedComment = await editDialog.getByRole('textbox', { name: 'Your annotation' }).inputValue()
  assert(
    storedComment === 'Browser marker 2',
    `the marker editor must load the stored draft annotation, received ${storedComment}`,
  )
  await markerDelete.click()
  await editDialog.waitFor({ state: 'detached' })
  assert(
    (await page.locator('.dia-marker').count()) === 4,
    'deleting from the marker editor must remove the marker',
  )
  if ((await page.locator('.dia-dock__main').getAttribute('aria-expanded')) !== 'true') {
    await page.locator('.dia-dock__main').click()
  }
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.dia-marker').length === 5)

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
  // 收起向上弹出的注解列表，避免它覆盖正文顶部的推理折叠行。
  if ((await page.locator('.dia-dock__main').getAttribute('aria-expanded')) === 'true') {
    await page.locator('.dia-dock__main').click()
  }
  await page.locator('.dia-assistant__reasoning [data-disclosure-row]').click()
  await page.waitForFunction(
    (before) => (document.querySelector('.dia-marker')?.getBoundingClientRect().top ?? before) > before + 5,
    firstMarkerTop,
  )
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
    summaryChrome.gap === '10px' &&
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
    return {
      background: getComputedStyle(element).backgroundColor,
      borderRadius: getComputedStyle(element).borderRadius,
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
    dockChrome.background === 'rgb(36, 43, 51)' && dockChrome.borderRadius === '12px',
    `annotation dock must use the official tip card, received ${JSON.stringify(dockChrome)}`,
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
  assert((await fold.getAttribute('aria-expanded')) === 'true', 'attaching must not fold the annotation list')
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

  await page.getByRole('textbox', { name: 'Official composer' }).press('Enter')
  await page
    .getByRole('alert')
    .filter({ hasText: '5 annotations queued; withdraw remains available in the list' })
    .waitFor()
  assert(
    (await page.getByRole('textbox', { name: 'Official composer' }).inputValue()) === '',
    'one official submission must clear the composer text',
  )
  if ((await dockMain.getAttribute('aria-expanded')) !== 'true') await dockMain.click()
  assert(
    (await page.getByRole('button', { name: 'Withdraw queued batch' }).count()) === 1,
    'an authoritatively queued batch must remain withdrawable',
  )
  await page.getByTestId('settle-sent').click()
  await page
    .getByRole('alert')
    .filter({ hasText: '5 annotations sent; durable history cannot be withdrawn' })
    .waitFor()
  assert(
    (await page.getByRole('button', { name: 'Withdraw queued batch' }).count()) === 0,
    'a durable sent batch must not expose withdrawal',
  )
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
  console.log(
    'browser regression passed: selection action bar with copy, compact editor, autosave, default auto-attach, upward attachment overview, official action geometry and hover, marker-anchored preview and editing with delete, mobile markers, dark mode, zoom, reasoning, attach toggle, Enter submission, attachment-only retry, authoritative Toasts, locate',
  )
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
