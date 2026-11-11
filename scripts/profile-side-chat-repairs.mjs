/** Interaction regressions against the candidate plugin in its official isolated Web profile. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

/** @param harness - Browser and official-profile fixture operations. @returns Recorded repair checks and geometry. */
export async function exerciseSideChatRepairs(harness) {
  const {
    browser,
    url,
    workspace,
    artifacts,
    request,
    seedMain,
    usePage,
    openMain,
    openSide,
    collect,
    selectText,
    composer,
    waitForSideLayout,
    assertComposerAtBottom,
    assertReferenceLocation,
    evidence,
  } = harness
  const mainId = 'annotation-side-chat-repair-main'
  const alpha = 'Repair Alpha source.'
  const beta = 'Repair Beta source.'
  const gamma = 'Repair Gamma source.'
  const delta = 'Repair Delta source.'
  const epsilon = 'Repair Epsilon source.'
  const longQuotes = [
    `Multiline quote\n${'Second line with original spacing.\n'.repeat(35)}Last line.`,
    `https://example.test/${'continuous-path-'.repeat(150)}`,
    '连续长文本withoutBreak'.repeat(160),
  ]
  const source = `${alpha} ${beta} ${gamma} ${delta} ${epsilon}\n\n${longQuotes.map((quote) => `\`\`\`text\n${quote}\n\`\`\``).join('\n\n')}`
  await seedMain(workspace, mainId, source, 'Interaction repairs')
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const errors = []
  context.on('page', (target) => target.on('pageerror', (error) => errors.push(error.message)))
  page.on('pageerror', (error) => errors.push(error.message))
  usePage(page)
  const checks = []
  const geometry = []
  let standaloneModelText
  const check = (name, result = {}) => {
    checks.push({ name, status: 'passed', ...result })
    evidence.checks.push({ name, status: 'passed' })
    console.log(`PASS repair: ${name}`)
  }
  const side = page.locator(`[data-dia-side-chat][data-main-session="${mainId}"]`)
  const flow = () => side.locator('[data-conversation-content]:visible')
  const main = () => page.locator(`[data-conversation-content][data-conversation-session="${mainId}"]`)
  const currentState = (target = page) =>
    target.evaluate((id) => JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${id}`)), mainId)
  async function storedChat(id, expectedReferences, target = page) {
    await target.waitForFunction(
      ({ mainId, id, expectedReferences }) => {
        const state = JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${mainId}`))
        const chat = state?.chats.find((entry) => entry.sideChatId === id)
        return (
          chat?.created === true &&
          (expectedReferences === undefined || chat.references.length === expectedReferences)
        )
      },
      { mainId, id, expectedReferences },
    )
    return (await currentState(target)).chats.find((entry) => entry.sideChatId === id)
  }
  async function activeChat() {
    await composer(flow()).waitFor({ state: 'visible' })
    await page.waitForFunction((id) => {
      const state = JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${id}`))
      const active = state?.chats.find((entry) => entry.sideChatId === state.activeSideChatId)
      return (
        active?.created === true &&
        active.sideSessionId ===
          document.querySelector(`[data-dia-side-chat][data-main-session="${id}"]`)?.dataset.sideSession
      )
    }, mainId)
    const state = await currentState()
    return state.chats.find((entry) => entry.sideChatId === state.activeSideChatId)
  }
  async function choose(id) {
    await side.locator(`[data-dia-side-chat-select="${id}"]:visible`).click()
    await composer(flow()).waitFor({ state: 'visible' })
    await page.waitForFunction(
      ({ mainId, id }) => {
        const root = document.querySelector(`[data-dia-side-chat][data-main-session="${mainId}"]`)
        const state = JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${mainId}`))
        return (
          root?.dataset.sideSession ===
            state?.chats.find((entry) => entry.sideChatId === id)?.sideSessionId &&
          state?.activeSideChatId === id
        )
      },
      { mainId, id },
    )
  }
  async function openStandaloneFromList(sessionId) {
    if ((await page.locator('[data-sidebar-collapsed]').count()) > 0)
      await page.locator('[data-sidebar-toggle]:visible').first().click()
    const row = page.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]`)
    await row.waitFor({ state: 'visible' })
    await row.click({ position: { x: 40, y: 12 } })
    const standalone = page.locator(
      `[data-conversation-content][data-conversation-session="${sessionId}"]:visible`,
    )
    await composer(standalone).waitFor({ state: 'visible' })
    return standalone
  }
  async function addNote(note) {
    const answer = flow()
      .locator('.dia-assistant__body')
      .filter({ hasText: 'This answer stays selectable.' })
      .last()
    const toolbar = await selectText(answer, 'This answer stays selectable.')
    await toolbar.getByRole('button', { name: '添加注解', exact: true }).click()
    const editor = page.locator('.dia-record-editor--quick')
    await editor.getByRole('textbox', { name: '你的注解', exact: true }).fill(note)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
  }
  async function addQuote() {
    const answer = flow()
      .locator('.dia-assistant__body')
      .filter({ hasText: 'This answer stays selectable.' })
      .last()
    const toolbar = await selectText(answer, 'This answer stays selectable.')
    await toolbar.getByRole('button', { name: '引用文本', exact: true }).click()
    await flow().locator('[data-quote-preview][data-removable]').waitFor({ state: 'visible' })
  }
  const draftFor = (sessionId) =>
    page.evaluate((id) => JSON.parse(localStorage.getItem(`dsh.conversation.${id}`))?.draft, sessionId)
  const visibleDraft = (draft) => {
    let prefix = draft.text.startsWith('/annotation-attachment') ? '/annotation-attachment'.length : 0
    if (draft.text[prefix] === '\u2060') prefix += 1
    return {
      text: draft.text.slice(prefix),
      references: draft.references.map((reference) => ({ ...reference, offset: reference.offset - prefix })),
      quotes: (draft.quotes ?? []).map((quote) => ({ ...quote, offset: quote.offset - prefix })),
    }
  }
  async function resizeSidebar(width) {
    const handle = page.locator('[data-side="rightbar"]').first()
    const box = await handle.boundingBox()
    assert.ok(box, 'The official frame exposes its resize handle')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(1440 - width, box.y + box.height / 2)
    await page.mouse.up()
  }
  async function chipGeometry(label, targetFlow = flow()) {
    await waitForSideLayout(side)
    await assertComposerAtBottom(targetFlow, label)
    await page.locator('[data-dsh-annotation-toast-marker]').waitFor({ state: 'hidden' })
    const inputBefore = await composer(targetFlow).innerText()
    await targetFlow.locator('[data-composer-card]').evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    const measured = await targetFlow.locator('[data-composer-card]').evaluate((card) => {
      const rect = (element) => {
        const box = element.getBoundingClientRect()
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        }
      }
      const chips = [...card.querySelectorAll('[data-dia-annotation-chip], [data-dia-side-chat-chip-row]')]
      const bounds = rect(card)
      const chipBounds = chips.map(rect)
      const tops = new Set(chipBounds.map((box) => Math.round(box.top)))
      const input = card.querySelector('[data-composer-input]')
      return {
        card: bounds,
        chips: chipBounds,
        rows: tops.size,
        paddingTop: Number.parseFloat(getComputedStyle(card).paddingTop),
        input: rect(input),
        focused: document.activeElement === input,
        scrollWidth: card.scrollWidth,
        clientWidth: card.clientWidth,
      }
    })
    const bottom = Math.max(measured.card.top, ...measured.chips.map((box) => box.bottom))
    if (measured.chips.length > 0) {
      assert.ok(
        Math.abs(measured.paddingTop - (bottom - measured.card.top + 4)) < 2,
        `${label} padding matches its actual capsule rows: ${JSON.stringify(measured)}`,
      )
      assert.ok(measured.input.top >= bottom - 1, `${label} capsules do not cover the draft`)
    } else assert.ok(measured.paddingTop < 40, `${label} releases empty capsule space`)
    assert.equal(measured.focused, true)
    assert.equal(await composer(targetFlow).innerText(), inputBefore)
    assert.ok(measured.scrollWidth <= measured.clientWidth + 1, `${label} has no composer overflow`)
    geometry.push({ label, ...measured })
    await page.screenshot({ path: join(artifacts, `${label}.png`), fullPage: true })
    return measured
  }
  async function layouts(kind) {
    if ((await page.locator('[data-sidebar-collapsed]').count()) === 0)
      await page.locator('[data-sidebar-toggle]:visible').first().click()
    await composer(flow()).focus()
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        theme === 'dark',
      )
      await page.setViewportSize({ width: 1440, height: 960 })
      await resizeSidebar(600)
      await chipGeometry(`repair-${kind}-wide-${theme}`)
      await resizeSidebar(300)
      await chipGeometry(`repair-${kind}-sidebar-300-${theme}`)
      await page.setViewportSize({ width: 390, height: 960 })
      await chipGeometry(`repair-${kind}-390-${theme}`)
    }
    await page.setViewportSize({ width: 1440, height: 960 })
    await resizeSidebar(600)
  }

  try {
    await page.addInitScript((id) => {
      if (localStorage.getItem('dsh.sessions.current') === null)
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, mainId)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    await side.locator('[data-dia-side-chat-new]:visible').click()
    const a = await activeChat()
    assert.deepEqual(a.references, [])
    const before = (await request('inspect')).modelRequests
    await composer(flow()).fill('First chat created without selecting any text. '.repeat(70).trimEnd())
    await composer(flow()).press('Enter')
    await flow().getByText('This answer stays selectable.', { exact: false }).waitFor()
    const transcript = flow().locator('[data-conversation-scroll]')
    assert.ok(
      await transcript.evaluate((element) => element.scrollHeight > element.clientHeight + 100),
      'The real long transcript exceeds its scrollport',
    )
    await transcript.evaluate((element) => {
      element.scrollTop = 0
    })
    await assertComposerAtBottom(flow(), 'repair-long-transcript-top')
    await transcript.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await assertComposerAtBottom(flow(), 'repair-long-transcript-bottom')
    check('long transcript scrolls independently while the composer stays at the bottom')
    await side.locator('[data-dockkit-add-tab]:visible, [data-dia-side-chat-new]:visible').click()
    const b = await activeChat()
    assert.notEqual(a.sideChatId, b.sideChatId)
    assert.notEqual(a.sideSessionId, b.sideSessionId)
    await composer(flow()).fill('Second chat created without selecting any text.')
    await composer(flow()).press('Enter')
    await flow().getByText('This answer stays selectable.', { exact: false }).waitFor()
    assert.equal((await request('inspect')).modelRequests, before + 2)
    check('first and second chats prepare and submit without selection', {
      a: a.sideSessionId,
      b: b.sideSessionId,
    })
    await choose(a.sideChatId)
    await composer(flow()).fill('Distinct A draft.\nA second paragraph.')
    await flow()
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'a-attachment.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('A attachment only\n'),
      })
    await layouts('empty')
    await addQuote()
    await addNote('Only A annotation')
    await layouts('annotation-only')
    await collect(mainId, alpha)
    await storedChat(a.sideChatId, 1)
    assert.equal(await main().locator('[data-dia-side-chat-chip-row]').count(), 0)
    assert.equal(await main().locator('.dia-side-chat-record-panel').count(), 0)
    await choose(b.sideChatId)
    await composer(flow()).fill('Distinct B draft.')
    await flow()
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'b-attachment.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('B attachment only\n'),
      })
    await collect(mainId, beta)
    await storedChat(b.sideChatId, 1)
    await layouts('reference-only')
    await addNote('Only B annotation')
    for (let repeat = 0; repeat < 2; repeat++) {
      await choose(a.sideChatId)
      assert.ok((await composer(flow()).innerText()).includes('Distinct A draft.'))
      await flow().getByText('a-attachment.txt', { exact: true }).waitFor()
      assert.equal(await flow().getByText('b-attachment.txt', { exact: true }).count(), 0)
      await choose(b.sideChatId)
      assert.equal(await composer(flow()).innerText(), 'Distinct B draft.')
      await flow().getByText('b-attachment.txt', { exact: true }).waitFor()
    }
    check('A and B drafts, references, annotations, and attachments stay separate')
    const mention = `@[Interaction repairs](dsh-session:${Buffer.from(JSON.stringify(mainId)).toString('base64url')})`
    await page.evaluate(
      ({ sessionId, mention }) => {
        const key = `dsh.conversation.${sessionId}`
        const stored = JSON.parse(localStorage.getItem(key))
        const offset = stored.draft.text.length + 1
        stored.draft.text += `\n${mention}`
        stored.draft.references.push({
          source: 'reference',
          ref: mention,
          appearance: 'session',
          label: 'Interaction repairs',
          clipboardText: mention,
          offset,
          length: mention.length,
        })
        localStorage.setItem(key, JSON.stringify(stored))
      },
      { sessionId: a.sideSessionId, mention },
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    await choose(a.sideChatId)
    assert.ok((await composer(flow()).innerText()).includes('Distinct A draft.'))
    assert.equal(await flow().getByText('a-attachment.txt', { exact: true }).count(), 0)
    await flow()
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'a-attachment.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('A attachment only\n'),
      })
    await flow().locator('[data-quote-preview][data-removable]').waitFor({ state: 'visible' })
    await composer(flow()).locator('[data-composer-chip="reference"]').waitFor({ state: 'visible' })
    await choose(b.sideChatId)
    assert.equal(await composer(flow()).innerText(), 'Distinct B draft.')
    check('refresh then select an unselected chat restores its usable composer')

    await choose(a.sideChatId)
    for (const quote of longQuotes) {
      await collect(mainId, quote)
      assert.equal(await main().locator('[data-dia-side-chat-chip-row]').count(), 0)
    }
    await storedChat(a.sideChatId, 4)
    await flow().locator('[data-dia-side-chat-chip-main]').hover()
    const multiPreview = page.locator('.dia-composer-chip__preview:visible')
    await multiPreview.waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.dia-composer-chip__preview')].some(
        (e) => getComputedStyle(e.parentElement).opacity === '1',
      ),
    )
    const multiBounds = await multiPreview.evaluate((e) => ({
      width: e.clientWidth,
      scrollWidth: e.scrollWidth,
      height: e.clientHeight,
      scrollHeight: e.scrollHeight,
    }))
    assert.ok(multiBounds.width > 140 && multiBounds.scrollWidth <= multiBounds.width + 1)
    assert.ok(multiBounds.height <= 420 && multiBounds.scrollHeight > multiBounds.height)
    await page.screenshot({ path: join(artifacts, 'ui-multiple-long-reference-chip.png'), fullPage: true })
    await composer(flow()).hover()
    await multiPreview.waitFor({ state: 'hidden' })
    check(
      'multiple and long composer references read horizontally and scroll inside the bounded preview',
      multiBounds,
    )
    await layouts('both')
    await flow().locator('[data-dia-side-chat-chip-main]').click()
    const rows = flow().locator('[data-dia-side-chat-reference]')
    await rows.first().waitFor({ state: 'visible' })
    for (const [index, quote] of longQuotes.entries()) {
      const row = rows.nth(index + 1)
      await row.scrollIntoViewIfNeeded()
      const collapsed = await row.locator('q').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        display: getComputedStyle(element).display,
      }))
      assert.ok(
        collapsed.height <= collapsed.lineHeight * 2 + 1,
        'Collapsed quotes show no more than two lines',
      )
      assert.notEqual(collapsed.display, 'inline')
      await row.locator('[data-dia-side-chat-expand]').click()
      const expanded = await row.locator('q').evaluate((element) => ({
        exact: element.textContent,
        height: element.getBoundingClientRect().height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        focusable: element.tabIndex === 0,
      }))
      assert.equal(expanded.exact, quote)
      assert.ok(expanded.height <= 121 && expanded.scrollHeight > expanded.clientHeight)
      assert.equal(expanded.focusable, true)
      const action = await row.locator('.dia-record-row__actions').boundingBox()
      const box = await row.boundingBox()
      assert.ok(action.y <= box.y + 4, 'Actions stay at the row top')
      await row.locator('[data-dia-side-chat-expand]').click()
      assert.equal(await row.locator('q').getAttribute('data-expanded'), 'false')
      await assertReferenceLocation(row, mainId)
    }
    const longRow = rows.nth(1)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'))
    await longRow.scrollIntoViewIfNeeded()
    const trigger = longRow.locator('[data-dia-side-chat-preview-trigger]')
    await trigger.click()
    const preview = page.locator('.dia-side-chat-record-preview')
    await preview.waitFor({ state: 'visible' })
    const previewBounds = await preview.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return {
        position: getComputedStyle(element).position,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        parent: element.parentElement.tagName,
        viewport: { width: innerWidth, height: innerHeight },
      }
    })
    assert.equal(previewBounds.position, 'fixed')
    assert.equal(previewBounds.parent, 'BODY')
    assert.ok(
      previewBounds.height > 20 &&
        previewBounds.left >= 0 &&
        previewBounds.top >= 0 &&
        previewBounds.right <= 1440 &&
        previewBounds.bottom <= 960,
      `Preview stays inside the viewport: ${JSON.stringify(previewBounds)}`,
    )
    await preview.hover()
    assert.equal(await preview.isVisible(), true)
    await page.screenshot({ path: join(artifacts, 'repair-preview-wide-light.png'), fullPage: true })
    await preview.focus()
    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true)
    await trigger.press('Enter')
    await preview.waitFor({ state: 'visible' })
    await composer(flow()).click()
    await preview.waitFor({ state: 'hidden' })
    check('bounded exact quotes, pinned actions, fixed portal, pointer and keyboard dismissal', {
      preview: previewBounds,
    })

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await resizeSidebar(300)
      await longRow.scrollIntoViewIfNeeded()
      await trigger.click()
      await preview.waitFor({ state: 'visible' })
      await page.screenshot({
        path: join(artifacts, `repair-preview-sidebar-300-${theme}.png`),
        fullPage: true,
      })
      await page.setViewportSize({ width: 390, height: 960 })
      await openSide(mainId)
      await waitForSideLayout(side)
      await longRow.scrollIntoViewIfNeeded()
      if (!(await preview.isVisible())) await trigger.click()
      await preview.waitFor({ state: 'visible' })
      const bounds = await preview.boundingBox()
      assert.ok(
        bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 960,
      )
      await page.screenshot({ path: join(artifacts, `repair-preview-390-${theme}.png`), fullPage: true })
      await preview.focus()
      await page.keyboard.press('Escape')
      await preview.waitFor({ state: 'hidden' })
      await page.setViewportSize({ width: 1440, height: 960 })
    }
    await resizeSidebar(600)
    await page.evaluate(() => {
      document.body.style.zoom = '1.25'
    })
    await writeFile(
      join(artifacts, 'repair-zoom-stability.json'),
      `${JSON.stringify(
        await longRow.evaluate(
          (row) =>
            new Promise((resolve) => {
              const frames = []
              const sample = () => {
                const geometry = (element) => {
                  if (element === null) return null
                  const rect = element.getBoundingClientRect()
                  const css = getComputedStyle(element)
                  return {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                    paddingTop: css.paddingTop,
                    paddingBottom: css.paddingBottom,
                    chipSpace: css.getPropertyValue('--dia-composer-chip-space'),
                    style: element.getAttribute('style'),
                  }
                }
                const owner = row.closest('[data-dia-side-chat]')
                frames.push({
                  row: geometry(row),
                  owner: geometry(owner),
                  card: geometry(
                    [...owner.querySelectorAll('[data-composer-card]')].find(
                      (e) => e.getBoundingClientRect().width > 0,
                    ) ?? null,
                  ),
                  overlay: geometry(
                    [...owner.querySelectorAll('[data-composer-overlay]')].find(
                      (e) => e.getBoundingClientRect().width > 0,
                    ) ?? null,
                  ),
                  preview: geometry(document.querySelector('.dia-side-chat-reference-preview')),
                  scrollers: [...owner.querySelectorAll('[data-conversation-scroll]')].map((element) => ({
                    ...geometry(element),
                    scrollTop: element.scrollTop,
                    scrollHeight: element.scrollHeight,
                  })),
                  markers: [...document.querySelectorAll('.dia-assistant:has(.dia-marker)')].map(
                    (element) => ({
                      ...geometry(element),
                      body: geometry(element.querySelector('.dia-assistant__body')),
                      markers: [...element.querySelectorAll('.dia-marker')].map(geometry),
                    }),
                  ),
                })
                if (frames.length === 40) resolve(frames)
                else requestAnimationFrame(sample)
              }
              requestAnimationFrame(sample)
            }),
        ),
        null,
        2,
      )}\n`,
    )
    const zoomFrames = JSON.parse(await readFile(join(artifacts, 'repair-zoom-stability.json'), 'utf8'))
    for (const dimension of ['top', 'left', 'width', 'height'])
      assert.equal(
        new Set(zoomFrames.slice(-10).map((frame) => frame.row[dimension])).size,
        1,
        `Zoomed reference rows retain a stable ${dimension}`,
      )
    await longRow.scrollIntoViewIfNeeded()
    await trigger.click()
    await preview.waitFor({ state: 'visible' })
    const zoomBounds = await preview.boundingBox()
    assert.ok(
      zoomBounds.x >= 0 &&
        zoomBounds.y >= 0 &&
        zoomBounds.x + zoomBounds.width <= 1440 &&
        zoomBounds.y + zoomBounds.height <= 960,
    )
    await page.screenshot({ path: join(artifacts, 'repair-preview-zoom-125-dark.png'), fullPage: true })
    await page.evaluate(() => {
      document.body.style.zoom = ''
    })
    await preview.focus()
    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'hidden' })
    const touchContext = await browser.newContext({
      storageState: await context.storageState(),
      viewport: { width: 390, height: 960 },
      hasTouch: true,
      isMobile: true,
      locale: 'zh-CN',
      colorScheme: 'dark',
    })
    try {
      const touch = await touchContext.newPage()
      touch.on('pageerror', (error) => errors.push(error.message))
      usePage(touch)
      await touch.goto(url, { waitUntil: 'domcontentloaded' })
      await touch.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
      await openSide(mainId)
      const touchFlow = touch.locator(
        `[data-dia-side-chat][data-main-session="${mainId}"] [data-conversation-content]`,
      )
      if ((await touchFlow.locator('[data-dia-side-chat-reference]').count()) === 0)
        await touchFlow.locator('[data-dia-side-chat-chip-main]').tap()
      const touchTrigger = touchFlow.locator('[data-dia-side-chat-preview-trigger]').nth(1)
      await touchTrigger.scrollIntoViewIfNeeded()
      await touchTrigger.tap()
      const touchPreview = touch.locator('.dia-side-chat-record-preview')
      await touchPreview.waitFor({ state: 'visible' })
      const bounds = await touchPreview.boundingBox()
      assert.ok(
        bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 960,
      )
      await touch.screenshot({ path: join(artifacts, 'repair-preview-touch-390-dark.png'), fullPage: true })
      await touchTrigger.tap()
      await touchPreview.waitFor({ state: 'hidden' })
      await touchTrigger.tap()
      await touchPreview.waitFor({ state: 'visible' })
      await composer(touchFlow).tap()
      await touchPreview.waitFor({ state: 'hidden' })
    } finally {
      usePage(page)
      await touchContext.close()
    }
    check('previews fit constrained and mobile containers in both themes and open and dismiss by touch')

    await choose(b.sideChatId)
    const bBefore = await storedChat(b.sideChatId, 1)
    const standalone = await openStandaloneFromList(a.sideSessionId)
    assert.ok((await composer(standalone).innerText()).includes('Distinct A draft.'))
    const aRows = standalone.locator('[data-dia-side-chat-reference]')
    if ((await aRows.count()) === 0) await standalone.locator('[data-dia-side-chat-chip-main]').click()
    await aRows.first().waitFor({ state: 'visible' })
    assert.equal(await aRows.count(), 4)
    assert.equal(await aRows.filter({ hasText: beta }).count(), 0)
    const structuredBefore = await draftFor(a.sideSessionId)
    await aRows.nth(1).locator('[data-dia-side-chat-remove]').click()
    await storedChat(a.sideChatId, 3)
    assert.deepEqual(await storedChat(b.sideChatId, 1), bBefore)
    assert.equal((await currentState()).activeSideChatId, b.sideChatId)
    assert.deepEqual(await draftFor(a.sideSessionId), structuredBefore)
    await standalone.locator('[data-quote-preview][data-removable]').waitFor({ state: 'visible' })
    assert.equal(
      await standalone.locator('[data-quote-preview][data-removable]').count(),
      structuredBefore.quotes.length,
    )
    await composer(standalone).locator('[data-composer-chip="reference"]').waitFor({ state: 'visible' })
    await standalone.getByText('a-attachment.txt', { exact: true }).waitFor()
    await standalone.locator('[data-dia-annotation-chip]').hover()
    await standalone.getByRole('button', { name: '取消本次附加', exact: true }).click()
    await standalone.locator('[data-dia-annotation-chip]').waitFor({ state: 'hidden' })
    assert.deepEqual(visibleDraft(await draftFor(a.sideSessionId)), visibleDraft(structuredBefore))
    await standalone.locator('[data-dia-side-chat-chip-row]').hover()
    await standalone.locator('[data-dia-side-chat-remove-all]').click()
    await storedChat(a.sideChatId, 0)
    assert.deepEqual(visibleDraft(await draftFor(a.sideSessionId)), visibleDraft(structuredBefore))
    await standalone.locator('[data-quote-preview][data-removable]').waitFor({ state: 'visible' })
    await composer(standalone).locator('[data-composer-chip="reference"]').waitFor({ state: 'visible' })
    await standalone.getByText('a-attachment.txt', { exact: true }).waitFor()
    assert.equal((await currentState()).activeSideChatId, b.sideChatId)
    assert.deepEqual(await storedChat(b.sideChatId, 1), bBefore)
    check(
      'removal, clear-all and annotation detach retain official structured references, quote blocks, text and attachments',
    )
    await openMain(mainId, source)
    await openSide(mainId)
    await choose(a.sideChatId)
    for (const quote of [alpha, longQuotes[1], longQuotes[2]]) await collect(mainId, quote)
    if (!(await flow().locator('[data-annotation-id]').filter({ hasText: 'Only A annotation' }).isVisible()))
      await flow().locator('.dia-record-toggle').click()
    await flow()
      .locator('[data-annotation-id]')
      .filter({ hasText: 'Only A annotation' })
      .getByRole('button', { name: '随消息发送', exact: true })
      .click()
    await flow().locator('[data-dia-annotation-chip]').waitFor({ state: 'visible' })
    await choose(b.sideChatId)
    await openStandaloneFromList(a.sideSessionId)
    await composer(standalone).fill('Standalone A sends only its visible references and A annotation.')
    await composer(standalone).press('Enter')
    await standalone.getByText('Side note addressed.', { exact: false }).waitFor()
    const history = standalone.locator('[data-dia-side-chat-history]').last()
    await history.locator('[data-dia-side-chat-history-toggle]').click()
    for (const index of [0, 1]) {
      await history.locator('.dia-timeline-item__content q').nth(index).hover()
      const preview = page.locator('.dia-composer-chip__preview:visible')
      await preview.waitFor()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.dia-composer-chip__preview')].some(
          (e) => getComputedStyle(e.parentElement).opacity === '1',
        ),
      )
      const bounds = await preview.evaluate((e) => ({
        width: e.clientWidth,
        scrollWidth: e.scrollWidth,
        height: e.clientHeight,
      }))
      assert.ok(bounds.width > 140 && bounds.scrollWidth <= bounds.width + 1)
      await page.screenshot({ path: join(artifacts, `ui-sent-reference-${index}.png`), fullPage: true })
      await composer(standalone).hover()
      await preview.waitFor({ state: 'hidden' })
    }
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize({ width: 390, height: 960 })
      await history.locator('.dia-timeline-item__content q').first().hover()
      const preview = page.locator('.dia-composer-chip__preview:visible')
      await preview.waitFor()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.dia-composer-chip__preview')].some(
          (e) => getComputedStyle(e.parentElement).opacity === '1',
        ),
      )
      const bounds = await preview.evaluate((e) => {
        const r = e.parentElement.getBoundingClientRect()
        return {
          left: r.left,
          right: r.right,
          width: r.width,
          clientWidth: e.clientWidth,
          scrollWidth: e.scrollWidth,
        }
      })
      assert.ok(bounds.width > 140 && bounds.left >= 0 && bounds.right <= 390)
      assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1)
      await page.screenshot({ path: join(artifacts, `ui-sent-reference-390-${theme}.png`), fullPage: true })
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.waitForFunction(
        (width) =>
          [...document.querySelectorAll('.dia-composer-chip__preview')].some(
            (e) => e.parentElement.getBoundingClientRect().width > width,
          ),
        bounds.width,
      )
      await composer(standalone).hover()
      await preview.waitFor({ state: 'hidden' })
    }
    check('sent short and long history previews use the message region width')
    const aLog = await request('read-session', { sessionId: a.sideSessionId })
    const sent = aLog.events
      .filter((event) => event.type === 'user/message' && event.data.source.kind === 'user')
      .at(-1).data
    const aRequest = (await request('model-requests')).findLast((item) => item.sessionId === a.sideSessionId)
    const modelSend = aRequest.messages.find((message) => message.id === sent.id)
    assert.equal(modelSend.id, sent.id)
    assert.deepEqual(modelSend.source, sent.source)
    assert.deepEqual(modelSend.content[0], sent.content[0])
    assert.equal(sent.content[1].type, 'file')
    assert.ok(
      modelSend.content.some(
        (block) =>
          block.type === 'text' &&
          block.text.includes('a-attachment.txt') &&
          block.text.includes(sent.content[1].attachment.attachmentId.slice('sha256:'.length)),
      ),
    )
    assert.equal(sent.source.sideChatSubmission.sideSessionId, a.sideSessionId)
    assert.deepEqual(
      sent.source.sideChatSubmission.references.map((reference) => reference.quote.exact),
      [alpha, longQuotes[1], longQuotes[2]],
    )
    assert.equal(sent.source.annotationSubmission.annotations[0].annotation, 'Only A annotation')
    assert.equal(sent.source.sideChatSubmission.attachmentIdentities.length, 1)
    const annotation = sent.source.annotationSubmission.annotations[0]
    const identities = new Map([
      [a.sideSessionId, '{{session:A}}'],
      [sent.source.annotationSubmission.submissionId, '{{submission:1}}'],
      [annotation.annotationId, '{{annotation:1}}'],
      [annotation.messageId, '{{message:answer:A}}'],
      ...sent.source.sideChatSubmission.references.map((reference, index) => [
        reference.referenceId,
        `{{reference:${index + 1}}}`,
      ]),
    ])
    standaloneModelText = modelSend.content[0].text
    for (const [id, token] of identities) standaloneModelText = standaloneModelText.replaceAll(id, token)
    await writeFile(join(artifacts, 'repair-model-message.txt'), `${standaloneModelText}\n`)
    assert.equal((await currentState()).activeSideChatId, b.sideChatId)
    assert.deepEqual(await storedChat(b.sideChatId, 1), bBefore)
    await page.screenshot({ path: join(artifacts, 'repair-standalone-a.png'), fullPage: true })
    check('standalone A displays, removes and submits A while B stays selected and unchanged')

    await openMain(mainId, source)
    await openSide(mainId)
    await choose(b.sideChatId)
    const second = await context.newPage()
    usePage(second)
    await second.goto(url, { waitUntil: 'domcontentloaded' })
    await second.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openMain(mainId, source)
    await openSide(mainId)
    await collect(mainId, gamma, second)
    await storedChat(b.sideChatId, 2, second)
    await page
      .locator('[data-dia-side-chat-chip-main]')
      .filter({ hasText: '2 条引用' })
      .waitFor({ state: 'visible' })
    usePage(page)
    await collect(mainId, delta, page)
    await storedChat(b.sideChatId, 3)
    await second
      .locator('[data-dia-side-chat-chip-main]')
      .filter({ hasText: '3 条引用' })
      .waitFor({ state: 'visible' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    assert.deepEqual(
      (await storedChat(b.sideChatId, 3)).references.map((reference) => reference.quote.exact),
      [beta, gamma, delta],
    )
    check('two browser pages synchronize additions and refresh preserves the reported count')

    await page.evaluate(() => {
      const write = Storage.prototype.setItem
      window.annotationRepairRestoreWrites = () => {
        Storage.prototype.setItem = write
      }
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('dsh-annotation:side-chat:'))
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        return write.call(this, key, value)
      }
    })
    await collect(mainId, epsilon)
    const warning = flow().locator('[data-dia-side-chat-save="unavailable"]')
    await warning.waitFor({ state: 'visible' })
    await page.locator('.dia-toast-icon--error').waitFor({ state: 'visible' })
    assert.equal((await storedChat(b.sideChatId, 3)).references.length, 3)
    assert.equal(await flow().locator('[data-dia-side-chat-remove-all]').isDisabled(), true)
    const downloaded = page.waitForEvent('download')
    await flow().locator('[data-dia-side-chat-recovery-export]').click()
    const download = await downloaded
    const recoveryPath = join(artifacts, 'repair-local-recovery.json')
    await download.saveAs(recoveryPath)
    const exported = JSON.parse(await readFile(recoveryPath, 'utf8'))
    assert.deepEqual(
      exported.association.chats
        .find((chat) => chat.sideChatId === b.sideChatId)
        .references.map((reference) => reference.quote.exact),
      [beta, gamma, delta, epsilon],
    )
    await page.screenshot({ path: join(artifacts, 'repair-save-failure.png'), fullPage: true })
    await page.evaluate(() => window.annotationRepairRestoreWrites())
    await flow().locator('[data-dia-side-chat-save-retry]').click()
    await warning.waitFor({ state: 'hidden' })
    await storedChat(b.sideChatId, 4)
    await second
      .locator('[data-dia-side-chat-chip-main]')
      .filter({ hasText: '4 条引用' })
      .waitFor({ state: 'visible' })
    check('quota failure is visible in a ready composer, export retains edits, retry saves both pages')
    await page.locator('[data-sidebar-right-mode="fullscreen"]').first().click()
    const right = page.locator(`[data-sidebar-right-panel][data-sidebar-right-session="${mainId}"]`).first()
    await right.locator('[data-dockkit-split-button]:not([disabled])').first().click()
    const divider = right.locator('[data-dockkit-divider]').first()
    await divider.waitFor({ state: 'attached' })
    await right.locator('[data-sidebar-right-mode="push"]').first().click()
    await resizeSidebar(600)
    await composer(flow()).focus()
    const dividerBounds = await divider.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    })
    const sideBounds = await side.boundingBox()
    await page.mouse.move(
      dividerBounds.x + dividerBounds.width / 2,
      dividerBounds.y + dividerBounds.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(sideBounds.x + 220, dividerBounds.y + dividerBounds.height / 2)
    await page.mouse.up()
    await composer(flow()).focus()
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        theme === 'dark',
      )
      await resizeSidebar(800)
      const fitted = await chipGeometry(`repair-split-both-one-row-${theme}`)
      assert.equal(fitted.rows, 1)
      await resizeSidebar(600)
      const constrained = await chipGeometry(`repair-both-constrained-${theme}`)
      assert.equal(
        constrained.rows,
        1,
        'Both capsules reserve their action width without changing composer height',
      )
      assert.ok(constrained.card.width < 230)
    }
    await flow().locator('[data-dia-side-chat-chip-row]').hover()
    await flow().locator('[data-dia-side-chat-remove-all]').click()
    await storedChat(b.sideChatId, 0)
    const oneRow = await chipGeometry('repair-annotation-after-reference-removal-dark')
    assert.equal(oneRow.rows, 1)
    await flow().locator('[data-dia-annotation-chip]').hover()
    await flow().getByRole('button', { name: '取消本次附加', exact: true }).click()
    const noRow = await chipGeometry('repair-empty-after-detach-dark')
    assert.equal(noRow.rows, 0)
    check('real split-pane capsules and removal preserve height, draft and input focus')

    const conflictBefore = await currentState()
    const frozenBase = {
      ...sent.source.sideChatSubmission,
      sideSessionId: b.sideSessionId,
      references: bBefore.references,
      attachmentIdentities: [],
    }
    delete frozenBase.annotationSubmission
    const conflictJournal = (question) => ({
      version: 1,
      id: crypto.randomUUID(),
      dependencies: [],
      before: conflictBefore,
      after: {
        ...conflictBefore,
        chats: conflictBefore.chats.map((chat) =>
          chat.sideChatId === b.sideChatId
            ? {
                ...chat,
                outbox: {
                  status: 'ready',
                  payload: { ...frozenBase, submissionId: crypto.randomUUID(), question },
                },
              }
            : chat,
        ),
      },
    })
    const firstConflict = conflictJournal('Retained page one question')
    const secondConflict = conflictJournal('Retained page two question')
    const appendJournal = (target, journal) =>
      target.evaluate(
        ({ mainId, journal }) => {
          localStorage.setItem(
            `dsh-annotation:side-chat:v2:${mainId}:journal:${journal.id}`,
            JSON.stringify(journal),
          )
        },
        { mainId, journal },
      )
    await appendJournal(second, firstConflict)
    await appendJournal(page, secondConflict)
    const peerSide = second.locator(`[data-dia-side-chat][data-main-session="${mainId}"]`)
    const conflict = peerSide.locator('[data-dia-side-chat-save="conflict"]')
    await conflict.waitFor({ state: 'visible' })
    assert.equal(await peerSide.locator('[data-dockkit-add-tab]:visible').count(), 0)
    await peerSide.locator('[data-dia-side-chat-save-retry]').click()
    await conflict.waitFor({ state: 'visible' })
    const conflictDownload = second.waitForEvent('download')
    await peerSide.locator('[data-dia-side-chat-recovery-export]').click()
    const conflictRecoveryPath = join(artifacts, 'repair-conflict-recovery.json')
    await (await conflictDownload).saveAs(conflictRecoveryPath)
    const conflictExport = await readFile(conflictRecoveryPath, 'utf8')
    assert.ok(
      conflictExport.includes('Retained page one question') &&
        conflictExport.includes('Retained page two question'),
    )
    usePage(second)
    await second.reload({ waitUntil: 'domcontentloaded' })
    await second.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    await composer(peerSide.locator('[data-conversation-content]')).waitFor({ state: 'visible' })
    await conflict.waitFor({ state: 'visible' })
    await second.screenshot({
      path: join(artifacts, 'repair-save-conflict-after-refresh.png'),
      fullPage: true,
    })
    usePage(page)
    check(
      'incompatible browser journals remain visible and blocked through retry and refresh, with both questions exported',
    )
    assert.equal(
      `${standaloneModelText}\n`,
      (
        await readFile(
          new URL('../tests/profile-fixtures/side-chat/repair-model-message.expected.txt', import.meta.url),
          'utf8',
        )
      ).replaceAll('{{space}}', ' '),
    )
    check('standalone A model text matches its owner-local recorded-message snapshot')
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: join(artifacts, 'repair-failure.png'), fullPage: true })
    await writeFile(
      join(artifacts, 'repair-failure.txt'),
      `${error.stack ?? error}\n${await page.locator('body').innerText()}\n`,
    )
    await writeFile(
      join(artifacts, 'repair-failure-state.json'),
      `${JSON.stringify(
        await page.evaluate(
          (mainId) => ({
            currentSession: localStorage.getItem('dsh.sessions.current'),
            sideChats: JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${mainId}`)),
            rows: [...document.querySelectorAll('[role="treeitem"]')].map((row) => ({
              key: row.getAttribute('data-row-key'),
              text: row.textContent,
              selected: row.getAttribute('aria-selected'),
            })),
            conversations: [...document.querySelectorAll('[data-conversation-content]')].map((flow) => ({
              sessionId: flow.getAttribute('data-conversation-session'),
              visible: flow.getBoundingClientRect().width > 0,
            })),
          }),
          mainId,
        ),
        null,
        2,
      )}\n`,
    )
    throw error
  } finally {
    await writeFile(
      join(artifacts, 'repair-interactions.json'),
      `${JSON.stringify({ checks, geometry, errors }, null, 2)}\n`,
    )
    usePage(page)
    await context.close()
  }
}
