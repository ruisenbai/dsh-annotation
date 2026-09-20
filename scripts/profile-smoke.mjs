/** Built-package smoke through the installed official dsh web profile (no source imports). */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { exerciseTranscriptVisibility } from './profile-transcript-visibility.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
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

async function readRecordedReplay(directory, bindings) {
  const text = await readFile(new URL('session.v3.jsonl', directory), 'utf8')
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'Session fixture needs one trailing newline')
  const recorded = text
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line))
  const [{ type, ...header }, ...rows] = substituteIdentities(recorded, bindings)
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
  return {
    recorded,
    bindings,
    header,
    events,
    source: rows.find((event) => event.type === 'assistant/message').data.message.content[0].text,
  }
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
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '注解', exact: true }).click()
  const card = dialog.locator('.dia-plugin-card')
  await card.waitFor()
  return card
}

async function summaryGeometry(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  return page.locator('.dia-dock-shell').evaluate((shell) => {
    const body = shell.querySelector('.dia-dock-body')
    return {
      shell: shell.getBoundingClientRect().toJSON(),
      body: body.getBoundingClientRect().toJSON(),
      composer: document.querySelector('[data-composer-card]').getBoundingClientRect().toJSON(),
      shellBorder: getComputedStyle(shell).borderTopWidth,
      shellBackground: getComputedStyle(shell).backgroundColor,
      iconCount: shell.querySelectorAll('.dia-dock__icon').length,
    }
  })
}

