/** Recorded transcript checks driven through the isolated official Web profile. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const switches = new Map([
  ['hideReasoning', '隐藏思考过程'],
  ['hideTools', '隐藏全部工具调用与结果'],
  ['hideToolRead', '隐藏 read / read_image'],
  ['hideToolGlob', '隐藏 glob'],
  ['hideToolGrep', '隐藏 grep'],
  ['hideToolBash', '隐藏 bash / pwsh'],
  ['hideToolEdit', '隐藏 edit'],
  ['hideToolWrite', '隐藏 write'],
  ['hideToolOther', '隐藏其他工具'],
  ['hideContext', '隐藏上下文'],
  ['hideCommandResults', '隐藏命令结果'],
  ['hideCompaction', '隐藏上下文压缩'],
  ['hideRetries', '隐藏重试'],
  ['hideErrors', '隐藏失败与 token 限制提示'],
  ['hideAttachments', '隐藏图片和文件'],
  ['hideAnnotationHistory', '隐藏已提交注解详情'],
  ['hideTurnDetails', '隐藏已完成回复的统计与操作栏'],
  ['hideOther', '隐藏其他详情'],
])

async function openCard(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '注解', exact: true }).click()
  const card = dialog.locator('.dia-plugin-card')
  await card.waitFor()
  return card
}

function annotationPreferences(section) {
  return {
    enabled: section.value.enabled,
    autoAttach: section.value.autoAttach,
    compactSummary: section.value.compactSummary,
  }
}

function chatPreferences(section) {
  assert.ok(section, 'The official Host must expose its Chat settings')
  return { value: section.value, user: section.user }
}

/**
 * Assert saved filtering, restoration, and unchanged Session data through real controls.
 * @param page - browser page connected only to the isolated profile.
 * @param fixture - profile-owned IPC, replay, and navigation helpers.
 */
