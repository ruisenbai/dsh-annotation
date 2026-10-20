/** Installed Codex UI and annotation plugin exercised together in an isolated Web profile. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Exercise selection, composer geometry, and submission against the installed interface plugin.
 * @param page Isolated browser page owned by the profile smoke.
 * @param options Host fixture bridge, authenticated origin, and screenshot directory.
 */
export async function exerciseCodexUi(page, { request, url, artifacts }) {
  const submission = await request('submit')
  const sessionUrl = new URL(url)
  sessionUrl.searchParams.set('session', submission.sessionId)
  await page.goto(sessionUrl.href, { waitUntil: 'domcontentloaded' })
  await page.locator('.dcu-root').waitFor()
  await page.locator(`[data-dcu-session="${submission.sessionId}"]`).first().click()
  await page.locator('html[data-dsh-annotation-compatibility="codex-ui"]').waitFor({ state: 'attached' })
  const body = page.locator('.dia-assistant__body').first()
  await body.getByText('Selected source needs clarification.', { exact: false }).waitFor()
  await body.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const quote = 'needs clarification.'
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = node.textContent.indexOf(quote)
      if (start === -1) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + quote.length)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
      node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      return
    }
    throw new Error('Expected quote is missing from the actual assistant renderer')
  })
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ animations: 'disabled', path: join(artifacts, 'codex-ui-selection.png') })
  await page.getByRole('button', { name: '添加注解', exact: true }).click()
  const editor = page.locator('.dia-record-editor--quick')
  await editor.getByRole('textbox', { name: '你的注解' }).fill('兼容模式下解释这句话。')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        colorScheme === 'dark',
      )
      await page.waitForFunction(() => {
        const editor = document.querySelector('.dia-record-editor--quick')
        const rect = editor.getBoundingClientRect()
        return (
          rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.width >= Math.min(240, window.innerWidth - 24)
        )
      })
      const save = editor.getByRole('button', { name: '保存', exact: true })
      assert.ok(
        await save.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return element.contains(
            document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
          )
        }),
        'The editor save action must remain reachable',
      )
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `codex-ui-editor-${width}-${colorScheme}.png`),
      })
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const chip = page.locator('.dia-composer-chip')
  await chip.waitFor()
  const composer = page.locator('[data-composer-card] [contenteditable="true"]')
  const requirement = '请结合注解说明。'
  await composer.click()
  await composer.press('End')
  await composer.pressSequentially(requirement)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        colorScheme === 'dark',
      )
      // Reordering the installed stylesheet exercises late theme/plugin loading as well.
      await page.evaluate(() =>
        document.head.prepend(document.querySelector('style[data-dsh-annotation="true"]')),
      )
      const geometry = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const chip = document.querySelector('.dia-composer-chip').getBoundingClientRect()
        const input = document
          .querySelector('[data-composer-card] [data-lexical-editor=true]')
          .getBoundingClientRect()
        return { chipLeft: chip.left, chipRight: chip.right, chipBottom: chip.bottom, inputTop: input.top }
      })
      assert.ok(
        geometry.chipBottom <= geometry.inputTop,
        `Annotation chip covers Codex UI input: ${JSON.stringify(geometry)}`,
      )
      assert.ok(
        geometry.chipLeft >= 0 && geometry.chipRight <= width,
        `Annotation attachment must fit ${width}px`,
      )
      assert.ok((await composer.innerText()).includes(requirement))
      await chip.locator('.dia-composer-chip__main').hover()
      const preview = page.locator('.dia-composer-chip__preview')
      await preview.waitFor()
      await page.waitForFunction(() => {
        const card = document.querySelector('.dia-composer-chip__preview')?.parentElement
        return card !== undefined && card !== null && getComputedStyle(card).opacity === '1'
      })
      const previewBounds = await preview.locator('..').boundingBox()
      assert.ok(
        previewBounds && previewBounds.x >= 0 && previewBounds.x + previewBounds.width <= width,
        `Annotation preview must fit ${width}px: ${JSON.stringify(previewBounds)}`,
      )
      assert.ok(
        previewBounds.y + previewBounds.height <= geometry.inputTop,
        'The attached-note preview must leave the composer text visible',
      )
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `codex-ui-preview-${width}-${colorScheme}.png`),
      })
      await page.keyboard.press('Escape')
      await preview.waitFor({ state: 'hidden' })
      await chip.getByRole('button', { name: '打开并展开注解记录，1 条注解随消息发送', exact: true }).click()
      const record = page.locator('.dia-record')
      await record.waitFor()
      const bounds = await record.boundingBox()
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
        `Annotation record must fit ${width}px`,
      )
      if (width === 390) {
        const row = record.locator('.dia-record-row').first()
        const note = await row.locator('.dia-record-row__text').boundingBox()
        const actions = await row.locator('.dia-record-row__actions').boundingBox()
        assert.ok(
          note && actions && actions.y >= note.y + note.height,
          'Narrow records must keep the action row below the note text',
        )
      }
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `codex-ui-${width}-${colorScheme}.png`),
        fullPage: true,
      })
      await page.getByRole('button', { name: '隐藏注解记录', exact: true }).click()
    }
  }
  console.log(
    'PASS Codex UI editors, previews, chip, and records fit both widths/themes; Escape dismisses previews',
  )
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('html[data-dsh-annotation-compatibility="codex-ui"]').waitFor({ state: 'attached' })
  await chip.waitFor()
  await page.waitForFunction(
    (text) =>
      document.querySelector('[data-composer-card] [contenteditable="true"]')?.textContent?.includes(text),
    requirement,
  )
  await composer.click()
  await composer.press('End')
  await composer.press('Enter')
  await chip.waitFor({ state: 'hidden' })
  await page.locator('.dia-user-submission').nth(1).waitFor()
  const saved = await request('read-session', { sessionId: submission.sessionId })
  const admissions = saved.events.filter(
    (event) => event.type === 'user/message' && event.data.source?.annotationSubmission,
  )
  assert.equal(admissions.length, 2, 'A single Enter must admit the annotation exactly once')
  const admitted = admissions[1].data
  assert.equal(admitted.source.annotationSubmission.overallRequirement, requirement)
  assert.equal(admitted.source.annotationSubmission.annotations[0].quote.exact, 'needs clarification.')
  assert.equal(admitted.source.annotationSubmission.annotations[0].annotation, '兼容模式下解释这句话。')
  const requests = await request('model-requests')
  assert.deepEqual(
    requests.at(-1).find((message) => message.id === admitted.id),
    admitted,
  )
  await page.screenshot({
    animations: 'disabled',
    path: join(artifacts, 'codex-ui-sent.png'),
    fullPage: true,
  })
  console.log('PASS Codex UI reload, official composer submission, durable log, and model input agree')
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '注解', exact: true }).click()
  const settings = page.locator('.dia-plugin-card')
  await settings.waitFor()
  assert.equal(await settings.getByRole('switch').count(), 4)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        colorScheme === 'dark',
      )
      const bounds = await settings.boundingBox()
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
        `Annotation settings must fit ${width}px: ${JSON.stringify(bounds)}`,
      )
      await page.screenshot({
        animations: 'disabled',
        path: join(artifacts, `codex-ui-settings-${width}-${colorScheme}.png`),
      })
    }
  }
  console.log('PASS Codex UI settings retains the annotation controls in both widths/themes')
}
