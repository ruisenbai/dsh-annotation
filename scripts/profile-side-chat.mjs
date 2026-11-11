/** Built-package side-chat acceptance through an isolated official dsh web profile and Loader. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { exerciseSideAnnotations } from './profile-side-annotations.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
// Point the isolated profile at the installed distribution when checking release downloads.
const installedIndex = process.argv.indexOf('--installed-package')
if (installedIndex >= 0 && !process.argv[installedIndex + 1])
  throw new Error('Missing installed package path')
const mountedPackage =
  installedIndex < 0 ? project : await realpath(resolve(process.argv[installedIndex + 1]))
if (installedIndex >= 0) {
  const source = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  const installed = JSON.parse(await readFile(join(mountedPackage, 'package.json'), 'utf8'))
  assert.equal(installed.name, source.name)
  assert.equal(installed.version, source.version)
  for (const path of ['lib/index.js', 'lib/client.js', 'lib/invariant.js'])
    assert.deepEqual(await readFile(join(mountedPackage, path)), await readFile(join(project, path)))
}
const fixture = new URL('../tests/profile-fixtures/side-chat/', import.meta.url)
const scenario = JSON.parse(await readFile(new URL('scenario.json', fixture), 'utf8'))
const cliManifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
const cliManifest = JSON.parse(await readFile(cliManifestPath, 'utf8'))
const baseline = JSON.parse(await readFile(join(project, 'source-baseline.json'), 'utf8'))
assert.equal(cliManifest.version, baseline.version, 'Use the matching current Harness build')
await access(join(project, 'lib/client.js'))
await access(join(project, 'lib/index.js'))
await mkdir(join(project, 'artifacts/browser'), { recursive: true })
const artifacts = await mkdtemp(join(project, 'artifacts/browser/side-chat-'))
const root = await mkdtemp(join(tmpdir(), 'dsh-annotation-side-chat-'))
const pending = new Map()
let child
let completion
let browser
let page
let nextId = 0
let output = ''
let forced = false
const candidateClient = await readFile(join(project, 'lib/client.js'))
const candidateLoaded = Promise.withResolvers()
const hostBuild = {
  cliManifest: await realpath(cliManifestPath),
  node: process.version,
  artifacts: {},
  loaded: {},
}
const hostCandidates = new Map()
for (const name of [
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-conversation',
]) {
  const manifestPath = fileURLToPath(import.meta.resolve(`${name}/package.json`))
  const dir = dirname(await realpath(manifestPath))
  const bytes = await readFile(join(dir, 'lib/client.js'))
  hostBuild.artifacts[name] = { path: join(dir, 'lib/client.js'), sha256: sha256(bytes) }
  hostCandidates.set(name, bytes)
}
const evidence = {
  hostBuild,
  hostVersion: cliManifest.version,
  sources: {},
  artifacts: {},
  loaded: null,
  checks: [],
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function hashSources(directory, prefix = 'src') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory()) await hashSources(path, relative)
    else evidence.sources[relative] = sha256(await readFile(path))
  }
}
await hashSources(join(project, 'src'))
for (const path of [
  'lib/client.js',
  'lib/index.js',
  'scripts/profile-side-chat.mjs',
  'scripts/profile-side-annotations.mjs',
  'tests/profile-fixtures/side-chat-observer.mjs',
  'tests/profile-fixtures/side-chat/annotation-model-message.expected.txt',
  'snapshots/web/side-chat-roundtrip/session.v4.jsonl',
  'snapshots/web/side-chat-roundtrip/system-prompt.expected.md',
  'snapshots/web/side-chat-roundtrip/tool-schemas.expected.json',
  'snapshots/web/side-chat-roundtrip/snapshot.yml',
  'snapshots/web/side-annotations-roundtrip/session.v4.jsonl',
  'snapshots/web/side-annotations-roundtrip/system-prompt.expected.md',
  'snapshots/web/side-annotations-roundtrip/tool-schemas.expected.json',
  'snapshots/web/side-annotations-roundtrip/snapshot.yml',
])
  evidence.artifacts[path] = sha256(await readFile(join(project, path)))

function observeCandidate(target) {
  target.on('response', (response) => {
    if (
      response.request().resourceType() !== 'script' ||
      !new URL(response.url()).pathname.startsWith('/plugins/')
    )
      return
    void response
      .body()
      .then((bytes) => {
        for (const [name, candidate] of hostCandidates) {
          if (bytes.indexOf(candidate) >= 0)
            hostBuild.loaded[name] = { path: new URL(response.url()).pathname, sha256: sha256(candidate) }
        }
        const offset = bytes.indexOf(candidateClient)
        if (offset < 0) return
        evidence.loaded = {
          path: new URL(response.url()).pathname,
          responseSha256: sha256(bytes),
          candidateOffset: offset,
          candidateBytes: candidateClient.length,
          candidateSha256: sha256(bytes.subarray(offset, offset + candidateClient.length)),
        }
        assert.equal(evidence.loaded.candidateSha256, evidence.artifacts['lib/client.js'])
        candidateLoaded.resolve()
      })
      .catch((error) => candidateLoaded.reject(error))
  })
}

function redact(value) {
  return String(value).replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/gu, '$1?<redacted>')
}

/** Bound an observable transition; time is never used as readiness evidence. */
async function deadline(operation, label, ms = 90_000) {
  let timer
  try {
    return await Promise.race([
      operation,
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
    child.send({ type: 'annotation-side-chat-smoke', id, action, payload }, (error) => {
      if (error) reject(error)
    })
  })
  try {
    return await deadline(reply, `IPC ${action}`)
  } finally {
    pending.delete(id)
  }
}

/** Use an existing current-format recording as the schema template, with explicit fixture-owned values. */
async function seedMain(workspace, sessionId, source, title, attach = true) {
  const template = (
    await readFile(new URL('../snapshots/web/reading-first/session.v4.jsonl', import.meta.url), 'utf8')
  )
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
  const identities = new Map([
    ['{{session:1}}', sessionId],
    ['{{message:1}}', `${sessionId}:user`],
    ['{{message:2}}', `${sessionId}:assistant`],
    ['{{cwd}}', workspace],
    ['Reading-first summary', title],
    ['A compact summary keeps the conversation easy to read.', source],
    ['annotation-fixture', 'annotation-side-chat-fixture'],
  ])
  const substitute = (value) => {
    if (typeof value === 'string') return identities.get(value) ?? value
    if (Array.isArray(value)) return value.map(substitute)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]))
    }
    return value
  }
  const [{ type, ...header }, ...rows] = substitute(template)
  assert.equal(type, 'session')
  const events = rows.map((event, seq) => ({ ...event, seq, time: seq }))
  const actual = await request('seed-session', { header, events, attach })
  assert.deepEqual(actual.header, header)
  assert.deepEqual(actual.events, events)
  return { header, events }
}

