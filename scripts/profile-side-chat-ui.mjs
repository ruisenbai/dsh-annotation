/** Geometry and real pointer/keyboard acceptance inside the built side-chat Web profile. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

export async function exerciseSideChatUi({ page, tab, flow, composer, rename, chats, artifacts }) {
  const measurements = []
  const c = chats.at(-1)
  const originalTitle = await tab(c.sideChatId).locator('[data-dockkit-tab-title]').innerText()
  const geometry = (target) =>
    target.evaluate((element) => {
      const title = element.querySelector('[data-dockkit-tab-title]')
      const actions = element.querySelector('[data-dockkit-tab-action-bar]')
      const rect = (e) => {
        const r = e.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
      }
      return {
        tab: rect(element),
        title: rect(title),
        actions: rect(actions),
        opacity: getComputedStyle(actions).opacity,
        mask: getComputedStyle(title).maskImage,
        maskSize: getComputedStyle(title).maskSize,
        clipped: title.hasAttribute('data-dockkit-tab-clipped'),
        scrollWidth: title.scrollWidth,
      }
    })
  async function settle() {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  async function resize(width) {
    const handle = await page.locator('[data-side="rightbar"]').first().boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(page.viewportSize().width - width, handle.y + handle.height / 2)
    await page.mouse.up()
    await settle()
  }
  async function preview(label) {
    const chip = flow(page).locator('[data-dia-side-chat-chip-main]')
    await chip.hover()
    const content = page.locator('.dia-composer-chip__preview:visible')
    await content.waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.dia-composer-chip__preview')].some(
        (e) => getComputedStyle(e.parentElement).opacity === '1',
      ),
    )
    const box = await content.evaluate((e) => {
      const card = e.parentElement.getBoundingClientRect()
      return {
        left: card.left,
        right: card.right,
        width: card.width,
        height: card.height,
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        scrollHeight: e.scrollHeight,
        clientHeight: e.clientHeight,
      }
    })
    assert.ok(box.width > 140, `${label}: preview follows its composer: ${JSON.stringify(box)}`)
    assert.ok(box.left >= 0 && box.right <= page.viewportSize().width)
    assert.ok(box.scrollWidth <= box.clientWidth + 1)
    assert.ok(box.height <= 420)
    measurements.push({ label, ...box })
    await page.screenshot({ path: join(artifacts, `${label}.png`), fullPage: true })
    await composer(flow(page)).hover()
    await content.waitFor({ state: 'hidden' })
  }
  try {
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        theme === 'dark',
      )
      await resize(600)
      for (const chat of chats) {
        const target = tab(chat.sideChatId)
        await target.scrollIntoViewIfNeeded()
        await composer(flow(page)).focus()
        await composer(flow(page)).hover()
        await settle()
        await page.waitForFunction(
          (id) =>
            getComputedStyle(
              document
                .querySelector(`[data-dia-side-chat-archive="${id}"]`)
                .closest('[data-dockkit-tab-action-bar]'),
            ).opacity === '0',
          chat.sideChatId,
        )
        const before = await geometry(target)
        assert.ok(before.title.width >= before.tab.width - 22, JSON.stringify(before))
        await page.screenshot({
          path: join(artifacts, `ui-tab-${chat.sideChatId}-${theme}-default.png`),
          fullPage: true,
        })
        await target.hover()
        const action = target.locator('[data-dia-side-chat-archive]')
        await action.hover()
        await page.waitForFunction(
          (id) =>
            getComputedStyle(
              document
                .querySelector(`[data-dia-side-chat-archive="${id}"]`)
                .closest('[data-dockkit-tab-action-bar]'),
            ).opacity === '1',
          chat.sideChatId,
        )
        const hover = await geometry(target)
        assert.equal(before.tab.width, hover.tab.width)
        assert.equal(before.title.width, hover.title.width)
        assert.ok(hover.actions.left >= hover.tab.left && hover.actions.right <= hover.tab.right)
        assert.equal(
          await action.evaluate((e) => {
            const r = e.getBoundingClientRect()
            return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
          }),
          true,
        )
        await target.locator('[data-dia-side-chat-delete]').hover()
        assert.equal((await geometry(target)).opacity, '1')
        measurements.push({ theme, id: chat.sideChatId, before, hover })
        await page.screenshot({
          path: join(artifacts, `ui-tab-${chat.sideChatId}-${theme}-hover.png`),
          fullPage: true,
        })
      }
      await resize(300)
      await preview(`ui-chip-sidebar-300-${theme}`)
      await page.setViewportSize({ width: 390, height: 960 })
      await preview(`ui-chip-viewport-390-${theme}`)
      await page.setViewportSize({ width: 1440, height: 960 })
      await resize(600)
    }
    await resize(300)
    for (const chat of [chats[0], c]) {
      const target = tab(chat.sideChatId)
      await target.scrollIntoViewIfNeeded()
      await target.hover()
      for (const action of ['archive', 'delete']) {
        const button = target.locator(`[data-dia-side-chat-${action}]`)
        await button.hover()
        assert.equal(
          await button.evaluate((e) => {
            const r = e.getBoundingClientRect()
            return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
          }),
          true,
        )
      }
    }
    const scrolledTab = tab(c.sideChatId)
    const strip = scrolledTab.locator('..')
    assert.ok(await strip.evaluate((e) => e.scrollLeft > 0))
    await composer(flow(page)).hover()
    await page.keyboard.press('Shift')
    await scrolledTab.focus()
    const scrollHint = page.getByRole('tooltip').filter({ hasText: originalTitle }).last()
    await scrollHint.waitFor({ state: 'visible' })
    await scrollHint.evaluate(async (e) => {
      await Promise.all(e.getAnimations().map((animation) => animation.finished))
    })
    assert.equal(await scrollHint.evaluate((e) => e.closest('[data-dockkit-strip-tabs]') === null), true)
    await page.screenshot({ path: join(artifacts, 'ui-title-scrolled-sidebar-300.png'), fullPage: true })
    await strip.evaluate((e) => {
      e.scrollLeft = 0
    })
    await scrollHint.waitFor({ state: 'hidden' })
    await resize(600)
    for (const [label, requestedTitle] of [
      ['chinese', '中文长标题'.repeat(28)],
      ['english', 'A long English conversation title '.repeat(12)],
      ['unbroken', 'UnbrokenTitle'.repeat(45)],
      ['mixed', originalTitle],
    ]) {
      await rename(c.sideSessionId, requestedTitle)
      const target = tab(c.sideChatId)
      const text = target.locator('[data-dockkit-tab-title]')
      await page.waitForFunction(
        ({ id, prefix }) =>
          document
            .querySelector(`[data-dockkit-tab="annotation-side-tab:${id}"] [data-dockkit-tab-title]`)
            .textContent.startsWith(prefix),
        { id: c.sideChatId, prefix: requestedTitle.slice(0, 10) },
      )
      const title = await text.innerText()
      await target.scrollIntoViewIfNeeded()
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(`[data-dockkit-tab="annotation-side-tab:${id}"] [data-dockkit-tab-title]`)
            .hasAttribute('data-dockkit-tab-clipped'),
        c.sideChatId,
      )
      await composer(flow(page)).hover()
      await page.keyboard.press('Shift')
      await target.focus()
      const hint = page.getByRole('tooltip').filter({ hasText: title }).last()
      await hint.waitFor({ state: 'visible' })
      await hint.evaluate(async (e) => {
        await Promise.all(e.getAnimations().map((animation) => animation.finished))
      })
      assert.equal(await hint.evaluate((e) => e.closest('[data-dockkit-strip-tabs]') === null), true)
      const r = await hint.boundingBox()
      assert.ok(r.x >= 0 && r.x + r.width <= 1440)
      await page.screenshot({ path: join(artifacts, `ui-title-${label}-keyboard.png`), fullPage: true })
      await page.keyboard.press('Escape')
      await hint.waitFor({ state: 'hidden' })
      await target.click()
      await composer(flow(page)).hover()
      assert.equal(await hint.count(), 0)
      await page.waitForFunction(
        (id) =>
          getComputedStyle(
            document
              .querySelector(`[data-dia-side-chat-archive="${id}"]`)
              .closest('[data-dockkit-tab-action-bar]'),
          ).opacity === '0',
        c.sideChatId,
      )
      await target.hover()
      await hint.waitFor({ state: 'visible' })
      await composer(flow(page)).hover()
      await hint.waitFor({ state: 'hidden' })
    }
    await tab(c.sideChatId).focus()
    await page.keyboard.press('Tab')
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-dia-side-chat-archive')),
      true,
    )
    await page.keyboard.press('Tab')
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-dia-side-chat-delete')),
      true,
    )
  } finally {
    await writeFile(join(artifacts, 'ui-measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)
  }
}