export async function exerciseTranscriptVisibility(page, fixture) {
  const { request, readReplay, openSession, assertRecordedSession, workspace, artifacts, settingsPath } =
    fixture
  const bindings = new Map([
    ['{{session:1}}', 'annotation-transcript-visibility'],
    ['{{cwd}}', workspace],
    ...Array.from({ length: 10 }, (_, index) => [
      `{{message:${index + 1}}}`,
      `annotation-transcript-visibility-message-${index + 1}`,
    ]),
  ])
  const replay = await readReplay(
    new URL('../snapshots/web/transcript-visibility/', import.meta.url),
    bindings,
  )
  const assistants = replay.events.filter((event) => event.type === 'assistant/message')
  const bodies = assistants.flatMap((event) =>
    event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text),
  )
  const reasoning = assistants.flatMap((event) =>
    event.data.message.content.filter((block) => block.type === 'reasoning').map((block) => block.text),
  )
  const calls = replay.events.filter((event) => event.type === 'tool/call')
  const results = replay.events.filter((event) => event.type === 'tool/result')
  assert.equal(bodies.length, 4, 'Three process bodies and the final body must be recorded')
  assert.equal(reasoning.length, 3)
  assert.deepEqual(
    calls.map((event) => event.data.name),
    ['read', 'glob', 'read', 'glob', 'glob'],
  )
  assert.equal(results.length, 5)
  assertRecordedSession(
    await request('seed-session', { header: replay.header, events: replay.events }),
    replay,
  )

  const initial = await request('inspect')
  const chatPreference = chatPreferences(initial.chatSettings)
  const annotationPreference = annotationPreferences(initial.settings)
  assert.equal(chatPreference.value.transcriptView, 'compact', 'The official default must be Compact')
  const expected = Object.fromEntries([...switches.keys()].map((field) => [field, false]))
  for (const field of switches.keys()) {
    assert.equal(initial.settings.value[field], false, `${field} defaults off in the Host schema`)
    assert.equal(Object.hasOwn(initial.settings.user ?? {}, field), false, `${field} has no seeded override`)
  }

  await openSession(page, workspace, bodies.at(-1))
  const chat = page.locator('[data-chat-flow]')
  const body = (text) => chat.locator('.dia-assistant__body').getByText(text, { exact: true })
  const summary = chat.locator('.dia-transcript-summary')
  const process = chat.locator('[data-turn-process="1"]')
  await process.waitFor({ state: 'visible' })
  assert.equal(await process.getAttribute('aria-expanded'), 'false')
  for (const text of bodies.slice(0, -1)) assert.equal(await body(text).isVisible(), false)
  await body(bodies.at(-1)).waitFor({ state: 'visible' })

  const defaultCard = await openCard(page)
  assert.equal(await defaultCard.getByRole('switch').count(), 3 + switches.size)
  const visibility = defaultCard.getByRole('region', { name: '会话记录显示', exact: true })
  assert.equal(await visibility.getByRole('switch').count(), switches.size)
  for (const label of switches.values()) {
    assert.equal(
      await visibility.getByRole('switch', { name: label, exact: true }).getAttribute('aria-checked'),
      'false',
    )
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await body(bodies.at(-1)).waitFor({ state: 'visible' })

  async function assertPreferences() {
    const state = await request('inspect')
    assert.deepEqual(
      chatPreferences(state.chatSettings),
      chatPreference,
      'Filtering must not save ui-chat preferences',
    )
    assert.deepEqual(
      annotationPreferences(state.settings),
      annotationPreference,
      'Transcript switches must preserve annotation settings',
    )
    for (const [field, enabled] of Object.entries(expected)) {
      assert.equal(state.settings.value[field], enabled, `Saved Host value for ${field}`)
    }
    assert.equal(state.modelRequests, initial.modelRequests, 'Reading a transcript must not call the model')
  }

  async function setFilters(changes) {
    const card = await openCard(page)
    for (const [field, enabled] of Object.entries(changes)) {
      const control = card.getByRole('switch', { name: switches.get(field), exact: true })
      assert.notEqual(
        await control.getAttribute('aria-checked'),
        String(enabled),
        `${field} must change in this step`,
      )
      await control.click()
      expected[field] = enabled
    }
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    await assertPreferences()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await body(bodies.at(-1)).waitFor({ state: 'visible' })
    await assertPreferences()
  }

  async function assertBodiesVisible() {
    for (const text of bodies) await body(text).waitFor({ state: 'visible' })
    assert.equal(await chat.locator('.dia-assistant__body').count(), bodies.length)
    assert.equal(await process.count(), 0, 'Effective Normal must remove the outer Compact disclosure')
  }

  async function assertCounts(labels) {
    await summary.waitFor({ state: 'visible' })
    assert.equal(await summary.count(), 1, 'One turn must render exactly one count summary')
    assert.deepEqual(await summary.locator('.dia-transcript-summary__count').allTextContents(), labels)
    assert.equal(await summary.getAttribute('role'), 'note')
    assert.equal(await summary.getAttribute('aria-expanded'), null)
    assert.equal(await summary.getAttribute('tabindex'), null)
    assert.equal(
      await summary
        .locator('button, summary, details, a, input, [role="button"], [aria-expanded], [tabindex]')
        .count(),
      0,
    )
  }

  async function assertHiddenDetailsAbsent() {
    assert.equal(
      await chat.locator('.dia-assistant__body [data-variant="think"]').count(),
      0,
      'Hidden reasoning must not be mounted',
    )
    assert.equal(
      await chat.locator('[data-chat-call-id]').count(),
      0,
      'Hidden tool renderers must not be mounted',
    )
    assert.doesNotMatch(
      await chat.textContent(),
      /PRIVATE_REASONING_|PRIVATE_TOOL_RESULT_|visibility-private-/u,
    )
  }

  await setFilters({ hideReasoning: true, hideToolRead: true, hideToolGlob: true })
  await assertBodiesVisible()
  const labels = ['think x 3', '读取 x 2', 'Glob x 3']
  await assertCounts(labels)
  await assertHiddenDetailsAbsent()
  const hiddenToolRows = chat.locator('[data-chat-flow-kind="tool-call"]')
  assert.equal(await hiddenToolRows.count(), 5)
  assert.deepEqual(
    await hiddenToolRows.evaluateAll((rows) => rows.map((row) => getComputedStyle(row).display)),
    Array.from({ length: 5 }, () => 'none'),
    'Fully hidden tool rows must not reserve flow gaps',
  )
  const disk = await readFile(settingsPath, 'utf8')
  assert.match(disk, /dsh-annotation:[\s\S]*hideReasoning: true/u)
  assert.match(disk, /dsh-annotation:[\s\S]*hideToolRead: true/u)
  assert.match(disk, /dsh-annotation:[\s\S]*hideToolGlob: true/u)
  const output = `# Assistant bodies\n${(await chat.locator('.dia-assistant__body').allTextContents()).join('\n')}\n\n# Hidden activity counts\n${(await summary.locator('.dia-transcript-summary__count').allTextContents()).join('\n')}\n`
  assert.equal(
    output,
    await readFile(
      new URL('../tests/profile-fixtures/transcript-visibility.expected.txt', import.meta.url),
      'utf8',
    ),
  )
  await page.screenshot({ path: join(artifacts, 'transcript-visibility-profile-hidden.png'), fullPage: true })

  await summary.click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  for (const key of ['Enter', ' ']) await summary.dispatchEvent('keydown', { key, bubbles: true })
  await chat.locator('[data-chat-flow-key]').evaluateAll((rows) => {
    for (const row of rows) row.dispatchEvent(new Event('beforematch', { bubbles: true }))
  })
  await assertBodiesVisible()
  await assertCounts(labels)
  await assertHiddenDetailsAbsent()

  const reloadedCard = await openCard(page)
  for (const [field, label] of switches) {
    assert.equal(
      await reloadedCard.getByRole('switch', { name: label, exact: true }).getAttribute('aria-checked'),
      String(expected[field]),
    )
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await body(bodies.at(-1)).waitFor({ state: 'visible' })
  await assertHiddenDetailsAbsent()
  console.log(
    'PASS recorded multi-step transcript keeps every body and one non-expandable count summary after save/reload',
  )

  await setFilters({ hideReasoning: false })
  await assertBodiesVisible()
  await assertCounts(['读取 x 2', 'Glob x 3'])
  assert.equal(await chat.locator('[data-chat-call-id]').count(), 0)
  const reasoningRows = chat.locator('.dia-assistant__body [data-variant="think"]')
  assert.equal(
    await reasoningRows.count(),
    3,
    'Disabling hideReasoning restores the original reasoning renderer',
  )
  await reasoningRows.first().locator('[data-disclosure-row][role="button"]').click()
  assert.equal(await reasoningRows.first().getAttribute('data-expanded'), 'true')
  await reasoningRows.first().getByText(reasoning[0], { exact: true }).waitFor({ state: 'visible' })

  await setFilters({ hideReasoning: true, hideToolRead: false, hideToolGlob: false })
  await assertBodiesVisible()
  await assertCounts(['think x 3'])
  assert.equal(await chat.locator('.dia-assistant__body [data-variant="think"]').count(), 0)
  const toolRows = chat.locator('[data-chat-call-id]')
  assert.equal(
    await toolRows.count(),
    5,
    'Disabling the read and glob filters restores every official tool renderer',
  )
  const firstTool = chat.locator(`[data-chat-call-id="${calls[0].data.callId}"]`)
  await firstTool.locator('[aria-expanded]').first().click()
  await firstTool
    .getByText(results[0].data.message.content[0].content[0].text, { exact: true })
    .waitFor({ state: 'visible' })
  console.log(
    'PASS reasoning and tools restore independently without changing the official Compact preference',
  )

  await setFilters({ hideReasoning: false, hideOther: true })
  await assertBodiesVisible()
  assert.equal(await chat.locator('.dia-assistant__body [data-variant="think"]').count(), 3)
  assert.equal(await chat.locator('[data-chat-call-id]').count(), 5)
  console.log(
    'PASS a non-reasoning filter alone keeps all intermediate bodies visible in effective Normal mode',
  )

  await setFilters({ hideOther: false })
  await process.waitFor({ state: 'visible' })
  assert.equal(await process.getAttribute('aria-expanded'), 'false')
  assert.equal(await summary.count(), 0)
  for (const text of bodies.slice(0, -1)) assert.equal(await body(text).isVisible(), false)
  await process.click()
  for (const text of bodies) await body(text).waitFor({ state: 'visible' })
  assert.equal(await chat.locator('.dia-assistant__body [data-variant="think"]').count(), 3)
  assert.equal(await chat.locator('[data-chat-call-id]').count(), 5)
  await assertPreferences()
  assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
  console.log(
    'PASS all filters off restores official Compact disclosure and the recorded Session remains unchanged',
  )
}