async function openListedSession(sessionId) {
  if (await mainBody(sessionId).isVisible()) return
  const row = page.locator(`[role="treeitem"][data-row-key="session:${sessionId}"]`)
  const workspace = page
    .locator('[role="treeitem"][data-row-key^="workspace:"]')
    .filter({ has: page.getByText('Side-chat smoke', { exact: true }) })
    .first()
  await workspace.waitFor()
  if ((await workspace.getAttribute('aria-expanded')) !== 'true')
    await workspace.getByText('Side-chat smoke', { exact: true }).click()
  await row.waitFor()
  await row.click()
}

async function openMain(sessionId, source) {
  await openListedSession(sessionId)
  await mainBody(sessionId)
    .getByText(source.split(/\n|\. /u)[0], { exact: false })
    .waitFor()
}

function mainBody(sessionId, target = page) {
  return target.locator(`[data-dsh-annotation-message-id="${sessionId}:assistant"] .dia-assistant__body`)
}

function mainFlow(sessionId, target = page) {
  return target.locator(`[data-conversation-content][data-conversation-session="${sessionId}"]`)
}

function composer(flow) {
  return flow.locator('[data-composer-card] [contenteditable="true"]').first()
}

async function selectText(body, exact, target = page) {
  await body.evaluate((element, text) => {
    // Synthetic pointer dispatch has no browser focus default. A real source selection
    // releases the borrowed draft editor before the new document range is installed.
    if (document.activeElement instanceof HTMLElement && !element.contains(document.activeElement))
      document.activeElement.blur()
    const start = element.textContent.indexOf(text)
    if (start < 0) throw new Error(`The exact source is not rendered: ${text}`)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let offset = 0
    let owner
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const end = offset + node.textContent.length
      if (owner === undefined && start >= offset && start < end) {
        range.setStart(node, start - offset)
        owner = node.parentElement
      }
      if (owner !== undefined && start + text.length <= end) {
        range.setEnd(node, start + text.length - offset)
        const selected = window.getSelection()
        owner.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        owner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        selected.removeAllRanges()
        selected.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        owner.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
        return
      }
      offset = end
    }
    throw new Error(`The rendered source range cannot be restored: ${text}`)
  }, exact)
  const toolbar = target.getByRole('toolbar', { name: '选区操作', exact: true })
  await toolbar.waitFor({ state: 'visible' })
  assert.equal(await toolbar.count(), 1, 'Only the selected Conversation owns an accessible toolbar')
  return toolbar
}

