/** Official Tabs and Session lifecycle acceptance against the current built Web profile. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { exerciseSideChatUi } from './profile-side-chat-ui.mjs'

export async function exerciseSideChatLifecycle(h) {
  const {
    browser,
    url,
    workspace,
    artifacts,
    request,
    seedMain,
    usePage,
    openSide,
    openMain,
    collect,
    composer,
    closeSide,
    assertComposerAtBottom,
    evidence,
  } = h
  const mainId = 'annotation-tabs-lifecycle-main'
  const quotes = [
    'A引用第一段。',
    'B引用第二段。',
    'C引用第三段。',
    '跨页追加引用。',
    '归档期间追加引用。',
    '删除期间追加引用。',
  ]
  const source = quotes.join('\n\n')
  const mainSeed = await seedMain(workspace, mainId, source, 'Tab lifecycle source')
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  const errors = []
  const diagnostics = []
  context.on('page', (target) => target.on('pageerror', (error) => errors.push(error.message)))
  page.on('pageerror', (error) => errors.push(error.message))
  context.on('console', async (message) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return
    diagnostics.push({
      text: message.text(),
      args: await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null))),
    })
  })
  const checks = []
  const check = (name, details = {}) => {
    const result = { name, status: 'passed', ...details }
    checks.push(result)
    evidence.checks.push(result)
    console.log(`PASS lifecycle: ${name}`)
  }
  const side = (target) => target.locator(`[data-dia-side-chat][data-main-session="${mainId}"]:visible`)
  const flow = (target) => side(target).locator('[data-conversation-content]:visible')
  const tab = (id, target = page) =>
    side(target).locator(`[data-dockkit-tab="annotation-side-tab:${id}"]:visible`)
  const state = (target) =>
    target.evaluate((id) => JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${id}`)), mainId)
  async function waitState(predicate, args, target = page) {
    await target.waitForFunction(
      ({ mainId, predicate, args }) => {
        const value = JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${mainId}`))
        return value !== null && Function('state', 'args', `return (${predicate})(state,args)`)(value, args)
      },
      { mainId, predicate: String(predicate), args },
    )
    return state(target)
  }
  async function active(target = page) {
    await composer(flow(target)).waitFor({ state: 'visible' })
    const sessionId = await flow(target).getAttribute('data-conversation-session')
    await waitState((s, id) => s.chats.some((c) => c.sideSessionId === id && c.created), sessionId, target)
    const value = await state(target)
    return value.chats.find((chat) => chat.sideSessionId === sessionId)
  }
  async function choose(id, target = page) {
    usePage(target)
    await tab(id, target).click()
    await side(target)
      .locator(`[data-dockkit-tab="annotation-side-tab:${id}"][aria-selected="true"]:visible`)
      .waitFor()
    await composer(flow(target)).waitFor({ state: 'visible' })
    assert.equal((await active(target)).sideChatId, id)
  }
  async function create(target = page) {
    await side(target).locator('[data-dockkit-add-tab]:visible, [data-dia-side-chat-new]:visible').click()
    return active(target)
  }
  async function send(question, target = page) {
    const owner = await active(target)
    const before = (await request('inspect')).modelRequests
    await composer(flow(target)).fill(question)
    await composer(flow(target)).press('Enter')
    await target.waitForFunction(() =>
      [...document.querySelectorAll('[data-conversation-content]')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .some((e) => e.textContent.includes('This answer stays selectable.')),
    )
    await waitState(
      (s, id) => s.chats.find((c) => c.sideChatId === id)?.outbox == null,
      owner.sideChatId,
      target,
    )
    assert.equal((await request('inspect')).modelRequests, before + 1)
  }
  async function archive(id, target = page) {
    await tab(id, target).hover()
    await tab(id, target).locator(`[data-dia-side-chat-archive="${id}"]`).click()
  }
  async function waitArchived(id, archived = true, target = page) {
    return waitState(
      (s, args) => s.chats.find((c) => c.sideChatId === args.id)?.archived === args.archived,
      { id, archived },
      target,
    )
  }
  async function restore(sessionId, target = page) {
    if (
      !(await target.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]:visible`).isVisible())
    ) {
      await target.getByRole('button', { name: '视图选项', exact: true }).click()
      await target.getByRole('menuitem', { name: '全部对话（显示已归档）', exact: true }).click()
    }
    const row = target.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]:visible`)
    await row.waitFor({ state: 'visible' })
    await row.click({ button: 'right' })
    await target.getByRole('menuitem', { name: '取消归档', exact: true }).click()
  }
  async function rename(sessionId, title) {
    const row = page.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]:visible`)
    await row.waitFor({ state: 'visible' })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '重命名会话', exact: true })
    await dialog.getByRole('textbox', { name: '会话名称', exact: true }).fill(title)
    await dialog.getByRole('button', { name: '重命名', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  async function deleteDialog(id, target = page) {
    await tab(id, target).hover()
    await tab(id, target).locator(`[data-dia-side-chat-delete="${id}"]`).click()
    const dialog = target.getByRole('dialog', { name: '删除会话', exact: true })
    await dialog.waitFor({ state: 'visible' })
    return dialog
  }
  async function remove(id, target = page) {
    const dialog = await deleteDialog(id, target)
    await dialog.getByRole('button', { name: '删除会话', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await waitState(
      (s, id) => !s.chats.some((c) => c.sideChatId === id) && s.deletedSideChatIds?.includes(id),
      id,
      target,
    )
  }
  try {
    usePage(page)
    await page.addInitScript(
      (id) => localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })),
      mainId,
    )
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await page
      .locator(`[data-dsh-annotation-message-id="${mainId}:assistant"] .dia-assistant__body`)
      .waitFor({ state: 'visible' })
    await openMain(mainId, source)
    const plus = page.locator('[data-dia-side-chat-guide-new]:visible')
    if (!(await plus.isVisible())) {
      await page.locator('[data-sidebar-right-expand]:visible').click()
    }
    await plus.waitFor()
    assert.equal(await plus.getAttribute('aria-label'), '新建侧边聊天')
    assert.equal(await plus.evaluate((e) => e.closest('[data-sidebar-right-guide-entry]') !== null), true)
    await plus.hover()
    const navigation = await plus.evaluate((element) => {
      const bounds = (target) => {
        const rect = target.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }
      return {
        button: bounds(element),
        entry: bounds(element.closest('[data-sidebar-right-guide-entry]')),
        viewport: { width: innerWidth, height: innerHeight },
      }
    })
    assert.ok(navigation.entry.left >= 0 && navigation.entry.right <= navigation.viewport.width)
    assert.ok(
      navigation.button.left >= navigation.entry.left && navigation.button.right <= navigation.entry.right,
    )
    assert.ok(navigation.button.top >= 0 && navigation.button.bottom <= navigation.viewport.height)
    await writeFile(join(artifacts, 'tabs-navigation-plus.json'), `${JSON.stringify(navigation, null, 2)}\n`)
    await page.screenshot({ path: join(artifacts, 'tabs-navigation-plus.png'), fullPage: true })
    await plus.click()
    const a = await active()
    await assertComposerAtBottom(flow(page), 'tabs-empty-chat')
    assert.equal((await state(page)).chats.length, 1)
    assert.deepEqual(a.references, [])
    const unnamed = await create()
    assert.equal(await tab(a.sideChatId).locator('[data-dockkit-tab-title]').innerText(), '侧边聊天 1')
    assert.equal(await tab(unnamed.sideChatId).locator('[data-dockkit-tab-title]').innerText(), '侧边聊天 2')
    await side(page).locator('[data-dia-side-chat-open-alone]').click()
    const identity = page.locator(`[data-dia-side-chat-identity="${unnamed.sideSessionId}"]:visible`)
    await identity.waitFor()
    assert.ok((await identity.innerText()).includes('侧边聊天 2'))
    // Read both axes in one frame while the official sidebar finishes its transition.
    const identityGeometry = await identity.evaluate((element) => {
      const card = element.closest('[data-conversation-content]').querySelector('[data-composer-card]')
      const bounds = (node) => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left, width: rect.width }
      }
      return { identity: bounds(element), composer: bounds(card) }
    })
    assert.ok(Math.abs(identityGeometry.identity.left - identityGeometry.composer.left) < 2)
    assert.ok(Math.abs(identityGeometry.identity.width - identityGeometry.composer.width) < 2)
    await page.screenshot({ path: join(artifacts, 'ui-blank-standalone-name.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 960 })
    await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
    await page.waitForFunction(() => {
      const mask = document.querySelector('[data-sidebar-mask]')
      return mask?.nextElementSibling?.getBoundingClientRect().right <= 1
    })
    await page.waitForFunction((id) => {
      const element = document.querySelector(`[data-dia-side-chat-identity="${id}"] > span`)
      const r = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    }, unnamed.sideSessionId)
    const identityBounds = await identity.boundingBox()
    assert.ok(identityBounds.x >= 0 && identityBounds.x + identityBounds.width <= 390)
    await page.screenshot({ path: join(artifacts, 'ui-blank-standalone-name-390.png'), fullPage: true })
    await identity.locator('[data-dia-side-chat-blank-back]').click()
    await side(page).waitFor()
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.locator('[data-sidebar-drawer]').waitFor({ state: 'detached' })
    await remove(unnamed.sideChatId)
    await choose(a.sideChatId)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    await composer(flow(page)).waitFor()
    assert.equal(await tab(a.sideChatId).locator('[data-dockkit-tab-title]').innerText(), '侧边聊天 1')
    check(
      'distinct blank titles survive deletion and browser refresh, and identify the same standalone Session',
    )
    await send('Create A through the navigation plus without selecting text.')
    await rename(a.sideSessionId, 'A 引用讨论')
    await collect(mainId, quotes[0])
    await composer(flow(page)).fill('A retains its draft')
    const b = await create()
    await send('Create B through the official Tab plus.')
    await rename(b.sideSessionId, 'B 独立讨论')
    await collect(mainId, quotes[1])
    await composer(flow(page)).fill('B retains its draft')
    const c = await create()
    await send('Create C without a quote.')
    const longTitle = `C 长标题 ${'引用讨论 '.repeat(25)}`.trim()
    await rename(c.sideSessionId, longTitle)
    await collect(mainId, quotes[2])
    await composer(flow(page)).fill('C retains its draft')
    await choose(b.sideChatId)
    assert.equal(await composer(flow(page)).innerText(), 'B retains its draft')
    assert.equal(await side(page).locator('[data-dockkit-tab]:visible').count(), 3)
    assert.equal(await tab(b.sideChatId).getAttribute('aria-selected'), 'true')
    assert.equal(await side(page).locator('.dia-side-chat-heading, .dia-side-chat-mode').count(), 0)
    await assertComposerAtBottom(flow(page), 'tabs-multiple-dark')
    await page.screenshot({ path: join(artifacts, 'tabs-multiple-dark.png'), fullPage: true })
    const before = await tab(a.sideChatId).boundingBox()
    await tab(a.sideChatId).hover()
    const after = await tab(a.sideChatId).boundingBox()
    assert.equal(before.width, after.width)
    await page.screenshot({ path: join(artifacts, 'tabs-hover-actions.png'), fullPage: true })
    await tab(a.sideChatId).focus()
    await page.keyboard.press('Tab')
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-dia-side-chat-archive')),
      a.sideChatId,
    )
    await page.keyboard.press('Tab')
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-dia-side-chat-delete')),
      a.sideChatId,
    )
    assert.equal((await state(page)).activeSideChatId, b.sideChatId)
    check('navigation plus, three official Tabs, real titles, stable hover actions and keyboard access')

    await exerciseSideChatUi({ page, side, tab, flow, composer, rename, chats: [a, b, c], artifacts })
    check(
      'default, hover and keyboard Tab geometry, clipped title portals and composer preview widths in both themes and narrow containers',
    )
    await choose(b.sideChatId)
    await archive(a.sideChatId)
    await waitArchived(a.sideChatId)
    assert.equal((await state(page)).activeSideChatId, b.sideChatId)
    await archive(b.sideChatId)
    await waitArchived(b.sideChatId)
    assert.equal((await state(page)).activeSideChatId, c.sideChatId)
    await restore(a.sideSessionId)
    await waitArchived(a.sideChatId, false)
    await restore(b.sideSessionId)
    await waitArchived(b.sideChatId, false)
    await choose(c.sideChatId)
    await archive(c.sideChatId)
    await waitArchived(c.sideChatId)
    assert.equal((await state(page)).activeSideChatId, b.sideChatId)
    await restore(c.sideSessionId)
    await waitArchived(c.sideChatId, false)
    await choose(a.sideChatId)
    assert.equal(await composer(flow(page)).innerText(), 'A retains its draft')
    assert.equal(
      (await state(page)).chats.find((chat) => chat.sideChatId === a.sideChatId).sideSessionId,
      a.sideSessionId,
    )
    await page.screenshot({ path: join(artifacts, 'tabs-archive-restored.png'), fullPage: true })
    check(
      'current and noncurrent archive choose right then left and official restore reuses original Sessions',
    )

    await choose(b.sideChatId)
    await request('fail-next-lifecycle', { kind: 'archive' })
    await archive(a.sideChatId)
    await page
      .getByText('无法完成会话操作，数据已保留，请重试', { exact: true })
      .waitFor({ state: 'visible' })
    assert.equal((await state(page)).chats.find((chat) => chat.sideChatId === a.sideChatId).archived, false)
    assert.equal((await state(page)).activeSideChatId, b.sideChatId)
    await archive(a.sideChatId)
    await waitArchived(a.sideChatId)
    await restore(a.sideSessionId)
    await waitArchived(a.sideChatId, false)
    const cancel = await deleteDialog(a.sideChatId)
    await cancel.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await request('is-deleted', { sessionId: a.sideSessionId }), false)
    await request('fail-next-lifecycle', { kind: 'delete' })
    const retry = await deleteDialog(a.sideChatId)
    await retry.getByRole('button', { name: '删除会话', exact: true }).click()
    await retry.getByRole('alert').waitFor({ state: 'visible' })
    assert.equal(await request('is-deleted', { sessionId: a.sideSessionId }), false)
    assert.ok((await state(page)).chats.some((chat) => chat.sideChatId === a.sideChatId))
    await page.screenshot({ path: join(artifacts, 'tabs-delete-retry.png'), fullPage: true })
    await retry.getByRole('button', { name: '删除会话', exact: true }).click()
    await retry.waitFor({ state: 'hidden' })
    await waitState((s, id) => !s.chats.some((c) => c.sideChatId === id), a.sideChatId)
    assert.equal((await state(page)).activeSideChatId, b.sideChatId)
    await remove(b.sideChatId)
    assert.equal((await state(page)).activeSideChatId, c.sideChatId)
    await remove(c.sideChatId)
    await side(page).locator('[data-dia-side-chat-empty]').waitFor({ state: 'visible' })
    assert.equal((await state(page)).activeSideChatId, null)
    await page.screenshot({ path: join(artifacts, 'tabs-last-delete-empty.png'), fullPage: true })
    check(
      'official delete confirmation, cancellation, failed retry, exact noncurrent removal and last-Tab empty state',
    )

    const cleaning = await create()
    await request('fail-next-lifecycle', { kind: 'cleanup' })
    const cleanup = await deleteDialog(cleaning.sideChatId)
    await cleanup.getByRole('button', { name: '删除会话', exact: true }).click()
    await cleanup.getByText('会话已删除，但列表清理未完成，请重试', { exact: true }).waitFor()
    assert.equal(await request('is-deleted', { sessionId: cleaning.sideSessionId }), true)
    await waitState((s, id) => !s.chats.some((c) => c.sideChatId === id), cleaning.sideChatId)
    await page.screenshot({ path: join(artifacts, 'tabs-delete-cleanup-retry.png'), fullPage: true })
    await cleanup.getByRole('button', { name: '删除会话', exact: true }).click()
    await cleanup.waitFor({ state: 'hidden' })
    assert.equal((await request('inspect')).workspaceSessionIds.includes(cleaning.sideSessionId), false)
    check(
      'committed deletion reports unfinished accounting and retries the same identity without restoring its Tab',
    )

    await collect(mainId, quotes[0])
    const d = await active()
    assert.ok(![a.sideSessionId, b.sideSessionId, c.sideSessionId].includes(d.sideSessionId))
    await send('New D after deleting all prior chats.')
    await collect(mainId, quotes[0])
    await composer(flow(page)).fill('D remains through archive')
    await archive(d.sideChatId)
    await waitArchived(d.sideChatId)
    await side(page).locator('[data-dia-side-chat-empty]').waitFor({ state: 'visible' })
    await page.screenshot({ path: join(artifacts, 'tabs-last-archive-empty.png'), fullPage: true })
    await restore(d.sideSessionId)
    await waitArchived(d.sideChatId, false)
    await composer(flow(page)).waitFor({ state: 'visible' })
    assert.equal(await composer(flow(page)).innerText(), 'D remains through archive')
    const e = await create()
    await send('E for cross-page lifecycle races.')
    await collect(mainId, quotes[1])
    await composer(flow(page)).fill('E draft')
    const peer = await context.newPage()
    usePage(peer)
    await peer.goto(url, { waitUntil: 'domcontentloaded' })
    await peer.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    await openSide(mainId)
    await choose(d.sideChatId, peer)
    await collect(mainId, quotes[3], peer)
    await waitState(
      (s, id) => s.chats.find((c) => c.sideChatId === id)?.references.length === 2,
      d.sideChatId,
    )
    await choose(e.sideChatId, page)
    assert.equal((await active(peer)).sideChatId, d.sideChatId)
    assert.equal(await composer(flow(page)).innerText(), 'E draft')
    await request('hold-lifecycle', { kind: 'archive' })
    await archive(d.sideChatId)
    assert.equal(await request('wait-lifecycle', { kind: 'archive' }), d.sideSessionId)
    usePage(peer)
    await collect(mainId, quotes[4], peer)
    await request('release-lifecycle', { kind: 'archive' })
    await waitArchived(d.sideChatId, true, peer)
    await waitArchived(d.sideChatId)
    assert.equal((await state(page)).activeSideChatId, e.sideChatId)
    assert.deepEqual(
      (await state(page)).chats
        .find((c) => c.sideChatId === d.sideChatId)
        .references.map((r) => r.quote.exact),
      [quotes[0], quotes[3], quotes[4]],
    )
    usePage(page)
    await restore(d.sideSessionId)
    await waitArchived(d.sideChatId, false)
    await choose(d.sideChatId)
    const older = await state(peer)
    await request('hold-lifecycle', { kind: 'delete' })
    const deleting = await deleteDialog(e.sideChatId)
    await deleting.getByRole('button', { name: '删除会话', exact: true }).click()
    assert.equal(await request('wait-lifecycle', { kind: 'delete' }), e.sideSessionId)
    await request('release-lifecycle', { kind: 'delete' })
    await deleting.waitFor({ state: 'hidden' })
    await waitState((s, id) => !s.chats.some((c) => c.sideChatId === id), e.sideChatId, peer)
    await peer.evaluate(
      ({ mainId, older }) =>
        localStorage.setItem(`dsh-annotation:side-chat:v2:${mainId}`, JSON.stringify(older)),
      { mainId, older },
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    usePage(page)
    await openSide(mainId)
    await active()
    assert.equal(
      (await state(page)).chats.some((c) => c.sideChatId === e.sideChatId),
      false,
    )
    assert.equal(await request('is-deleted', { sessionId: e.sideSessionId }), true)
    await page.screenshot({ path: join(artifacts, 'tabs-cross-page-lifecycle.png'), fullPage: true })
    check(
      'last archive restores without copying, cross-page archive merges ordered references and stale writes cannot revive deleted Sessions',
    )

    await choose(d.sideChatId)
    await request('hold-next-model')
    await composer(flow(page)).fill('D generation survives Tab switch and hiding')
    await composer(flow(page)).press('Enter')
    await request('wait-model')
    const f = await create()
    assert.equal((await request('inspect')).modelPending, true)
    await closeSide(side(page))
    assert.equal((await request('inspect')).modelPending, true)
    await request('release-model')
    await openSide(mainId)
    await choose(d.sideChatId)
    await flow(page).getByText('This answer stays selectable.', { exact: false }).last().waitFor()
    assert.equal((await request('model-requests')).at(-1).sessionId, d.sideSessionId)
    await request('hold-next-model')
    await composer(flow(page)).fill('D running archive cancellation')
    await composer(flow(page)).press('Enter')
    await request('wait-model')
    await archive(d.sideChatId)
    await page.getByRole('dialog').waitFor({ state: 'visible' })
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await request('inspect')).modelPending, true)
    assert.equal((await state(page)).chats.find((c) => c.sideChatId === d.sideChatId).archived, false)
    await request('release-model')
    await choose(f.sideChatId)
    await request('hold-next-model')
    await composer(flow(page)).fill('F running deletion')
    await composer(flow(page)).press('Enter')
    await request('wait-model')
    const stopDelete = await deleteDialog(f.sideChatId)
    await stopDelete.getByText('删除将停止这个会话正在进行的工作', { exact: true }).waitFor()
    await stopDelete.getByRole('button', { name: '删除会话', exact: true }).click()
    await stopDelete.waitFor({ state: 'hidden' })
    assert.equal(await request('is-deleted', { sessionId: f.sideSessionId }), true)
    assert.equal((await request('inspect')).modelPending, false)
    check(
      'background generation survives switching and hiding, archive cancellation keeps running work and confirmed deletion stops it',
    )

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 960 },
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
      colorScheme: 'light',
    })
    try {
      const touch = await touchContext.newPage()
      touch.on('pageerror', (error) => errors.push(error.message))
      await touch.addInitScript(
        (id) => localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })),
        mainId,
      )
      usePage(touch)
      await touch.goto(url, { waitUntil: 'domcontentloaded' })
      await touch.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
      await touch
        .locator(`[data-dsh-annotation-message-id="${mainId}:assistant"] .dia-assistant__body`)
        .waitFor({ state: 'visible' })
      if (!(await touch.locator('[data-dia-side-chat-guide-new]:visible').isVisible()))
        await touch.locator('[data-sidebar-right-expand]:visible').tap()
      await touch.locator('[data-dia-side-chat-guide-new]:visible').tap()
      const first = await active(touch)
      await side(touch).locator('[data-dockkit-add-tab]:visible').tap()
      const second = await active(touch)
      await side(touch).locator('[data-dockkit-add-tab]:visible').tap()
      const mobile = await active(touch)
      const strip = side(touch).locator('[data-dockkit-strip-tabs]:visible')
      const scrollBefore = await strip.evaluate((e) => e.scrollLeft)
      assert.ok(scrollBefore > 0)
      assert.equal(await strip.evaluate((e) => getComputedStyle(e).touchAction), 'pan-x')
      const rect = await strip.boundingBox()
      const gestures = await touchContext.newCDPSession(touch)
      try {
        const x = rect.x + 20
        const y = rect.y + rect.height / 2
        await gestures.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        for (let step = 1; step <= 8; step += 1) {
          await gestures.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + ((rect.width - 40) * step) / 8, y }],
          })
          await touch.evaluate(() => new Promise(requestAnimationFrame))
        }
        await gestures.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await touch.waitForFunction(
          ({ mainId, before }) => {
            const strip = document.querySelector(
              `[data-dia-side-chat][data-main-session="${mainId}"] [data-dockkit-strip-tabs]`,
            )
            return strip.scrollLeft < before - 20
          },
          { mainId, before: scrollBefore },
        )
      } finally {
        await gestures.detach()
      }
      await tab(first.sideChatId, touch).tap()
      assert.equal((await active(touch)).sideChatId, first.sideChatId)
      await tab(first.sideChatId, touch).locator(`[data-dia-side-chat-archive="${first.sideChatId}"]`).tap()
      await waitArchived(first.sideChatId, true, touch)
      assert.equal((await active(touch)).sideChatId, second.sideChatId)
      await tab(mobile.sideChatId, touch).tap()
      assert.equal((await active(touch)).sideChatId, mobile.sideChatId)
      const operation = tab(mobile.sideChatId, touch).locator(
        `[data-dia-side-chat-archive="${mobile.sideChatId}"]`,
      )
      assert.equal(await operation.evaluate((e) => getComputedStyle(e.parentElement).opacity), '1')
      await assertComposerAtBottom(flow(touch), 'tabs-touch-390-light')
      await touch.screenshot({ path: join(artifacts, 'tabs-touch-390-light.png'), fullPage: true })
      const dialog = await deleteDialog(mobile.sideChatId, touch)
      await dialog.getByRole('button', { name: '删除会话', exact: true }).tap()
      await dialog.waitFor({ state: 'hidden' })
      const last = await deleteDialog(second.sideChatId, touch)
      await last.getByRole('button', { name: '删除会话', exact: true }).tap()
      await last.waitFor({ state: 'hidden' })
      await side(touch).locator('[data-dia-side-chat-empty]').waitFor({ state: 'visible' })
    } finally {
      await touchContext.close()
      usePage(page)
    }
    assert.deepEqual((await request('read-session', { sessionId: mainId })).events, mainSeed.events)
    assert.deepEqual(errors, [])
    check(
      'touch pans multiple fixed Tabs, exposes navigation plus and lifecycle actions at 390px, and preserves the main transcript',
    )
  } catch (error) {
    await writeFile(
      join(artifacts, 'tabs-lifecycle-host-state.json'),
      `${JSON.stringify(await request('inspect'), (key, value) => (key === 'url' ? new URL(value).origin : value), 2)}\n`,
    )
    await page.screenshot({ path: join(artifacts, 'tabs-lifecycle-failure.png'), fullPage: true })
    await writeFile(
      join(artifacts, 'tabs-lifecycle-failure-state.json'),
      `${JSON.stringify(
        await page.evaluate(
          (mainId) => ({
            current: localStorage.getItem('dsh.sessions.current'),
            state: JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${mainId}`)),
            rows: [...document.querySelectorAll('[data-row-key]')].map((e) => ({
              key: e.getAttribute('data-row-key'),
              expanded: e.getAttribute('aria-expanded'),
              text: e.textContent,
            })),
            conversations: [...document.querySelectorAll('[data-conversation-content]')].map((e) => ({
              sessionId: e.getAttribute('data-conversation-session'),
              visible: e.getBoundingClientRect().width > 0,
            })),
          }),
          mainId,
        ),
        null,
        2,
      )}\n`,
    )
    await writeFile(
      join(artifacts, 'tabs-lifecycle-failure.txt'),
      `${error.stack ?? error}\n${await page.locator('body').innerText()}\n`,
    )
    throw error
  } finally {
    await writeFile(
      join(artifacts, 'tabs-lifecycle-results.json'),
      `${JSON.stringify({ checks, errors, diagnostics }, null, 2)}\n`,
    )
    await context.close()
  }
}
