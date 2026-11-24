/** Built-package side-chat acceptance through an isolated official dsh web profile and Loader. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { launchFixtureDesktop } from './profile-packaged-desktop.mjs'
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
// Point to a built source checkout when testing workspace capabilities newer than the public CLI.
const harnessRoot = process.env.DSH_SIDE_CHAT_HARNESS_ROOT
const cliManifestPath = harnessRoot
  ? join(harnessRoot, 'apps/cli/package.json')
  : fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
const cliManifest = JSON.parse(await readFile(cliManifestPath, 'utf8'))
const baseline = JSON.parse(await readFile(join(project, 'source-baseline.json'), 'utf8'))
if (!harnessRoot)
  assert.equal(cliManifest.version, baseline.version, 'Use the matching current Harness build')
await access(join(project, 'lib/client.js'))
await access(join(project, 'lib/index.js'))
await mkdir(join(project, 'artifacts/browser'), { recursive: true })
const artifacts = await mkdtemp(join(project, 'artifacts/browser/side-chat-'))
const root = await mkdtemp(join(tmpdir(), 'dsh-annotation-side-chat-'))
const packagedDir = process.env.DSH_ANNOTATION_PACKAGED_DIR
const desktop = process.argv.includes('--desktop')
if (desktop && !packagedDir) throw new Error('Pass DSH_ANNOTATION_PACKAGED_DIR for the Linux desktop build')
let gui
let authenticatedEntry
const pending = new Map()
function onReply(message) {
  const waiter = pending.get(message?.id)
  if (!waiter) return
  if (message.error) waiter.reject(new Error(message.error))
  else waiter.resolve(message.result)
}
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
  const hostPackage = {
    '@deepseek-ai/dsh-client-ui-workspace': 'packages/client/ui-workspace',
    '@deepseek-ai/dsh-api-session-controller': 'packages/api/session-controller',
    '@deepseek-ai/dsh-client-ui-conversation': 'packages/client/ui-conversation',
  }[name]
  const manifestPath = harnessRoot
    ? join(harnessRoot, hostPackage, 'package.json')
    : fileURLToPath(import.meta.resolve(`${name}/package.json`))
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
    const packet = { type: 'annotation-side-chat-smoke', id, action, payload }
    if (gui) {
      gui.send(packet)
      return
    }
    child.send(packet, (error) => {
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
  const template = (await readFile(new URL('parent-session.v4.jsonl', fixture), 'utf8'))
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
  return mainFlow(sessionId, target).locator(
    `[data-dsh-annotation-message-id="${sessionId}:assistant"] .dia-assistant__body`,
  )
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
        owner.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
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
async function association(sessionId, previousTabs = []) {
  const handle = await page.waitForFunction(
    ({ id, previousTabs }) => {
      const stored = JSON.parse(localStorage.getItem(`dsh-annotation:side-chat:v2:${id}`))
      return stored?.chats.find(
        (chat) =>
          chat.sideChatId === stored.activeSideChatId &&
          chat.sideSessionId &&
          !previousTabs.includes(chat.sideChatId),
      )
    },
    { id: sessionId, previousTabs },
  )
  try {
    return await handle.jsonValue()
  } finally {
    await handle.dispose()
  }
}

async function addControlSize(button) {
  return button.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect()
    const glyph = element.querySelector('svg').getBoundingClientRect()
    return [width, height, glyph.width, glyph.height].map((value) => Math.round(value * 10) / 10)
  })
}

/** Compare the guide card with the official file entry in the same pane. */
async function verifyGuideCard(card, hasChats) {
  const add = card.locator('[data-dia-side-chat-guide-new]')
  const toggle = card.locator('[data-dia-side-chat-guide-switch]')
  if (hasChats) await toggle.waitFor()
  await add.click({ trial: true })
  const { row, stockRow, title, stockTitle, plus, switcher, endInset } = await card.evaluate((element) => {
    const peer = element
      .closest('[data-sidebar-right-guide]')
      .querySelector('button[data-sidebar-right-guide-entry="files"]')
    const style = getComputedStyle(peer)
    const switchButton = element.querySelector('[data-dia-side-chat-guide-switch]')
    const rect = (target) => {
      const { x, y, width, height, right } = target.getBoundingClientRect()
      return { x, y, width, height, right }
    }
    return {
      row: rect(element),
      stockRow: rect(peer),
      title: rect(element.querySelector('.dia-side-chat-guide__title')),
      stockTitle: rect(peer.querySelector(':scope > span:nth-child(2)')),
      plus: rect(element.querySelector('[data-dia-side-chat-guide-new]')),
      switcher: switchButton === null ? undefined : rect(switchButton),
      endInset: parseFloat(style.paddingInlineEnd) + parseFloat(style.borderInlineEndWidth),
    }
  })
  const same = (actual, expected, name) =>
    assert.ok(Math.abs(actual - expected) <= 1, name + ': ' + actual + ' vs ' + expected)
  same(row.width, stockRow.width, 'guide card width')
  same(row.height, stockRow.height, 'guide card height')
  same(title.x - row.x, stockTitle.x - stockRow.x, 'guide label inset')
  same(row.right - plus.right, endInset, 'add button end inset')
  same(plus.y + plus.height / 2, row.y + row.height / 2, 'add button vertical center')
  assert.equal(switcher !== undefined, hasChats)
  if (switcher !== undefined) {
    same(switcher.right + 4, plus.x, 'switch and add button gap')
    same(switcher.y + switcher.height / 2, plus.y + plus.height / 2, 'guide action centers')
  }
  return addControlSize(add)
}