/** The active chat's browser-owned pending state, as the panel renders it. */
async function association(sessionId) {
  const stored = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${id}`)),
    sessionId,
  )
  assert.ok(stored !== null, 'The main Session keeps its side-chat association')
  const active = stored.chats.find((chat) => chat.sideChatId === stored.activeSideChatId)
  assert.ok(active, 'The stored association selects one of its chats')
  return active
}

/**
 * Open the side chat from the Host right Sidebar's navigation area.
 *
 * The launcher is the guide card `data-sidebar-right-guide-entry`, exactly like
 * every other right-Sidebar entry: there is no composer button to click.
 */
async function openSide(sessionId) {
  await mainFlow(sessionId).waitFor({ state: 'visible' })
  // A narrow layout collapses the right column; its chrome toggle re-expands it
  // before the guide page and its entry capsules mount.
  const sidePanel = page
    .locator(`[data-sidebar-right-session="${sessionId}"][data-sidebar-right-panel]`)
    .first()
  if ((await sidePanel.getAttribute('data-sidebar-right-open')) !== 'true') {
    await page.locator('[data-sidebar-right-expand]:visible').click()
    await sidePanel.waitFor({ state: 'visible' })
  }
  const card = page.locator('[data-sidebar-right-guide-entry="annotationsidechat"]')
  const panel = page.locator(`[data-dia-side-chat][data-main-session="${sessionId}"]`)
  if ((await panel.count()) === 0 || !(await panel.first().isVisible())) {
    await card.first().click()
  }
  const side = page.locator(`[data-dia-side-chat][data-main-session="${sessionId}"]`)
  await side.waitFor({ state: 'visible' })
  await side
    .locator('[data-conversation-content]:visible, [data-dia-side-chat-empty]:visible')
    .first()
    .waitFor({ state: 'visible' })
  await waitForSideLayout(side)
  return side
}

/** Wait until the Host reports the side conversation has settled its layout. */
async function waitForSideLayout(side) {
  await side.evaluate(async (element) => {
    for (let ancestor = element; ancestor !== null; ancestor = ancestor.parentElement) {
      await Promise.all(ancestor.getAnimations().map((animation) => animation.finished))
    }
  })
  await page.waitForFunction(
    (id) => {
      const side = document.querySelector(`[data-dia-side-chat][data-main-session="${id}"]`)
      return (
        side !== null &&
        side.closest('[data-sidebar-right-opening="true"]') === null &&
        side.closest('[data-animating="true"]') === null
      )
    },
    await side.getAttribute('data-main-session'),
  )
}

async function inspectLayout(side, label) {
  await waitForSideLayout(side)
  const geometry = await side.evaluate((element) => {
    const bounds = (target) => {
      if (target === null) return null
      const rect = target.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: target.clientWidth,
        clientHeight: target.clientHeight,
        scrollWidth: target.scrollWidth,
        scrollHeight: target.scrollHeight,
      }
    }
    const styles = (target) => {
      if (target === null) return null
      const style = getComputedStyle(target)
      return Object.fromEntries(
        [
          'width',
          'minWidth',
          'maxWidth',
          'display',
          'flex',
          'flexDirection',
          'gridTemplateColumns',
          'transform',
          'overflow',
          'overflowX',
          'overflowY',
        ].map((key) => [key, style[key]]),
      )
    }
    const input = element.querySelector('[data-composer-card]')
    const close = element.closest('[data-dockkit-pane]')?.querySelector('[data-dockkit-tab-close]')
    const references = element.querySelector('.dia-side-chat-record-panel')
    const conversation = element.querySelector('[data-conversation-content]')
    const ancestry = (target) => {
      const ancestors = []
      for (let ancestor = target; ancestor !== null; ancestor = ancestor.parentElement) {
        ancestors.push({
          tag: ancestor.tagName,
          className: ancestor.className,
          attributes: Object.fromEntries(
            [...ancestor.attributes]
              .filter(({ name }) => name.startsWith('data-') || name === 'role')
              .map(({ name, value }) => [name, value]),
          ),
          bounds: bounds(ancestor),
          styles: styles(ancestor),
        })
      }
      return ancestors
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: bounds(element),
      pane: bounds(element.closest('[data-dockkit-pane]')),
      conversation: bounds(conversation),
      input: bounds(input),
      close: bounds(close),
      references: bounds(references),
      styles: {
        root: styles(element),
        pane: styles(element.closest('[data-dockkit-pane]')),
        conversation: styles(conversation),
        scroll: styles(element.querySelector('[data-conversation-scroll]')),
        input: styles(input),
      },
      ancestors: {
        root: ancestry(element),
        conversation: ancestry(conversation),
        input: ancestry(input),
      },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }
  })
  await writeFile(join(artifacts, `${label}.json`), `${JSON.stringify(geometry, null, 2)}\n`)
  await page.screenshot({ path: join(artifacts, `${label}.png`), fullPage: true })
  assert.equal(geometry.overflow, false, `${label} must not overflow the viewport horizontally`)
  for (const part of [geometry.input, geometry.close]) {
    assert.ok(
      part !== null &&
        part.width > 0 &&
        part.height > 0 &&
        part.left >= -1 &&
        part.right <= geometry.viewport.width + 1 &&
        part.top >= -1 &&
        part.bottom <= geometry.viewport.height + 1,
      `${label} keeps input and close reachable: ${JSON.stringify(geometry)}`,
    )
  }
  await assertComposerAtBottom(side.locator('[data-conversation-content]:visible'), label)
  return geometry
}

/** Measure the real embedded Conversation's footer against its assigned pane. */
async function assertComposerAtBottom(flow, label) {
  const geometry = await flow.evaluate(async (element) => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    const bounds = (target) => {
      if (target === null) return null
      const rect = target.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }
    }
    const panel = element.closest('[data-dia-side-chat]')
    const scroll = element.querySelector('[data-conversation-scroll]')
    const paneBody = element.closest('[data-dockkit-pane]')?.lastElementChild
    return {
      panel: bounds(panel),
      conversation: bounds(element),
      scroll: bounds(scroll),
      seat: bounds(element.querySelector('[data-composer-seat]')),
      input: bounds(element.querySelector('[data-composer-card]')),
      paneScroll:
        paneBody === undefined
          ? null
          : {
              height: paneBody.clientHeight,
              scrollHeight: paneBody.scrollHeight,
            },
    }
  })
  await writeFile(join(artifacts, `${label}-composer.json`), `${JSON.stringify(geometry, null, 2)}\n`)
  for (const part of [
    geometry.panel,
    geometry.conversation,
    geometry.scroll,
    geometry.seat,
    geometry.input,
  ]) {
    assert.ok(
      part !== null && part.height > 0 && part.width > 0,
      `${label} has a visible composer: ${JSON.stringify(geometry)}`,
    )
  }
  assert.ok(
    Math.abs(geometry.seat.bottom - geometry.panel.bottom) <= 2,
    `${label} keeps the composer at the pane's bottom: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    Math.abs(geometry.conversation.bottom - geometry.panel.bottom) <= 2,
    `${label} fills the pane with the real Conversation: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    geometry.paneScroll.scrollHeight <= geometry.paneScroll.height + 1,
    `${label} keeps message scrolling inside the Conversation: ${JSON.stringify(geometry)}`,
  )
  return geometry
}

/** Replay the captured side Session through persistence and its ordinary full-page renderer. */
async function runRecordedSideChatSnapshot(workspace, annotations = false) {
  const name = annotations ? 'side-annotations-roundtrip' : 'side-chat-roundtrip'
  const directory = new URL(`../snapshots/web/${name}/`, import.meta.url)
  const rows = (await readFile(new URL('session.v4.jsonl', directory), 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
  const prompt = (await readFile(new URL('system-prompt.expected.md', directory), 'utf8')).trimEnd()
  const schemas = JSON.parse(await readFile(new URL('tool-schemas.expected.json', directory), 'utf8')).initial
  const sessionId = `annotation-recorded-${name}`
  const substitute = (value) => {
    if (typeof value === 'string') {
      if (value === '{{tools}}') return schemas
      if (value === '{{system}}') return prompt.replaceAll('{{cwd}}', workspace)
      return value
        .replaceAll('{{cwd}}', workspace)
        .replace(
          /\{\{(session|message|command|approval|workflow|rpc|retry|id):(\d+)\}\}/g,
          (_match, kind, ordinal) =>
            kind === 'session' && ordinal === '1' ? sessionId : `${sessionId}:${kind}:${ordinal}`,
        )
    }
    if (Array.isArray(value)) return value.map(substitute)
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]))
    return value
  }
  const [{ type, ...header }, ...records] = substitute(rows)
  assert.equal(type, 'session')
  assert.equal(header.version, 4)
  assert.equal(header.id, sessionId)
  assert.equal(records.at(-1)?.type, 'session/end-seed')
  const events = records.map((event, seq) => ({ ...event, seq, time: 0 }))
  const expected = { header, events }
  const actual = await request('seed-session', expected)
  assert.deepEqual(actual.header, header)
  assert.deepEqual(actual.events, events)
  const modelRequests = (await request('inspect')).modelRequests
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  await openListedSession(sessionId)
  const flow = page.locator(`[data-conversation-content][data-conversation-session="${sessionId}"]:visible`)
  await composer(flow).waitFor({ state: 'visible' })
  if (annotations) {
    assert.equal(await flow.locator('[data-dia-side-chat-history-toggle]').count(), 0)
    await flow.locator('.dia-timeline').waitFor({ state: 'visible' })
    const payload = events.find(
      (event) => event.type === 'user/message' && event.data.source?.annotationSubmission,
    )?.data.source.annotationSubmission
    assert.equal(payload.protocolVersion, 6)
    assert.equal(payload.sessionId, sessionId)
    assert.equal(payload.annotations[0].source.sessionId, scenario.mainSessionId)
    assert.ok((await flow.locator('.dia-timeline').innerText()).includes('1 条注解'))
    await flow.getByRole('button', { name: '显示注解记录', exact: true }).click()
    await flow.getByRole('button', { name: '定位原文', exact: true }).click()
    await mainFlow(scenario.mainSessionId).locator('.dia-quote-flash').first().waitFor({ state: 'visible' })
    await openListedSession(sessionId)
  } else {
    await flow.locator('[data-dia-side-chat-history-toggle]').click()
    assert.deepEqual(
      await flow.locator('[data-dia-side-chat-history] .dia-timeline-item q').allTextContents(),
      scenario.references,
    )
  }
  const replayed = await request('read-session', { sessionId })
  assert.deepEqual(replayed.header, header)
  assert.deepEqual(replayed.events, events)
  assert.equal((await request('inspect')).modelRequests, modelRequests)
  await writeFile(join(artifacts, `recorded-${name}.json`), `${JSON.stringify(replayed, null, 2)}\n`)
  await page.screenshot({ path: join(artifacts, `recorded-${name}.png`), fullPage: true })
  evidence.checks.push({
    name: `${name}: recorded side Session replays through the ordinary view with unchanged persisted output`,
    status: 'passed',
  })
  console.log('PASS recorded side Session, ordinary full page and persisted-output round trip')
  await openMain(scenario.mainSessionId, scenario.source)
}

try {
  const home = join(root, 'home')
  const profile = join(home, 'profiles/web')
  const workspace = join(root, 'Side-chat smoke')
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await mkdir(workspace)
  await symlink(mountedPackage, join(profile, 'node_modules/dsh-annotation'), 'junction')
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-annotation': `link:${mountedPackage}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-annotation'] } },
    }),
  )
  const patch = join(root, 'side-chat-observer.patch.yml')
  await writeFile(
    patch,
    JSON.stringify([
      ...['llm-deepseek', 'llm-pi-ai', 'session-title-llm', 'agent-instructions', 'directory-picker'].map(
        (id) => ({ id, disabled: true }),
      ),
      { id: 'agent-default-model', config: { provider: 'annotation-side-chat-fixture', model: 'fixture' } },
      {
        insert: [
          { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
          { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
          {
            id: 'annotation-side-chat-observer',
            name: new URL('../tests/profile-fixtures/side-chat-observer.mjs', import.meta.url).href,
          },
        ],
      },
    ]),
  )
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
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  completion = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      const error = new Error(`dsh exited: code=${code}, signal=${signal}\n${output}`)
      rejectReady(error)
      for (const waiter of pending.values()) waiter.reject(error)
      resolve({ code, signal })
    }),
  )
  child.once('error', rejectReady)
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      output = (output + String(data).replace(/([?&]token=)[^\s&]+/g, '$1<redacted>')).slice(-60_000)
      if (output.includes('dsh web: http://')) resolveReady()
    })
  child.on('message', (message) => {
    const waiter = pending.get(message?.id)
    if (!waiter) return
    if (message.error) waiter.reject(new Error(message.error))
    else waiter.resolve(message.result)
  })
  await deadline(ready, 'Isolated Web readiness')
  await request('prepare')
  const initial = await request('inspect')
  assert.equal(initial.bundles.find((bundle) => bundle.name === 'dsh-annotation')?.enabled, true)
  console.log(`Isolated side-chat profile URL: ${new URL(initial.url).origin}`)
  const mainSeed = await seedMain(workspace, scenario.mainSessionId, scenario.source, 'Side-chat source A')
  const otherSeed = await seedMain(
    workspace,
    scenario.otherSessionId,
    scenario.otherSource,
    'Side-chat source B',
  )
  const seeded = await request('inspect')
  assert.deepEqual(seeded.sessionIds.sort(), [scenario.mainSessionId, scenario.otherSessionId].sort())
  assert.deepEqual(
    seeded.workspaceSessionIds.sort(),
    [scenario.mainSessionId, scenario.otherSessionId].sort(),
  )
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    colorScheme: 'dark',
  })
  page.setDefaultTimeout(30_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  observeCandidate(page)
  await page.addInitScript((sessionId) => {
    if (localStorage.getItem('dsh.sessions.current') === null)
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, scenario.mainSessionId)
  await page.goto(initial.url, { waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  await deadline(candidateLoaded.promise, 'Candidate client artifact bytes')
  const continueButton = page.getByRole('button', { name: '继续', exact: true })
  if (await continueButton.isVisible()) await continueButton.click()
  console.log('PASS built plugin activates through the real Loader in an isolated Web instance')
  await mainBody(scenario.mainSessionId).waitFor({ state: 'visible' })
  if (process.argv.includes('--launch-only')) {
    await openMain(scenario.mainSessionId, scenario.source)
    assert.equal(await mainFlow(scenario.mainSessionId).count(), 1)
    assert.equal(await composer(mainFlow(scenario.mainSessionId)).count(), 1)
    await page.screenshot({ path: join(artifacts, 'launch-only.png'), fullPage: true })
    console.log('PASS real seeded main Conversation and official composer are available')
  } else if (process.argv.includes('--snapshot-only')) {
    await runRecordedSideChatSnapshot(workspace)
    await runRecordedSideChatSnapshot(workspace, true)
  } else {
    await exerciseSideAnnotations({
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
    })
    assert.deepEqual(
      (await request('read-session', { sessionId: scenario.mainSessionId })).events,
      mainSeed.events,
    )
    assert.deepEqual(
      (await request('read-session', { sessionId: scenario.otherSessionId })).events,
      otherSeed.events,
    )
    await runRecordedSideChatSnapshot(workspace)
    await runRecordedSideChatSnapshot(workspace, true)
  }
  assert.equal(pageErrors.length, 0, `Unexpected Client failures: ${JSON.stringify(pageErrors)}`)
} catch (error) {
  await writeFile(join(artifacts, 'launch-diagnostics.txt'), `${redact(output)}\n`)
  if (page && !page.isClosed()) {
    const visibleSide = page.locator('[data-dia-side-chat]:visible')
    if ((await visibleSide.count()) === 1) {
      try {
        await inspectLayout(visibleSide, 'failure-layout')
      } catch (layoutFailure) {
        console.error('Failure layout:', layoutFailure)
      }
    }
    console.error(
      await page.locator('[role="treeitem"]').evaluateAll((rows) =>
        rows.map((row) => ({
          key: row.getAttribute('data-row-key'),
          expanded: row.getAttribute('aria-expanded'),
          text: row.textContent,
        })),
      ),
    )
    console.error(await page.locator('body').innerText())
    await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
  }
  throw new Error(redact(error.stack ?? error))
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
    await writeFile(join(artifacts, 'repair-results.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    assert.equal(forced, false, 'The isolated Web profile must shut down without forced termination')
    console.log(`PASS isolated browser/profile cleanup; evidence: ${artifacts}`)
  }
}
