/** Real built-plugin marker, confirmation and chip animation acceptance in an official DSH profile. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { assertMarkerMaterial, captureMarker } from './marker-material.mjs'

export async function exerciseMarkerUi(harness) {
  const {
    browser,
    url,
    workspace,
    artifacts,
    seedMain,
    usePage,
    openSide,
    closeSide,
    selectText,
    collect,
    composer,
    request,
    evidence,
  } = harness
  const id = 'annotation-marker-ui-main'
  const exact = '同一选区保留每条独立记录。'
  const repeated = '不同位置的相同文字。'
  const denseExact = '在同一行中标记这几个字'
  const fieldExact = '5 分钟后的记录数值'
  const dense = `${'前一行包含连续的正文，用于检查气泡不被推到其他行。'.repeat(4)}  \n第二行靠前的${denseExact}，后面仍有很多未被选择的正文，需要保持末字的位置。${'这里继续显示正常的后续正文。'.repeat(3)}`
  const field = `${'连续正文的字段定位示例需要保持前后文字和换行关系。'.repeat(4)}  \n这一行中的 *${fieldExact}*，后面依然是同一行的普通内容，以及下一行可继续阅读的正文。`
  const long = '长段落用于验证字号变化、正文重新换行和独立气泡避让。'.repeat(520)
  const source = `${exact}\n\n${repeated}第一处。\n\n${repeated}第二处。\n\n${dense}\n\n${field}\n\n跨行锚点：${'选区跨行时应取最后一行的末尾字符，'.repeat(7)}终字。\n\n\`\`\`text\n尾部空白目标字   \n\n\`\`\`\n\n${long}`
  await seedMain(workspace, id, source, '独立气泡与输入区动画')
  const videoDir = join(artifacts, 'videos')
  await mkdir(videoDir, { recursive: true })
  const recordingStart = Date.now()
  const timeline = []
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    colorScheme: 'light',
    recordVideo: { dir: videoDir, size: { width: 1440, height: 960 } },
  })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => {
    browserErrors.push(error.stack ?? error.message)
    console.error('Marker page error:', error.stack ?? error.message)
  })
  const video = page.video()
  usePage(page)
  const checks = []
  const measurements = []
  const body = () => page.locator(`[data-dsh-annotation-message-id="${id}:assistant"] .dia-assistant__body`)
  const root = () => body().locator('..')
  const main = () => page.locator(`[data-conversation-content][data-conversation-session="${id}"]`)
  const side = () => page.locator(`[data-dia-side-chat][data-main-session="${id}"]`)
  const flow = () => side().locator('[data-conversation-content]:visible')
  const editor = () => page.locator('.dia-record-editor--quick')
  const markers = () => root().locator('.dia-marker')
  const check = (name) => {
    checks.push({ name, status: 'passed' })
    evidence.checks.push({ name, status: 'passed' })
    console.log(`PASS marker: ${name}`)
  }
  const screenshot = (name) => page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })
  const hold = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) // Reading and motion capture only.
  async function addNote(text, selection = exact, content = body(), saveWithEnter = false) {
    const toolbar = await selectText(content, selection)
    await toolbar.getByRole('button', { name: '添加注解', exact: true }).click()
    await editor().waitFor()
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill(text)
    if (saveWithEnter) await editor().getByRole('textbox').press('Enter')
    else await editor().getByRole('button', { name: '保存', exact: true }).click()
    await editor().waitFor({ state: 'hidden' })
  }
  async function collectNativeSource(reverse = false, action = '在侧边聊天提问') {
    const source = body().locator('p').first()
    await source.scrollIntoViewIfNeeded()
    const bounds = await source.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
    })
    await page.mouse.move(reverse ? bounds.right + 1 : bounds.left - 1, bounds.y)
    await page.mouse.down()
    await page.mouse.move(reverse ? bounds.left - 1 : bounds.right + 1, bounds.y, { steps: 12 })
    await page.mouse.up()
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), exact)
    const toolbar = page.getByRole('toolbar', { name: '选区操作', exact: true })
    await toolbar.getByRole('button', { name: action, exact: true }).click()
    await toolbar.waitFor({ state: 'hidden' })
  }
  async function touchPreview() {
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 960 },
      locale: 'zh-CN',
      colorScheme: 'dark',
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    })
    try {
      const touch = await touchContext.newPage()
      usePage(touch)
      await touch.goto(url, { waitUntil: 'domcontentloaded' })
      await touch.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
      const touchSide = touch.locator(`[data-dia-side-chat][data-main-session="${id}"]`)
      await openSide(id)
      await touchSide.waitFor({ state: 'visible' })
      await touchSide.locator('[data-conversation-content]:visible [data-composer-card]').waitFor()
      if (await touchSide.isVisible()) {
        const actions = touchSide.locator('.dia-composer-chip__actions')
        for (const action of await actions.all())
          assert.equal(await action.evaluate((e) => getComputedStyle(e).visibility), 'visible')
        await touch.screenshot({ path: join(artifacts, 'markers-touch-chip-actions.png'), fullPage: true })
        await closeSide(touchSide)
        const collapse = touch.locator('[data-sidebar-right-open] [data-sidebar-right-toggle]')
        if (await collapse.count()) await collapse.click()
        await touch.waitForFunction(() => {
          return [
            ...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-host="dock"]'),
          ].every(
            (host) =>
              host.getBoundingClientRect().width === 0 ||
              getComputedStyle(host).visibility === 'hidden' ||
              host.getBoundingClientRect().left >= innerWidth - 1,
          )
        })
      }
      const touchRoot = touch.locator(`[data-dsh-annotation-message-id="${id}:assistant"]`)
      await touchRoot.locator('.dia-assistant__body p').first().scrollIntoViewIfNeeded()
      const bubble = touchRoot.locator('[data-reference-id]').first()
      await bubble.scrollIntoViewIfNeeded()
      const box = await bubble.boundingBox()
      assert.ok(box.width >= 44 && box.height >= 44)
      await bubble.tap()
      await touch.locator('.dia-marker-popover').waitFor()
      const preview = await touch.locator('.dia-marker-popover').boundingBox()
      assert.ok(preview.width >= 200 && preview.x >= 12 && preview.x + preview.width <= 390 - 12)
      const dismiss = await touch
        .locator('.dia-marker-popover')
        .getByRole('button', { name: '取消', exact: true })
        .boundingBox()
      assert.ok(dismiss.x >= preview.x && dismiss.x + dismiss.width <= preview.x + preview.width)
      await touch.screenshot({
        path: join(artifacts, 'markers-touch-independent-preview.png'),
        fullPage: true,
      })
      await writeFile(
        join(artifacts, 'touch-preview-geometry.json'),
        `${JSON.stringify(
          await touch.locator('.dia-marker-popover').evaluate((e) => {
            const props = (node) => {
              const s = getComputedStyle(node)
              const r = node.getBoundingClientRect()
              return {
                tag: node.tagName,
                class: node.className,
                width: r.width,
                left: r.left,
                top: r.top,
                height: r.height,
                overflowX: s.overflowX,
                overflowY: s.overflowY,
                maxWidth: s.maxWidth,
                computedWidth: s.width,
                containingBlock: s.containerType,
                style: node.getAttribute('style'),
              }
            }
            const anchor = document.querySelector('.dia-marker[data-reference-id][aria-expanded="true"]')
            const ancestors = []
            for (let a = anchor; a; a = a.parentElement) ancestors.push(props(a))
            return { overlay: props(e), close: props(e.querySelector('button')), ancestors }
          }),
          null,
          2,
        )}\n`,
      )
      await touch.locator('.dia-marker-popover').getByRole('button', { name: '取消', exact: true }).tap()
      await touch.locator('.dia-marker-popover').waitFor({ state: 'hidden' })
      check('touch exposes chip actions and 44px independent bubble hit areas with normal preview dismissal')
    } finally {
      usePage(page)
      await touchContext.close()
    }
  }
  async function layout(label, content = root()) {
    const result = await content.evaluate((element) => {
      const rect = (e) => {
        const r = e.getBoundingClientRect()
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        }
      }
      return {
        markers: [...element.querySelectorAll('.dia-marker')].map((e) => ({
          ...rect(e),
          surface: rect(e.querySelector('span')),
          id: e.dataset.annotationId ?? e.dataset.referenceId,
          number: e.textContent,
          font: getComputedStyle(e).fontSize,
          cssWidth: e.offsetWidth,
          cssHeight: e.offsetHeight,
        })),
        body: rect(element.querySelector('.dia-assistant__body')),
        font: getComputedStyle(element.querySelector('.dia-assistant__body p')).fontSize,
      }
    })
    for (const marker of result.markers) {
      assert.ok(marker.surface.left >= result.body.left - 1)
      assert.ok(marker.right <= result.body.right + 1)
      assert.ok(marker.surface.height < marker.height)
      assert.ok(marker.cssWidth >= 24 && marker.cssHeight >= 24)
    }
    for (const [index, marker] of result.markers.entries())
      for (const peer of result.markers.slice(index + 1))
        assert.ok(
          marker.right <= peer.left ||
            peer.right <= marker.left ||
            marker.bottom <= peer.top ||
            peer.bottom <= marker.top,
        )
    assert.equal(new Set(result.markers.map((e) => e.id)).size, result.markers.length)
    measurements.push({ label, ...result })
    return result
  }
  async function settingsFont(size) {
    await page.getByRole('button', { name: '账号菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    const current = () =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size')),
      )
    while ((await current()) !== size) {
      const before = await current()
      await dialog.getByRole('button', { name: before < size ? '增大字号' : '减小字号', exact: true }).click()
      await page.waitForFunction(
        (before) =>
          Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size')) !==
          before,
        before,
      )
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  async function anchorScenarios() {
    const capture = async (name) => {
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const result = await body().evaluate((element, id) => {
        const box = (rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        })
        const nodes = []
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (
            !node.parentElement.closest(
              'button, script, style, [aria-hidden="true"], [aria-live], [role="status"], [data-variant="think"], [data-dsh-annotation-ignore="true"]',
            )
          )
            nodes.push(node)
        }
        const all = nodes.map((node) => node.data).join('')
        const records = JSON.parse(localStorage.getItem(`dsh-annotation:v1:${id}`))?.annotations ?? []
        const textRects = nodes.flatMap((node) => {
          if (!node.data.trim()) return []
          const range = document.createRange()
          range.selectNodeContents(node)
          return [...range.getClientRects()].filter((rect) => rect.width && rect.height).map(box)
        })
        const values = records.map((record) => {
          const quote = record.quote.exact.replace(/[\s\u200b]+$/u, '')
          const start = all.indexOf(record.quote.exact)
          if (start < 0) throw new Error(`Missing live quote ${quote}`)
          let offset = start + quote.length - 1
          let node = nodes[0]
          for (const candidate of nodes) {
            if (offset < candidate.length) {
              node = candidate
              break
            }
            offset -= candidate.length
          }
          const range = document.createRange()
          range.setStart(node, offset)
          range.setEnd(node, offset + 1)
          const marker = element.parentElement.querySelector(`[data-annotation-id="${record.annotationId}"]`)
          if (!marker) throw new Error(`Missing marker ${record.ordinal}`)
          const surface = marker.querySelector('span')
          const css = getComputedStyle(surface)
          return {
            id: record.annotationId,
            quote: record.quote.exact,
            label: record.annotation,
            ordinal: record.ordinal,
            character: box(range.getBoundingClientRect()),
            surface: box(surface.getBoundingClientRect()),
            hit: box(marker.getBoundingClientRect()),
            bodyFont: Number.parseFloat(getComputedStyle(node.parentElement).fontSize),
            font: Number.parseFloat(getComputedStyle(marker).fontSize),
            material: {
              background: css.backgroundColor,
              color: css.color,
              filter: css.backdropFilter,
              opacity: css.opacity,
              radius: css.borderRadius,
            },
          }
        })
        return {
          values,
          textRects,
          body: box(element.getBoundingClientRect()),
          padding: element.parentElement.style.paddingRight,
          viewport: window.innerWidth,
        }
      }, id)
      const overlaps = (a, b) =>
        a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
      assert.equal(result.padding, '')
      for (const item of result.values) {
        assert.ok(Math.abs(item.font - item.bodyFont * 0.8) < 0.01)
        assert.ok(item.surface.height < item.hit.height)
        assert.equal(item.material.opacity, '1')
        assert.ok(
          item.surface.left >= result.body.left - 0.5 &&
            item.hit.right <= Math.min(result.body.right, result.viewport) + 0.5,
        )
        assert.ok(!overlaps(item.surface, item.character), `${name}: bubble covers its final character`)
        // Dense inline endpoints keep their own superscript position; complete line boxes are not exclusions.
      }
      for (const [index, item] of result.values.entries())
        for (const peer of result.values.slice(index + 1))
          assert.ok(!overlaps(item.hit, peer.hit), `${name}: hit areas overlap`)
      measurements.push({ label: name, ...result })
      await writeFile(
        join(artifacts, 'marker-anchor-progress.json'),
        `${JSON.stringify(measurements, null, 2)}\n`,
      )
      return result
    }
    const crop = async (name, record) => {
      await page.mouse.move(10, 10)
      await page.keyboard.press('Escape')
      const left = Math.max(0, record.character.left - 100)
      const top = Math.max(0, Math.min(record.character.top, record.surface.top) - 22)
      await page.screenshot({
        path: join(artifacts, `${name}.png`),
        animations: 'disabled',
        clip: {
          x: left,
          y: top,
          width: Math.min(page.viewportSize().width - left, record.hit.right - left + 36),
          height: Math.min(
            page.viewportSize().height - top,
            Math.max(record.character.bottom, record.hit.bottom) - top + 30,
          ),
        },
      })
    }
    for (const reverse of [false, true]) {
      await collectNativeSource(reverse, '添加注解')
      await editor()
        .getByRole('textbox')
        .fill(reverse ? '反向拖选保存' : '正向拖选保存')
      await editor().getByRole('button', { name: '保存', exact: true }).click()
      await editor().waitFor({ state: 'hidden' })
    }
    let result = await capture('native-forward-and-reverse')
    assert.equal(result.values[0].quote, result.values[1].quote)
    assert.deepEqual(result.values[0].character, result.values[1].character)
    const primary = result.values[0]
    assert.ok(
      primary.surface.left >= primary.character.right &&
        primary.surface.left - primary.character.right < primary.bodyFont * 0.3,
    )
    assert.ok(primary.surface.top < primary.character.top)
    await crop('anchor-single-light-detail', primary)
    for (let index = 0; index < 3; index++) await collectNativeSource()
    await closeSide(side())
    for (let index = 0; index < 5; index++) await addNote(`同选区独立记录 ${index + 1}`)
    result = await capture('same-endpoint-independent-note-and-reference-bubbles')
    await screenshot('anchors-same-selection-light')
    await layout('character-anchored-mixed-hit-regions')
    const many = await markers().evaluateAll((elements) =>
      elements.map((e) => ({
        id: e.dataset.annotationId ?? e.dataset.referenceId,
        left: e.getBoundingClientRect().left,
        top: e.getBoundingClientRect().top,
      })),
    )
    assert.equal(new Set(many.map((e) => e.id)).size, many.length)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await body().waitFor({ state: 'visible' })
    await page.waitForFunction(
      ({ id, count }) =>
        document
          .querySelector(`[data-dsh-annotation-message-id="${id}:assistant"]`)
          ?.querySelectorAll('.dia-marker').length === count,
      { id, count: many.length },
    )
    await body().locator('p').first().scrollIntoViewIfNeeded()
    await capture('same-records-after-reload')
    assert.deepEqual(
      await markers().evaluateAll((elements) =>
        elements.map((e) => e.dataset.annotationId ?? e.dataset.referenceId),
      ),
      many.map((item) => item.id),
    )
    check(
      'native forward and backward drags restore the same final character; mixed records keep independent stable bubbles after reload',
    )
    for (const [label, selected] of [
      ['密集正文末字', denseExact],
      ['斜体字段末字', fieldExact],
    ]) {
      await addNote(label, selected)
      const denseResult = await capture(`dense-inline-${label}`)
      const item = denseResult.values.find((value) => value.label === label)
      assert.ok(
        item.surface.left > item.character.right &&
          item.surface.left - item.character.right < item.bodyFont * 0.3,
      )
      assert.ok(item.surface.top < item.character.top)
      assert.ok(Math.abs(item.surface.bottom - item.character.top) < item.bodyFont * 0.35)
      assert.ok(item.surface.height >= item.bodyFont * 1.45)
      await addNote(`${label} 第二枚`, selected)
      const paired = await capture(`dense-inline-${label}-paired`)
      const second = paired.values.find((value) => value.label === `${label} 第二枚`)
      assert.ok(Math.abs(second.surface.top - item.surface.top) < 0.1)
      assert.ok(second.surface.left >= item.hit.right)
      await crop(`blue-corner-${label}-light`, second)

      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
      const darkResult = await capture(`dense-inline-${label}-dark`)
      const darkItem = darkResult.values.find((value) => value.label === label)
      await assertMarkerMaterial(root().locator(`[data-annotation-id="${item.id}"]`))
      await crop(`blue-corner-${label}-dark`, darkItem)
      await page.emulateMedia({ colorScheme: 'light' })
    }
    check(
      'dense mid-line and italic field selections keep a larger blue speech bubble at the final character corner',
    )
    const multiline = await body().locator('p').filter({ hasText: '跨行锚点：' }).innerText()
    await addNote('跨行的最后一个字符', multiline)
    const crossParagraph = await body().evaluate((element, repeated) => {
      const text = element.textContent
      return text.slice(
        text.indexOf(`${repeated}第一处。`),
        text.indexOf(`${repeated}第二处。`) + `${repeated}第二处。`.length,
      )
    }, repeated)
    await addNote('跨段的最后一个字符', crossParagraph)
    await addNote('忽略尾部空白和换行', '尾部空白目标字   \n')
    result = await capture('multiline-paragraphs-and-trailing-whitespace')
    for (const label of ['跨行的最后一个字符', '跨段的最后一个字符', '忽略尾部空白和换行']) {
      const item = result.values.find((value) => value.label === label)
      if (label === '忽略尾部空白和换行')
        assert.ok(
          item.surface.left >= item.character.right &&
            item.surface.left - item.character.right < item.bodyFont * 0.3,
        )
      await crop(
        `anchor-${label === '跨行的最后一个字符' ? 'multiline' : label === '跨段的最后一个字符' ? 'paragraphs' : 'whitespace'}-light-detail`,
        item,
      )
    }
    check(
      'multiline, cross-paragraph and whitespace-ending selections preserve their final selected character',
    )
    for (const size of [10, 22, 14]) {
      await settingsFont(size)
      await page.waitForFunction(
        ({ id }) => {
          const root = document.querySelector(`[data-dsh-annotation-message-id="${id}:assistant"]`)
          const font = Number.parseFloat(getComputedStyle(root.querySelector('p')).fontSize)
          return (
            Math.abs(
              Number.parseFloat(getComputedStyle(root.querySelector('.dia-marker')).fontSize) - font * 0.8,
            ) < 0.01
          )
        },
        { id },
      )
      await body().locator('p').first().scrollIntoViewIfNeeded()
      result = await capture(`anchors-font-${size}`)
      await crop(`anchor-font-${size}-detail`, result.values[0])
    }
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        theme === 'dark',
      )
      for (const kind of ['annotation', 'reference']) {
        const bubble = root().locator(`.dia-marker[data-${kind}-id]`).first()
        await page.mouse.move(10, 10)
        await bubble.evaluate((element) => element.blur())
        const bounds = await bubble.boundingBox()
        const idle = await assertMarkerMaterial(bubble)
        assert.equal(idle.emphasized, false)
        await captureMarker(page, bubble, join(artifacts, `material-${kind}-${theme}-idle.png`))
        await bubble.hover()
        const hover = await assertMarkerMaterial(bubble)
        assert.equal(hover.alpha, 1)
        assert.deepEqual(await bubble.boundingBox(), bounds)
        await captureMarker(page, bubble, join(artifacts, `material-${kind}-${theme}-hover.png`))
        await page.mouse.move(10, 10)
        const leave = await assertMarkerMaterial(bubble)
        assert.equal(leave.alpha, idle.alpha, 'Pointer leave restores the translucent fill')
        await bubble.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        const focus = await assertMarkerMaterial(bubble)
        assert.equal(focus.alpha, 1)
        assert.deepEqual(await bubble.boundingBox(), bounds)
        await page.keyboard.press('Tab')
        const blur = await assertMarkerMaterial(bubble)
        assert.equal(blur.alpha, idle.alpha, 'Keyboard blur restores the translucent fill')
        measurements.push({ label: `material-states-${kind}-${theme}`, idle, hover, leave, focus, blur })
      }
      result = await capture(`anchors-${theme}`)
      const before = result.values[0]
      const marker = root().locator(`[data-annotation-id="${before.id}"]`)
      measurements.push({ label: `material-${theme}`, ...(await assertMarkerMaterial(marker)) })
      await marker.focus()
      await marker.hover()
      const focused = await capture(`anchors-${theme}-focused`)
      assert.deepEqual(focused.values[0].surface, before.surface)
      await crop(`anchor-single-${theme}-focused-detail`, focused.values[0])
      await marker.click()
      await page.locator('.dia-record-editor--detail').waitFor()
      assert.equal(
        await page.locator('.dia-record-editor--detail').getByRole('textbox').inputValue(),
        before.label,
      )
      await page.keyboard.press('Escape')
      await page.locator('.dia-record-editor--detail').waitFor({ state: 'hidden' })
    }
    check(
      'annotation and reference bubbles are translucent at rest, opaque on hover or keyboard focus, and restore on leave in both themes without moving',
    )
    const noBlur = await page.addStyleTag({
      content:
        '.dia-marker > span { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
    })
    const fallback = await capture('backdrop-filter-disabled')
    measurements.push({
      label: 'material-without-backdrop-blur',
      ...(await assertMarkerMaterial(root().locator('.dia-marker[data-annotation-id]').first(), {
        blur: false,
      })),
    })
    await crop('anchor-no-blur-fallback-detail', fallback.values[0])
    await noBlur.evaluate((element) => element.remove())
    check('disabling backdrop blur retains a translucent surface with opaque digits and readable contrast')

    await body()
      .locator('p')
      .first()
      .evaluate((element) => element.prepend(document.createTextNode('正文更新后仍能跟随：')))
    result = await capture('live-dom-content-update')
    assert.ok(result.values[0].surface.left >= result.values[0].character.right)
    await body()
      .locator('p')
      .first()
      .evaluate((element) => element.firstChild.remove())
    await capture('live-dom-content-restored')
    await body()
      .locator('p')
      .first()
      .evaluate((element) => {
        element.style.fontSize = '18px'
      })
    await page.waitForFunction(
      ({ id }) =>
        Math.abs(
          Number.parseFloat(
            getComputedStyle(
              document.querySelector(`[data-dsh-annotation-message-id="${id}:assistant"] .dia-marker`),
            ).fontSize,
          ) -
            18 * 0.8,
        ) < 0.01,
      { id },
    )
    await capture('inline-font-with-unchanged-line-height')
    await body()
      .locator('p')
      .first()
      .evaluate((element) => {
        element.style.fontSize = ''
      })
    await capture('inline-font-restored')
    check(
      'the real mounted renderer remeasures DOM content and inline font changes without requiring a container resize',
    )
    await collectNativeSource()
    await openSide(id)
    await composer(flow()).waitFor()
    const handle = await page.locator('[data-side="rightbar"]').first().boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(1140, handle.y + handle.height / 2)
    await page.mouse.up()
    await composer(flow()).fill('验证窄侧栏里的气泡')
    await flow().locator('[data-composer-card] button[aria-busy]').last().click()
    const answer = flow()
      .locator('.dia-assistant__body')
      .filter({ hasText: 'This answer stays selectable.' })
      .last()
    await answer.waitFor()
    await addNote('窄侧栏末字', 'This answer stays selectable.', answer)
    await screenshot('anchors-sidebar-300-light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 960 })
    if (await page.locator('[data-sidebar-drawer]:not([data-sidebar-collapsed])').count())
      await page.locator('[data-sidebar-toggle]:visible').first().click()
    await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
    await page.waitForFunction(() => {
      const mask = document.querySelector('[data-sidebar-mask]')
      return mask && mask.nextElementSibling.getBoundingClientRect().right <= 1
    })
    await answer.locator('p').last().scrollIntoViewIfNeeded()
    await screenshot('anchors-sidebar-390-dark')
    const sidebarGeometry = await answer.locator('..').evaluate((element) => {
      const box = (r) => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      })
      const marker = element.querySelector('.dia-marker')
      const surface = marker.querySelector('span').getBoundingClientRect()
      const nodes = []
      const walker = document.createTreeWalker(
        element.querySelector('.dia-assistant__body'),
        NodeFilter.SHOW_TEXT,
      )
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.data.trim()) nodes.push(node)
      const node = nodes.at(-1)
      const end = node.data.trimEnd().length
      const range = document.createRange()
      range.setStart(node, end - 1)
      range.setEnd(node, end)
      return {
        hit: box(marker.getBoundingClientRect()),
        surface: box(surface),
        character: box(range.getBoundingClientRect()),
        viewport: innerWidth,
        reachable:
          document
            .elementFromPoint(surface.left + surface.width / 2, surface.top + surface.height / 2)
            ?.closest('button') === marker,
      }
    })
    assert.ok(sidebarGeometry.hit.left >= 0 && sidebarGeometry.hit.right <= 390)
    assert.ok(sidebarGeometry.surface.height < sidebarGeometry.hit.height)
    assert.ok(sidebarGeometry.reachable)
    await crop('anchor-sidebar-390-dark-detail', sidebarGeometry)
    measurements.push({ label: 'narrow-sidebar-real-model-fixture-reply', ...sidebarGeometry })
    check(
      'a real side Conversation response from the deterministic model fixture keeps its bubble reachable at 300px and a 390px viewport',
    )
    await page.setViewportSize({ width: 1440, height: 960 })
    await closeSide(side())
    await touchPreview()
    assert.deepEqual(browserErrors, [], 'The actual marker page must not report runtime errors')
    await writeFile(
      join(artifacts, 'marker-anchor-results.json'),
      `${JSON.stringify({ checks, measurements, transport: 'official DSH web profile and current built plugin', model: 'deterministic fixture', realApi: false, contentUpdate: 'explicit DOM mutation in the real mounted renderer' }, null, 2)}\n`,
    )
  }
  async function animateChip(chip, label) {
    timeline.push({ scene: label, start: (Date.now() - recordingStart) / 1000 })
    const mainButton = chip.locator('.dia-composer-chip__main')
    const action = chip.locator('.dia-composer-chip__remove').first()
    await composer(flow()).hover()
    await composer(flow()).focus()
    await page.waitForFunction(
      (label) =>
        [...document.querySelectorAll('.dia-composer-chip')].some(
          (e) =>
            e.querySelector('button')?.getAttribute('aria-label') === label &&
            e.querySelector('.dia-composer-chip__actions').getBoundingClientRect().width < 1,
        ),
      await mainButton.getAttribute('aria-label'),
    )
    const before = await chip.evaluate((e) => ({
      left: e.getBoundingClientRect().left,
      text: e.querySelector('.dia-composer-chip__main').getBoundingClientRect().width,
      height: e.closest('[data-composer-card]').getBoundingClientRect().height,
    }))
    const samples = page.evaluate(
      (label) =>
        new Promise((resolve) => {
          const e = [...document.querySelectorAll('.dia-composer-chip')].find(
            (e) => e.querySelector('button')?.getAttribute('aria-label') === label,
          )
          const values = []
          const start = performance.now()
          function sample() {
            values.push(e.querySelector('.dia-composer-chip__actions').getBoundingClientRect().width)
            if (performance.now() - start < 450) requestAnimationFrame(sample)
            else resolve(values)
          }
          requestAnimationFrame(sample)
        }),
      await mainButton.getAttribute('aria-label'),
    )
    await mainButton.hover()
    const widths = await samples
    assert.ok(
      widths.some((width) => width > 1 && width < Math.max(...widths) - 1),
      `${label} has continuous intermediate widths: ${widths}`,
    )
    await action.hover()
    assert.equal(
      await action.evaluate((e) => getComputedStyle(e.parentElement.parentElement).visibility),
      'visible',
    )
    await hold(900)
    const after = await chip.evaluate((e) => ({
      left: e.getBoundingClientRect().left,
      text: e.querySelector('.dia-composer-chip__main').getBoundingClientRect().width,
      height: e.closest('[data-composer-card]').getBoundingClientRect().height,
    }))
    assert.deepEqual(after, before, `${label} keeps text and composer geometry`)
    for (let i = 0; i < 4; i++) {
      await mainButton.hover()
      await hold(65)
      await composer(flow()).hover()
      await hold(65)
    }
    await mainButton.focus()
    await page.keyboard.press('Tab')
    assert.equal(await action.evaluate((e) => document.activeElement === e), true)
    await composer(flow()).focus()
    await composer(flow()).hover()
    await hold(400)
    assert.equal(
      await action.evaluate((e) => getComputedStyle(e.parentElement.parentElement).visibility),
      'hidden',
    )
    measurements.push({ label, before, after, widths })
    timeline.at(-1).end = (Date.now() - recordingStart) / 1000
  }
  try {
    await page.addInitScript((id) => {
      if (localStorage.getItem('dsh.sessions.current') === null)
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, id)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
    const welcome = page.getByRole('button', { name: '继续', exact: true })
    if (await welcome.isVisible()) await welcome.click()
    await body().waitFor({ state: 'visible' })
    await body().locator('p').first().scrollIntoViewIfNeeded()
    if (process.argv.includes('--marker-anchors-only')) {
      await anchorScenarios()
      return checks
    }
    const beforeModel = (await request('inspect')).modelRequests
    for (const text of ['独立注解一', '独立注解二', '独立注解三', '', '', '']) await addNote(text)
    for (let index = 0; index < 3; index++) await collectNativeSource()
    await openSide(id)
    await composer(flow()).waitFor()
    await body().locator('p').first().scrollIntoViewIfNeeded()
    assert.equal(await markers().count(), 9)
    assert.equal(await root().locator('[data-reference-id]').count(), 3)
    await layout('nine-independent-same-selection')
    await screenshot('markers-independent-mixed')
    if (process.argv.includes('--marker-touch-only')) {
      await touchPreview()
      return checks
    }
    assert.equal((await request('inspect')).modelRequests, beforeModel)
    check(
      'same selection creates three notes, three saved quote records and three side references as nine independent bubbles',
    )
    for (const marker of await root().locator('[data-annotation-id].dia-marker').all()) {
      const annotationId = await marker.getAttribute('data-annotation-id')
      const text = await page.evaluate(
        ({ id, annotationId }) =>
          JSON.parse(localStorage.getItem(`dsh-annotation:v1:${id}`)).annotations.find(
            (item) => item.annotationId === annotationId,
          ).annotation,
        { id, annotationId },
      )
      await marker.hover()
      await marker.click()
      await page.locator('.dia-record-editor').waitFor()
      assert.equal(await page.locator('.dia-record-editor').getByRole('textbox').inputValue(), text)
      await page.keyboard.press('Escape')
      await page.locator('.dia-record-editor').waitFor({ state: 'hidden' })
    }
    const referenceId = await root().locator('[data-reference-id]').nth(1).getAttribute('data-reference-id')
    await root().locator(`[data-reference-id="${referenceId}"]`).click()
    const detail = page.locator('.dia-marker-popover')
    await detail.waitFor()
    assert.equal(
      await detail.locator('[data-dia-side-chat-reference]').getAttribute('data-dia-side-chat-reference'),
      referenceId,
    )
    await detail.getByRole('button', { name: '移除引用', exact: true }).click()
    await detail.waitFor({ state: 'hidden' })
    assert.equal(await markers().count(), 8)
    assert.equal(await root().locator(`[data-reference-id="${referenceId}"]`).count(), 0)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await body().waitFor({ state: 'visible' })
    await body().locator('p').first().scrollIntoViewIfNeeded()
    await openSide(id)
    await page.waitForFunction(
      ({ id, count }) =>
        document
          .querySelector(`[data-dsh-annotation-message-id="${id}:assistant"]`)
          ?.querySelectorAll('.dia-marker').length === count,
      { id, count: 8 },
    )
    await layout('reload-preserves-record-identities')
    check('each bubble opens its own record; reference deletion removes only that id and survives reload')
    const noteIds = await root()
      .locator('.dia-marker[data-annotation-id]')
      .evaluateAll((items) => items.map((item) => item.dataset.annotationId))
    await root().locator(`[data-annotation-id="${noteIds[0]}"]`).click()
    const edit = page.locator('.dia-record-editor--detail')
    await edit.getByRole('textbox').fill('独立注解一的精确编辑')
    await edit.getByRole('button', { name: '保存', exact: true }).click()
    await edit.getByRole('textbox').filter({ visible: true }).waitFor()
    assert.equal(await edit.getByRole('textbox').inputValue(), '独立注解一的精确编辑')
    await page.waitForFunction(() => document.querySelector('.dia-record-editor--detail textarea')?.readOnly)
    await page.keyboard.press('Escape')
    await edit.waitFor({ state: 'hidden' })
    await root().locator(`[data-annotation-id="${noteIds[1]}"]`).click()
    await edit.getByRole('button', { name: '删除', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    assert.equal(await root().locator(`[data-annotation-id="${noteIds[1]}"]`).count(), 0)
    const remainingIds = await root()
      .locator('.dia-marker[data-annotation-id]')
      .evaluateAll((items) => items.map((item) => item.dataset.annotationId))
    assert.deepEqual(
      remainingIds,
      noteIds.filter((value) => value !== noteIds[1]),
    )
    await addNote('删除后新保存的独立记录')
    check(
      'each annotation editor binds its own saved text; editing preserves its id and deletion removes only its bubble',
    )
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForFunction(
        (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
        theme === 'dark',
      )
      await composer(main()).fill('按钮对照草稿，不发送')
      const toolbar = await selectText(body(), exact)
      await toolbar.getByRole('button', { name: '添加注解', exact: true }).click()
      for (const [label, text] of [
        ['single', '单行确认按钮'],
        ['multiline', '第一行\n第二行\n第三行'],
      ]) {
        await editor().getByRole('textbox').fill(text)
        const confirm = editor().getByRole('button', { name: '保存', exact: true })
        const send = main().locator('[data-composer-card] button[aria-busy]').last()
        const css = (e) => {
          const s = getComputedStyle(e)
          const r = e.getBoundingClientRect()
          return {
            width: r.width,
            height: r.height,
            background: s.backgroundColor,
            color: s.color,
            radius: s.borderRadius,
            svg: e.querySelector('svg').getBoundingClientRect().width,
          }
        }
        const settle = (button) =>
          button.evaluate(async (element) => {
            element.getBoundingClientRect()
            await Promise.all(element.getAnimations().map((animation) => animation.finished))
          })
        await Promise.all([settle(confirm), settle(send)])
        const [a, b] = await Promise.all([confirm.evaluate(css), send.evaluate(css)])
        assert.deepEqual(a, b)
        await send.hover()
        await settle(send)
        const sendHover = await send.evaluate(css)
        await confirm.hover()
        await settle(confirm)
        assert.deepEqual(await confirm.evaluate(css), sendHover)
        await page.mouse.down()
        assert.deepEqual(await confirm.evaluate(css), sendHover)
        await page.mouse.move(10, 10)
        await page.mouse.up()
        await editor().getByRole('textbox').focus()
        await page.keyboard.press('Tab')
        assert.equal(await confirm.evaluate((e) => document.activeElement === e), true)
        assert.equal(await confirm.evaluate((e) => e.matches(':focus-visible')), true)
        measurements.push({ theme, label, confirm: a, send: b })
        await screenshot(`confirm-send-${theme}-${label}`)
      }
      await page.keyboard.press('Escape')
      await editor().waitFor({ state: 'hidden' })
    }
    check(
      'real quick confirmation and main send button match blue/white computed colors, circle and icon dimensions in both themes and line layouts',
    )
    const longToolbar = await selectText(body(), long)
    await longToolbar.getByRole('button', { name: '添加注解', exact: true }).click()
    await editor().waitFor()
    const confirmLong = editor().getByRole('button', { name: '保存', exact: true })
    assert.equal(await confirmLong.isDisabled(), true)
    assert.equal(await confirmLong.evaluate((e) => getComputedStyle(e).opacity), '0.4')
    await screenshot('confirm-disabled-long-selection')
    await page.keyboard.press('Escape')
    await editor().waitFor({ state: 'hidden' })
    const waitingToolbar = await selectText(body(), exact)
    await waitingToolbar.getByRole('button', { name: '添加注解', exact: true }).click()
    await editor().getByRole('textbox').fill('提交期间未保存的编辑保持独立')
    await request('hold-lifecycle', { kind: 'admission' })
    await main().locator('[data-composer-card] button[aria-busy]').last().click()
    await request('wait-lifecycle', { kind: 'admission' })
    await page.waitForFunction(
      () => document.querySelector('.dia-record-editor__check')?.getAttribute('aria-busy') === 'true',
    )
    assert.equal(await editor().getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
    assert.equal(
      await editor()
        .getByRole('button', { name: '保存', exact: true })
        .evaluate((e) => getComputedStyle(e).opacity),
      '1',
    )
    await screenshot('confirm-processing-official-command')
    await request('release-lifecycle', { kind: 'admission' })
    await page.waitForFunction(
      () => document.querySelector('.dia-record-editor__check')?.getAttribute('aria-busy') === 'false',
    )
    await page.keyboard.press('Escape')
    await editor().waitFor({ state: 'hidden' })
    check(
      'long-selection disable and processing states use the real editor and held official command admission',
    )
    await settingsFont(10)
    await layout('font-10')
    await screenshot('markers-font-small')
    await settingsFont(22)
    const large = await layout('font-22')
    assert.ok(large.markers.some((e) => e.surface.height > 20))
    await screenshot('markers-font-large')
    await settingsFont(14)
    await layout('font-14')
    check('official font settings update measured bubble font, hit area and avoidance without reload')
    const handle = await page.locator('[data-side="rightbar"]').first().boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(1140, handle.y + handle.height / 2)
    await page.mouse.up()
    await composer(flow()).fill('标签动画测试')
    await flow().locator('[data-composer-card] button[aria-busy]').last().click()
    const answer = flow()
      .locator('.dia-assistant__body')
      .filter({ hasText: 'This answer stays selectable.' })
      .last()
    await answer.waitFor()
    await addNote('侧边注解标签', 'This answer stays selectable.', answer)
    for (const size of [10, 22, 14]) {
      await settingsFont(size)
      const ownFont = await answer
        .locator('p')
        .last()
        .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))
      const bubble = flow().locator('.dia-marker[data-annotation-id]').last()
      await page.waitForFunction(
        ({ id, expected }) => {
          const e = document.querySelector(
            `[data-dia-side-chat][data-main-session="${id}"] .dia-marker[data-annotation-id]`,
          )
          return e && Math.abs(Number.parseFloat(getComputedStyle(e).fontSize) - expected) < 0.01
        },
        { id, expected: ownFont * 0.8 },
      )
      assert.ok(
        Math.abs(
          (await bubble.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))) - ownFont * 0.8,
        ) < 0.01,
      )
    }
    check('side reply bubbles follow their own actual content font through live application font changes')
    const sideToolbar = await selectText(answer, 'This answer stays selectable.')
    await sideToolbar.getByRole('button', { name: '添加注解', exact: true }).click()
    await editor().getByRole('textbox').fill('侧边弹窗确认按钮对照')
    const sideConfirm = editor().getByRole('button', { name: '保存', exact: true })
    const sideSend = flow().locator('[data-composer-card] button[aria-busy]').last()
    const buttonStyle = (element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        color: style.color,
        width: element.offsetWidth,
        height: element.offsetHeight,
        icon: element.querySelector('svg').getBoundingClientRect().width,
      }
    }
    assert.deepEqual(await sideConfirm.evaluate(buttonStyle), await sideSend.evaluate(buttonStyle))
    await screenshot('confirm-send-side-conversation')
    await page.keyboard.press('Escape')
    await editor().waitFor({ state: 'hidden' })
    check('side Conversation uses the same real quick-confirm blue circle and white icon treatment')
    await collect(id, exact)
    await screenshot('marker-narrow-sidebar-chips')
    await animateChip(
      flow()
        .locator('.dia-composer-chip')
        .filter({ has: page.locator('[data-dia-side-chat-chip-main]') }),
      'reference-chip',
    )
    await animateChip(flow().locator('[data-dia-annotation-chip]'), 'annotation-chip')
    await page.emulateMedia({ colorScheme: 'light' })
    await animateChip(flow().locator('[data-dia-annotation-chip]'), 'annotation-chip-light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await screenshot('marker-chips-keyboard')
    check(
      'narrow real composer has smooth reversible chip width, stable text and height, continuous pointer target and keyboard action access',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await flow().locator('[data-dia-annotation-chip] .dia-composer-chip__main').focus()
    assert.ok(
      await flow()
        .locator('[data-dia-annotation-chip] .dia-composer-chip__actions')
        .evaluate((e) =>
          getComputedStyle(e)
            .transitionDuration.split(',')
            .every((value) => value.trim() === '0s'),
        ),
    )
    check('reduced motion keeps the same visible keyboard actions')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(await main().locator('[data-dia-side-chat-chip-row]').count(), 0)
    check('source bubbles preserve main and side input isolation')
    for (const [suffix, paragraph] of [
      ['第一处。', '第一处。'],
      ['第二处。', '第二处。'],
    ])
      await addNote(`同文字的${suffix}`, repeated, body().locator('p').filter({ hasText: paragraph }))
    await addNote('重叠范围一', '同一选区保留每条')
    await addNote('重叠范围二', '保留每条独立记录')
    await layout('adjacent-overlapping-and-identical-text-positions')
    const positions = await page.evaluate((id) => {
      const raw = JSON.parse(localStorage.getItem(`dsh-annotation:v1:${id}`))
      return raw?.annotations ?? []
    }, id)
    const sameText = positions.filter((item) => item.annotation.startsWith('同文字的'))
    assert.equal(sameText.length, 2)
    assert.equal(sameText[0].quote.exact, sameText[1].quote.exact)
    assert.notEqual(sameText[0].quote.start, sameText[1].quote.start)
    measurements.push({ label: 'same-text-position-records', positions })
    const beforeCancel = await markers().count()
    for (let i = 0; i < 2; i++) {
      const bar = await selectText(body(), exact)
      await bar.getByRole('button', { name: '添加注解', exact: true }).click()
      await editor().waitFor()
      await page.keyboard.press('Escape')
      await editor().waitFor({ state: 'hidden' })
    }
    assert.equal(await markers().count(), beforeCancel)
    check(
      'adjacent, overlapping and separate identical-text positions stay independent; unconfirmed repeated selection creates no record',
    )
    while ((await root().locator('.dia-marker[data-annotation-id]').count()) < 100) {
      const number = (await root().locator('.dia-marker[data-annotation-id]').count()) + 1
      await addNote(`实际保存记录 ${number}`, exact, body(), true)
      if (number % 10 === 0) console.log(`PASS marker: saved independent record ${number}`)
    }
    for (const size of [10, 14, 22]) {
      await settingsFont(size)
      await layout(`one-two-three-digit-font-${size}`)
      for (const number of ['1', '10', '100']) {
        const bubble = root()
          .locator('.dia-marker[data-annotation-id]')
          .filter({ hasText: new RegExp(`^${number}$`) })
          .first()
        assert.ok((await bubble.count()) > 0)
        const dimensions = await bubble.evaluate((e) => ({
          width: e.clientWidth,
          scroll: e.scrollWidth,
          height: e.getBoundingClientRect().height,
        }))
        assert.ok(dimensions.scroll <= dimensions.width)
        assert.ok(dimensions.height >= 24)
      }
    }
    const hundred = root().locator('.dia-marker[data-annotation-id]').filter({ hasText: /^100$/ }).first()
    await hundred.scrollIntoViewIfNeeded()
    await hundred.focus()
    await screenshot('markers-one-two-three-digits')
    await settingsFont(14)
    for (const zoom of ['80%', '125%']) {
      await page.locator('body').evaluate((e, zoom) => {
        e.style.zoom = zoom
      }, zoom)
      await layout(`browser-zoom-${zoom}`)
    }
    await page.locator('body').evaluate((e) => {
      e.style.zoom = ''
    })
    check(
      '100 records saved through the real editor keep one, two and three-digit labels readable through font changes and CSS zoom',
    )
    await touchPreview()
    await writeFile(
      join(artifacts, 'marker-ui-results.json'),
      `${JSON.stringify({ checks, measurements, timeline, recording: { transport: 'official DSH web profile', model: 'deterministic provider fixture', realApi: false, source: videoDir } }, null, 2)}\n`,
    )
  } catch (error) {
    await screenshot('marker-ui-failure')
    throw error
  } finally {
    await writeFile(
      join(artifacts, 'marker-browser-errors.json'),
      `${JSON.stringify(browserErrors, null, 2)}\n`,
    )
    await context.close()
    await video.saveAs(join(artifacts, 'marker-ui.webm'))
  }
  return checks
}