function sidebarFor(sessionId) {
  return page.locator('[data-sidebar-right-panel][data-sidebar-right-session="' + sessionId + '"]').first()
}

async function openGuideCard(sidebar) {
  const card = sidebar.locator('[data-sidebar-right-guide-entry="annotationsidechat"]:visible').first()
  if (!(await card.isVisible())) {
    const guide = sidebar.getByRole('tab', { name: /^开始/u }).first()
    if ((await guide.count()) > 0) await guide.click()
    else await sidebar.locator('[data-dockkit-add-tab]:visible').first().click()
  }
  await card.waitFor()
  return card
}

async function createFromSideTab(sessionId) {
  const sidebar = sidebarFor(sessionId)
  const empty = sidebar.locator('[data-dia-side-chat-new]:visible')
  if (await empty.isVisible()) {
    await empty.click()
    return
  }
  await sidebar.locator('[data-dockkit-tab][aria-selected="true"] [data-dia-side-chat-select]').click({
    button: 'right',
  })
  await page.getByRole('menuitem', { name: '新建侧边聊天', exact: true }).click()
}

async function restoreFromGuide(sessionId) {
  const card = await openGuideCard(sidebarFor(sessionId))
  await card.locator('[data-dia-side-chat-guide-switch]').click()
  await page.getByRole('menuitem', { name: /^恢复/u }).click()
}

/** Open the side chat through the Host right Sidebar's guide. */
async function openSide(sessionId, guideAction) {
  await mainFlow(sessionId).waitFor({ state: 'visible' })
  // A narrow layout collapses the right column; its chrome toggle re-expands it
  // before the guide page and its entry capsules mount.
  const sidePanel = sidebarFor(sessionId)
  if ((await sidePanel.getAttribute('data-sidebar-right-open')) !== 'true') {
    await page.locator('[data-sidebar-right-expand]:visible').click()
    await sidePanel.waitFor({ state: 'visible' })
  }
  const side = sidePanel.locator('[data-dia-side-chat]:visible').first()
  if (guideAction !== undefined || !(await side.isVisible())) {
    const card = await openGuideCard(sidePanel)
    if (guideAction !== undefined) {
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('[data-sidebar-right-panel][data-sidebar-right-session="' + id + '"]')
            ?.getAttribute('data-sidebar-right-opening') !== 'true',
        sessionId,
      )
      assert.deepEqual(await verifyGuideCard(card, guideAction === 'switch'), [28, 28, 14, 14])
      console.log(
        'PASS guide card and add button match stock controls at ' + page.viewportSize().width + 'px',
      )
      await page.screenshot({ path: join(artifacts, 'side-chat-guide-' + guideAction + '.png') })
    }
    if (guideAction === 'create') {
      await card.locator('[data-dia-side-chat-guide-new]').click()
    } else if (guideAction === 'switch') {
      await card.locator('[data-dia-side-chat-guide-switch]').tap()
      await page.getByRole('menuitem').first().tap()
    } else await card.click()
  }
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
      const side = [...document.querySelectorAll(`[data-dia-side-chat][data-main-session="${id}"]`)].find(
        (panel) => panel.checkVisibility(),
      )
      return (
        side !== null &&
        side.closest('[data-sidebar-right-opening="true"]') === null &&
        side.closest('[data-animating="true"]') === null
      )
    },
    await side.getAttribute('data-main-session'),
  )
}

