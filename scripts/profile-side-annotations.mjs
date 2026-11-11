/** Current side-annotation workflow through the built plugin and official Conversation components. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * Exercise source routing, independent drafts, one annotation composer, reload and model admission.
 * @param context - Isolated profile, browser and observation helpers owned by the caller.
 */
export async function exerciseSideAnnotations(context) {
  const {
    page,
    request,
    scenario,
    artifacts,
    mainBody,
    mainFlow,
    openMain,
    openSide,
    selectText,
    composer,
    association,
    assertComposerAtBottom,
    evidence,
  } = context
  const readNotes = (id) =>
    page.evaluate((sessionId) => JSON.parse(localStorage.getItem(`dsh-annotation:v1:${sessionId}`)), id)
  const flow = (id) => page.locator(`[data-conversation-content][data-conversation-session="${id}"]:visible`)
  const editor = () => page.locator('.dia-record-editor:visible[role="dialog"]')
  const side = page.locator('[data-dia-side-chat]:visible')
  const tab = (id) => page.locator(`[data-dockkit-tab="annotation-side-tab:${id}"]`)
  const assertCleanConversation = async (content) => {
    assert.equal(
      await content
        .locator('[data-dia-side-chat-identity], [data-dia-side-chat-back], [data-dia-side-chat-blank-back]')
        .count(),
      0,
    )
    assert.equal(await content.getByRole('button', { name: /返回(?:关联的)?主会话/ }).count(), 0)
  }
  const editorGeometry = async (label, sourceSessionId) => {
    await editor().waitFor({ state: 'visible' })
    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await Promise.allSettled(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
          )
          .map((animation) => animation.finished),
      )
    })
    const geometry = await editor().evaluate((element, sourceSessionId) => {
      const rect = element.getBoundingClientRect()
      const receiver = Array.from(document.querySelectorAll('[data-conversation-content]')).find(
        (node) =>
          node.dataset.conversationSession === (sourceSessionId ?? element.dataset.diaAnnotationTarget) &&
          node.checkVisibility({ visibilityProperty: true }) &&
          !node.closest('[hidden], [inert], [aria-hidden="true"]'),
      )
      const parent = receiver.getBoundingClientRect()
      const composer = receiver.querySelector('[data-composer-card]').getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        parentLeft: parent.left,
        parentRight: parent.right,
        composerTop: composer.top,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        controlsVisible: Array.from(element.querySelectorAll('textarea, button')).every((control) => {
          const bounds = control.getBoundingClientRect()
          const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          return (
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            bounds.top >= 0 &&
            bounds.bottom <= innerHeight &&
            target !== null &&
            control.contains(target)
          )
        }),
      }
    }, sourceSessionId)
    assert.ok(
      geometry.left >= geometry.parentLeft - 1 && geometry.right <= geometry.parentRight + 1,
      JSON.stringify(geometry),
    )
    assert.ok(geometry.bottom <= geometry.composerTop + 1, JSON.stringify(geometry))
    assert.ok(
      geometry.scrollWidth <= geometry.clientWidth + 1 && geometry.controlsVisible,
      JSON.stringify(geometry),
    )
    assert.notEqual(await editor().getAttribute('data-floating-placement'), 'inline')
    if (label) await page.screenshot({ path: join(artifacts, `${label}.png`), fullPage: true })
    return geometry
  }
  const quickAppearance = async (label, sourceSessionId) => {
    await editorGeometry(label, sourceSessionId)
    assert.equal(await editor().locator('.dia-record-editor__source, q').count(), 0)
    assert.equal(await editor().getByRole('button').count(), 1)
    assert.equal(await editor().getByRole('button', { name: '取消', exact: true }).count(), 0)
    const appearance = await editor().evaluate((element) => {
      const button = element.querySelector('.dia-record-editor__check')
      const field = element.querySelector('textarea')
      const cardStyle = getComputedStyle(element),
        buttonStyle = getComputedStyle(button)
      const buttonRect = button.getBoundingClientRect(),
        fieldRect = field.getBoundingClientRect()
      return {
        radius: cardStyle.borderTopLeftRadius,
        padding: cardStyle.padding,
        fieldFont: getComputedStyle(field).font,
        fieldHeight: fieldRect.height,
        buttonWidth: buttonRect.width,
        buttonHeight: buttonRect.height,
        buttonRadius: buttonStyle.borderRadius,
        focused: document.activeElement === field,
      }
    })
    assert.equal(appearance.radius, '999px')
    assert.equal(appearance.buttonWidth, appearance.buttonHeight)
    assert.equal(appearance.focused, true)
    return appearance
  }
  const assertSourcePosition = async (exact) => {
    const endpoint = await mainBody(scenario.mainSessionId).evaluate((body, exact) => {
      const start = body.textContent.indexOf(exact)
      if (start < 0) throw new Error('Annotation source text is missing')
      let offset = start + exact.length - 1
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (offset >= node.textContent.length) {
          offset -= node.textContent.length
          continue
        }
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { bottom: rect.bottom }
      }
      throw new Error('Annotation source endpoint is missing')
    }, exact)
    const bounds = await editor().boundingBox()
    assert.equal(await editor().getAttribute('data-floating-placement'), 'bottom')
    assert.ok(Math.abs(bounds.y - endpoint.bottom - 10) <= 2, JSON.stringify({ bounds, endpoint }))
  }
  let mainAppearance
  const save = async () => {
    await editor().getByRole('button', { name: '保存', exact: true }).click()
    await editor().waitFor({ state: 'hidden' })
  }
  const annotate = async (exact, opinion) => {
    const toolbar = await selectText(mainBody(scenario.mainSessionId), exact)
    assert.equal(await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).count(), 0)
    await toolbar.getByRole('button', { name: '在侧边添加注解', exact: true }).click()
    await editor().waitFor({ state: 'visible' })
    assert.equal(await editor().count(), 1)
    assert.deepEqual(await quickAppearance(undefined, scenario.mainSessionId), mainAppearance)
    if (exact !== scenario.longReference) await assertSourcePosition(exact)
    if (exact === scenario.references[0]) {
      const scrollport = await mainBody(scenario.mainSessionId).evaluateHandle((body) => {
        for (let node = body.parentElement; node !== null; node = node.parentElement) {
          if (
            /auto|scroll|overlay/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight
          )
            return node
        }
        throw new Error('Source scrollport is missing')
      })
      const before = await editor().boundingBox()
      const target = await editor().getAttribute('data-dia-annotation-target')
      const movement = await scrollport.evaluate((node) => {
        const top = node.scrollTop
        // Scroll away from the nearest edge so the fixture works at either end of the transcript.
        node.scrollTop = top >= 24 ? top - 24 : top + 24
        return { originalScroll: top, delta: top - node.scrollTop }
      })
      assert.notEqual(movement.delta, 0, JSON.stringify(movement))
      await page.waitForFunction(
        ({ target, top }) => {
          const card = document.querySelector(`.dia-record-editor[data-dia-annotation-target="${target}"]`)
          return card !== null && Math.abs(card.getBoundingClientRect().top - top) <= 2
        },
        { target, top: before.y + movement.delta },
      )
      await assertSourcePosition(exact)
      await editorGeometry('source-new-editor-scrolled', scenario.mainSessionId)
      await scrollport.evaluate((node, top) => {
        node.scrollTop = top
      }, movement.originalScroll)
      await page.waitForFunction(
        ({ target, top }) => {
          const card = document.querySelector(`.dia-record-editor[data-dia-annotation-target="${target}"]`)
          return card !== null && Math.abs(card.getBoundingClientRect().top - top) <= 2
        },
        { target, top: before.y },
      )
      await scrollport.dispose()
      await editorGeometry('source-new-editor', scenario.mainSessionId)
    }
    if (opinion !== undefined) {
      await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill(opinion)
      await save()
    }
    return association(scenario.mainSessionId)
  }
  const waitForNotes = (id, count) =>
    page.waitForFunction(
      ({ id, count }) =>
        JSON.parse(localStorage.getItem(`dsh-annotation:v1:${id}`))?.annotations.length === count,
      { id, count },
    )
  const sourceOpinions = ['解释 Alpha 的前提', '补充 Beta 的例子']

  await openMain(scenario.mainSessionId, scenario.source)
  const mainToolbar = await selectText(mainBody(scenario.mainSessionId), scenario.references[0])
  await mainToolbar.getByRole('button', { name: '添加注解', exact: true }).click()
  mainAppearance = await quickAppearance('main-compact-editor')
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).press('Escape')
  await editor().waitFor({ state: 'hidden' })
  await composer(mainFlow(scenario.mainSessionId)).fill(scenario.mainDraft)
  await mainFlow(scenario.mainSessionId)
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'main-attachment.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Keep the main attachment.'),
    })
  const first = await annotate(scenario.references[0], sourceOpinions[0])
  await waitForNotes(first.sideSessionId, 1)
  assert.equal((await request('inspect')).modelRequests, 0)
  assert.equal((await readNotes(first.sideSessionId)).annotations[0].source.sessionId, scenario.mainSessionId)
  assert.equal(await side.locator('[data-dia-side-chat-chip-main]').count(), 0)
  assert.equal(await flow(first.sideSessionId).locator('[data-dia-annotation-chip]').count(), 1)
  assert.equal((await readNotes(scenario.mainSessionId))?.annotations.length ?? 0, 0)
  assert.equal(await composer(mainFlow(scenario.mainSessionId)).innerText(), scenario.mainDraft)
  assert.ok(
    await mainFlow(scenario.mainSessionId).getByText('main-attachment.txt', { exact: true }).isVisible(),
  )

  await side.getByRole('button', { name: '新建侧边聊天', exact: true }).click()
  await side.locator('[data-conversation-content]:visible [contenteditable="true"]').waitFor()
  const blank = await association(scenario.mainSessionId)
  await assertCleanConversation(flow(blank.sideSessionId))
  assert.equal(
    await flow(blank.sideSessionId)
      .getByText(/^侧边聊天 \d+$/)
      .count(),
    0,
  )
  assert.equal(await side.getByRole('tab').count(), 2)
  await assertComposerAtBottom(flow(blank.sideSessionId), 'clean-new-side-chat')
  await page.screenshot({ path: join(artifacts, 'clean-new-side-chat.png'), fullPage: true })
  await side.locator('[data-dia-side-chat-open-alone]').click()
  await composer(flow(blank.sideSessionId)).waitFor({ state: 'visible' })
  for (const [width, theme] of [
    [1440, 'dark'],
    [390, 'light'],
  ]) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width, height: 960 })
    await page.waitForFunction(
      (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
      theme === 'dark',
    )
    await assertCleanConversation(flow(blank.sideSessionId))
    assert.equal(
      await flow(blank.sideSessionId)
        .getByText(/^侧边聊天 \d+$/)
        .count(),
      0,
    )
    const bounds = await composer(flow(blank.sideSessionId)).boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.screenshot({
      path: join(artifacts, `clean-new-standalone-${width}-${theme}.png`),
      animations: 'disabled',
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await openMain(scenario.mainSessionId, scenario.source)
  await openSide(scenario.mainSessionId)
  await tab(blank.sideChatId).click()
  const second = await annotate(scenario.references[1])
  assert.equal(second.sideChatId, blank.sideChatId)
  assert.notEqual(first.sideSessionId, second.sideSessionId)
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill(sourceOpinions[1])
  await tab(first.sideChatId).click()
  await editor().waitFor({ state: 'hidden' })
  assert.equal((await readNotes(first.sideSessionId)).annotations.length, 1)
  await tab(second.sideChatId).click()
  await editor().waitFor({ state: 'visible' })
  assert.equal(
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(),
    sourceOpinions[1],
  )
  await page.screenshot({ path: join(artifacts, 'side-source-active.png'), fullPage: true })
  await save()
  await waitForNotes(second.sideSessionId, 1)
  await tab(first.sideChatId).click()

  const firstNote = (await readNotes(first.sideSessionId)).annotations[0]
  const secondNote = (await readNotes(second.sideSessionId)).annotations[0]
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
  await page.locator('[data-rightbar-collapsed]:not([data-animating])').waitFor({ state: 'attached' })
  await mainBody(scenario.mainSessionId)
    .locator('..')
    .locator(`[data-annotation-id="${secondNote.annotationId}"]`)
    .click()
  await editor().waitFor({ state: 'visible' })
  await editorGeometry('source-bubble-draft-editor', scenario.mainSessionId)
  await assertSourcePosition(scenario.references[1])
  assert.equal(await side.getAttribute('data-side-session'), second.sideSessionId)
  assert.equal(
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(),
    sourceOpinions[1],
  )
  await editor().getByRole('button', { name: '取消', exact: true }).click()
  await tab(first.sideChatId).click()

  await annotate(scenario.longReference)
  await editor()
    .getByRole('textbox', { name: '你的注解', exact: true })
    .fill('这是一条尚未保存的长注解。'.repeat(20))
  const draft = await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue()
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 1440, height: 960 })
    const handle = await page.locator('[data-side="rightbar"]').boundingBox()
    assert.ok(handle)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(1140, handle.y + handle.height / 2)
    await page.mouse.up()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      await openSide(scenario.mainSessionId)
      await editor().waitFor({ state: 'visible' })
      await editor().getByRole('textbox', { name: '你的注解', exact: true }).focus()
      assert.equal(await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(), draft)
      await editorGeometry(
        `annotation-editor-${width}-${theme}`,
        width === 1440 ? scenario.mainSessionId : undefined,
      )
    }
  }
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill('')
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).press('Escape')
  await editor().waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await openSide(scenario.mainSessionId)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  await openSide(scenario.mainSessionId)
  await composer(flow(first.sideSessionId)).waitFor()
  assert.equal((await readNotes(first.sideSessionId)).annotations[0].annotationId, firstNote.annotationId)
  assert.equal((await readNotes(second.sideSessionId)).annotations[0].annotationId, secondNote.annotationId)
  const restoredMarker = mainBody(scenario.mainSessionId)
    .locator('..')
    .locator(`[data-annotation-id="${secondNote.annotationId}"]`)
  await restoredMarker.waitFor({ state: 'visible' })
  await restoredMarker.click()
  await editor().waitFor({ state: 'visible' })
  await editorGeometry('restored-source-bubble-editor', scenario.mainSessionId)
  await assertSourcePosition(scenario.references[1])
  assert.equal(await restoredMarker.getAttribute('data-active'), 'true')
  assert.equal(await restoredMarker.getAttribute('aria-expanded'), 'true')
  assert.equal(await restoredMarker.isDisabled(), true)
  const collapse = page.getByRole('button', { name: '收起右侧边栏', exact: true })
  await collapse.focus()
  await collapse.press('Enter')
  await side.waitFor({ state: 'hidden' })
  await restoredMarker.waitFor({ state: 'visible' })
  await page.waitForFunction((id) => {
    const marker = document.querySelector(`.dia-marker[data-annotation-id="${id}"]`)
    return marker && !marker.disabled && marker.getAttribute('aria-expanded') === 'false'
  }, secondNote.annotationId)
  await restoredMarker.click()
  await editor().waitFor({ state: 'visible' })
  assert.equal(await side.getAttribute('data-side-session'), second.sideSessionId)
  assert.equal(
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(),
    sourceOpinions[1],
  )
  await editor().getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await restoredMarker.getAttribute('aria-expanded'), 'false')
  assert.equal(await restoredMarker.isEnabled(), true)
  await tab(first.sideChatId).click()
  await flow(first.sideSessionId).getByRole('button', { name: '显示注解记录', exact: true }).click()
  await flow(first.sideSessionId).getByRole('button', { name: '定位原文', exact: true }).click()
  await mainFlow(scenario.mainSessionId).locator('.dia-quote-flash').first().waitFor({ state: 'visible' })
  await assertComposerAtBottom(flow(first.sideSessionId), 'side annotation input')

  await composer(flow(first.sideSessionId)).fill('请按注解说明。')
  await composer(flow(first.sideSessionId)).press('Enter')
  await flow(first.sideSessionId).getByText('Side note addressed.', { exact: false }).first().waitFor()
  const requests = await request('model-requests')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].sessionId, first.sideSessionId)
  const sent = requests[0].messages.findLast((message) => message.source?.annotationSubmission)
  assert.ok(sent)
  assert.equal(sent.source.sideChatSubmission, undefined)
  assert.equal(sent.source.annotationSubmission.sessionId, first.sideSessionId)
  assert.equal(sent.source.annotationSubmission.annotations[0].source.sessionId, scenario.mainSessionId)
  assert.equal(sent.source.annotationSubmission.annotations[0].annotation, sourceOpinions[0])
  assert.equal(sent.source.annotationSubmission.annotations.length, 1)
  const modelText = sent.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const stableText = modelText
    .replaceAll(sent.source.annotationSubmission.submissionId, '{{submission}}')
    .replaceAll(firstNote.annotationId, '{{annotation}}')
  const expected = await readFile(
    new URL('../tests/profile-fixtures/side-chat/annotation-model-message.expected.txt', import.meta.url),
    'utf8',
  )
  await writeFile(join(artifacts, 'annotation-model-message.actual.txt'), `${stableText}\n`)
  assert.equal(`${stableText}\n`, expected)
  const recorded = await request('read-session', { sessionId: first.sideSessionId })
  assert.ok(
    recorded.events.some(
      (event) =>
        event.type === 'user/message' &&
        event.data.source?.annotationSubmission?.annotations[0]?.source?.sessionId === scenario.mainSessionId,
    ),
  )
  await writeFile(join(artifacts, 'side-annotation-session.json'), `${JSON.stringify(recorded, null, 2)}\n`)

  const sentMarker = mainFlow(scenario.mainSessionId).locator(
    `.dia-marker[data-annotation-id="${firstNote.annotationId}"]`,
  )
  await sentMarker.click()
  await editor().waitFor({ state: 'visible' })
  await editorGeometry('source-bubble-sent-card', scenario.mainSessionId)
  await assertSourcePosition(scenario.references[0])
  assert.equal(await sentMarker.getAttribute('aria-expanded'), 'true')
  assert.equal(await sentMarker.isEnabled(), true)
  assert.equal(await editor().locator('textarea').getAttribute('readonly'), '')
  assert.equal((await editor().innerText()).includes('Submission ID'), false)
  assert.equal(await editor().locator('.dia-record-editor__source').count(), 0)
  assert.ok((await tab(first.sideChatId).innerText()).includes('侧边聊天 1'))
  await sentMarker.click()
  await editor().waitFor({ state: 'hidden' })
  assert.equal(await sentMarker.getAttribute('aria-expanded'), 'false')
  assert.ok((await flow(first.sideSessionId).locator('.dia-timeline').innerText()).includes('1 条注解'))

  const answer = flow(first.sideSessionId).locator('.dia-assistant__body').last()
  const toolbar = await selectText(answer, 'Side note addressed.')
  assert.equal(await toolbar.getByRole('button', { name: '在侧边添加注解', exact: true }).count(), 0)
  await toolbar.getByRole('button', { name: '添加注解', exact: true }).click()
  await editor().waitFor({ state: 'visible' })
  assert.deepEqual(await quickAppearance('side-local-compact-editor'), mainAppearance)
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill('请再举一个例子')
  await tab(second.sideChatId).click()
  await editor().waitFor({ state: 'hidden' })
  await composer(flow(second.sideSessionId)).click()
  await page.keyboard.press('Escape')
  await composer(flow(second.sideSessionId)).click()
  await tab(first.sideChatId).click()
  await editor().waitFor({ state: 'visible' })
  assert.equal(
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(),
    '请再举一个例子',
  )
  await save()
  await waitForNotes(first.sideSessionId, 2)
  assert.equal((await readNotes(second.sideSessionId)).annotations.length, 1)
  assert.equal((await readNotes(scenario.mainSessionId))?.annotations.length ?? 0, 0)
  await page.screenshot({ path: join(artifacts, 'side-annotations-complete.png'), fullPage: true })

  const localNote = (await readNotes(first.sideSessionId)).annotations.find(
    (note) => note.annotationId !== firstNote.annotationId,
  )
  assert.ok(localNote)
  await annotate(scenario.references[2], '核对同一侧边聊天的两种来源')
  const foreignDraft = (await readNotes(first.sideSessionId)).annotations.find(
    (note) => note.quote.exact === scenario.references[2],
  )
  assert.ok(foreignDraft)
  await page.locator(`[role="treeitem"][data-row-key="session:${first.sideSessionId}"]`).click()
  await composer(flow(first.sideSessionId)).waitFor({ state: 'visible' })
  await assertCleanConversation(flow(first.sideSessionId))
  const standaloneSource = flow(first.sideSessionId).locator('.dia-assistant__body').last()
  const standaloneToolbar = await selectText(standaloneSource, 'Side note addressed.')
  const standaloneSideAction = standaloneToolbar.getByRole('button', { name: '在侧边添加注解', exact: true })
  assert.equal(
    await standaloneSideAction.count(),
    1,
    'A former side chat opened as a main page keeps the sidebar annotation entry',
  )
  await page.screenshot({ path: join(artifacts, 'standalone-main-selection-entry.png'), fullPage: true })
  const originalAssociation = await association(scenario.mainSessionId)
  const ownNotesBefore = (await readNotes(first.sideSessionId)).annotations.length
  await standaloneSideAction.click()
  await editor().waitFor({ state: 'visible' })
  const receiving = await association(first.sideSessionId)
  assert.notEqual(receiving.sideSessionId, first.sideSessionId)
  assert.notEqual(receiving.sideSessionId, second.sideSessionId)
  assert.equal(await editor().getAttribute('data-dia-annotation-target'), receiving.sideSessionId)
  await editor()
    .getByRole('textbox', { name: '你的注解', exact: true })
    .fill('独立打开后继续在自己的侧栏添加注解')
  await save()
  await waitForNotes(receiving.sideSessionId, 1)
  const received = (await readNotes(receiving.sideSessionId)).annotations[0]
  assert.equal(received.source.sessionId, first.sideSessionId)
  assert.equal(received.quote.exact, 'Side note addressed.')
  assert.equal((await readNotes(first.sideSessionId)).annotations.length, ownNotesBefore)
  assert.deepEqual(await association(scenario.mainSessionId), originalAssociation)
  await page.screenshot({ path: join(artifacts, 'standalone-main-sidebar-annotation.png'), fullPage: true })
  await page
    .locator(
      `[data-sidebar-right-panel][data-sidebar-right-session="${first.sideSessionId}"] [data-sidebar-right-toggle]`,
    )
    .click()
  await flow(first.sideSessionId).waitFor({ state: 'visible' })
  await flow(first.sideSessionId)
    .locator(`.dia-marker[data-annotation-id="${localNote.annotationId}"]`)
    .click()
  const ownGeometry = await editorGeometry('standalone-local-annotation')
  await editor().getByRole('button', { name: '取消', exact: true }).click()
  const showRecords = flow(first.sideSessionId).getByRole('button', { name: '显示注解记录', exact: true })
  if (await showRecords.isVisible()) await showRecords.click()
  await flow(first.sideSessionId)
    .locator(`.dia-record-row[data-annotation-id="${foreignDraft.annotationId}"]`)
    .getByRole('button', { name: '编辑', exact: true })
    .click()
  const foreignGeometry = await editorGeometry('standalone-foreign-annotation')
  assert.equal(ownGeometry.width, foreignGeometry.width)
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 390, height: 960 })
    await editorGeometry(`standalone-annotation-390-${theme}`)
    for (const button of await editor().getByRole('button').all()) {
      const bounds = await button.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 960)
    }
  }
  await editor().getByRole('button', { name: '取消', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 960 })
  await openMain(scenario.mainSessionId, scenario.source)
  await openSide(scenario.mainSessionId)
  await tab(first.sideChatId).click()
  await annotate(scenario.nextReference, '')
  const highlight = (await readNotes(first.sideSessionId)).annotations.find(
    (note) => note.quote.exact === scenario.nextReference,
  )
  assert.equal(highlight.annotation, '')
  assert.equal(highlight.kind, 'highlight-only')
  const highlightRow = () =>
    flow(first.sideSessionId).locator(`.dia-record-row[data-annotation-id="${highlight.annotationId}"]`)
  const openRecords = async () => {
    const show = flow(first.sideSessionId).getByRole('button', { name: '显示注解记录', exact: true })
    if (await show.isVisible()) await show.click()
    const expand = flow(first.sideSessionId).getByRole('button', { name: '展开注解', exact: true })
    if (await expand.isVisible()) await expand.click()
    await highlightRow().waitFor({ state: 'visible' })
  }
  await openRecords()
  assert.equal(
    await highlightRow().locator('.dia-record-row__preview-anchor').innerText(),
    scenario.nextReference,
  )
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      await openSide(scenario.mainSessionId)
      await highlightRow().scrollIntoViewIfNeeded()
      await page.waitForFunction((id) => {
        const row = document.querySelector(`.dia-record-row[data-annotation-id="${id}"]`)
        const text = row?.querySelector('.dia-record-row__preview-anchor')
        const actions = row?.querySelector('.dia-record-row__actions')
        if (!text || !actions) return false
        return (
          Math.abs(
            text.getBoundingClientRect().width -
              (row.getBoundingClientRect().width -
                actions.getBoundingClientRect().width -
                Number.parseFloat(getComputedStyle(row).columnGap)),
          ) < 2 &&
          text.getBoundingClientRect().right <= actions.getBoundingClientRect().left &&
          Array.from(actions.querySelectorAll('button')).every((button) => {
            const rect = button.getBoundingClientRect()
            const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return rect.left >= 0 && rect.right <= innerWidth && target !== null && button.contains(target)
          })
        )
      }, highlight.annotationId)
      await page.screenshot({
        path: join(artifacts, `side-highlight-summary-${width}-${theme}.png`),
        fullPage: true,
      })
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  await openSide(scenario.mainSessionId)
  await tab(first.sideChatId).click()
  await openRecords()
  assert.equal(
    await highlightRow().locator('.dia-record-row__preview-anchor').innerText(),
    scenario.nextReference,
  )
  assert.equal(
    (await readNotes(first.sideSessionId)).annotations.find(
      (note) => note.annotationId === highlight.annotationId,
    ).annotation,
    '',
  )
  await highlightRow().getByRole('button', { name: '编辑', exact: true }).click()
  await editor().getByRole('textbox', { name: '你的注解', exact: true }).fill('补充后的注解文字')
  await save()
  assert.equal(
    await highlightRow().locator('.dia-record-row__preview-anchor').innerText(),
    '补充后的注解文字',
  )
  await highlightRow().getByRole('button', { name: '编辑', exact: true }).click()
  assert.equal(
    await editor().getByRole('textbox', { name: '你的注解', exact: true }).inputValue(),
    '补充后的注解文字',
  )
  await editor().getByRole('button', { name: '取消', exact: true }).click()
  evidence.checks.push({
    name: 'side annotations: captured target, synchronized source bubbles, sent-card toggle, readable titles, isolated drafts, recovery, matching compact editors, readable highlight-only summaries, model output and constrained themes',
    status: 'passed',
  })
  console.log(
    'PASS unified side annotations, independent targets, source navigation, reload, model/log output and 300px/390px layouts',
  )
}
