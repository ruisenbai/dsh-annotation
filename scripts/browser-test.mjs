import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { assertMarkerMaterial, captureMarker } from './marker-material.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(root, 'artifacts', 'browser')
const selectedCase = process.argv
  .slice(2)
  .find((argument) => !['--blank-only', '--record-order-only'].includes(argument))
const blankOnly = process.argv.includes('--blank-only')
const recordOrderOnly = process.argv.includes('--record-order-only')
const variants = [
  { name: 'wide-light', width: 1280, height: 850, dark: false },
  { name: 'narrow-dark', width: 390, height: 850, dark: true },
]
const geometryReport = { generatedAt: new Date().toISOString(), variants: {}, trash: null }

function rectEdges(rect) {
  assert(rect !== null, 'Expected a visible element with a DOMRect')
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
  }
}

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
    viewport: { width: variant.width, height: variant.height },
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
    if (!variant.dark) {
      const flash = await source.evaluate(async (element) => {
        const { showSourceFlash } = await import('/src/client/source-flash.ts')
        const root = element.querySelector('.dia-assistant__body')
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let text = walker.nextNode()
        while (text !== null && !text.textContent.includes('Alpha')) text = walker.nextNode()
        if (!(text instanceof Text)) return { visible: false, faded: false }
        const start = text.textContent.indexOf('Alpha')
        const range = document.createRange()
        range.setStart(text, start)
        range.setEnd(text, start + 5)
        const dispose = showSourceFlash(root, [range])
        const mark = document.querySelector('.dia-source-flash')
        const visible = mark !== null && mark.getBoundingClientRect().width > 0
        await new Promise((resolve) => setTimeout(resolve, 1_100))
        const faded = mark !== null && Number(getComputedStyle(mark).opacity) < 0.9
        dispose?.()
        return { visible, faded }
      })
      assert(flash.visible && flash.faded, `Located source highlight must fade: ${JSON.stringify(flash)}`)
    }
    await page.getByTestId('conversation-scroll').evaluate((element) => {
      element.scrollTop = 250
    })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByTestId('begin-quick-editor').evaluate((button) => button.click())
    const quick = page.locator('.dia-record-editor--quick')
    await quick.waitFor()
    const quickRect = rectEdges(await quick.boundingBox())
    const selectionLastLine = await source.evaluate((element) => {
      const body = element.querySelector('.dia-assistant__body')
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const start = node.textContent.indexOf('Alpha')
        if (start < 0) continue
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + 'Alpha'.length)
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
        const rect = rects.at(-1) ?? range.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      }
      throw new Error('Selected source text is missing')
    })
    assert(
      quickRect.top >= selectionLastLine.bottom,
      `The quick editor must not overlap the selected final line: ${JSON.stringify({ quickRect, selectionLastLine })}`,
    )
    await page.screenshot({ path: join(artifacts, `editor-${variant.name}.png`), fullPage: true })
    const quickInput = quick.locator('textarea')
    const quickShape = await quick.evaluate((element) => {
      const card = element.getBoundingClientRect()
      const check = element.querySelector('.dia-record-editor__check').getBoundingClientRect()
      const field = element.querySelector('textarea').getBoundingClientRect()
      return {
        width: card.width,
        radius: getComputedStyle(element).borderTopLeftRadius,
        checkRadius: getComputedStyle(element.querySelector('.dia-record-editor__check')).borderRadius,
        checkWidth: check.width,
        checkHeight: check.height,
        placement: element.dataset.floatingPlacement,
        checkCenter: check.top + check.height / 2,
        fieldCenter: field.top + field.height / 2,
        fieldHeight: field.height,
        resize: getComputedStyle(element.querySelector('textarea')).resize,
      }
    })
    assert(
      quickShape.width <= 392 &&
        quickShape.radius === '999px' &&
        quickShape.checkRadius === '50%' &&
        quickShape.checkWidth === quickShape.checkHeight &&
        quickShape.resize === 'none' &&
        quickShape.fieldHeight <= 33 &&
        Math.abs(quickShape.checkCenter - quickShape.fieldCenter) <= 2,
      `A one-line quick editor must use the approved compact layout: ${JSON.stringify(quickShape)}`,
    )
    assert(
      quickShape.placement === 'bottom',
      `The quick editor must start below the selected character: ${JSON.stringify(quickShape)}`,
    )
    await quickInput.fill(' \n\t ')
    for (let outside = 0; outside < 2; outside += 1) {
      await page.mouse.click(2, 2)
      assert(await quick.isVisible(), 'The first two outside clicks must retain the blank editor')
      await page.locator('.dia-record-editor--quick.dia-record-editor--shake').waitFor()
      await page.locator('.dia-record-editor--quick.dia-record-editor--shake').waitFor({
        state: 'hidden',
      })
      if (outside === 0) await quickInput.click()
    }
    await page.mouse.click(2, 2)
    await quick.waitFor({ state: 'detached' })
    geometryReport.variants[variant.name] = {
      viewport: { width: variant.width, height: variant.height },
      selectionLastLine,
      editor: quickRect,
      capsule: quickShape,
    }
    const blankView = JSON.parse(await page.getByTestId('interaction-view-json').textContent())
    assert(
      blankView.annotations.length === 0 &&
        blankView.trash.length === 0 &&
        blankView.editorDrafts.length === 0 &&
        blankView.editor === null &&
        blankView.selectedAnnotationIds.length === 0 &&
        (await page.locator('.dia-marker, .dia-composer-chip').count()) === 0,
      'Canceling a blank editor must create neither records, trash nor recoverable blank buffers',
    )
    await page.getByTestId('begin-quick-editor').evaluate((button) => button.click())
    await quick.waitFor()
    await page.locator('[data-composer-input]').fill('Keep the composer focus')
    await quick.waitFor({ state: 'detached' })
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '0' &&
        (await page
          .locator('[data-composer-input]')
          .evaluate((element) => element.contains(document.activeElement))),
      'Typing in the composer must not implicitly save an empty annotation',
    )
    const restoredPage = await context.newPage()
    try {
      await restoredPage.goto(`${base}/?scenario=interaction`, { waitUntil: 'networkidle' })
      await restoredPage.getByTestId('interaction-view-json').waitFor({ state: 'attached' })
      const restoredBlankView = JSON.parse(
        await restoredPage.getByTestId('interaction-view-json').textContent(),
      )
      assert(
        restoredBlankView.annotations.length === 0 &&
          restoredBlankView.trash.length === 0 &&
          restoredBlankView.editorDrafts.length === 0 &&
          restoredBlankView.editor === null &&
          restoredBlankView.selectedAnnotationIds.length === 0 &&
          (await restoredPage.locator('.dia-marker, .dia-composer-chip').count()) === 0,
        'Canceled blank editors must stay absent after a browser refresh',
      )
    } finally {
      await restoredPage.close()
    }
    if (blankOnly) {
      assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`)
      console.log(`PASS ${variant.name}: blank editor shake, cancel, composer focus, and refresh recovery`)
      return
    }
    await page.locator('[data-composer-input]').fill('')
    await page.getByTestId('conversation-scroll').evaluate((element) => {
      element.scrollTop = 250
    })
    await page.getByTestId('begin-quick-editor').evaluate((button) => button.click())
    await quick.waitFor()
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
    try {
      await page.waitForFunction(() => {
        const card = document.querySelector('.dia-record-editor--quick')
        const field = card?.querySelector('textarea')
        const scroller = document.querySelector('[data-testid="conversation-scroll"]')
        if (card === null || field === null || scroller === null) return false
        const reservedBottom = parseFloat(getComputedStyle(scroller).paddingBottom)
        return (
          field.getBoundingClientRect().height < 152 ||
          (reservedBottom >= card.getBoundingClientRect().height + 8 &&
            scroller.scrollHeight > scroller.clientHeight)
        )
      })
    } catch (cause) {
      const geometry = await quick.evaluate((element) => {
        const scroller = document.querySelector('[data-testid="conversation-scroll"]')
        const style = getComputedStyle(scroller)
        return {
          editor: element.getBoundingClientRect().toJSON(),
          field: element.querySelector('textarea').getBoundingClientRect().toJSON(),
          scroller: scroller.getBoundingClientRect().toJSON(),
          scrollerStyle: {
            inlineHeight: scroller.style.height,
            computedHeight: style.height,
            minHeight: style.minHeight,
            padding: style.padding,
            boxSizing: style.boxSizing,
            transform: style.transform,
          },
        }
      })
      throw new Error(`A short source viewport did not constrain the editor: ${JSON.stringify(geometry)}`, {
        cause,
      })
    }
    const constrainedQuick = await quick.evaluate((element) => {
      const card = element.getBoundingClientRect()
      const check = element.querySelector('.dia-record-editor__check').getBoundingClientRect()
      const hit = document.elementFromPoint(check.left + check.width / 2, check.top + check.height / 2)
      const body = document.querySelector('[data-testid="interaction-source"] .dia-assistant__body')
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let sourceBottom = null
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const start = node.textContent.indexOf('Alpha')
        if (start < 0) continue
        const range = document.createRange()
        range.setStart(node, start + 4)
        range.setEnd(node, start + 5)
        sourceBottom = range.getBoundingClientRect().bottom
        break
      }
      return {
        cardTop: card.top,
        cardBottom: card.bottom,
        checkBottom: check.bottom,
        clickable: hit !== null && element.querySelector('.dia-record-editor__check').contains(hit),
        sourceBottom,
      }
    })
    assert(
      constrainedQuick.checkBottom <= constrainedQuick.cardBottom + 1 &&
        constrainedQuick.clickable &&
        constrainedQuick.sourceBottom !== null &&
        constrainedQuick.cardTop >= constrainedQuick.sourceBottom + 7,
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
    const markerIdle = await assertMarkerMaterial(marker, false)
    await marker.focus()
    await assertMarkerMaterial(marker, false)
    await marker.hover()
    const markerHover = await assertMarkerMaterial(marker, false)
    assert(markerIdle.alpha === markerHover.alpha, 'Hover must retain the frosted fill')
    await captureMarker(page, marker, join(artifacts, `marker-hover-${variant.name}.png`))
    await marker.click()
    const card = page.locator('.dia-record-editor--detail')
    await card.waitFor()
    await assertMarkerMaterial(marker, true)
    await captureMarker(page, marker, join(artifacts, `marker-open-${variant.name}.png`))
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
    await assertMarkerMaterial(marker, false)
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
      const actions = getComputedStyle(element.querySelector('.dia-composer-chip__actions'))
      return {
        left: chip.left - cardRect.left,
        top: chip.top - cardRect.top,
        height: chip.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        selector: getComputedStyle(card).getPropertyValue('--dsw-specific-selector').trim(),
        removeWidth: remove.width,
        removeOpacity: actions.opacity,
        clearOfInput: chip.bottom <= input.top,
      }
    })
    assert(
      Math.abs(chipLayout.left - 8) <= 1 &&
        Math.abs(chipLayout.top - 8) <= 1 &&
        chipLayout.height === 32 &&
        chipLayout.radius === '999px' &&
        chipLayout.background === chipLayout.selector &&
        chipLayout.removeWidth === '28px' &&
        chipLayout.removeOpacity === '0' &&
        chipLayout.clearOfInput,
      `The count chip must align with official composer buttons without covering text: ${JSON.stringify(chipLayout)}`,
    )
    await chip.hover()
    await page.waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__actions')).opacity) === 1,
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
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__actions')).opacity) === 0,
    )
    await chip.locator('.dia-composer-chip__main').focus()
    await page.waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('.dia-composer-chip__actions')).opacity) === 1,
    )
    assert(
      (await chip.locator('.dia-composer-chip__main').innerText()).trim() === '3 annotations',
      'The composer count must omit the send-with-message suffix',
    )
    const beforeTrash = JSON.parse(await page.getByTestId('interaction-view-json').textContent()).trash.length
    await chip.getByRole('button', { name: 'Remove annotations from this message' }).click()
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '3',
      'The X only detaches annotations',
    )
    assert(
      JSON.parse(await page.getByTestId('interaction-view-json').textContent()).trash.length === beforeTrash,
      'Detaching must not put records in the recycle bin',
    )
    await toggle.click()
    for (let index = 0; index < 3; index += 1) {
      await page
        .locator('.dia-record')
        .getByRole('button', { name: 'Send with message', exact: true })
        .first()
        .click()
    }
    await chip.hover()
    const trash = chip.getByRole('button', { name: 'Move attached annotations to the recycle bin' })
    const detach = chip.getByRole('button', { name: 'Remove annotations from this message' })
    const trashBox = await trash.boundingBox()
    const detachBox = await detach.boundingBox()
    assert(trashBox.x + trashBox.width <= detachBox.x, 'Trash must be left of the X')
    await trash.hover()
    const dangerBackground = await trash.evaluate((element) => getComputedStyle(element).backgroundColor)
    await detach.hover()
    const neutralBackground = await detach.evaluate((element) => getComputedStyle(element).backgroundColor)
    assert(
      dangerBackground !== 'rgba(0, 0, 0, 0)' && dangerBackground !== neutralBackground,
      'Trash must use a red background and X a distinct neutral highlight in both themes',
    )
    await trash.click()
    assert(
      (await page.locator('main').getAttribute('data-annotation-count')) === '0',
      'Trash deletes the captured attachment batch',
    )
    assert(
      JSON.parse(await page.getByTestId('interaction-view-json').textContent()).trash.length ===
        beforeTrash + 3,
      'Every removed attachment must remain in the recycle bin',
    )
    await page.getByTestId('seed-three').click()
    await chip.locator('.dia-composer-chip__main').click()
    const record = page.locator('.dia-record')
    await record.waitFor()
    assert((await record.locator('.dia-record-row').count()) === 3, 'Record must show three rows')
    await chip.locator('.dia-composer-chip__main').click()
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'false',
      'Chip must fold an open record',
    )
    assert((await record.locator('.dia-record-row').count()) === 0, 'Folded record must hide its rows')
    await chip.locator('.dia-composer-chip__main').click()
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'true',
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
    const recordBody = await record.locator('.dia-record__body').boundingBox()
    assert(recordBody !== null, 'The record body must be visible')
    await page.mouse.click(recordBody.x + recordBody.width / 2, recordBody.y + 2)
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'false',
      'Clicking the record top padding must fold the record',
    )
    await page.mouse.click(recordBody.x + recordBody.width / 2, recordBody.y + 2)
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'true',
      'Clicking the record top padding must expand the record',
    )
    await record.locator('.dia-record__progress').click()
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'false',
      'Clicking the record header text must fold the record',
    )
    await record.locator('.dia-record__progress').click()
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'true',
      'Clicking the record header text must expand the record',
    )
    const firstRow = record.locator('.dia-record-row').filter({ hasText: 'First saved note' })
    const firstGlyph = firstRow.locator('.dia-record-row__glyph [data-state]')
    assert(
      (await firstGlyph.getAttribute('data-state')) === 'warning',
      'An attached note must use a static pending dot',
    )
    await firstRow.getByRole('button', { name: 'Locate source' }).click()
    assert((await record.count()) === 1, 'Locating source must keep the record visible')
    assert(
      (await record.locator('.dia-record__heading-action').getAttribute('aria-expanded')) === 'true',
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
    if ((await marker.getAttribute('aria-haspopup')) === 'menu') {
      await page.getByRole('menuitem', { name: /#1 First saved note/ }).click()
    }
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
    await firstRow.locator('.dia-record-action').first().click()
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

async function inspectRecordOrder(browser, base, variant) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
    colorScheme: variant.dark ? 'dark' : 'light',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${base}/?scenario=interaction&reset=1`, { waitUntil: 'networkidle' })
    const save = async (note) => {
      await page.getByTestId('begin-quick-editor').evaluate((button) => button.click())
      const editor = page.locator('.dia-record-editor--quick')
      await editor.locator('textarea').fill(note)
      await editor.getByRole('button', { name: 'Save', exact: true }).click()
      await editor.waitFor({ state: 'hidden' })
    }
    const names = Array.from({ length: 24 }, (_, index) => `Record ${String(index).padStart(2, '0')}`)
    for (const name of names) await save(name)
    await page.getByRole('button', { name: 'Show annotation records', exact: true }).click()
    const list = page.locator('.dia-record__list')
    const row = (name) => list.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) })
    const order = () => list.locator('.dia-record-row__preview-anchor').allTextContents()
    assert(
      JSON.stringify(await order()) === JSON.stringify([...names].reverse()),
      'Newest records must appear first',
    )
    for (const name of names.slice(0, 8))
      await row(name).getByRole('button', { name: 'Remove from message' }).click()
    const target = row('Record 14')
    await list.scrollIntoViewIfNeeded()
    await target.evaluate((element) => {
      const list = element.parentElement
      list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - 36
    })
    const button = target.getByRole('button', { name: 'Remove from message' })
    await button.focus()
    const offset = () =>
      target.evaluate(
        (element) => element.getBoundingClientRect().top - element.parentElement.getBoundingClientRect().top,
      )
    const before = await offset()
    await button.click()
    assert(Math.abs((await offset()) - before) <= 1, 'Detaching a row must retain its visible offset')
    assert(
      await target
        .getByRole('button', { name: 'Send with message' })
        .evaluate((element) => element === document.activeElement),
      'Reordering must retain keyboard focus',
    )
    await target.getByRole('button', { name: 'Send with message' }).click()
    assert(Math.abs((await offset()) - before) <= 1, 'Reattaching a row must retain its visible offset')
    await page.screenshot({ path: join(artifacts, `record-order-${variant.name}.png`), fullPage: false })
    const anchor = await list.evaluate((element) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const bounds = element.getBoundingClientRect()
      const first = Array.from(element.children).find(
        (child) => child.getBoundingClientRect().bottom > bounds.top,
      )
      return { id: first.dataset.annotationId, offset: first.getBoundingClientRect().top - bounds.top }
    })
    await save('Newest while reading')
    const preservedOffset = await list.evaluate((element, id) => {
      const row = Array.from(element.children).find((child) => child.dataset.annotationId === id)
      return row.getBoundingClientRect().top - element.getBoundingClientRect().top
    }, anchor.id)
    assert(
      Math.abs(preservedOffset - anchor.offset) <= 1,
      'Adding a note while scrolled must preserve the reading anchor',
    )
    await list.evaluate((element) => {
      element.scrollTop = 0
    })
    await save('Newest at top')
    assert((await order())[0] === 'Newest at top', 'The newest note must lead the attached group')
    assert(
      await list.evaluate((element) => element.scrollTop === 0),
      'Readers at the top must see the newly added record',
    )
    const beforeReload = await order()
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Show annotation records', exact: true }).click()
    assert(JSON.stringify(await order()) === JSON.stringify(beforeReload), 'Reload must retain record order')
    assert(errors.length === 0, `Record ordering browser errors: ${errors.join('\n')}`)
    console.log(
      `PASS record-order-${variant.name}: newest first, attachment priority, focus, scroll anchors, and reload`,
    )
  } catch (error) {
    await page.screenshot({
      path: join(artifacts, `record-order-${variant.name}-failure.png`),
      fullPage: false,
    })
    throw error
  } finally {
    await context.close()
  }
}