/** Measure the controls within the Host strip, including its own clipping edge. */
async function verifyNativeTab(tab, side) {
  assert.equal(await side.locator('[data-dockkit-strip]').count(), 0)
  const actions = tab.locator('.dia-side-chat-tab-action')
  assert.equal(await actions.count(), 2)
  for (const button of await actions.all()) assert.deepEqual(await addControlSize(button), [28, 28, 16, 16])
  const placement = await tab.evaluate((element) => {
    const strip = element.closest('[data-dockkit-strip]')
    const scroll = element.closest('[data-dockkit-strip-tabs]').getBoundingClientRect()
    const buttons = [...element.querySelectorAll('.dia-side-chat-tab-action')]
    return {
      hostControls: strip.querySelector('[data-sidebar-right-toggle]') !== null,
      guide: [...strip.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent.trim() === '开始'),
      titleMask: getComputedStyle(element.querySelector('[data-dockkit-tab-title]')).maskImage,
      fits: buttons.every((button) => {
        const rect = button.getBoundingClientRect()
        return (
          rect.left >= Math.max(0, scroll.left) - 1 &&
          rect.right <= Math.min(innerWidth, scroll.right) + 1 &&
          getComputedStyle(button).visibility === 'visible'
        )
      }),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }
  })
  assert.deepEqual(placement, {
    hostControls: true,
    guide: true,
    titleMask: 'none',
    fits: true,
    overflow: false,
  })
}

async function swipeSideTabs(sidebar, tab) {
  const row = sidebar.locator('[data-dockkit-strip-tabs]:visible').first()
  const id = await row.evaluate((element) => {
    const previous = element.scrollLeft
    const settled = () => {
      if (element.scrollLeft <= previous + 20) return
      element.dataset.testTabSwipeSettled = 'true'
      element.removeEventListener('scrollend', settled)
    }
    element.addEventListener('scrollend', settled)
    return element.getAttribute('data-dockkit-strip-tabs')
  })
  const label = await tab.locator('[data-dia-side-chat-select]').boundingBox()
  assert.ok(label)
  const x = Math.round(label.x + label.width / 2)
  const y = Math.round(label.y + label.height / 2)
  const input = await page.context().newCDPSession(page)
  try {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (const travel of [20, 45, 75, 110]) {
      await input.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - travel, y }],
      })
    }
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sidebar.locator('[data-dockkit-strip-tabs="' + id + '"][data-test-tab-swipe-settled]').waitFor()
  } finally {
    await input.detach()
  }
}

