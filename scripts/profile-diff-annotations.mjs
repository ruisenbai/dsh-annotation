/** Real Git → built Diff UI → official composer → model input → original-version history. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** Exercise the plugin-owned entry point without modifying Host or sidebar source. */
export async function exerciseDiffAnnotations(
  page,
  { request, workspace, artifacts, openAnnotationSettings, selectReadingSource },
) {
  const git = (...args) =>
    promisify(execFile)(
      'git',
      [
        '-c',
        'user.name=Annotation Browser',
        '-c',
        'user.email=annotation@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { cwd: workspace },
    )
  const tail =
    Array.from({ length: 40 }, (_, index) => `// context line ${index + 1}`).join('\n') +
    `\nconst longLine = "${'x'.repeat(320)}";\n`
  const base = `export function total(value: number) {\n  const result = value + 1;\n  return result;\n}\n\n${tail}`
  const staged = base.replace('value + 1', 'value + 2')
  const working = base.replace(
    '  const result = value + 1;',
    '  const result = value + 3;\n  const reason = "check boundary";',
  )
  await git('init', '-q')
  await writeFile(join(workspace, 'review.ts'), base)
  await git('add', 'review.ts')
  await git('commit', '-qm', 'Diff browser base')
  await writeFile(join(workspace, 'review.ts'), staged)
  await git('add', 'review.ts')
  await writeFile(join(workspace, 'review.ts'), working)
  const { sessionId } = await request('diff-session')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const workspaceRow = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
  if ((await workspaceRow.getAttribute('aria-expanded')) !== 'true') await workspaceRow.click()
  const group = page.getByRole('treeitem', { name: /未分组/ }).first()
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await page.getByRole('treeitem', { name: /Diff browser review/ }).click()
  await page
    .locator('.dia-assistant__body')
    .getByText('Keep this sentence for a message annotation.', { exact: true })
    .waitFor()
  const settings = await openAnnotationSettings(page)
  const individual = settings.getByRole('switch', { name: '逐条选择要发送的注解', exact: true })
  if ((await individual.getAttribute('aria-checked')) !== 'true') {
    await individual.click()
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  }
  await page.keyboard.press('Escape')
  const readState = () =>
    page.evaluate((id) => JSON.parse(localStorage.getItem(`dsh-annotation:v1:${id}`)), sessionId)
  const save = async (note) => {
    const editor = page.locator('.dia-editor:visible')
    await editor.getByRole('textbox').fill(note)
    if (note === '请检查新增的两行代码。')
      await page.screenshot({ path: join(artifacts, 'diff-editor.png'), fullPage: true })
    await editor.getByRole('button', { name: '保存注解', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
  }
  await page.getByRole('button', { name: '代码 Diff 批注', exact: true }).click()
  const panel = page.locator('[data-annotation-diff]')
  await panel.getByRole('combobox', { name: '文件', exact: true }).selectOption('review.ts')
  const old = panel.getByRole('button', { name: '批注旧侧第 2 行', exact: true })
  await old.focus()
  await old.press('Enter')
  await save('请检查删除的旧实现。')
  const next = panel.getByRole('button', { name: '批注新侧第 2 行', exact: true })
  await next.click()
  await panel.locator('.dia-diff-quote').getByText('工作区 · 新侧 · 2–2', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '批注新侧第 3 行', exact: true }).press('Shift+Enter')
  await panel.locator('.dia-diff-quote').getByText('工作区 · 新侧 · 2–3', { exact: true }).waitFor()
  await save('请检查新增的两行代码。')
  await panel.getByRole('button', { name: '批注新侧第 4 行', exact: true }).click()
  await save('这一条保留草稿，不要发送。')
  assert.equal(await panel.locator('.dia-diff-markers button').count(), 3)
  assert.deepEqual((await readState()).selectedAnnotationIds, [], 'Diff saving must not select all drafts')
  await old.focus()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: join(artifacts, 'diff-working-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(artifacts, 'diff-working-dark.png'), fullPage: true })
  const grid = await panel.locator('.dia-diff-scroll').evaluate((element) => {
    const rows = [...element.querySelectorAll('.dia-diff-row[data-kind]')]
    return {
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      codeColumns: [...new Set(rows.map((row) => row.querySelector('code').getBoundingClientRect().left))],
      texts: rows.map((row) => row.querySelector('code').textContent),
      markerSelect: getComputedStyle(element.querySelector('.dia-diff-markers')).userSelect,
    }
  })
  assert.equal(grid.codeColumns.length, 1, 'Gutter alignment must not depend on line length')
  assert.ok(grid.scrollWidth > grid.width, 'Long lines must scroll horizontally')
  assert.equal(grid.markerSelect, 'none')
  assert.equal(
    grid.texts.some((text) => text.includes('\u200b')),
    false,
    'Blank lines must not add copy artifacts',
  )
  await panel.locator('.dia-diff-scroll').evaluate((element) => {
    element.scrollLeft = 180
  })
  assert.equal(
    await panel
      .locator('.dia-diff-markers button')
      .first()
      .evaluate((button) => {
        const marker = button.getBoundingClientRect()
        const clip = button.closest('.dia-diff-scroll').getBoundingClientRect()
        return marker.left >= clip.left && marker.right <= clip.right
      }),
    true,
    'Annotation markers must stay visible while code scrolls',
  )
  await page.screenshot({ path: join(artifacts, 'diff-horizontal-scroll.png'), fullPage: true })
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 720, height: 900 })
  assert.equal(await panel.locator('.dia-diff-plus').first().isVisible(), true)
  await page.screenshot({ path: join(artifacts, 'diff-narrow.png'), fullPage: true })
  await page.setViewportSize(viewport)

  await panel.getByRole('button', { name: '暂存区', exact: true }).click()
  await panel.getByRole('combobox', { name: '文件', exact: true }).selectOption('review.ts')
  await panel
    .locator('.dia-diff-row[data-kind="del"] code')
    .filter({ hasText: 'const result = value + 1;' })
    .waitFor()
  assert.match(await panel.locator('.dia-diff-row[data-kind="add"] code').innerText(), /value \+ 2/)
  await page.screenshot({ path: join(artifacts, 'diff-staged.png'), fullPage: true })
  await panel.getByRole('button', { name: '返回消息输入框', exact: true }).click()
  await selectReadingSource(page, 'Keep this sentence for a message annotation.')
  await page.getByRole('button', { name: '添加注解', exact: true }).click()
  await save('请说明这句文字。')
  const saved = await readState()
  const chosen = saved.annotations.filter((item) => item.annotation !== '这一条保留草稿，不要发送。')
  assert.equal(chosen.length, 3)
  for (const item of chosen)
    await page
      .getByRole('group', { name: '选择本次随消息发送的注解', exact: true })
      .getByRole('button', { name: `注解 ${item.ordinal}：暂不发送`, exact: true })
      .click()
  await page.getByRole('button', { name: '处理方式：逐条解答', exact: true }).click()
  await page.getByText('按批注修改', { exact: true }).click()
  const composer = page.locator('[data-composer-input]')
  await composer.click()
  await composer.press('End')
  await page.keyboard.insertText('只处理本次选中的批注，给出修改意见。')
  await composer.press('Enter')
  await page
    .locator('.dia-assistant__body')
    .getByText('Diff review completed for 3 selected annotations.', { exact: false })
    .waitFor()
  const durable = await request('read-session', { sessionId })
  const event = durable.events.find(
    (event) =>
      event.type === 'user/message' && event.data.source?.annotationSubmission?.protocolVersion === 3,
  )
  assert.ok(event, 'The real composer must persist its mixed annotation message')
  const payload = event.data.source.annotationSubmission
  assert.equal(payload.processingMode, 'modify')
  assert.equal(payload.annotations.length, 3)
  assert.deepEqual(
    payload.annotations.map((item) => item.ordinal),
    [1, 2, 3],
  )
  assert.equal(
    payload.annotations.some((item) => item.annotation === '这一条保留草稿，不要发送。'),
    false,
  )
  assert.equal(payload.annotations.filter((item) => item.source.kind === 'message').length, 1)
  const diffItems = payload.annotations.filter((item) => item.source.kind === 'diff')
  assert.equal(diffItems.length, 2)
  assert.deepEqual(
    diffItems.map((item) => [item.source.side, item.source.startLine, item.source.endLine]).sort(),
    [
      ['new', 2, 3],
      ['old', 2, 2],
    ],
  )
  assert.equal(
    diffItems.every((item) => !Object.hasOwn(item, 'messageId')),
    true,
  )
  await page.waitForFunction(
    ({ sessionId, ids }) => {
      const state = JSON.parse(localStorage.getItem(`dsh-annotation:v1:${sessionId}`))
      return ids.every((id) =>
        state?.annotations.some((item) => item.annotationId === id && item.status === 'processed'),
      )
    },
    { sessionId, ids: payload.annotations.map((item) => item.annotationId) },
  )
  await page.waitForFunction(() => document.querySelectorAll('.dia-reply-chip').length === 3)
  for (const item of payload.annotations) {
    const chip = page.locator(`.dia-reply-chip[aria-label^="注解 ${item.ordinal}："]`)
    assert.equal(await chip.count(), 1)
    assert.ok((await chip.getAttribute('aria-label')).includes(item.quote.exact))
  }
  // Pointer-transparent reply targets preserve text selection; the body delegates heading clicks.
  await page
    .locator('.dia-assistant__body')
    .getByText('注解 3：已处理 请检查新增的两行代码。', { exact: true })
    .click({ position: { x: 10, y: 10 } })
  await panel.getByText('原版本快照 · 工作区', { exact: true }).waitFor()
  assert.equal(
    await panel
      .getByRole('button', { name: '批注新侧第 2 行', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await panel.getByRole('button', { name: '返回消息输入框', exact: true }).click()
  const requests = await request('model-requests')
  assert.equal(JSON.stringify(requests).includes('这一条保留草稿，不要发送。'), false)
  const model = requests.flat().find((message) => message.id === event.data.id)
  assert.deepEqual(model, event.data, 'Model-visible content must equal the durable standard message')
  const modelText = model.content[0].text
  assert.match(modelText, /index -> working tree/)
  assert.match(modelText, /value \+ 2/)
  assert.match(modelText, /value \+ 3/)
  let normalized = modelText.replaceAll(payload.submissionId, '<submission>')
  for (const item of payload.annotations) {
    normalized = normalized.replaceAll(item.annotationId, `<annotation-${item.ordinal}>`)
    if (item.source.kind === 'message') {
      normalized = normalized
        .replaceAll(`Reply message: ${item.messageId}`, 'Reply message: <assistant-message>')
        .replaceAll(`Reply event seq: ${item.messageSeq}`, 'Reply event seq: <assistant-seq>')
    } else {
      const snap = item.source.snapshot
      normalized = normalized
        .replaceAll(JSON.stringify(snap.repository), '"<repository>"')
        .replaceAll(snap.head, '<head>')
        .replaceAll(snap.id, '<snapshot>')
    }
  }
  await writeFile(join(artifacts, 'diff-model-message.actual.txt'), normalized + '\n')
  const frozen = JSON.stringify(payload)
  await writeFile(join(workspace, 'review.ts'), `// inserted after annotations\n${working}`)
  await git('add', 'review.ts')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const card = page.locator('.dia-user-submission')
  await card.locator('.dia-timeline > summary').click()
  const item = card.locator('.dia-timeline-item').filter({ hasText: '请检查新增的两行代码。' })
  await item.getByRole('button', { name: '定位原文', exact: true }).click()
  await panel.getByText('原版本快照 · 工作区', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '批注新侧第 2 行', exact: true }).waitFor()
  assert.equal(
    await panel
      .getByRole('button', { name: '批注新侧第 2 行', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  assert.match(
    await panel.locator('[data-new-line="2"]').locator('..').locator('code').innerText(),
    /value \+ 3/,
  )
  await panel.getByRole('button', { name: '检查当前位置', exact: true }).click()
  await panel.getByText('找到唯一候选：第 3 行。确认前不会改变原批注。', { exact: false }).waitFor()
  assert.equal(
    JSON.stringify(
      (await request('read-session', { sessionId })).events.find((entry) => entry.seq === event.seq).data
        .source.annotationSubmission,
    ),
    frozen,
  )
  await panel.getByRole('button', { name: '创建补充批注并绑定新位置', exact: true }).click()
  await save('明确绑定新位置的补充意见。')
  const rebound = (await readState()).annotations.find(
    (entry) => entry.annotation === '明确绑定新位置的补充意见。',
  )
  assert.equal(rebound.source.startLine, 3)
  assert.equal(rebound.supplementalTo, diffItems.find((entry) => entry.source.side === 'new').annotationId)
  assert.deepEqual(rebound.source.reboundFrom, diffItems.find((entry) => entry.source.side === 'new').source)
  await page.screenshot({ path: join(artifacts, 'diff-history-rebind.png'), fullPage: true })
  await writeFile(
    join(artifacts, 'diff-browser-report.json'),
    JSON.stringify(
      {
        sessionId,
        protocolVersion: payload.protocolVersion,
        selected: payload.annotations.map((entry) => ({
          ordinal: entry.ordinal,
          kind: entry.source.kind,
          quote: entry.quote.exact,
        })),
        originalSnapshotPreserved: true,
        explicitRebindLine: rebound.source.startLine,
        grid,
      },
      null,
      2,
    ) + '\n',
  )
  assert.equal(
    normalized + '\n',
    await readFile(
      new URL('../tests/profile-fixtures/diff-model-message.expected.txt', import.meta.url),
      'utf8',
    ),
  )
  console.log(
    'PASS real Git Diff keyboard/multiline/markers → selected mixed composer send → actual model/durable message → original history and explicit rebind',
  )
}