async function inspectTrash(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${base}/?scenario=trash`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Recycle bin/u }).click()
    const dialog = page.locator('.dia-trash-modal')
    await dialog.waitFor({ state: 'visible' })
    const sessionLabels = await dialog.locator('.dia-trash__session-field option').allTextContents()
    assert(sessionLabels.includes('project-1 - Review 1'), 'Trash Sessions must use project and title labels')
    const radioRows = await dialog
      .locator('.dia-trash__source-filter label')
      .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().top)))
    assert(new Set(radioRows).size < radioRows.length, 'Trash source radios must share a compact row')
    const first = dialog.locator('.dia-trash__disclosure').first()
    await first.focus()
    await page.keyboard.press('Enter')
    await dialog.locator('.dia-trash__source pre').waitFor({ state: 'visible' })
    const initial = await dialog.evaluate((element) => {
      const edges = (rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })
      const modal = element.getBoundingClientRect()
      const content = element.querySelector('.dia-trash-modal__content')?.getBoundingClientRect()
      const workspace = element.querySelector('.dia-trash__workspace')?.getBoundingClientRect()
      const list = element.querySelector('.dia-trash__list')
      const detail = element.querySelector('.dia-trash__detail')
      const selected = element.querySelector('.dia-trash__row[data-selected="true"]')
      const row = element.querySelector('.dia-trash__row')
      return {
        modal: edges(modal),
        content: content && edges(content),
        workspace: workspace && edges(workspace),
        list: list && {
          ...edges(list.getBoundingClientRect()),
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
        },
        detail: detail && {
          ...edges(detail.getBoundingClientRect()),
          clientHeight: detail.clientHeight,
          scrollHeight: detail.scrollHeight,
        },
        row: row && {
          ...edges(row.getBoundingClientRect()),
          buttons: Array.from(row.querySelectorAll('button')).map((button) => ({
            label: button.getAttribute('aria-label') ?? button.textContent?.trim(),
            ...edges(button.getBoundingClientRect()),
            clientWidth: button.clientWidth,
            scrollWidth: button.scrollWidth,
          })),
        },
        selected: selected !== null,
      }
    })
    assert(
      initial.modal.top >= -1 && initial.modal.bottom <= 781,
      `The trash modal is clipped: ${JSON.stringify(initial)}`,
    )
    assert(
      initial.content && initial.workspace && initial.list && initial.detail && initial.row,
      `The trash layout is incomplete: ${JSON.stringify(initial)}`,
    )
    assert(initial.selected, 'The disclosed recycle-bin row needs a visible selected state')
    assert(
      initial.list.scrollHeight > initial.list.clientHeight &&
        initial.detail.scrollHeight > initial.detail.clientHeight,
      `The narrow recycle-bin fixture must exercise both scroll regions: ${JSON.stringify(initial)}`,
    )
    assert(
      initial.workspace.left >= initial.modal.left - 1 &&
        initial.workspace.right <= initial.modal.right + 1 &&
        initial.list.left >= initial.workspace.left - 1 &&
        initial.list.right <= initial.workspace.right + 1 &&
        initial.detail.left >= initial.workspace.left - 1 &&
        initial.detail.right <= initial.workspace.right + 1,
      `The narrow recycle-bin workspace escapes the modal: ${JSON.stringify(initial)}`,
    )
    assert(
      initial.row.left >= initial.list.left - 1 &&
        initial.row.right <= initial.list.right + 1 &&
        initial.row.buttons.every(
          (button) =>
            button.left >= initial.row.left - 1 &&
            button.right <= initial.row.right + 1 &&
            button.scrollWidth <= button.clientWidth + 1,
        ),
      `The narrow recycle-bin row or its actions are clipped: ${JSON.stringify(initial.row)}`,
    )
    await page.screenshot({ path: join(artifacts, 'trash-390x780-top.png'), fullPage: false })
    const scrolled = await dialog.evaluate((element) => {
      const measure = (target) => {
        target.scrollTop = target.scrollHeight
        return {
          scrollTop: target.scrollTop,
          clientHeight: target.clientHeight,
          scrollHeight: target.scrollHeight,
          reachesBottom: Math.abs(target.scrollTop + target.clientHeight - target.scrollHeight) <= 1,
        }
      }
      return {
        list: measure(element.querySelector('.dia-trash__list')),
        detail: measure(element.querySelector('.dia-trash__detail')),
      }
    })
    assert(
      scrolled.list.reachesBottom && scrolled.detail.reachesBottom,
      `Trash content cannot reach its end: ${JSON.stringify(scrolled)}`,
    )
    await page.screenshot({ path: join(artifacts, 'trash-390x780-bottom.png'), fullPage: false })
    await dialog.getByRole('button', { name: 'Delete permanently' }).first().click()
    const confirmation = page.locator('.dia-trash-confirm-modal')
    await confirmation.waitFor({ state: 'visible' })
    const confirmationRect = rectEdges(await confirmation.boundingBox())
    const confirmationButtons = await confirmation.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return {
          label: button.getAttribute('aria-label') ?? button.textContent?.trim(),
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          borderRadius: style.borderRadius,
          color: style.color,
          background: style.backgroundColor,
        }
      }),
    )
    assert(confirmationButtons.length >= 2, 'The confirmation must expose official cancel and delete buttons')
    assert(
      confirmationButtons.every(
        (button) =>
          button.left >= confirmationRect.left - 1 &&
          button.right <= confirmationRect.right + 1 &&
          button.left >= -1 &&
          button.right <= 391 &&
          button.scrollWidth <= button.clientWidth + 1,
      ),
      `The confirmation buttons are clipped: ${JSON.stringify({ confirmationRect, confirmationButtons })}`,
    )
    await page.screenshot({ path: join(artifacts, 'trash-confirm-390x780.png'), fullPage: false })
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await confirmation.waitFor({ state: 'hidden' })
    geometryReport.trash = {
      viewport: { width: 390, height: 780 },
      initial,
      scrolled,
      confirmation: { rect: confirmationRect, buttons: confirmationButtons },
    }
    assert(errors.length === 0, `Trash browser errors: ${errors.join('\n')}`)
    console.log('PASS trash-390x780: list/detail scrolling, selection, and confirmation actions')
  } catch (error) {
    await page.screenshot({ path: join(artifacts, 'trash-390x780-failure.png'), fullPage: false })
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
  for (const variant of variants.filter((item) => selectedCase === undefined || item.name === selectedCase)) {
    if (!recordOrderOnly) await inspectVariant(browser, base, variant)
    if (!blankOnly) await inspectRecordOrder(browser, base, variant)
  }
  if (selectedCase === undefined && !recordOrderOnly) await inspectTrash(browser, base)
  await writeFile(join(artifacts, 'browser-geometry.json'), `${JSON.stringify(geometryReport, null, 2)}\n`)
} finally {
  await browser?.close()
  await server.close()
}