/** Check model input and navigation against the same retained Sessions after reload and restore. */
async function exerciseOwnedSideChats() {
  const parent = scenario.otherSessionId
  const tokens = [
    ['parent-before', scenario.otherSource],
    ['side-only', '仅侧聊记录：蓝桥'],
    ['parent-after', '主会话新增：荷叶'],
    ['side-after-reopen', '重开侧聊：晴天'],
    ['second-side', '另一个侧聊：白帆'],
  ]
  const expected = JSON.parse(await readFile(new URL('owned-context.expected.json', fixture), 'utf8'))
  async function ask(id, key) {
    const text = tokens.find(([name]) => name === key)[1]
    const flow = mainFlow(id).filter({ visible: true }).first()
    await composer(flow).fill(text)
    await composer(flow).press('Enter')
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const calls = await request('model-requests')
      const sent = calls.findLast(
        (call) =>
          call.sessionId === id &&
          call.messages.some((m) => m.role === 'user' && m.content.some((b) => b.text === text)),
      )
      if (sent)
        return tokens
          .filter(([, token]) => sent.messages.some((m) => m.content.some((b) => b.text === token)))
          .map(([name]) => name)
      await new Promise((resolve) => setTimeout(resolve, 75))
    }
    throw new Error('No model request for ' + key)
  }
  await page.setViewportSize({ width: 1440, height: 930 })
  await openMain(parent, scenario.otherSource)
  await page.emulateMedia({ colorScheme: 'dark' })
  const side = await openSide(parent, 'create')
  const sidebar = sidebarFor(parent)
  const newTab = async () => {
    const previousTabs = await sidebar
      .locator('[data-dia-side-chat-select]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.diaSideChatSelect))
    await createFromSideTab(parent)
    const chat = await association(parent, previousTabs)
    await composer(mainFlow(chat.sideSessionId)).waitFor()
    return chat
  }
  const verifyOwnTranscript = async (id, ownText) => {
    const body = mainFlow(id).filter({ visible: true }).first().locator('[data-chat-flow]').first()
    await body.waitFor({ state: 'attached' })
    if (ownText) await body.getByText(ownText, { exact: true }).first().waitFor()
    else assert.equal((await body.innerText()).trim(), '')
    assert.equal(await body.getByText(scenario.otherSource, { exact: true }).count(), 0)
  }
  const one = await association(parent)
  await composer(mainFlow(one.sideSessionId)).waitFor()
  await verifyOwnTranscript(one.sideSessionId)
  assert.deepEqual(await ask(one.sideSessionId, 'side-only'), expected.firstSideRequest)
  assert.deepEqual(await ask(parent, 'parent-after'), expected.nextParentRequest)
  // Wait for the committed parent answer before taking the second snapshot.
  await mainFlow(parent)
    .getByText(/Side answer: Alpha/)
    .last()
    .waitFor()
  const two = await newTab()
  await verifyOwnTranscript(two.sideSessionId)
  assert.deepEqual(await ask(two.sideSessionId, 'second-side'), expected.secondSideRequest)
  const row = (id) => page.locator(`[data-row-key="session:${id}"]`)
  assert.equal(await row(one.sideSessionId).count(), 0)
  assert.equal(await row(two.sideSessionId).count(), 0)
  await sidebar.locator(`[data-dia-side-chat-select="${one.sideChatId}"]`).hover()
  const firstTab = sidebar.locator(`[role="tab"]:has([data-dia-side-chat-select="${one.sideChatId}"])`)
  await firstTab.focus()
  await page.keyboard.press('Tab')
  assert.equal(
    await sidebar
      .locator(`[data-dia-side-chat-archive="${one.sideChatId}"]`)
      .evaluate((button) => button === document.activeElement),
    true,
  )
  assert.equal(await firstTab.getAttribute('aria-selected'), 'false')
  await verifyNativeTab(firstTab, side)
  await page.screenshot({ path: join(artifacts, 'owned-tab-actions.png'), animations: 'disabled' })
  await sidebar.locator(`[data-dia-side-chat-open-alone="${one.sideChatId}"]`).click()
  await page.waitForFunction(
    (id) => JSON.parse(localStorage.getItem('dsh.sessions.current'))?.sessionId === id,
    one.sideSessionId,
  )
  assert.equal(await row(one.sideSessionId).count(), 0)
  await verifyOwnTranscript(one.sideSessionId, tokens[1][1])
  await page.reload()
  await composer(mainFlow(one.sideSessionId)).waitFor()
  await verifyOwnTranscript(one.sideSessionId, tokens[1][1])
  assert.equal(await row(one.sideSessionId).count(), 0)
  assert.deepEqual(await ask(one.sideSessionId, 'side-after-reopen'), expected.reopenedSideRequest)
  await openMain(parent, scenario.otherSource)
  await openSide(parent)
  await sidebar.locator(`[data-dia-side-chat-select="${two.sideChatId}"]`).hover()
  await sidebar.locator(`[data-dia-side-chat-archive="${two.sideChatId}"]`).click()
  await sidebar.locator(`[data-dia-side-chat-select="${two.sideChatId}"]`).waitFor({ state: 'detached' })
  await restoreFromGuide(parent)
  await composer(mainFlow(two.sideSessionId)).waitFor()
  assert.equal(await row(two.sideSessionId).count(), 0)
  const originalPage = page
  const clean = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 390, height: 840 },
    hasTouch: true,
    colorScheme: 'light',
    storageState: { cookies: await page.context().cookies(), origins: [] },
  })
  try {
    page = await clean.newPage()
    await page.addInitScript(
      (id) => localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })),
      parent,
    )
    await page.goto(desktop ? authenticatedEntry : new URL(originalPage.url()).origin)
    await mainBody(parent).waitFor()
    const recovered = await openSide(parent, 'switch')
    const recoveredSidebar = sidebarFor(parent)
    for (const chat of [one, two])
      await recoveredSidebar.locator(`[data-dia-side-chat-select="${chat.sideChatId}"]`).waitFor()
    assert.equal(await recoveredSidebar.locator('[data-dia-side-chat-select]').count(), 2)
    const touchTab = recoveredSidebar.locator(
      `[role="tab"]:has([data-dia-side-chat-select="${one.sideChatId}"])`,
    )
    await verifyNativeTab(touchTab, recovered)
    await page.screenshot({ path: join(artifacts, 'owned-tab-actions-touch.png'), animations: 'disabled' })
    await swipeSideTabs(recoveredSidebar, touchTab)
    assert.equal(await touchTab.getAttribute('aria-selected'), 'true')
    const other = recoveredSidebar.locator('[data-dia-side-chat-select="' + two.sideChatId + '"]')
    const position = await other.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const x = Math.round(rect.x + rect.width / 2)
      const y = Math.round(rect.y + rect.height / 2)
      return { x, y, hit: element.contains(document.elementFromPoint(x, y)) }
    })
    assert.ok(position.hit, 'A swipe must expose the next tab in the Host strip')
    await page.touchscreen.tap(position.x, position.y)
    await composer(mainFlow(two.sideSessionId)).waitFor()
    const touchButton = recoveredSidebar.locator('[data-dia-side-chat-open-alone="' + two.sideChatId + '"]')
    await touchButton.tap()
    await page
      .locator(
        `[data-conversation-content][data-conversation-session="${two.sideSessionId}"]:not([data-dia-side-chat] *)`,
      )
      .waitFor()
    assert.equal(await page.locator(`[data-row-key="session:${one.sideSessionId}"]`).count(), 0)
    console.log('PASS swipe the Host strip, select the next side chat, and open it independently at 390px')
  } finally {
    page = originalPage
    await clean.close()
  }
  // A lost acknowledgement retries the same child even after the parent continued.
  const previous = await request('read-session', { sessionId: one.sideSessionId })
  const repeat = await request('request-side-fork', {
    parent,
    request: { target: one.sideSessionId, at: -1, title: 'Retry' },
  })
  assert.equal(repeat.text, one.sideSessionId)
  assert.deepEqual(await request('read-session', { sessionId: one.sideSessionId }), previous)
  const otherOwner = await request('request-side-fork', {
    parent,
    request: { target: 'annotation-side-' + '0'.repeat(64) + '-' + randomUUID() },
  })
  assert.equal(otherOwner.kind, 'error')
  const at = previous.events.find((e) => e.type === 'step/start').seq
  const prefix = one.sideSessionId.slice(0, 'annotation-side-'.length + 64 + 1)
  const partial = prefix + randomUUID()
  assert.equal(
    (await request('request-side-fork', { parent, request: { target: partial, at } })).text,
    partial,
  )
  const cut = await request('read-session', { sessionId: partial })
  assert.equal(cut.inheritedEventCount, at + 1)
  assert.equal(cut.events.at(-1).data.reason.kind, 'forked')
  const empty = prefix + randomUUID()
  assert.equal(
    (await request('request-side-fork', { parent, request: { target: empty, at: -1 } })).text,
    empty,
  )
  assert.deepEqual((await request('read-session', { sessionId: empty })).events, [])
  await exerciseDelegatedSideChats(parent)
  await exerciseMainBubbleReconnect(parent)
  await page.getByRole('button', { name: '搜索会话', exact: true }).filter({ visible: true }).click()
  const searchBox = page.getByPlaceholder('搜索会话名称')
  await searchBox.fill('Side-chat source B')
  await page
    .getByRole('tree', { name: '搜索结果' })
    .getByText('Side-chat source B', { exact: true })
    .waitFor()
  await searchBox.fill('仅侧聊记录：蓝桥')
  await page.getByText('无匹配会话', { exact: true }).waitFor()
  assert.equal(await page.getByRole('tree', { name: '搜索结果' }).getByRole('treeitem').count(), 0)
  await searchBox.press('Escape')
  const projectRow = page.getByRole('treeitem').filter({ hasText: 'Side-chat smoke' }).first()
  await projectRow.hover()
  await projectRow.getByRole('button', { name: '在“Side-chat smoke”中新建会话', exact: true }).click()
  await page.waitForFunction((previous) => {
    const id = JSON.parse(localStorage.getItem('dsh.sessions.current'))?.sessionId
    return typeof id === 'string' && id !== previous
  }, parent)
  const newMain = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dsh.sessions.current')).sessionId,
  )
  assert.ok(!newMain.startsWith('annotation-side-'), 'New Session must not reuse an empty owned side chat')
  await composer(mainFlow(newMain)).waitFor()
  console.log(
    'PASS fork-time model context, independent parent and sibling updates, hidden rows, inactive-tab full page, reload, archive and parent-only restore',
  )
}