try {
  const home = join(root, 'home')
  const profile = join(home, 'profiles/web')
  const workspace = join(root, 'workspace')
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await mkdir(workspace)
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
  const initial = await request('inspect')
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
  let card = await openAnnotationSettings(page)
  const visibilityCells = card.locator(
    '[data-transcript-visibility-grid] > .dia-plugin-card__field--visibility',
  )
  assert.equal(await visibilityCells.count(), 18)
  const wideFirst = await visibilityCells.nth(0).boundingBox()
  const wideSecond = await visibilityCells.nth(1).boundingBox()
  assert.ok(wideFirst)
  assert.ok(wideSecond)
  assert.ok(Math.abs(wideFirst.y - wideSecond.y) <= 1, 'Normal Settings width must use two columns')
  await page.setViewportSize({ width: 640, height: 900 })
  const narrowFirst = await visibilityCells.nth(0).boundingBox()
  const narrowSecond = await visibilityCells.nth(1).boundingBox()
  assert.ok(narrowFirst)
  assert.ok(narrowSecond)
  assert.ok(
    narrowSecond.y >= narrowFirst.y + narrowFirst.height,
    'Narrow Settings width must collapse to one column',
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  const toggle = card.getByRole('switch', { name: '启用 DSH 注解', exact: true })
  assert.equal(await toggle.getAttribute('aria-checked'), 'true')
  await toggle.click()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  const saved = await request('inspect')
  assert.equal(saved.settings.user.enabled, false)
  const settingsFile = await readFile(join(home, 'settings.yaml'), 'utf8')
  assert.match(settingsFile, /dsh-annotation:[\s\S]*enabled: false/)
  await page.reload({ waitUntil: 'domcontentloaded' })
  card = await openAnnotationSettings(page)
  const disabledToggle = card.getByRole('switch', { name: '启用 DSH 注解', exact: true })
  assert.equal(await disabledToggle.getAttribute('aria-checked'), 'false')
  await disabledToggle.click()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await request('inspect')).settings.user.enabled, true)
  if (process.env.DSH_PROFILE_SCREENSHOT) {
    await card
      .getByRole('region', { name: '会话记录显示', exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
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
  assert.deepEqual(modelMessage, admitted[0].data, 'Logged annotation message must equal actual model input')
  const reference = admitted[0].data.source.annotationSubmission.annotations[0]
  const modelText = modelMessage.content[0].text
    .replace(`Reply message: ${reference.messageId}`, 'Reply message: <assistant-message>')
    .replace(`Reply event seq: ${reference.messageSeq}`, 'Reply event seq: <assistant-seq>')
  assert.equal(
    `${modelText}\n`,
    await readFile(new URL('../tests/profile-fixtures/model-message.expected.txt', import.meta.url), 'utf8'),
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
  await submissionCard.locator('summary').click()
  const conversation = `# Assistant\n${await page.locator('.dia-assistant__body').first().ariaSnapshot()}\n\n# Annotation submission\n${await submissionCard.ariaSnapshot()}\n`
  assert.equal(
    conversation,
    await readFile(new URL('../tests/profile-fixtures/conversation.expected.txt', import.meta.url), 'utf8'),
  )
  assert.equal(
    await page.locator('.dia-user').first().innerText(),
    'Please review [local notes](./notes.md).',
  )
  await page.getByText('1 条历史注解', { exact: true }).waitFor()
  console.log('PASS persisted user/assistant Markdown and annotation history render in the real conversation')

  const replay = await readingReplay(workspace)
  assertRecordedSession(
    await request('seed-session', { header: replay.header, events: replay.events }),
    replay,
  )
  assert.equal(initial.settings.value.compactSummary, true, 'Compact summaries must be enabled by default')
  assert.equal(
    Object.hasOwn(initial.settings.value, 'localTools'),
    false,
    'Local data tools must not be part of the effective settings',
  )
  await openReadingSession(page, workspace, replay.source)
  await selectReadingSource(page, replay.source)
  await page.getByRole('button', { name: '添加注解', exact: true }).click()
  const note = 'Clarify this recorded statement.'
  const editor = page.getByRole('textbox', { name: '你的注解', exact: true })
  await editor.fill(note)
  await page.getByRole('button', { name: '保存注解', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.locator('.dia-dock-shell[data-compact-summary="true"]').waitFor()
  const compact = await summaryGeometry(page)
  assert.equal(compact.iconCount, 0, 'Compact summaries must omit the leftmost annotation icon')
  assert.equal(parseFloat(compact.shellBorder), 0)
  assert.equal(compact.shellBackground, 'rgba(0, 0, 0, 0)')
  assert.ok(
    compact.body.width < compact.shell.width - 100,
    `Summary must fit its content: ${JSON.stringify(compact)}`,
  )
  assert.ok(Math.abs(compact.body.right - compact.shell.right) <= 1, 'Compact summary must align right')
  assert.ok(
    compact.body.left >= compact.composer.left + compact.composer.width / 2 &&
      compact.body.right <= compact.composer.right + 1 &&
      compact.body.bottom <= compact.composer.top + 1,
    `Compact summary must sit above the composer on its right side: ${JSON.stringify(compact)}`,
  )
  const artifacts = join(project, 'artifacts/browser')
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'compact-summary-profile-default.png'), fullPage: true })
  await page.getByRole('button', { name: '展开注解', exact: true }).click()
  const readingPanel = page.locator('.dia-inline-panel')
  await readingPanel.getByText(note, { exact: true }).waitFor()
  assert.equal(await readingPanel.locator('.dia-local-data, .dia-local-status').count(), 0)
  assert.equal(await readingPanel.getByRole('button', { name: /导出|清空草稿/u }).count(), 0)
  assert.equal(await readingPanel.getByText(/本地数据/u).count(), 0)
  await page.screenshot({ path: join(artifacts, 'local-data-removed-profile-panel.png'), fullPage: true })
  await page.getByRole('button', { name: '收起注解', exact: true }).click()
  await readingPanel.waitFor({ state: 'hidden' })
  assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
  console.log(
    'PASS recorded Session replay supports local annotations without local-data controls in the compact summary',
  )

  card = await openAnnotationSettings(page)
  const compactToggle = card.getByRole('switch', { name: '紧凑注解汇总', exact: true })
  assert.equal(await compactToggle.getAttribute('aria-checked'), 'true')
  assert.equal(
    await card.getByRole('switch').count(),
    21,
    'Three annotation settings and eighteen transcript filters remain',
  )
  assert.equal(await card.getByRole('switch', { name: '显示本地数据控件', exact: true }).count(), 0)
  await page.screenshot({ path: join(artifacts, 'compact-summary-profile-settings.png'), fullPage: true })
  await compactToggle.click()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await card.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await request('inspect')).settings.user.compactSummary, false)
  assert.match(
    await readFile(join(home, 'settings.yaml'), 'utf8'),
    /dsh-annotation:[\s\S]*compactSummary: false/,
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.dia-assistant__body').getByText(replay.source, { exact: true }).waitFor()
  await page.locator('.dia-dock-shell[data-compact-summary="false"]').waitFor()
  const full = await summaryGeometry(page)
  assert.equal(full.iconCount, 1, 'Disabling compact summaries must restore the leftmost icon')
  assert.ok(parseFloat(full.shellBorder) > 0)
  assert.notEqual(full.shellBackground, 'rgba(0, 0, 0, 0)')
  assert.ok(
    Math.abs(full.body.width - full.shell.width) <= 2,
    'Disabled summaries must restore the full-width bar',
  )
  assert.ok(
    full.body.width > compact.body.width + 100,
    'The restored bar must be wider than the compact summary',
  )
  await page.getByRole('button', { name: '展开注解', exact: true }).click()
  await page.locator('.dia-item').getByText(note, { exact: true }).waitFor()
  assert.equal(await readingPanel.locator('.dia-local-data, .dia-local-status').count(), 0)
  assert.equal(await readingPanel.getByRole('button', { name: /导出|清空草稿/u }).count(), 0)
  assert.equal(await readingPanel.getByText(/本地数据/u).count(), 0)
  assert.equal(
    await page.locator('.dia-item').count(),
    1,
    'The local annotation must survive settings and reload',
  )
  await page.getByRole('button', { name: '收起注解', exact: true }).click()
  await page.locator('.dia-inline-panel').waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(artifacts, 'compact-summary-profile-full-width.png'), fullPage: true })
  const reloaded = await request('inspect')
  assert.equal(reloaded.settings.user.compactSummary, false)
  assert.equal(
    reloaded.modelRequests,
    submission.requests.length,
    'The reading replay must not call the model',
  )
  assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
  console.log(
    'PASS saved compact-summary preference survives reload while the recorded Session remains unchanged',
  )
  await exerciseTranscriptVisibility(page, {
    request,
    readReplay: readRecordedReplay,
    openSession: openReadingSession,
    assertRecordedSession,
    workspace,
    artifacts,
    settingsPath: join(home, 'settings.yaml'),
  })
  assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
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
