import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(root, 'artifacts', 'browser')
const selectedCase = process.argv[2]
const variants = [
  { name: 'wide-light', width: 1280, dark: false },
  { name: 'narrow-dark', width: 390, dark: true },
]
if (selectedCase !== undefined && !variants.some((variant) => variant.name === selectedCase)) {
  throw new Error(`Unknown browser case: ${selectedCase}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
          if (new URL(request.url ?? '/', 'http://fixture.local').pathname !== '/') return next()
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

async function inspectVariant(browser, base, variant) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: 850 },
    colorScheme: variant.dark ? 'dark' : 'light',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${base}/?scenario=interaction&reset=1`, { waitUntil: 'networkidle' })
    if (variant.dark) await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    assert(
      (await page.locator('.dia-record, .dia-record-toggle, .dia-composer-chip').count()) === 0,
      'A new conversation must not show annotation chrome or empty copy',
    )
    const source = page.getByTestId('interaction-source')
    await source.locator('.dia-assistant__body').scrollIntoViewIfNeeded()
    await page.getByTestId('conversation-scroll').evaluate((element) => {
      element.scrollTop = 250
    })
    await page.getByTestId('begin-quick-editor').evaluate((button) => button.click())
    const quick = page.locator('.dia-record-editor--quick')
    await quick.waitFor()
    const quickInput = quick.locator('textarea')
    const quickShape = await quick.evaluate((element) => {
      const card = element.getBoundingClientRect()
      const check = element.querySelector('.dia-record-editor__check').getBoundingClientRect()
      const field = element.querySelector('textarea').getBoundingClientRect()
      return {
        width: card.width,
        radius: getComputedStyle(element).borderTopLeftRadius,
        placement: element.dataset.floatingPlacement,
        checkCenter: check.top + check.height / 2,
        fieldCenter: field.top + field.height / 2,
        fieldHeight: field.height,
        resize: getComputedStyle(element.querySelector('textarea')).resize,
      }
    })
    assert(
      quickShape.width <= 392 &&
        quickShape.radius === '14px' &&
        quickShape.resize === 'none' &&
        quickShape.fieldHeight <= 33 &&
        Math.abs(quickShape.checkCenter - quickShape.fieldCenter) <= 2,
      `A one-line quick editor must use the approved compact layout: ${JSON.stringify(quickShape)}`,
    )
    assert(
      quickShape.placement === 'bottom',
      `The quick editor must start below the selected character: ${JSON.stringify(quickShape)}`,
    )
    await quickInput.fill('A wrapped annotation '.repeat(15))
    assert(
      (await quickInput.evaluate((element) => element.getBoundingClientRect().height)) > 32,
      'A visually wrapped note must grow without explicit line breaks',
    )
    await quickInput.fill(Array.from({ length: 11 }, (_, index) => `Quick line ${index + 1}`).join('\n'))
    const quickOverflow = await quickInput.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    }))
    assert(
      quickOverflow.height <= 153 &&
        quickOverflow.height >= 151 &&
        quickOverflow.scrollHeight > quickOverflow.clientHeight &&
        quickOverflow.overflow === 'auto',
      `The quick editor must stop at seven lines and scroll: ${JSON.stringify(quickOverflow)}`,
    )
    await quickInput.evaluate((element) => {
      element.setSelectionRange(0, 0)
      element.blur()
      element.scrollTop = 0
    })
    const quickBox = await quickInput.boundingBox()
    await page.mouse.move(quickBox.x + quickBox.width / 2, quickBox.y + quickBox.height / 2)
    await page.mouse.wheel(0, 180)
    await page.waitForFunction(
      () => document.querySelector('.dia-record-editor--quick textarea')?.scrollTop > 0,
    )
    assert(
      (await quickInput.evaluate((element) => element.scrollTop)) > 0,
      'The quick note must scroll with the mouse wheel',
    )
    const scroller = page.getByTestId('conversation-scroll')
    await scroller.evaluate((element) => {
      element.style.height = '320px'
    })
    await page.waitForFunction(() => {
      const card = document.querySelector('.dia-record-editor--quick')
      const field = card?.querySelector('textarea')
      return card !== null && field !== null && field.getBoundingClientRect().height < 152
    })
    const constrainedQuick = await quick.evaluate((element) => {
      const card = element.getBoundingClientRect()
      const check = element.querySelector('.dia-record-editor__check').getBoundingClientRect()
      const hit = document.elementFromPoint(check.left + check.width / 2, check.top + check.height / 2)
      return {
        cardBottom: card.bottom,
        checkBottom: check.bottom,
        clickable: hit !== null && element.querySelector('.dia-record-editor__check').contains(hit),
      }
    })
    assert(
      constrainedQuick.checkBottom <= constrainedQuick.cardBottom + 1 && constrainedQuick.clickable,
      `A short source viewport must keep the check visible: ${JSON.stringify(constrainedQuick)}`,
    )
    await scroller.evaluate((element) => {
      element.style.height = '440px'
    })
    await quick.getByRole('button', { name: 'Save' }).click()
    await page.getByTestId('seed-one-early').evaluate((button) => button.click())
    const marker = source.locator('.dia-marker').first()
    await marker.waitFor()
    const lastCharacter = await source.evaluate((element) => {
      const body = element.querySelector('.dia-assistant__body')
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode()) !== null) {
        const offset = node.textContent.indexOf('Alpha')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset + 4)
        range.setEnd(node, offset + 5)
        const rect = range.getBoundingClientRect()
        return { right: rect.right, top: rect.top }
      }
      throw new Error('Selected source character is missing')
    })
    const markerRect = await marker.boundingBox()
    assert(
      markerRect && Math.abs(markerRect.x - (lastCharacter.right + 2)) < 4,
      `The bubble must follow the selected word, not the message edge: ${JSON.stringify({ markerRect, lastCharacter })}`,
    )
    assert(markerRect.y < lastCharacter.top, 'The bubble must sit above the selected character')
    await marker.click()
    const card = page.locator('.dia-record-editor--detail')
    await card.waitFor()
    const editInput = card.locator('textarea')
    const editShort = await editInput.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      resize: getComputedStyle(element).resize,
    }))
    assert(
      editShort.height <= 33 && editShort.resize === 'none',
      'A short bubble note must use one fixed-height line',
    )
    await editInput.fill(Array.from({ length: 11 }, (_, index) => `Edited line ${index + 1}`).join('\n'))
    const editLong = await editInput.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    }))
    assert(
      editLong.height >= 151 &&
        editLong.height <= 153 &&
        editLong.scrollHeight > editLong.clientHeight &&
        editLong.overflow === 'auto',
      `A draft bubble must grow to seven lines then scroll: ${JSON.stringify(editLong)}`,
    )
    await editInput.evaluate((element) => {
      element.setSelectionRange(0, 0)
      element.blur()
      element.scrollTop = 0
    })
    const editorBox = await editInput.boundingBox()
    await page.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
    await page.mouse.wheel(0, 180)
    await page.waitForFunction(
      () => document.querySelector('.dia-record-editor--detail textarea')?.scrollTop > 0,
    )
    assert(
      (await editInput.evaluate((element) => element.scrollTop)) > 0,
      'A draft bubble must scroll with the mouse wheel',
    )
    const footerGeometry = await card.evaluate((element) => {
      const card = element.getBoundingClientRect()
      const footer = element.querySelector('.dia-record-editor__footer').getBoundingClientRect()
      const actions = Array.from(element.querySelectorAll('.dia-record-editor__footer button'))
      return {
        cardBottom: card.bottom,
        footerBottom: footer.bottom,
        buttonBottoms: actions.map((button) => button.getBoundingClientRect().bottom),
        actionable: actions.every((button) => {
          const rect = button.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit !== null && button.contains(hit)
        }),
      }
    })
    assert(
      footerGeometry.footerBottom <= footerGeometry.cardBottom + 1 &&
        footerGeometry.buttonBottoms.every((bottom) => bottom <= footerGeometry.cardBottom + 1) &&
        footerGeometry.actionable,
      `Growing the note must keep its action buttons visible: ${JSON.stringify(footerGeometry)}`,
    )
    assert((await card.locator('button').allTextContents()).includes('Cancel'), 'Edit card must have Cancel')
    assert((await card.locator('button').allTextContents()).includes('Save'), 'Edit card must have Save')
    assert(
      (await card
        .locator('button', { hasText: 'Save' })
        .evaluate((element) => getComputedStyle(element).whiteSpace)) === 'nowrap',
      'Edit card action labels must stay on one line',
    )
    await card.getByRole('button', { name: 'Cancel' }).click()
    await page.getByTestId('seed-three').click()
    await page.locator('main[data-annotation-count="3"]').waitFor()
    assert((await page.locator('.dia-record').count()) === 0, 'Saving must leave the record closed')
    const toggle = page.locator('.dia-record-toggle')
    const model = page.getByRole('button', { name: 'Fixture model selector' })
    const toggleRect = await toggle.boundingBox()
    const modelRect = await model.boundingBox()
    assert(
      toggleRect && modelRect && toggleRect.x + toggleRect.width <= modelRect.x + 1,
      'The record toggle must sit immediately left of model selection',
    )
    const chip = page.locator('.dia-composer-chip')
    const chipLayout = await chip.evaluate((element) => {
      const card = element.closest('[data-composer-card]')
      const chip = element.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      const input = card.querySelector('[data-composer-input]').getBoundingClientRect()
      const style = getComputedStyle(element)
      const remove = getComputedStyle(element.querySelector('.dia-composer-chip__remove'))
      return {
        left: chip.left - cardRect.left,
        top: chip.top - cardRect.top,
        height: chip.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        selector: getComputedStyle(card).getPropertyValue('--dsw-specific-selector').trim(),
        removeWidth: remove.width,
        removeOpacity: remove.opacity,
        clearOfInput: chip.bottom <= input.top,
      }
    })
    assert(
      Math.abs(chipLayout.left - 8) <= 1 &&
        Math.abs(chipLayout.top - 8) <= 1 &&
        chipLayout.height === 32 &&
        chipLayout.radius === '999px' &&
        chipLayout.background === chipLayout.selector &&
        chipLayout.removeWidth === '0px' &&
        chipLayout.removeOpacity === '0' &&
        chipLayout.clearOfInput,
      `The count chip must align with official composer buttons without covering text: ${JSON.stringify(chipLayout)}`,
    )
    await chip.hover()
    await page.waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__remove')).width) >= 27,
    )
    const openChip = await chip.boundingBox()
    const chipCard = await page.locator('[data-composer-card]').boundingBox()
    assert(
      openChip && chipCard && openChip.x + openChip.width <= chipCard.x + chipCard.width - 7,
      'Revealing the detach control must remain inside the composer',
    )
    await chip.locator('.dia-composer-chip__preview').waitFor()
    assert((await chip.textContent()).includes('First saved note'), 'Hover must preview attached notes')
    await page.screenshot({ path: join(artifacts, `chip-${variant.name}.png`), fullPage: true })
    await page.mouse.move(0, 0)
    await page.waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__remove')).width) < 1,
    )
    await chip.locator('.dia-composer-chip__main').focus()
    await page.waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__remove')).width) >= 27,
    )
    await chip.locator('.dia-composer-chip__main').click()
    const record = page.locator('.dia-record')
    await record.waitFor()
    assert((await record.locator('.dia-record-row').count()) === 3, 'Record must show three rows')
    await chip.locator('.dia-composer-chip__main').click()
    assert(
      (await record.locator('.dia-record__header').getAttribute('aria-expanded')) === 'false',
      'Chip must fold an open record',
    )
    assert((await record.locator('.dia-record-row').count()) === 0, 'Folded record must hide its rows')
    await chip.locator('.dia-composer-chip__main').click()
    assert(
      (await record.locator('.dia-record__header').getAttribute('aria-expanded')) === 'true',
      'Chip must reopen a folded record',
    )
    assert((await record.locator('.dia-record-row').count()) === 3, 'Reopened record must show its rows')
    assert(
      !(await record.textContent()).includes('Alpha selected phrase'),
      'Rows must omit selected source text',
    )
    const recordRect = await record.boundingBox()
    const composerRect = await page.locator('[data-composer-card]').boundingBox()
    assert(
      recordRect && composerRect && recordRect.y + recordRect.height <= composerRect.y + 1,
      `The downward record must move the composer without covering it: ${JSON.stringify({ recordRect, composerRect })}`,
    )
    const material = await record.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        officialMenu: getComputedStyle(document.documentElement)
          .getPropertyValue('--dsw-specific-menu')
          .trim(),
        backgroundImage: style.backgroundImage,
        blur: style.backdropFilter,
        shadow: style.boxShadow,
        radius: style.borderRadius,
      }
    })
    assert(
      material.background === material.officialMenu &&
        material.backgroundImage === 'none' &&
        material.blur.includes('blur(40px)') &&
        material.radius === '12px' &&
        material.shadow !== 'none',
      `The record must match the official task panel material: ${JSON.stringify(material)}`,
    )
    const firstRow = record.locator('.dia-record-row').first()
    const firstGlyph = firstRow.locator('.dia-record-row__glyph [data-state]')
    assert(
      (await firstGlyph.getAttribute('data-state')) === 'warning',
      'An attached note must use a static pending dot',
    )
    await firstRow.getByRole('button', { name: 'Locate source' }).click()
    assert((await record.count()) === 1, 'Locating source must keep the record visible')
    assert(
      (await record.locator('.dia-record__header').getAttribute('aria-expanded')) === 'true',
      'Locating source must preserve the expanded record',
    )
    const firstPaperclip = firstRow.locator('.dia-record-action').first()
    await firstPaperclip.click()
    assert(
      (await page.getByTestId('selected-count').textContent()) === 'Selected 2',
      'Paperclip must detach the existing record without deleting it',
    )
    assert(
      (await firstGlyph.getAttribute('data-state')) === 'idle',
      'Detached notes must use a static idle dot',
    )
    await firstPaperclip.click()
    assert((await firstGlyph.getAttribute('data-state')) === 'warning', 'Reattached notes must not spin')
    await page.locator('[data-composer-input]').fill('Review these annotations.')
    await page.getByRole('button', { name: 'Send fixture message' }).click()
    await page.getByTestId('interaction-history').waitFor()
    const history = page.getByTestId('interaction-history')
    const timeline = history.locator('.dia-timeline')
    const timelineTrigger = timeline.locator('.dia-timeline__trigger')
    assert(
      (await timelineTrigger.textContent()).includes('3 comments'),
      'Sent annotations need a compact count above the message',
    )
    assert(
      await history
        .locator('.dia-user-submission')
        .evaluate(
          (element) =>
            element.firstElementChild?.classList.contains('dia-timeline') &&
            element.children[1]?.classList.contains('dia-user'),
        ),
      'The annotation count must precede the user message',
    )
    assert(
      (await timelineTrigger.getAttribute('aria-expanded')) === 'false',
      'The sent annotation list starts folded',
    )
    await timelineTrigger.click()
    assert(
      (await timeline.locator('.dia-timeline-item').count()) === 3,
      'The expanded list must show all submitted quotes and notes',
    )
    assert(
      (await timeline.getByRole('button', { name: 'Locate source' }).count()) === 3,
      'Each message annotation needs a map-pin action',
    )
    assert(
      (await history.getByText('Alpha', { exact: true }).count()) > 0,
      'The expanded list must show source text',
    )
    assert(
      (await timeline.locator('.dia-diagnostics').count()) === 0,
      'Sent annotations must not show diagnostics details',
    )
    await timelineTrigger.click()
    assert(
      (await timeline.locator('.dia-timeline-item').count()) === 0,
      'Clicking the count again must fold the list',
    )
    assert((await record.count()) === 0, 'Record must automatically hide after all notes are sent')
    assert((await chip.count()) === 0, 'Composer chip must clear after sending')
    await marker.click()
    const sentCard = page.locator('.dia-record-editor--detail')
    await sentCard.waitFor()
    const sentInput = sentCard.locator('textarea')
    const sentLong = await sentInput.evaluate((element) => ({
      readOnly: element.readOnly,
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    }))
    assert(
      sentLong.readOnly &&
        sentLong.height >= 32 &&
        sentLong.height <= 153 &&
        sentLong.scrollHeight > sentLong.clientHeight &&
        sentLong.overflow === 'auto',
      `A sent bubble must use the same seven-line height and scroll: ${JSON.stringify(sentLong)}`,
    )
    await sentInput.evaluate((element) => {
      element.scrollTop = 0
    })
    const sentBox = await sentInput.boundingBox()
    await page.mouse.move(sentBox.x + sentBox.width / 2, sentBox.y + sentBox.height / 2)
    await page.mouse.wheel(0, 180)
    await page.waitForFunction(
      () => document.querySelector('.dia-record-editor--detail textarea')?.scrollTop > 0,
    )
    assert(
      (await sentInput.evaluate((element) => element.scrollTop)) > 0,
      'A sent bubble must scroll with the mouse wheel',
    )
    await sentCard.getByRole('button', { name: 'Cancel' }).click()
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '3',
      'Sending must preserve the three original records',
    )
    await toggle.click()
    await record.waitFor()
    await record.locator('.dia-record-row').first().locator('.dia-record-action').first().click()
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '3',
      'Reattaching a sent note must reuse its record',
    )
    assert(
      (await page.getByTestId('selected-count').textContent()) === 'Selected 1',
      'Reattached sent note must appear in the next composer batch',
    )
    await page.getByRole('button', { name: 'Send fixture message' }).click()
    const singleTrigger = history.locator('.dia-timeline__trigger')
    assert(
      (await singleTrigger.textContent()).includes('1 comment'),
      'A resend must use the single-annotation label',
    )
    await singleTrigger.hover()
    const preview = page.getByRole('tooltip')
    await preview.waitFor()
    assert(
      (await preview.textContent()).includes('Alpha') &&
        (await preview.textContent()).includes('First saved note'),
      'Hovering one sent annotation must preview its quote and note',
    )
    await singleTrigger.dblclick()
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '3',
      'Resending must not duplicate the record',
    )
    assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`)
    await page.screenshot({ path: join(artifacts, `record-${variant.name}.png`), fullPage: true })
    console.log(`PASS ${variant.name}: record, composer chip, paperclip, send, and same-ID resend`)
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `record-${variant.name}-failure.png`), fullPage: true })
    throw error
  } finally {
    await context.close()
  }
}

let browser
try {
  await mkdir(artifacts, { recursive: true })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || typeof address === 'string' || address === undefined)
    throw new Error('Vite did not expose a TCP address')
  browser = await chromium.launch({ headless: true })
  const base = `http://127.0.0.1:${address.port}`
  for (const variant of variants.filter((item) => selectedCase === undefined || item.name === selectedCase))
    await inspectVariant(browser, base, variant)
} finally {
  await browser?.close()
  await server.close()
}