/** Fork the same delegated source while it runs and after the child has settled. */
async function exerciseDelegatedSideChats(parent) {
  const prompt = '子会话独有的测试上下文'
  await request('hold-next-model')
  const source = await request('start-delegated-source', { parent, prompt })
  await request('wait-model')
  const selectConversation = async (sessionId) => {
    await page.evaluate(
      (id) => localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })),
      sessionId,
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await mainFlow(sessionId).waitFor()
  }
  await selectConversation(source)
  let side = await openSide(source)
  const createTab = async (retry = false) => {
    const previousTabs = await sidebarFor(source)
      .locator('[data-dia-side-chat-select]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.diaSideChatSelect))
    if (retry) await request('fail-next-lifecycle', { kind: 'side-fork' })
    await createFromSideTab(source)
    const chat = await association(source, previousTabs)
    const body = mainFlow(chat.sideSessionId)
    if (retry) {
      await side.getByRole('alert').waitFor()
      assert.equal(await side.getByRole('alert').count(), 1)
      assert.equal(await side.getByRole('button', { name: '重试', exact: true }).count(), 1)
      assert.equal((await side.getByRole('alert').innerText()).includes('已保留引用'), false)
      await side.getByRole('button', { name: '重试', exact: true }).click()
    }
    await composer(body).waitFor({ timeout: 10000 })
    assert.equal((await association(source)).sideSessionId, chat.sideSessionId)
    assert.equal((await body.locator('[data-chat-flow]').first().innerText()).trim(), '')
    const saved = await request('read-session', { sessionId: chat.sideSessionId })
    assert.ok(
      saved.events.some(
        (e) => e.type === 'user/message' && e.data.content.some((part) => part.text === prompt),
      ),
    )
    assert.equal(saved.header.origin, undefined)
    assert.ok((await request('inspect')).workspaceSessionIds.includes(chat.sideSessionId))
    assert.equal(await page.locator(`[data-row-key="session:${chat.sideSessionId}"]`).count(), 0)
    return chat
  }
  const active = await createTab(true)
  await request('release-model')
  await request('settle-delegated-source')
  await selectConversation(source)
  side = await openSide(source)
  const finished = await createTab()
  assert.notEqual(active.sideSessionId, finished.sideSessionId)
  await selectConversation(parent)
  console.log(
    'PASS running and settled subagent side chats retain their own history, workspace, and blank transcript',
  )
}

