/** Built-package smoke through the installed official dsh web profile (no source imports). */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { exerciseLegacyDiffHistory } from './profile-legacy-diff.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(project, 'artifacts/browser')
const cliManifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
const cliManifest = JSON.parse(await readFile(cliManifestPath, 'utf8'))
const baseline = JSON.parse(await readFile(join(project, 'source-baseline.json'), 'utf8'))
assert.equal(cliManifest.version, baseline.version, 'This smoke targets the approved Harness release')
await access(join(project, 'lib/client.js'))
await access(join(project, 'lib/index.js'))
const root = await mkdtemp(join(tmpdir(), 'dsh-annotation-profile-'))
let child
let browser
let page
let completion
let output = ''
let forced = false
const pending = new Map()
let nextId = 0

/** Bound an observable event, not a delay used as a readiness guess. */
async function deadline(promise, label, ms = 90_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out\n${output}`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function request(action, payload) {
  const id = ++nextId
  const reply = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.send({ type: 'annotation-smoke', id, action, payload }, (error) => {
      if (error) reject(error)
    })
  })
  try {
    return await deadline(reply, `IPC ${action}`)
  } finally {
    pending.delete(id)
  }
}

/** Substitute only complete, explicitly declared identity tokens. */
function substituteIdentities(value, bindings) {
  if (typeof value === 'string') return bindings.has(value) ? bindings.get(value) : value
  if (Array.isArray(value)) return value.map((item) => substituteIdentities(item, bindings))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteIdentities(item, bindings)]),
    )
  }
  return value
}

async function readRecordedGeneration(directory, version) {
  const text = await readFile(new URL(`session.v${version}.jsonl`, directory), 'utf8')
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'Session fixture needs one trailing newline')
  return text
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line))
}

async function readRecordedReplay(directory, bindings) {
  const legacy = await readRecordedGeneration(directory, 3)
  const [{ type, ...header }, ...rows] = substituteIdentities(legacy, bindings)
  assert.equal(type, 'session')
  assert.equal(header.version, 3)
  assert.equal(header.createdAt, 0)
  assert.equal(rows.at(-2)?.type, 'turn/end', 'Recorded fixture must contain a closed turn')
  // The shipped Session constructor reuses a trailing resume marker instead of appending another one.
  assert.deepEqual(rows.at(-1), { type: 'session/end-seed', data: {} })
  const events = rows.map((event, seq) => {
    assert.equal(Object.hasOwn(event, 'seq'), false)
    assert.equal(Object.hasOwn(event, 'time'), false)
    return { ...event, seq, time: seq }
  })
  // These standalone recordings have no child Sessions; the catalog requires explicit child evidence.
  const restore = createSessionFormatCatalogWithChildren([]).createRestore(
    { type, ...header },
    { recovery: 'strict', validation: 'current' },
  )
  for (const event of events) restore.decodeRow(event)
  const current = restore.finish()
  assert.equal(current.header.version, 4)
  const replay = {
    recorded: await readRecordedGeneration(directory, 4),
    bindings,
    header: current.header,
    events: current.events,
    source: rows.find((event) => event.type === 'assistant/message').data.message.content[0].text,
  }
  assertRecordedSession(current, replay)
  return replay
}

async function readingReplay(workspace) {
  return readRecordedReplay(
    new URL('../snapshots/web/reading-first/', import.meta.url),
    new Map([
      ['{{session:1}}', 'annotation-reading-first'],
      ['{{message:1}}', 'annotation-reading-first-user'],
      ['{{message:2}}', 'annotation-reading-first-assistant'],
      ['{{cwd}}', workspace],
    ]),
  )
}

/** Verify synthesized clocks before removing them; preserve every other persisted field. */
function assertRecordedSession(actual, replay) {
  assert.equal(actual.inheritedEventCount, 0)
  assert.equal(
    actual.events.length,
    replay.events.length,
    `Reading must not append Session events: ${JSON.stringify(actual.events.slice(replay.events.length))}`,
  )
  const events = actual.events.map(({ seq, time, ...event }, index) => {
    assert.equal(seq, index, 'Persisted replay sequence must remain contiguous')
    assert.equal(time, index, 'Persisted replay clocks must remain unchanged')
    return event
  })
  const inverse = new Map([...replay.bindings].map(([token, identity]) => [identity, token]))
  const normalized = substituteIdentities([{ type: 'session', ...actual.header }, ...events], inverse)
  assert.deepEqual(
    normalized,
    replay.recorded,
    'Reading and local annotations must preserve the recorded Session',
  )
}

async function openReadingSession(page, cwd, source) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  const workspace = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
  await workspace.waitFor()
  if ((await workspace.getAttribute('aria-expanded')) !== 'true') await workspace.click()
  const group = page.getByRole('treeitem', { name: /未分组/ }).first()
  await group.waitFor()
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  const row = page.getByRole('treeitem').filter({ has: page.getByText(basename(cwd), { exact: true }) })
  await row.waitFor()
  assert.equal(await row.count(), 1, 'Exactly one unopened Session must show its workspace basename')
  await row.click()
  await page.locator('.dia-assistant__body').getByText(source, { exact: true }).waitFor()
}

async function selectReadingSource(page, source) {
  await page.locator('.dia-assistant__body').evaluate((body, exact) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = node.textContent.indexOf(exact)
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + exact.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      return
    }
    throw new Error(`Recorded source is not rendered: ${exact}`)
  }, source)
}

async function openAnnotationSettings(page) {
  // The Host's initial empty-Hero transition can dismiss a panel opened before Session hydration.
  await page.locator('[data-composer-card] [contenteditable="true"]').waitFor()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '注解', exact: true }).click()
  const card = dialog.locator('.dia-plugin-card')
  await card.waitFor()
  return card
}

/** Capture repository screenshots from the installed Chinese Web profile. */
async function captureReleaseScreenshots(page, request) {
  const source = '这段说明可以帮助我们更清楚地定位问题。'
  const note = '请补充判断依据，并给出一个具体例子。'
  const settings = await openAnnotationSettings(page)
  const autoAttach = settings.getByRole('switch', {
    name: '新增注解后自动随下一条消息发送',
    exact: true,
  })
  if ((await autoAttach.getAttribute('aria-checked')) === 'false') {
    await autoAttach.click()
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  }
  await request('release-showcase')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const group = page.getByRole('treeitem', { name: /未分组/ }).first()
  await group.waitFor()
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await page.getByRole('treeitem', { name: /请说明如何提出清晰的反馈/ }).click()
  await page.locator('.dia-assistant__body').getByText(source, { exact: true }).waitFor()
  await selectReadingSource(page, source)
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'release-selection.png'), fullPage: true })

  await page.getByRole('button', { name: '添加注解', exact: true }).click()
  const editor = page.locator('.dia-record-editor--quick')
  await editor.getByRole('textbox', { name: '你的注解', exact: true }).fill(note)
  await page.screenshot({ path: join(artifacts, 'release-editor.png'), fullPage: true })
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.locator('.dia-marker').first().click()
  await page.locator('.dia-record-editor--detail').waitFor()
  await page.screenshot({ path: join(artifacts, 'release-bubble.png'), fullPage: true })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
  await page.locator('.dia-record-row').getByText(note).waitFor()
  await page.screenshot({ path: join(artifacts, 'release-record.png'), fullPage: true })
  await openAnnotationSettings(page)
  await page.screenshot({ path: join(artifacts, 'release-settings.png'), fullPage: true })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.dia-composer-chip').waitFor()
  const composer = page.locator('[data-composer-card] [contenteditable="true"]')
  await composer.click()
  await composer.press('Enter')
  await page.locator('.dia-composer-chip').waitFor({ state: 'hidden' })
  await page.locator('.dia-user-submission').waitFor()
  await page.getByText('已补充判断依据和一个具体例子。', { exact: false }).last().waitFor()
  await page.screenshot({ path: join(artifacts, 'release-sent.png'), fullPage: true })

  await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
  const sent = page.locator('.dia-record-row').filter({ hasText: note })
  await sent.getByRole('button', { name: '重新随消息发送', exact: true }).click()
  await page.locator('.dia-composer-chip').waitFor()
  await page.screenshot({ path: join(artifacts, 'release-reattach.png'), fullPage: true })
}

try {
  const home = join(root, 'home')
  const profile = join(home, 'profiles/web')
  const workspace = join(root, 'workspace')
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await mkdir(workspace)
  const archivedPreferences =
    'inline-comments:\n  autoAttach: true\ndsh-annotation:\n  compactSummary: true\n  hideReasoning: true\n  localTools: false\nother-plugin:\n  preserved: true\n'
  const archivePath = join(home, 'settings.yaml.imported')
  await writeFile(archivePath, archivedPreferences)
  // A local linked bundle exercises the published manifest/patch and built dual-face entries.
  await symlink(project, join(profile, 'node_modules/dsh-annotation'), 'junction')
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-annotation': `link:${project}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-annotation'] } },
    }),
  )
  const patch = join(root, 'observer.patch.yml')
  await writeFile(
    patch,
    JSON.stringify([
      ...['llm-deepseek', 'llm-pi-ai', 'session-title-llm', 'agent-instructions', 'directory-picker'].map(
        (id) => ({
          id,
          disabled: true,
        }),
      ),
      { id: 'agent-default-model', config: { provider: 'annotation-fixture', model: 'fixture' } },
      {
        insert: [
          { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
          { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
          {
            id: 'annotation-smoke-observer',
            name: new URL('../tests/profile-fixtures/observer.mjs', import.meta.url).href,
          },
        ],
      },
    ]),
  )
  await writeFile(join(workspace, 'notes.md'), '# Local review notes\n')
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      /KEY|TOKEN|SECRET|PASSWORD|PROXY/i.test(key) ||
      /^DSH_|^(NODE_OPTIONS|NODE_PATH|TSX_TSCONFIG_PATH)$/.test(key)
    )
      delete env[key]
  }
  Object.assign(env, { DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1' })
  child = spawn(
    process.execPath,
    [
      join(dirname(cliManifestPath), cliManifest.bin.dsh),
      '--profile',
      'web',
      '--patch',
      patch,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ],
    { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  )
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  completion = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      const error = new Error(`dsh exited: code=${code}, signal=${signal}\n${output}`)
      readyReject(error)
      for (const request of pending.values()) request.reject(error)
      resolve({ code, signal })
    }),
  )
  child.once('error', (error) => readyReject(error))
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      output = (output + String(data).replace(/([?&]token=)[^\s&]+/g, '$1<redacted>')).slice(-60_000)
      if (output.includes('dsh web: http://')) readyResolve()
    })
  child.on('message', (message) => {
    const waiter = pending.get(message?.id)
    if (!waiter) return
    if (message.error) waiter.reject(new Error(message.error))
    else waiter.resolve(message.result)
  })
  await deadline(ready, 'Official web readiness')
  await request('settings-ready')
  const initial = await request('inspect')
  assert.equal(initial.settings.user.archivedPreferencesImported, true)
  assert.equal(initial.settings.user.autoAttach, true)
  assert.equal(initial.settings.user.compactSummary, true)
  assert.equal(initial.settings.user.hideReasoning, true)
  assert.equal(Object.hasOwn(initial.settings.user, 'localTools'), false)
  assert.equal(await readFile(archivePath, 'utf8'), archivedPreferences)
  console.log('PASS archived annotation preferences recover through official configuration forms')
  console.log(`Isolated profile URL: ${new URL(initial.url).origin}`)
  const bundle = initial.bundles.find((item) => item.name === 'dsh-annotation')
  assert.equal(bundle?.enabled, true)
  assert.equal(bundle?.installed, true)
  assert.equal(bundle?.rows[0]?.moduleName, 'dsh-annotation')
  assert.equal(initial.plugins.find((item) => item.moduleName === 'dsh-annotation')?.fiberPhase, 'active')
  assert.ok(initial.settings, 'Host must register annotation settings')
  console.log('PASS official profile + Loader discovers the installed annotation bundle')

  await request('prepare')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(30_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(initial.url, { waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  console.log('PASS built Client plugin activates in the real Web GUI')
  if (process.argv.includes('--legacy-diff-only')) {
    await request('submit')
    await mkdir(artifacts, { recursive: true })
  } else {
    let card = await openAnnotationSettings(page)
    assert.equal(
      await card.getByRole('switch').count(),
      2,
      'Only enablement and auto-attachment are editable',
    )
    assert.equal(await card.locator('[data-transcript-visibility-grid]').count(), 0)
    const autoAttachLabel = '新增注解后自动随下一条消息发送'
    const autoAttachField = card.locator('.dia-plugin-card__field').filter({
      has: page.getByRole('switch', { name: autoAttachLabel, exact: true }),
    })
    await autoAttachField.getByRole('button', { name: '恢复默认', exact: true }).click()
    const toggle = card.getByRole('switch', { name: '启用 DSH 注解', exact: true })
    assert.equal(await toggle.getAttribute('aria-checked'), 'true')
    await toggle.click()
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    const saved = await request('inspect')
    assert.equal(saved.settings.user.enabled, false)
    assert.equal(Object.hasOwn(saved.settings.user, 'autoAttach'), false)
    assert.equal(saved.settings.value.autoAttach, true)
    assert.equal(saved.settings.user.hideReasoning, true, 'Retired values remain stored without controls')
    assert.equal(saved.settings.user.archivedPreferencesImported, true)
    const settingsFile = await readFile(initial.settingsDocumentPath, 'utf8')
    assert.match(settingsFile, /id: dsh-annotation[\s\S]*enabled: false/)
    await page.reload({ waitUntil: 'domcontentloaded' })
    card = await openAnnotationSettings(page)
    const afterReset = await request('inspect')
    assert.equal(Object.hasOwn(afterReset.settings.user, 'autoAttach'), false)
    assert.equal(afterReset.settings.value.autoAttach, true)
    assert.equal(await readFile(archivePath, 'utf8'), archivedPreferences)
    console.log('PASS Reset does not restore an archived preference again')
    const disabledToggle = card.getByRole('switch', { name: '启用 DSH 注解', exact: true })
    assert.equal(await disabledToggle.getAttribute('aria-checked'), 'false')
    await disabledToggle.click()
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal((await request('inspect')).settings.user.enabled, true)
    if (process.env.DSH_PROFILE_SCREENSHOT) {
      await mkdir(dirname(process.env.DSH_PROFILE_SCREENSHOT), { recursive: true })
      await page.screenshot({ path: process.env.DSH_PROFILE_SCREENSHOT, fullPage: true })
    }
    console.log('PASS main Settings annotation section saves to Host settings and survives browser reload')
    const submission = await request('submit')
    const admitted = submission.events.filter(
      (event) => event.type === 'user/message' && event.data.source.annotationSubmission,
    )
    assert.equal(admitted.length, 1, 'The durable log must contain exactly one annotation admission')
    const modelMessage = submission.requests[1].find((message) => message.id === admitted[0].data.id)
    assert.deepEqual(
      modelMessage,
      admitted[0].data,
      'Logged annotation message must equal actual model input',
    )
    const reference = admitted[0].data.source.annotationSubmission.annotations[0]
    const modelText = modelMessage.content[0].text
      .replace(`Reply message: ${reference.messageId}`, 'Reply message: <assistant-message>')
      .replace(`Reply event seq: ${reference.messageSeq}`, 'Reply event seq: <assistant-seq>')
    assert.equal(
      `${modelText}\n`,
      await readFile(
        new URL('../tests/profile-fixtures/model-message.expected.txt', import.meta.url),
        'utf8',
      ),
    )
    assert.equal(submission.first?.result.kind, 'success')
    assert.match(submission.retry?.result.text, /already accepted/)
    assert.equal(
      submission.requests.length,
      2,
      'One initial turn and one annotation turn; retry must not call the model',
    )
    assert.match(JSON.stringify(submission.requests[1]), /Explain this claim/)
    assert.match(JSON.stringify(submission.events), /annotationSubmission/)
    console.log('PASS real Host command reaches AgentLoop/model and deduplicates accepted retry')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const workspaceRow = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
    await workspaceRow.waitFor()
    if ((await workspaceRow.getAttribute('aria-expanded')) !== 'true') await workspaceRow.click()
    const groupRow = page.getByRole('treeitem', { name: /未分组/ }).first()
    await groupRow.waitFor()
    if ((await groupRow.getAttribute('aria-expanded')) !== 'true') await groupRow.click()
    await page.getByRole('treeitem', { name: /Please review/ }).click()
    await page
      .locator('.dia-assistant__body')
      .getByText('Selected source needs clarification.', { exact: false })
      .waitFor()
    const submissionCard = page.locator('.dia-user-submission')
    await submissionCard.getByRole('button', { name: '1 条注释，双击定位原文', exact: true }).waitFor()
    const conversation = `# Assistant\n${await page.locator('.dia-assistant__body').first().ariaSnapshot()}\n\n# Annotation submission\n${await submissionCard.ariaSnapshot()}\n`
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'conversation.actual.txt'), conversation)
    await page.screenshot({ path: join(artifacts, 'conversation-profile.png'), fullPage: true })
    assert.equal(
      conversation,
      await readFile(new URL('../tests/profile-fixtures/conversation.expected.txt', import.meta.url), 'utf8'),
    )
    assert.equal(
      await page.locator('.dia-user').first().innerText(),
      'Please review [local notes](./notes.md).',
    )
    await page.getByRole('button', { name: '显示注解记录', exact: true }).waitFor()
    console.log(
      'PASS persisted user/assistant Markdown and annotation history render in the real conversation',
    )

    const replay = await readingReplay(workspace)
    assertRecordedSession(
      await request('seed-session', { header: replay.header, events: replay.events }),
      replay,
    )
    await openReadingSession(page, workspace, replay.source)
    assert.equal(await page.locator('.dia-record, .dia-composer-chip').count(), 0)
    await selectReadingSource(page, replay.source)
    await page.getByRole('button', { name: '添加注解', exact: true }).click()
    const note = 'Clarify this recorded statement.'
    const editor = page.locator('.dia-record-editor--quick')
    await editor.getByRole('textbox', { name: '你的注解', exact: true }).fill(note)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    const chip = page.locator('.dia-composer-chip')
    await chip.waitFor()
    assert.equal(await page.locator('.dia-record').count(), 0, 'Saving does not open the record')
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    const record = page.locator('.dia-record')
    const row = record.locator('.dia-record-row').filter({ hasText: note })
    await row.waitFor()
    await row.getByRole('button', { name: '定位原文', exact: true }).click()
    assert.equal(await record.isVisible(), true, 'Navigation preserves the open record')
    await row.getByRole('button', { name: '取消随消息发送', exact: true }).click()
    await chip.waitFor({ state: 'hidden' })
    await row.getByRole('button', { name: '随消息发送', exact: true }).click()
    await chip.waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.dia-assistant__body').getByText(replay.source, { exact: true }).waitFor()
    await chip.waitFor()
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await row.waitFor()
    assert.equal(await record.locator('.dia-record-row').count(), 1)
    assert.equal(await record.locator('.dia-local-data, .dia-local-status').count(), 0)
    assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
    assert.equal((await request('inspect')).modelRequests, submission.requests.length)
    await page.screenshot({ path: join(artifacts, 'annotation-record-profile.png'), fullPage: true })
    console.log(
      'PASS recorded Session supports selection, navigation, attachment, and reload without log changes',
    )

    card = await openAnnotationSettings(page)
    await card.getByRole('switch', { name: autoAttachLabel, exact: true }).click()
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal((await request('inspect')).settings.user.autoAttach, false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await chip.waitFor()
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await row.getByRole('button', { name: '取消随消息发送', exact: true }).click()
    await chip.waitFor({ state: 'hidden' })
    await row.getByRole('button', { name: '随消息发送', exact: true }).click()
    await chip.waitFor()
    assert.equal((await request('inspect')).settings.value.autoAttach, false)
    assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
    console.log('PASS saved auto-attachment preference preserves explicit paperclip attachment')

    // Frozen reading-only fixtures omit the live Session's protected system head.
    await page.getByRole('treeitem', { name: /Please review/ }).click()
    await page.locator('.dia-user-submission').waitFor()
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    const sentRow = record.locator('.dia-record-row').filter({ hasText: 'Explain this claim.' })
    await sentRow.getByRole('button', { name: '重新随消息发送', exact: true }).click()
    await chip.waitFor()
    const composer = page.locator('[data-composer-card] [contenteditable="true"]')
    await composer.click()
    await composer.press('End')
    await composer.pressSequentially('Please answer the attached annotation.')
    await composer.press('Enter')
    await chip.waitFor({ state: 'hidden' })
    await page.locator('.dia-user-submission').nth(1).waitFor()
    await record.waitFor({ state: 'hidden' })
    const firstSend = await request('read-session', { sessionId: submission.sessionId })
    const annotationsIn = (session) =>
      session.events.filter(
        (event) => event.type === 'user/message' && event.data.source.annotationSubmission,
      )
    const firstAdmissions = annotationsIn(firstSend)
    assert.equal(firstAdmissions.length, 2)
    const firstPayload = firstAdmissions[1].data.source.annotationSubmission
    assert.equal(firstPayload.processingMode, 'answer')
    assert.equal(firstPayload.overallRequirement, 'Please answer the attached annotation.')
    assert.equal(firstPayload.annotations[0].annotation, reference.annotation)
    assert.equal(firstPayload.annotations[0].quote.exact, reference.quote.exact)
    assert.equal(firstPayload.annotations[0].annotationId, reference.annotationId)
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await sentRow.getByRole('button', { name: '重新随消息发送', exact: true }).click()
    await chip.waitFor()
    await composer.click()
    await composer.press('Enter')
    await chip.waitFor({ state: 'hidden' })
    await page.locator('.dia-user-submission').nth(2).waitFor()
    const secondAdmissions = annotationsIn(await request('read-session', { sessionId: submission.sessionId }))
    assert.equal(secondAdmissions.length, 3)
    const secondPayload = secondAdmissions[2].data.source.annotationSubmission
    assert.equal(secondPayload.annotations[0].annotationId, firstPayload.annotations[0].annotationId)
    assert.notEqual(secondPayload.submissionId, firstPayload.submissionId)
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await sentRow.waitFor()
    assert.equal(await record.locator('.dia-record-row').count(), 1)
    await page.screenshot({ path: join(artifacts, 'composer-resend-profile.png'), fullPage: true })
    console.log('PASS official composer sends text plus annotations and reuses the annotation ID on resend')

    const attachmentRun = await request('attachment-smoke')
    assert.equal(attachmentRun.prepared?.result.kind, 'success')
    assert.equal(
      attachmentRun.beforePreflight,
      attachmentRun.afterPreflight,
      'Preflight must not call the model',
    )
    assert.equal(attachmentRun.afterFirst, attachmentRun.beforePreflight + 1)
    assert.equal(
      attachmentRun.afterRetry,
      attachmentRun.afterFirst,
      'Retry and rejection must not call the model',
    )
    assert.equal(attachmentRun.first?.result.kind, 'success')
    assert.match(attachmentRun.retry?.result.text, /already accepted/)
    assert.equal(attachmentRun.mismatch, 'Annotation attachments differ from the frozen submission.')
    const attachmentAdmissions = attachmentRun.events.filter(
      (event) =>
        event.type === 'user/message' &&
        event.data.source?.annotationSubmission?.submissionId === attachmentRun.payload.submissionId,
    )
    assert.equal(attachmentAdmissions.length, 1, 'The attachment submission must be durable exactly once')
    const attachmentMessage = attachmentAdmissions[0].data
    assert.deepEqual(attachmentMessage.source.annotationSubmission, attachmentRun.payload)
    const attachmentModelMessage = attachmentRun.requests[0].find(
      (message) => message.id === attachmentMessage.id,
    )
    assert.deepEqual(
      attachmentModelMessage,
      attachmentMessage,
      'The image-bearing model input must equal its logged message',
    )
    assert.deepEqual(
      attachmentMessage.content.map((block) => block.type),
      ['text', 'image'],
    )
    const identity = attachmentRun.payload.attachmentIdentities[0]
    assert.equal(identity.attachmentId, attachmentMessage.content[1].attachment.attachmentId)
    assert.equal(identity.bytes, attachmentMessage.content[1].attachment.bytes)
    assert.equal(identity.name, 'pixel.gif')
    assert.match(JSON.stringify(attachmentRun.requests), /Delivery mode: rewrite/)
    assert.match(JSON.stringify(attachmentRun.requests), /Attachment identity review/)
    assert.equal(JSON.stringify(attachmentRun.events).includes('R0lGODlhAQABAIAAAAAAAP'), false)
    console.log(
      'PASS real image preflight, frozen identity, rewrite payload, durable attachment, and retry deduplication',
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await workspaceRow.waitFor()
    if ((await workspaceRow.getAttribute('aria-expanded')) !== 'true') await workspaceRow.click()
    await groupRow.waitFor()
    if ((await groupRow.getAttribute('aria-expanded')) !== 'true') await groupRow.click()
    await page.getByRole('treeitem', { name: /Attachment identity smoke/ }).click()
    await page
      .locator('.dia-user-submission')
      .getByText('Attachment identity review.', { exact: true })
      .waitFor()
    const admittedImage = page.locator('.dia-message-attachments img')
    await admittedImage.waitFor()
    await admittedImage.evaluate((image) => image.decode())
    await page.screenshot({ path: join(artifacts, 'attachment-identity-profile.png'), fullPage: true })
    console.log('PASS the real Web conversation displays the identity-verified image submission')
  }
  await exerciseLegacyDiffHistory(page, {
    request,
    readRecordedReplay,
    assertRecordedSession,
    openReadingSession,
    workspace,
    artifacts,
  })
  if (process.env.DSH_RELEASE_SCREENSHOTS === '1') {
    await captureReleaseScreenshots(page, request)
    console.log('PASS seven release screenshots captured from the Chinese Web profile')
  }
  assert.deepEqual(pageErrors, [])
} catch (error) {
  console.error(output)
  if (page && !page.isClosed()) console.error(await page.locator('body').innerText())
  throw error
} finally {
  try {
    await browser?.close()
  } finally {
    if (child && completion) {
      const force = setTimeout(() => {
        forced = true
        child.kill('SIGKILL')
      }, 15_000)
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await completion
      } finally {
        clearTimeout(force)
      }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
    assert.equal(forced, false, 'Web profile must stop without forced termination')
  }
}
console.log('PASS browser/process closed and isolated profile removed')
