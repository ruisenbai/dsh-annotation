/** Built-package smoke through the installed official dsh web profile (no source imports). */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
const acceptanceGeometry = {}

function rectEdges(rect) {
  assert.ok(rect, 'Expected a visible element with a DOMRect')
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
  }
}

function assertStableComposer(before, current, label) {
  for (const key of ['top', 'bottom', 'height']) {
    assert.ok(
      Math.abs(before[key] - current[key]) <= 1,
      `${label} changed composer ${key}: ${JSON.stringify({ before, current })}`,
    )
  }
}

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

async function assertLocateFlash(page, selector, label) {
  const flash = page.locator(selector).first()
  await flash.waitFor({ state: 'visible', timeout: 1_500 })
  await page.waitForFunction(
    (target) => {
      const mark = document.querySelector(target)
      return mark !== null && Number(getComputedStyle(mark).opacity) < 0.7
    },
    selector,
    { timeout: 2_000 },
  )
  await flash.waitFor({ state: 'detached', timeout: 2_500 })
  assert.equal(await page.locator(selector).count(), 0, `${label} flash must clear`)
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

async function openReadingSession(page, sessionId, source) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  const workspace = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
  await workspace.waitFor()
  if ((await workspace.getAttribute('aria-expanded')) !== 'true') await workspace.click()
  const group = page.getByRole('treeitem', { name: /未分组/ }).first()
  await group.waitFor()
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  const row = page.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]`)
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

async function cancelBlankNewEditor(page, editor, source) {
  const before = {
    markers: await page.locator('.dia-marker').count(),
    rows: await page.locator('.dia-record-row').count(),
    chips: await page.locator('.dia-composer-chip').allTextContents(),
  }
  await editor.getByRole('textbox', { name: '你的注解', exact: true }).fill(' \n\t ')
  const shaking = page.locator('.dia-record-editor--quick.dia-record-editor--shake')
  for (let outside = 0; outside < 2; outside += 1) {
    await page.mouse.click(2, 2)
    await editor.waitFor({ state: 'visible' })
    await shaking.waitFor({ state: 'visible' })
    await shaking.waitFor({ state: 'hidden' })
    if (outside === 0) await editor.getByRole('textbox', { name: '你的注解' }).click()
  }
  await page.mouse.click(2, 2)
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(
    {
      markers: await page.locator('.dia-marker').count(),
      rows: await page.locator('.dia-record-row').count(),
      chips: await page.locator('.dia-composer-chip').allTextContents(),
    },
    before,
    `${source} blank cancellation must not create a bubble, record, or send attachment`,
  )
}

async function openAnnotationSettings(page) {
  await page.locator('[data-composer-card]').waitFor()
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog')
    try {
      await dialog.getByRole('button', { name: '注解', exact: true }).click({ timeout: 5_000 })
      const card = dialog.locator('.dia-plugin-card')
      await card.waitFor({ timeout: 5_000 })
      return card
    } catch (error) {
      // The Host can replace the empty Hero and dismiss Settings during hydration.
      if (await dialog.isVisible()) throw error
    }
  }
  throw new Error('Annotation Settings closed during Host hydration')
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
  await writeFile(join(workspace, 'example.ts'), 'const first = 1;\nconst second = 2;\nconst third = 3;\n')
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
  try {
    await Promise.race([
      page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' }),
      page
        .getByText('Failed to load plugins')
        .waitFor()
        .then(() => {
          throw new Error('Client plugin activation failed')
        }),
    ])
  } catch (error) {
    console.error('Client activation errors:', pageErrors)
    console.error('Client status:', (await page.locator('body').innerText()).slice(0, 2000))
    throw error
  }
  console.log('PASS built Client plugin activates in the real Web GUI')
  const continueFromPreviewNotice = page.getByRole('button', { name: '继续', exact: true })
  if (await continueFromPreviewNotice.isVisible()) await continueFromPreviewNotice.click()
  if (process.argv.includes('--legacy-diff-only')) {
    await request('submit')
    await mkdir(artifacts, { recursive: true })
  } else if (!process.argv.includes('--official-only')) {
    let card = await openAnnotationSettings(page)
    assert.equal(
      await card.getByRole('switch').count(),
      4,
      'Enablement, official file/Diff capture, and auto-attachment are editable',
    )
    const officialFileToggle = card.getByRole('switch', { name: '允许文件预览批注', exact: true })
    const officialDiffToggle = card.getByRole('switch', { name: '允许官方 turn Diff 批注', exact: true })
    assert.equal(await officialFileToggle.getAttribute('aria-checked'), 'true')
    assert.equal(await officialDiffToggle.getAttribute('aria-checked'), 'true')
    await officialFileToggle.click()
    await officialDiffToggle.click()
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    const sourcesDisabled = await request('inspect')
    assert.equal(sourcesDisabled.settings.user.officialFileAnnotations, false)
    assert.equal(sourcesDisabled.settings.user.officialDiffAnnotations, false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    card = await openAnnotationSettings(page)
    assert.equal(
      await card.getByRole('switch', { name: '允许文件预览批注', exact: true }).getAttribute('aria-checked'),
      'false',
    )
    assert.equal(
      await card
        .getByRole('switch', { name: '允许官方 turn Diff 批注', exact: true })
        .getAttribute('aria-checked'),
      'false',
    )
    await card.getByRole('switch', { name: '允许文件预览批注', exact: true }).click()
    await card.getByRole('switch', { name: '允许官方 turn Diff 批注', exact: true }).click()
    await card.getByRole('button', { name: '保存', exact: true }).click()
    await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    const sourcesEnabled = await request('inspect')
    assert.equal(sourcesEnabled.settings.user.officialFileAnnotations, true)
    assert.equal(sourcesEnabled.settings.user.officialDiffAnnotations, true)
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
      (
        await readFile(
          new URL('../tests/profile-fixtures/model-message.expected.txt', import.meta.url),
          'utf8',
        )
      ).replaceAll('<space>', ' '),
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
    await openReadingSession(page, 'annotation-reading-first', replay.source)
    assert.equal(await page.locator('.dia-record, .dia-composer-chip').count(), 0)
    const composerCard = page.locator('[data-composer-card]').first()
    const composerInput = composerCard.locator('[contenteditable="true"]')
    const composerBeforeEditor = rectEdges(await composerCard.boundingBox())
    const composerDraftBeforeEditor = await composerInput.innerText()
    await selectReadingSource(page, replay.source)
    const bodySelectionLastLine = await page.evaluate(() => {
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
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
    })
    assert.ok(bodySelectionLastLine, 'The body selection needs a measurable final line')
    await page.getByRole('button', { name: '添加注解', exact: true }).click()
    const editor = page.locator('.dia-record-editor--quick')
    await editor.waitFor({ state: 'visible' })
    const composerWithEditor = rectEdges(await composerCard.boundingBox())
    const bodyEditorRect = rectEdges(await editor.boundingBox())
    const bodyCapsule = await editor.evaluate((element) => {
      const editorRect = element.getBoundingClientRect()
      const input = element.querySelector('textarea')
      const confirm = element.querySelector('.dia-record-editor__check')
      if (!(input instanceof HTMLTextAreaElement) || !(confirm instanceof HTMLElement)) return null
      const inputRect = input.getBoundingClientRect()
      const confirmRect = confirm.getBoundingClientRect()
      const editorStyle = getComputedStyle(element)
      const inputStyle = getComputedStyle(input)
      return {
        editorHeight: editorRect.height,
        editorRadius: editorStyle.borderTopLeftRadius,
        inputLeftInset: inputRect.left - editorRect.left,
        inputRightInset: editorRect.right - inputRect.right,
        inputPaddingLeft: inputStyle.paddingLeft,
        inputPaddingRight: inputStyle.paddingRight,
        confirmWidth: confirmRect.width,
        confirmHeight: confirmRect.height,
        confirmRadius: getComputedStyle(confirm).borderRadius,
      }
    })
    assert.ok(bodyCapsule, 'The body quick editor needs measurable controls')
    assertStableComposer(composerBeforeEditor, composerWithEditor, 'Opening a body annotation editor')
    assert.ok(
      bodyEditorRect.top >= bodySelectionLastLine.bottom,
      `The body editor overlaps its final selection line: ${JSON.stringify({ bodySelectionLastLine, bodyEditorRect })}`,
    )
    assert.ok(
      Math.abs(bodyCapsule.confirmWidth - bodyCapsule.confirmHeight) <= 1 &&
        bodyCapsule.confirmWidth > 0 &&
        bodyCapsule.editorHeight >= bodyCapsule.confirmHeight &&
        bodyCapsule.inputLeftInset > 0 &&
        bodyCapsule.inputRightInset > 0,
      `The body quick editor is not a usable capsule with a circular confirmation button: ${JSON.stringify(bodyCapsule)}`,
    )
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'editor-below-selection-profile.png'), fullPage: true })
    const cdp = await page.context().newCDPSession(page)
    const zoom = {}
    try {
      for (const scale of [1.25, 1.5]) {
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
        await page.waitForTimeout(50)
        const metric = await editor.evaluate((element) => {
          const editorRect = element.getBoundingClientRect()
          const confirmRect = element.querySelector('.dia-record-editor__check').getBoundingClientRect()
          return {
            scale: window.visualViewport?.scale ?? 1,
            visualWidth: window.visualViewport?.width ?? window.innerWidth,
            editor: {
              left: editorRect.left,
              top: editorRect.top,
              right: editorRect.right,
              bottom: editorRect.bottom,
              width: editorRect.width,
              height: editorRect.height,
            },
            confirmWidth: confirmRect.width,
            confirmHeight: confirmRect.height,
          }
        })
        assert.ok(Math.abs(metric.scale - scale) < 0.01, `Chromium page scale did not reach ${scale}`)
        assert.ok(
          metric.editor.left >= 0 &&
            metric.editor.right <= metric.visualWidth + 1 &&
            Math.abs(metric.confirmWidth - metric.confirmHeight) <= 1,
          `The quick editor is clipped or its confirmation button is distorted at ${scale}: ${JSON.stringify(metric)}`,
        )
        zoom[String(scale)] = metric
        await page.screenshot({
          path: join(artifacts, `editor-zoom-${String(scale).replace('.', '')}-profile.png`),
        })
      }
    } finally {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
      await cdp.detach()
    }
    await cancelBlankNewEditor(page, editor, 'Body')
    const composerAfterEditor = rectEdges(await composerCard.boundingBox())
    assertStableComposer(composerBeforeEditor, composerAfterEditor, 'Canceling a body annotation editor')
    assert.equal(await composerInput.innerText(), composerDraftBeforeEditor)
    acceptanceGeometry.bodyEditor = {
      composerBefore: composerBeforeEditor,
      composerOpen: composerWithEditor,
      composerAfterCancel: composerAfterEditor,
      selectionLastLine: bodySelectionLastLine,
      editor: bodyEditorRect,
      capsule: bodyCapsule,
      zoom,
    }
    await openReadingSession(page, 'annotation-reading-first', replay.source)
    assert.equal(await page.locator('.dia-record, .dia-composer-chip, .dia-marker').count(), 0)
    await selectReadingSource(page, replay.source)
    await page.getByRole('button', { name: '添加注解', exact: true }).click()
    const note = 'Clarify this recorded statement.'
    await editor.getByRole('textbox', { name: '你的注解', exact: true }).fill(note)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    const savedToast = page.locator('[role="alert"][data-dsh-annotation-toast]').last()
    await savedToast.waitFor({ state: 'visible' })
    const toastRect = rectEdges(await savedToast.boundingBox())
    const toastComposerRect = rectEdges(await composerCard.boundingBox())
    assert.ok(
      Math.abs(toastRect.left - toastComposerRect.left) <= 1 &&
        Math.abs(toastRect.right - toastComposerRect.right) <= 1,
      `The annotation Toast must share the composer edges: ${JSON.stringify({ toastRect, toastComposerRect })}`,
    )
    acceptanceGeometry.toast = { toast: toastRect, composer: toastComposerRect }
    await page.screenshot({ path: join(artifacts, 'toast-composer-alignment-profile.png'), fullPage: true })
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
  if (!process.argv.includes('--official-only')) {
    await exerciseLegacyDiffHistory(page, {
      request,
      readRecordedReplay,
      assertRecordedSession,
      openReadingSession,
      workspace,
      artifacts,
    })
  }
  if (!process.argv.includes('--legacy-diff-only')) {
    await mkdir(artifacts, { recursive: true })
    if (process.argv.includes('--official-only')) await request('submit')
    const official = await request('official-source-session')
    assert.ok(
      official.events.some((event) => event.type === 'workspace/changes' && event.seq === official.seq),
    )
    assert.equal(official.summary.turn, official.turn)
    assert.equal(official.summary.files[0]?.path, 'notes.md')
    assert.equal(official.diff.kind, 'text')
    assert.ok(official.diff.hunks.some((hunk) => hunk.lines.includes('+A changed line.')))
    console.log('PASS official workspace/changes event, summary, and Diff come from the live Host Session')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    const codeTools = settings.getByRole('switch', { name: '代码工作工具' })
    if ((await codeTools.getAttribute('aria-checked')) === 'false') await codeTools.click()
    await settings.getByRole('button', { name: '注解', exact: true }).click()
    const annotationSettings = settings.locator('.dia-plugin-card')
    const autoAttach = annotationSettings.getByRole('switch', {
      name: '新增注解后自动随下一条消息发送',
      exact: true,
    })
    if ((await autoAttach.getAttribute('aria-checked')) === 'false') {
      await autoAttach.click()
      await annotationSettings.getByRole('button', { name: '保存', exact: true }).click()
      await annotationSettings.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
    }
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    const workspaceRow = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
    await workspaceRow.waitFor()
    if ((await workspaceRow.getAttribute('aria-expanded')) !== 'true') await workspaceRow.click()
    const groupRow = page.getByRole('treeitem', { name: /未分组/ }).first()
    await groupRow.waitFor()
    if ((await groupRow.getAttribute('aria-expanded')) !== 'true') await groupRow.click()
    await page.locator(`[role="treeitem"][data-row-key="session:${official.sessionId}"]`).click()
    const card = page.locator('[data-changed-files]')
    await card.waitFor({ state: 'visible' })
    const changedFile = card.getByRole('button', { name: '查看 notes.md 的改动' })
    await changedFile.hover()
    const hover = page.locator('[data-changes-hover-preview]')
    await hover.waitFor({ state: 'visible' })
    assert.equal(await hover.locator('[data-official-diff-annotate]').count(), 0)
    await page.screenshot({ path: join(artifacts, 'official-diff-hover-profile.png'), fullPage: true })
    await changedFile.click()
    const review = page.locator('[data-changes-review]')
    await review.waitFor({ state: 'visible' })
    await review.locator('[data-official-diff-annotate]').waitFor({ state: 'visible' })
    const selectChangedDiffText = async () => {
      await review
        .locator('[data-diff-line="add"]')
        .last()
        .evaluate((row) => {
          const code = row.lastElementChild
          if (code === null) throw new Error('Diff line code is missing')
          const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
          let text = walker.nextNode()
          while (text !== null && !text.textContent.includes('changed')) text = walker.nextNode()
          const start = text?.textContent.indexOf('changed') ?? -1
          if (text === null || start < 0) throw new Error('Diff line text is missing')
          const range = document.createRange()
          range.setStart(text, start)
          range.setEnd(text, start + 'changed'.length)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          code.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        })
      await page.locator('.dia-selection-bar').waitFor({ state: 'visible' })
    }
    await selectChangedDiffText()
    await page.locator('.dia-selection-bar').getByRole('button', { name: '添加注解' }).click()
    const diffEditor = page.locator('.dia-record-editor--quick')
    await cancelBlankNewEditor(page, diffEditor, 'Diff sidebar')
    await selectChangedDiffText()
    await page.locator('.dia-selection-bar').getByRole('button', { name: '添加注解' }).click()
    await diffEditor.getByRole('textbox', { name: '你的注解' }).fill('Check the changed line.')
    await diffEditor.getByRole('button', { name: '保存', exact: true }).click()
    await diffEditor.waitFor({ state: 'hidden' })
    const saved = page.locator('.dia-marker[data-annotation-id]').first()
    await saved.waitFor({ state: 'visible' })
    const annotationId = await saved.getAttribute('data-annotation-id')
    assert.ok(annotationId)
    await page.screenshot({
      path: join(artifacts, 'official-diff-sidebar-saved-profile.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await page
      .locator('.dia-record-row')
      .filter({ hasText: 'Check the changed line.' })
      .getByRole('button', { name: '定位原文', exact: true })
      .click()
    await review.waitFor({ state: 'visible' })
    const located = page.locator(`.dia-marker[data-annotation-id="${annotationId}"]`)
    await located.waitFor({ state: 'visible' })
    await review.locator('[data-dsh-official-diff-located]').waitFor({ state: 'visible' })
    await assertLocateFlash(page, '.dia-source-flash', 'Diff source')
    await page.screenshot({ path: join(artifacts, 'official-diff-located-profile.png'), fullPage: true })
    console.log(
      'PASS Diff hover has no annotation entry; sidebar selection creates a bubble and Locate restores its range',
    )
    await page.locator('.dia-assistant__body').getByRole('button', { name: 'notes.md' }).click()
    const filePreview = page.locator('[data-textpreview-url][data-document-preview]')
    await filePreview.waitFor({ state: 'visible' })
    await filePreview.locator('[data-document-markdown]').getByText('A changed line.').waitFor()
    const fileAction = filePreview.locator('[data-official-file-annotate]:visible').first()
    await fileAction.waitFor({ state: 'visible' })
    await fileAction.click()
    const fileEditor = page.locator('.dia-record-editor--quick')
    await fileEditor.waitFor({ state: 'visible' })
    await cancelBlankNewEditor(page, fileEditor, 'Whole file')
    await fileAction.waitFor({ state: 'visible' })
    await fileAction.click()
    await fileEditor.waitFor({ state: 'visible' })
    await fileEditor.getByRole('textbox', { name: '你的注解' }).fill('Review the entire file.')
    await fileEditor.getByRole('button', { name: '保存', exact: true }).click()
    await fileEditor.waitFor({ state: 'hidden' })
    const drag = await filePreview.locator('[data-document-markdown]').evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let first = null
      let last = null
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent.includes('Local review notes')) first = node
        if (node.textContent.includes('A changed line.')) last = node
      }
      if (first === null || last === null) throw new Error('Real mouse target is missing')
      const start = document.createRange()
      start.setStart(first, 0)
      start.setEnd(first, 1)
      const end = document.createRange()
      end.setStart(last, last.textContent.length - 1)
      end.setEnd(last, last.textContent.length)
      const startRect = start.getBoundingClientRect()
      const endRect = end.getBoundingClientRect()
      return {
        from: { x: startRect.left + 1, y: (startRect.top + startRect.bottom) / 2 },
        to: { x: endRect.right - 1, y: (endRect.top + endRect.bottom) / 2 },
      }
    })
    await page.mouse.move(drag.from.x, drag.from.y)
    await page.mouse.down()
    await page.mouse.move(drag.to.x, drag.to.y, { steps: 10 })
    await page.mouse.up()
    const nativeSelection = await page.evaluate(() => window.getSelection()?.toString())
    assert(nativeSelection?.includes('Local review notes') && nativeSelection.includes('A changed line.'))
    await page.locator('.dia-selection-bar').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await filePreview.locator('[data-document-viewer-menu]').click()
    await page.getByRole('menuitem', { name: '纯文本' }).click()
    await filePreview.locator('[data-textpreview-line="2"]').waitFor({ state: 'visible' })
    const plainDrag = await filePreview.locator('[data-textpreview-plain]').evaluate((body) => {
      const first = body.querySelector('[data-textpreview-line="1"]')?.firstChild
      const last = body.querySelector('[data-textpreview-line="2"]')?.firstChild
      if (!(first instanceof Text) || !(last instanceof Text)) throw new Error('Plain text rows are missing')
      const start = document.createRange()
      start.setStart(first, 0)
      start.setEnd(first, 1)
      const end = document.createRange()
      end.setStart(last, last.length - 2)
      end.setEnd(last, last.length - 1)
      const startRect = start.getBoundingClientRect()
      const endRect = end.getBoundingClientRect()
      return {
        from: { x: startRect.left + 1, y: (startRect.top + startRect.bottom) / 2 },
        to: { x: endRect.right - 1, y: (endRect.top + endRect.bottom) / 2 },
      }
    })
    await page.mouse.move(plainDrag.from.x, plainDrag.from.y)
    await page.mouse.down()
    await page.mouse.move(plainDrag.to.x, plainDrag.to.y, { steps: 10 })
    await page.mouse.up()
    const plainSelection = await page.evaluate(() => window.getSelection()?.toString())
    assert(
      plainSelection?.includes('Local review notes') && plainSelection.includes('A changed line'),
      `Real plain text drag selected ${JSON.stringify(plainSelection)} from ${JSON.stringify(plainDrag)}`,
    )
    await page.locator('.dia-selection-bar').waitFor({ state: 'visible', timeout: 5_000 })
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    const plainBody = await filePreview.locator('[data-textpreview-plain]').boundingBox()
    if (plainBody === null) throw new Error('Plain text preview is not visible')
    await page.mouse.move(plainDrag.from.x, plainDrag.from.y)
    await page.mouse.down()
    await page.mouse.move(plainBody.x + plainBody.width - 24, plainDrag.to.y, { steps: 10 })
    await page.mouse.up()
    const lineEndSelection = await page.evaluate(() => {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      return {
        text: selection?.toString(),
        endNode: range?.endContainer.nodeName,
        endOffset: range?.endOffset,
        action: document.querySelector('.dia-selection-bar') !== null,
      }
    })
    assert(lineEndSelection.text?.includes('A changed line'), JSON.stringify(lineEndSelection))
    await page.locator('.dia-selection-bar').waitFor({ state: 'visible', timeout: 5_000 })
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await filePreview.locator('[data-document-viewer-menu]').click()
    await page.getByRole('menuitem', { name: 'Markdown' }).click()
    await filePreview.locator('[data-document-markdown]').waitFor({ state: 'visible' })
    await filePreview.locator('[data-document-markdown]').evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let first = null
      let last = null
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent.includes('Local review notes')) first = node
        if (node.textContent.includes('A changed line.')) last = node
      }
      if (first === null || last === null) throw new Error('Multiline Markdown target is missing')
      const range = document.createRange()
      range.setStart(first, 0)
      range.setEnd(last, last.textContent.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      last.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    await page.locator('.dia-selection-bar').waitFor({ state: 'visible' })
    const multilineAnchor = await page.evaluate(() => {
      const body = document.querySelector('[data-document-markdown]')
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let first = null
      let last = null
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent.includes('Local review notes')) first = node
        if (node.textContent.includes('A changed line.')) last = node
      }
      if (first === null || last === null) throw new Error('Markdown anchor nodes are missing')
      const range = document.createRange()
      range.setStart(last, last.textContent.length - 1)
      range.setEnd(last, last.textContent.length)
      const final = range.getBoundingClientRect()
      range.selectNodeContents(first)
      const firstRect = range.getBoundingClientRect()
      const action = document.querySelector('.dia-selection-bar').getBoundingClientRect()
      return {
        firstBottom: firstRect.bottom,
        finalTop: final.top,
        lastBottom: final.bottom,
        actionTop: action.top,
      }
    })
    assert(
      multilineAnchor.firstBottom < multilineAnchor.finalTop &&
        Math.abs(multilineAnchor.actionTop - multilineAnchor.lastBottom - 8) < 3,
      `The shared selection action must anchor below the final Markdown line: ${JSON.stringify(multilineAnchor)}`,
    )
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await filePreview.locator('[data-document-markdown]').evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const start = node.textContent.indexOf('A changed line.')
        if (start < 0) continue
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + 'A changed line.'.length)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        return
      }
      throw new Error('Markdown selection target is missing')
    })
    await page.locator('.dia-selection-bar').getByRole('button', { name: '添加注解' }).click()
    await fileEditor.waitFor({ state: 'visible' })
    await page.setViewportSize({ width: 390, height: 850 })
    await page.waitForFunction(() => {
      const rect = document.querySelector('.dia-record-editor--quick')?.getBoundingClientRect()
      return rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })
    await fileEditor.getByRole('textbox', { name: '你的注解' }).fill('Check this Markdown line.')
    await fileEditor.getByRole('button', { name: '保存', exact: true }).click()
    await fileEditor.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('.dia-marker').nth(1).waitFor({ state: 'visible' })
    const fileMarkers = await page
      .locator('.dia-marker')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-annotation-ids')))
    assert(
      fileMarkers.length >= 2 && fileMarkers.every((ids) => ids?.split(' ').length === 1),
      `Whole-file and text-range notes need distinct bubbles: ${JSON.stringify(fileMarkers)}`,
    )
    const fileRecord = page.locator('.dia-record')
    if (!(await fileRecord.isVisible()))
      await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await fileRecord
      .locator('.dia-record-row')
      .filter({ hasText: 'Check this Markdown line.' })
      .getByRole('button', { name: '定位原文', exact: true })
      .click()
    await assertLocateFlash(page, '.dia-source-flash', 'File source')
    await filePreview.locator('[data-document-markdown]').evaluate((body) => {
      body.style.minHeight = '0'
      body.style.height = '60px'
      body.style.maxHeight = '60px'
      body.style.overflowY = 'auto'
      const spacer = document.createElement('div')
      spacer.style.height = '800px'
      body.append(spacer)
      body.scrollTop = body.scrollHeight
    })
    await page.waitForFunction(() => document.querySelector('[data-document-markdown]')?.scrollTop > 100)
    await page.waitForFunction(() => document.querySelectorAll('.dia-marker').length === 1)
    await filePreview.locator('[data-document-markdown]').evaluate((body) => {
      body.scrollTop = 0
    })
    await page.waitForFunction(() => document.querySelectorAll('.dia-marker').length >= 2)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const restoredWorkspace = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
    await restoredWorkspace.waitFor()
    if ((await restoredWorkspace.getAttribute('aria-expanded')) !== 'true') await restoredWorkspace.click()
    const restoredGroup = page.getByRole('treeitem', { name: /未分组/ }).first()
    await restoredGroup.waitFor()
    if ((await restoredGroup.getAttribute('aria-expanded')) !== 'true') await restoredGroup.click()
    await page.getByRole('treeitem', { name: /Official source review/ }).click()
    await page.locator('.dia-assistant__body').getByRole('button', { name: 'notes.md' }).click()
    await filePreview.waitFor({ state: 'visible' })
    await page.locator('.dia-marker').nth(1).waitFor({ state: 'visible' })
    await page.screenshot({ path: join(artifacts, 'official-file-preview-profile.png'), fullPage: true })
    console.log(
      'PASS Markdown final-line anchor, narrow editor, separate bubbles, scroll, and refresh recovery',
    )
    await page.locator('.dia-assistant__body').getByRole('button', { name: 'example.ts' }).click()
    const codePreview = page.locator('[data-textpreview-url][data-document-preview$="/code"]')
    await codePreview.locator('[data-code-preview] pre .line').nth(1).waitFor({ state: 'visible' })
    await codePreview
      .locator('[data-official-file-annotate]:not([disabled])')
      .first()
      .waitFor({ state: 'visible' })
    const codeDrag = await codePreview.locator('[data-code-preview]').evaluate((body) => {
      const lines = body.querySelectorAll('pre .line')
      const textNode = (line) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent.length > 0) return node
        }
        throw new Error('Highlighted code line has no text')
      }
      const first = textNode(lines[0])
      const second = textNode(lines[1])
      const start = document.createRange()
      start.setStart(first, 0)
      start.setEnd(first, 1)
      const end = document.createRange()
      end.setStart(second, Math.max(0, second.length - 1))
      end.setEnd(second, second.length)
      const startRect = start.getBoundingClientRect()
      const endRect = end.getBoundingClientRect()
      return {
        from: { x: startRect.left + 1, y: (startRect.top + startRect.bottom) / 2 },
        to: { x: endRect.right - 1, y: (endRect.top + endRect.bottom) / 2 },
      }
    })
    await page.mouse.move(codeDrag.from.x, codeDrag.from.y)
    await page.mouse.down()
    await page.mouse.move(codeDrag.to.x, codeDrag.to.y, { steps: 10 })
    await page.mouse.up()
    const codeSelection = await page.evaluate(() => window.getSelection()?.toString())
    assert(
      codeSelection?.includes('const first') && codeSelection.includes('const'),
      `Native code selection was ${JSON.stringify(codeSelection)}`,
    )
    await page.locator('.dia-selection-bar').waitFor({ state: 'visible', timeout: 5_000 })
    await page.screenshot({ path: join(artifacts, 'official-code-selection-profile.png'), fullPage: true })
    await page.locator('.dia-selection-bar').getByRole('button', { name: '添加注解' }).click()
    await fileEditor.waitFor({ state: 'visible' })
    await page.screenshot({ path: join(artifacts, 'official-code-editor-profile.png'), fullPage: true })
    await cancelBlankNewEditor(page, fileEditor, 'Code file selection')
    console.log('PASS native multiline code selection shows the shared action and blank cancellation')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await selectReadingSource(page, 'Review the changed ')
    await page.locator('.dia-selection-bar').getByRole('button', { name: '添加注解' }).click()
    await fileEditor.getByRole('textbox', { name: '你的注解' }).fill('Review this reply.')
    await fileEditor.getByRole('button', { name: '保存', exact: true }).click()
    await fileEditor.waitFor({ state: 'hidden' })
    const record = page.locator('.dia-record')
    if (!(await record.isVisible()))
      await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await record
      .locator('.dia-record-row')
      .filter({ hasText: 'Review this reply.' })
      .getByRole('button', { name: '定位原文', exact: true })
      .click()
    await assertLocateFlash(page, '.dia-quote-flash', 'Reply source')
    await record.getByRole('tab', { name: '文件', exact: true }).click()
    assert.equal(await record.locator('.dia-record-row').count(), 2)
    await record.getByRole('tab', { name: 'Diff', exact: true }).click()
    assert.equal(await record.locator('.dia-record-row').count(), 1)
    await record.getByRole('tab', { name: '正文', exact: true }).click()
    assert.equal(await record.locator('.dia-record-row').count(), 1)
    await record.getByRole('tab', { name: '全部', exact: true }).click()
    assert.equal(await record.locator('.dia-record-row').count(), 4)
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    const composer = page.locator('[data-composer-card] [contenteditable="true"]')
    await composer.click()
    await composer.press('End')
    await composer.pressSequentially('Review official sources.')
    await composer.press('Enter')
    await page.locator('.dia-user-submission').waitFor()
    const logged = await request('read-session', { sessionId: official.sessionId })
    const admissions = logged.events.filter(
      (event) => event.type === 'user/message' && event.data.source?.annotationSubmission,
    )
    assert.equal(admissions.length, 1)
    const payload = admissions[0].data.source.annotationSubmission
    assert.equal(payload.overallRequirement, 'Review official sources.')
    assert.deepEqual(payload.annotations.map((item) => item.source?.kind).sort(), [
      'file',
      'file',
      'message',
      'official-diff',
    ])
    const diffAnnotation = payload.annotations.find((item) => item.source?.kind === 'official-diff')
    assert.equal(diffAnnotation?.source?.side, 'new')
    assert.equal(diffAnnotation?.quote.exact, 'changed')
    assert.ok(diffAnnotation?.source?.startColumn !== undefined)
    if (!(await record.isVisible()))
      await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    try {
      await page.waitForFunction(
        () => document.querySelector('.dia-record__progress')?.textContent?.includes('4 已发送'),
        null,
        { timeout: 5_000 },
      )
    } catch {
      const rows = await record
        .locator('.dia-record-row')
        .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
      throw new Error(`Sent official annotations still show pending: ${JSON.stringify(rows)}`)
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    const sentWorkspace = page.getByRole('treeitem', { name: /Annotation smoke/ }).first()
    await sentWorkspace.waitFor()
    if ((await sentWorkspace.getAttribute('aria-expanded')) !== 'true') await sentWorkspace.click()
    const sentGroup = page.getByRole('treeitem', { name: /未分组/ }).first()
    await sentGroup.waitFor()
    if ((await sentGroup.getAttribute('aria-expanded')) !== 'true') await sentGroup.click()
    await page.getByRole('treeitem', { name: /Official source review/ }).click()
    if (!(await record.isVisible()))
      await page.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await page.waitForFunction(() =>
      document.querySelector('.dia-record__progress')?.textContent?.includes('4 已发送'),
    )
    for (const opinion of ['Review this reply.', 'Review the entire file.', 'Check the changed line.']) {
      const sentRow = record.locator('.dia-record-row').filter({ hasText: opinion })
      await sentRow.getByRole('button', { name: '重新随消息发送', exact: true }).click()
      assert.match(await sentRow.getAttribute('aria-label'), /已发送$/u)
      assert.match(await record.locator('.dia-record__progress').innerText(), /4 已发送/u)
      await sentRow.getByRole('button', { name: '取消随消息发送', exact: true }).click()
    }
    const modelRequests = await request('model-requests')
    assert.deepEqual(
      modelRequests.at(-1).find((message) => message.id === admissions[0].data.id),
      admissions[0].data,
    )
    const retry = await request('retry-official-submission')
    assert.match(retry.result?.result?.text, /already accepted/)
    assert.equal(retry.before, retry.after)
    console.log(
      'PASS source filters, official Composer payload, Session log, model input, and retry identity',
    )
  }
  if (process.env.DSH_RELEASE_SCREENSHOTS === '1') {
    await captureReleaseScreenshots(page, request)
    console.log('PASS seven release screenshots captured from the Chinese Web profile')
  }
  await mkdir(artifacts, { recursive: true })
  await writeFile(
    join(artifacts, 'acceptance-geometry.json'),
    `${JSON.stringify(acceptanceGeometry, null, 2)}\n`,
  )
  assert.equal(pageErrors.length, 0, `${pageErrors.length} browser errors: ${pageErrors[0] ?? ''}`)
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