/** Drop the real GUI transport while the Host has claimed an accepted, unrecorded message. */
async function exerciseMainBubbleReconnect(id) {
  await page.addInitScript(() => {
    const Native = window.WebSocket
    const sockets = new Set()
    const tracker = {
      baselines: 0,
      disconnect() {
        for (const socket of sockets) socket.close()
      },
    }
    window.sideChatTransportCheck = tracker
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args)
        if (!this.url.includes('/remote.mux')) return
        sockets.add(this)
        const follows = new Set()
        const send = this.send.bind(this)
        this.send = (frame) => {
          if (typeof frame === 'string') {
            const data = JSON.parse(frame)
            if (data.type === 'open' && data.endpoint === 'session/follow') follows.add(data.streamId)
          }
          return send(frame)
        }
        this.addEventListener('message', (e) => {
          if (typeof e.data !== 'string') return
          const data = JSON.parse(e.data)
          if (follows.has(data.streamId) && data.type === 'item' && data.value?.type === 'snapshot')
            tracker.baselines++
        })
        this.addEventListener('close', () => sockets.delete(this))
      }
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const flow = mainFlow(id).filter({ visible: true }).first()
  const text = '发送后重连仍显示这条消息'
  const bubble = flow.getByText(text, { exact: true })
  await composer(flow).waitFor()
  await request('hold-main-admission', { id })
  try {
    await composer(flow).fill(text)
    await composer(flow).press('Enter')
    await request('wait-main-claim')
    await bubble.waitFor()
    await flow.evaluate((element, text) => {
      const counts = new Set()
      const sample = () => {
        counts.add(
          Array.from(element.querySelectorAll('[data-submission-echo], [data-chat-flow-kind="user"]')).filter(
            (row) => row.getClientRects().length && row.textContent.includes(text),
          ).length,
        )
        frame = requestAnimationFrame(sample)
      }
      let frame
      sample()
      window.sideChatTransportCheck.finish = () => {
        cancelAnimationFrame(frame)
        return [...counts]
      }
    }, text)
    const before = await page.evaluate(() => {
      const p = window.sideChatTransportCheck
      const before = p.baselines
      p.disconnect()
      return before
    })
    await page.waitForFunction((n) => window.sideChatTransportCheck.baselines > n, before, { timeout: 15000 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.equal(await bubble.count(), 1)
    assert.ok(await bubble.isVisible())
  } finally {
    await request('release-main-admission')
  }
  await flow.locator('[data-chat-flow-kind="user"]').getByText(text, { exact: true }).waitFor()
  assert.equal(await bubble.count(), 1)
  assert.deepEqual(await page.evaluate(() => window.sideChatTransportCheck.finish()), [1])
  await request('wait-agent-idle', { id })
  await composer(flow).fill(text)
  await composer(flow).press('Enter')
  await flow.locator('[data-chat-flow-kind="user"]').getByText(text, { exact: true }).nth(1).waitFor()
  assert.equal(await bubble.count(), 2)
  for (const outcome of ['reject', 'cancel']) {
    await request('wait-agent-idle', { id })
    const draft = '重连后终止的测试输入 ' + outcome
    const stopped = flow.getByText(draft, { exact: true })
    await request('hold-main-admission', { id })
    try {
      await composer(flow).fill(draft)
      await composer(flow).press('Enter')
      await request('wait-main-claim')
      await stopped.waitFor()
      const previous = await page.evaluate(() => {
        const control = window.sideChatTransportCheck
        control.disconnect()
        return control.baselines
      })
      await page.waitForFunction((n) => window.sideChatTransportCheck.baselines > n, previous)
      assert.equal(await stopped.count(), 1)
    } finally {
      await request('release-main-admission', { outcome })
    }
    await request('wait-agent-idle', { id })
    await stopped.waitFor({ state: 'detached' })
    const saved = await request('read-session', { sessionId: id })
    assert.ok(
      !saved.events.some(
        (e) => e.type === 'user/message' && e.data.content.some((part) => part.text === draft),
      ),
    )
  }
  console.log(
    'PASS main chat retains exactly one visible message across claim, reconnect, and durable admission',
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
    const close = element.closest('[data-sidebar-right-panel]')?.querySelector('[data-sidebar-right-toggle]')
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
  const profile = join(home, 'profiles', desktop ? 'desktop' : 'web')
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
  if (desktop) {
    gui = await launchFixtureDesktop({
      directory: packagedDir,
      root,
      profile,
      patch,
      workspace,
      env,
      onReply,
      deadline,
    })
  } else {
    child = spawn(
      packagedDir ? join(packagedDir, 'resources/runtime/cli/bin/dsh') : process.execPath,
      [
        ...(packagedDir ? [] : [join(dirname(cliManifestPath), cliManifest.bin.dsh)]),
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
    child.on('message', onReply)
    await deadline(ready, 'Isolated Web readiness')
  }
  await request('prepare', { workspace })
  const initial = await request('inspect')
  authenticatedEntry = initial.url
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
  const fixtureIds = [scenario.mainSessionId, scenario.otherSessionId].sort()
  const initialBlanks = desktop ? seeded.sessionIds.filter((id) => !fixtureIds.includes(id)) : []
  for (const id of initialBlanks) {
    // The packaged desktop can open one empty conversation as soon as its first workspace appears.
    assert.match(id, /^session-[0-9a-f-]{36}$/)
    const initial = await request('read-session', { sessionId: id })
    assert.ok(!initial.events.some((event) => event.type === 'user/message' || event.type === 'turn/start'))
  }
  for (const ids of [seeded.sessionIds, seeded.workspaceSessionIds])
    assert.deepEqual(ids.filter((id) => !initialBlanks.includes(id)).sort(), fixtureIds)
  browser = await chromium.launch({ headless: true })
  page =
    gui?.window ??
    (await browser.newPage({
      // At this height, opening the sidebar can push the selected line above the scrolling band.
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      colorScheme: 'dark',
    }))
  page.setDefaultTimeout(30_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  observeCandidate(page)
  await page.addInitScript((sessionId) => {
    if (localStorage.getItem('dsh.sessions.current') === null)
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, scenario.mainSessionId)
  if (gui) await page.reload({ waitUntil: 'domcontentloaded' })
  else await page.goto(initial.url, { waitUntil: 'domcontentloaded' })
  await page.locator('style[data-dsh-annotation="true"]').waitFor({ state: 'attached' })
  await deadline(candidateLoaded.promise, 'Candidate client artifact bytes')
  const continueButton = page.getByRole('button', { name: '继续', exact: true })
  if (await continueButton.isVisible()) await continueButton.click()
  console.log(`PASS built plugin activates in the isolated ${desktop ? 'desktop' : 'Web'} profile`)
  if (gui) await openListedSession(scenario.mainSessionId)
  await mainBody(scenario.mainSessionId).waitFor({ state: 'visible' })
  if (process.argv.includes('--launch-only')) {
    await openMain(scenario.mainSessionId, scenario.source)
    assert.equal(await mainFlow(scenario.mainSessionId).count(), 1)
    assert.equal(await composer(mainFlow(scenario.mainSessionId)).count(), 1)
    await page.screenshot({ path: join(artifacts, 'launch-only.png'), fullPage: true })
    console.log('PASS real seeded main Conversation and official composer are available')
  } else if (process.argv.includes('--owned-only')) {
    await exerciseOwnedSideChats()
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
      createFromSideTab,
      restoreFromGuide,
      selectText,
      composer,
      association,
      assertComposerAtBottom,
      evidence,
    })
    const parentEvents = (await request('read-session', { sessionId: scenario.mainSessionId })).events
    assert.deepEqual(parentEvents.slice(0, mainSeed.events.length), mainSeed.events)
    const forkIds = new Set()
    for (const event of parentEvents.slice(mainSeed.events.length)) {
      if (event.type === 'command/run' && event.data.name === 'annotation_side_chat_fork')
        forkIds.add(event.data.commandId)
      else
        assert.ok(
          event.type === 'command/done' && forkIds.delete(event.data.commandId),
          `Unexpected parent event after side chat creation: ${event.type} (${event.data.name ?? ''})`,
        )
    }
    assert.equal(forkIds.size, 0)
    assert.deepEqual(
      (await request('read-session', { sessionId: scenario.otherSessionId })).events,
      otherSeed.events,
    )
    await exerciseOwnedSideChats()
    await runRecordedSideChatSnapshot(workspace)
    await runRecordedSideChatSnapshot(workspace, true)
  }
  assert.equal(pageErrors.length, 0, `Unexpected Client failures: ${JSON.stringify(pageErrors)}`)
} catch (error) {
  console.error(redact(error.stack ?? error))
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
    await page
      .screenshot({ path: join(artifacts, 'failure.png'), fullPage: true, timeout: 3000 })
      .catch((cause) => console.error(redact(cause.message)))
  }
  throw new Error(redact(error.stack ?? error))
} finally {
  try {
    await gui?.close()
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
