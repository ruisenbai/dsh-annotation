/** Real Git fixtures run through the same public Host providers as the plugin. */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SessionStore, { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationDiffHost, parseChangedPaths } from '../src/host/diff.ts'
import { createAnnotationCommand } from '../src/host/command.ts'
import {
  diffQuote,
  parseDiffSource,
  relocationCandidates,
  type DiffFileEntry,
  type DiffReadResult,
  type DiffSnapshot,
  type DiffSource,
} from '../src/shared/diff-source.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { encodeJsonCommand, encodeSubmissionCommand } from '../src/shared/codec.ts'
import { parseSubmissionPayload } from '../src/shared/protocol.ts'
import { sourceFields } from '../src/shared/annotation-source.ts'
import { diffAnnotation } from './diff-fixtures.ts'
import { fixturePayload } from './fixtures.ts'

const run = promisify(execFile)
let root: string
let repo: string
let ctx: Context
let host: AnnotationDiffHost
let agent: Agent
let messages: UserMessage[]
const signal = () => new AbortController().signal
const git = (...args: string[]) =>
  run(
    'git',
    [
      '-c',
      'user.name=Annotation Test',
      '-c',
      'user.email=annotation@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd: repo },
  )
const put = (path: string, content: string | Uint8Array) => writeFile(join(repo, path), content)
const request = (value: unknown) => host.request(agent, value, signal())
const files = async (range = 'worktree') =>
  ((await request({ action: 'list', range })) as { files: DiffFileEntry[] }).files
async function capture(path: string, range = 'worktree'): Promise<DiffSnapshot> {
  const result = (await request({ action: 'capture', range, path })) as DiffReadResult
  expect(result.kind).toBe('text')
  if (result.kind !== 'text') throw new Error(result.reason)
  return result.snapshot
}
async function anchor(
  snapshot: DiffSnapshot,
  side = 'new',
  startLine = 2,
  endLine = startLine,
): Promise<DiffSource> {
  const result = (await request({ action: 'anchor', snapshot, side, startLine, endLine })) as {
    source: unknown
  }
  return parseDiffSource(result.source)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'annotation-git-'))
  repo = join(root, 'repo')
  await mkdir(repo)
  await git('init', '-q')
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: repo })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('session-test'), { meta: { cwd: repo } })
  messages = []
  agent = {
    id: session.id,
    session,
    inbox: { nextTurn: messages, nextStep: [] },
    followup: vi.fn((message: UserMessage) => messages.push(message)),
    steer: vi.fn(),
  } as unknown as Agent
  host = new AnnotationDiffHost(ctx.fs, ctx.subprocess, DEFAULT_CONFIG, '1'.repeat(64))
})
afterEach(async () => {
  await host?.dispose()
  await ctx?.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('Git range and immutable snapshots', () => {
  it('reads HEAD→index separately from index→worktree and never falls back to the other range', async () => {
    await put('app.ts', 'header\nbase\nfooter\n')
    await git('add', '.')
    await git('commit', '-qm', 'base')
    await put('app.ts', 'header\nstaged\nfooter\n')
    await git('add', '.')
    expect(await files('worktree')).toEqual([])
    await expect(capture('app.ts')).rejects.toThrow('moved or disappeared')
    await put('app.ts', 'header\nworking\nextra\nfooter\n')
    const staged = await capture('app.ts', 'staged')
    const work = await capture('app.ts')
    expect(staged).toMatchObject({
      range: 'staged',
      old: { content: 'header\nbase\nfooter\n' },
      new: { kind: 'blob', content: 'header\nstaged\nfooter\n' },
    })
    expect(work.old.oid).toBe(staged.new.oid)
    expect(work.new).toMatchObject({ kind: 'working-tree', content: 'header\nworking\nextra\nfooter\n' })
    expect((await capture('app.ts')).id).toBe(work.id)
    const source = await anchor(work, 'new', 2, 3)
    expect(diffQuote(source).exact).toBe('working\nextra')
    const deletion = await anchor(work, 'old', 2)
    expect(diffQuote(deletion).exact).toBe('staged')
    const frozen = JSON.stringify(source)
    await put('app.ts', 'completely different\n')
    await git('add', '.')
    host.validate(diffAnnotation(source), agent)
    host.validate(diffAnnotation(await anchor(staged, 'old', 1)), agent)
    expect(JSON.stringify(source)).toBe(frozen)
    expect((await capture('app.ts', 'staged')).new.oid).not.toBe(staged.new.oid)
  })

  it('handles unborn HEAD, added/deleted/empty/renamed files and literal Unicode paths', async () => {
    await put('新 文件.ts', 'new\n')
    const added = await capture('新 文件.ts')
    expect(added).toMatchObject({ head: null, oldPath: null, old: { kind: 'absent' }, newPath: '新 文件.ts' })
    await git('add', '.')
    expect(await capture('新 文件.ts', 'staged')).toMatchObject({
      old: { kind: 'absent' },
      new: { kind: 'blob' },
    })
    await put('empty.ts', '')
    const empty = await capture('empty.ts')
    await expect(anchor(empty, 'new', 1)).rejects.toThrow('one-based')
    await git('add', '.')
    await git('commit', '-qm', 'base')
    await rename(join(repo, '新 文件.ts'), join(repo, 'renamed.ts'))
    await git('add', '-A')
    expect(await files('staged')).toContainEqual({
      path: 'renamed.ts',
      oldPath: '新 文件.ts',
      newPath: 'renamed.ts',
      status: 'R100',
    })
    const renamed = await capture('renamed.ts', 'staged')
    expect(renamed.old.oid).toBe(renamed.new.oid)
    await git('commit', '-qm', 'rename')
    await rm(join(repo, 'renamed.ts'))
    const deleted = await capture('renamed.ts')
    expect(deleted).toMatchObject({ oldPath: 'renamed.ts', newPath: null, new: { kind: 'absent' } })
    expect(diffQuote(await anchor(deleted, 'old', 1)).exact).toBe('new')
    await expect(anchor(deleted, 'new', 1)).rejects.toThrow('no text')
  })

  it('rejects binary, non-UTF8, symlink and oversized sources instead of inventing anchors', async () => {
    await put('binary.dat', Uint8Array.from([0, 1, 2]))
    await put('invalid.txt', Uint8Array.from([0xff, 0xfe, 0xfd]))
    await put('large.txt', 'a'.repeat(DEFAULT_CONFIG.maxDiffFileBytes + 1))
    for (const path of ['binary.dat', 'invalid.txt', 'large.txt']) {
      const result = (await request({ action: 'capture', range: 'worktree', path })) as DiffReadResult
      expect(result.kind).toBe('unsupported')
    }
    await git('add', 'binary.dat', 'invalid.txt')
    for (const path of ['binary.dat', 'invalid.txt'])
      expect(await request({ action: 'capture', range: 'staged', path })).toMatchObject({
        kind: 'unsupported',
        reason: 'binary',
      })
    if (process.platform !== 'win32') {
      await symlink(join(root, 'outside'), join(repo, 'link'))
      expect(await request({ action: 'capture', range: 'worktree', path: 'link' })).toMatchObject({
        kind: 'unsupported',
        reason: 'special',
      })
    }
  })

  it('honors Git binary attributes and drivers even for UTF-8 bytes', async () => {
    await put('.gitattributes', '*.bin -diff\n*.data diff=opaque\n')
    await put('custom.bin', 'printable but declared binary\n')
    expect(await request({ action: 'capture', path: 'custom.bin', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'binary',
    })
    await git('add', '.')
    await git('commit', '-qm', 'binary attributes')
    await put('custom.bin', 'updated text-like binary\n')
    expect(await request({ action: 'capture', path: 'custom.bin', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'binary',
    })
    await git('config', 'diff.opaque.binary', 'true')
    await put('custom.data', 'driver declares binary\n')
    expect(await request({ action: 'capture', path: 'custom.data', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'binary',
    })
    await git('add', 'custom.data')
    expect(await request({ action: 'capture', path: 'custom.data', range: 'staged' })).toMatchObject({
      kind: 'unsupported',
      reason: 'binary',
    })
  })

  it('detects a worktree or index change during capture', async () => {
    await put('race.ts', 'base\n')
    await git('add', '.')
    await git('commit', '-qm', 'base')
    await put('race.ts', 'captured\n')
    const stream = ctx.fs.streamText.bind(ctx.fs)
    const spy = vi.spyOn(ctx.fs, 'streamText').mockImplementationOnce(async (target, abort) => {
      const chunks = await stream(target, abort)
      return (async function* () {
        yield* chunks
        await put('race.ts', 'changed while reading\n')
      })()
    })
    expect(await request({ action: 'capture', path: 'race.ts', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'changed',
    })
    spy.mockRestore()
    vi.spyOn(ctx.fs, 'streamText').mockImplementationOnce(async (target, abort) => {
      const chunks = await stream(target, abort)
      return (async function* () {
        yield* chunks
        await git('add', 'race.ts')
      })()
    })
    expect(await request({ action: 'capture', path: 'race.ts', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'changed',
    })
  })

  it('does not attest an absent side from a stale added or deleted listing', async () => {
    await put('late.ts', 'new file\n')
    const stream = ctx.fs.streamText.bind(ctx.fs)
    const read = vi.spyOn(ctx.fs, 'streamText').mockImplementationOnce(async (target, abort) => {
      const chunks = await stream(target, abort)
      return (async function* () {
        yield* chunks
        await git('add', 'late.ts')
      })()
    })
    expect(await request({ action: 'capture', path: 'late.ts', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'changed',
    })
    read.mockRestore()
    await git('commit', '-qm', 'base')
    await rm(join(repo, 'late.ts'))
    const lstat = ctx.fs.lstat.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'lstat').mockImplementationOnce(async (...args) => {
      await put('late.ts', 'restored before capture\n')
      return lstat(...args)
    })
    expect(await request({ action: 'capture', path: 'late.ts', range: 'worktree' })).toMatchObject({
      kind: 'unsupported',
      reason: 'changed',
    })
  })

  it('rejects Git submodules and unmerged comparisons without fake text', async () => {
    await put('base.ts', 'base\n')
    await git('add', '.')
    await git('commit', '-qm', 'base')
    const head = (await git('rev-parse', 'HEAD')).stdout.trim()
    await git('update-index', '--add', '--cacheinfo', `160000,${head},module`)
    expect(await request({ action: 'capture', range: 'staged', path: 'module' })).toMatchObject({
      kind: 'unsupported',
      reason: 'special',
    })
    await git('update-index', '--force-remove', 'module')
    await git('checkout', '-qb', 'other')
    await put('base.ts', 'other\n')
    await git('commit', '-qam', 'other')
    await git('checkout', '-q', '--detach', head)
    await put('base.ts', 'ours\n')
    await git('commit', '-qam', 'ours')
    await expect(git('merge', 'other')).rejects.toThrow()
    await expect(files('staged')).rejects.toThrow('incomplete')
  })

  it('reports missing Diff capability without preventing ordinary annotation submission', async () => {
    await ctx.plugin(CommandRuntime)
    ctx.commands.register(createAnnotationCommand(DEFAULT_CONFIG))
    await expect(
      ctx.commands.execute(
        agent,
        encodeJsonCommand(`${DEFAULT_CONFIG.commandName} diff`, { action: 'list', range: 'worktree' }),
        [],
        signal(),
      ),
    ).rejects.toThrow('requires the Host filesystem')
    expect(messages).toHaveLength(0)
    await ctx.commands.execute(
      agent,
      encodeSubmissionCommand(DEFAULT_CONFIG.commandName, fixturePayload()),
      [],
      signal(),
    )
    expect(messages).toHaveLength(1)
  })

  it('validates session, path, signature, code and one-based ranges at the Host', async () => {
    await put('a.ts', 'one\ntwo\n')
    const snapshot = await capture('a.ts')
    for (const patch of [
      { id: 'f'.repeat(64) },
      { capturedAt: snapshot.capturedAt + 1 },
      { newPath: 'other.ts' },
      { new: { ...snapshot.new, content: 'forged\n' } },
      { workspace: root },
    ]) {
      await expect(anchor({ ...snapshot, ...patch } as DiffSnapshot)).rejects.toThrow('attested')
    }
    await expect(anchor(snapshot, 'new', 0)).rejects.toThrow()
    await expect(anchor(snapshot, 'new', 1, 3)).rejects.toThrow('one-based')
    await expect(request({ action: 'capture', path: '../outside', range: 'worktree' })).rejects.toThrow()
    const source = await anchor(snapshot)
    expect(() =>
      host.validate({ ...diffAnnotation(source), quote: { ...diffQuote(source), exact: 'bad' } }, agent),
    ).toThrow('attested file lines')
    expect(() =>
      host.validate(diffAnnotation(source), { ...agent, id: 'other-session' } as unknown as Agent),
    ).toThrow('attested')
    await mkdir(join(repo, 'sub'))
    const session = ctx.sessions.create(SessionId('sub-session'), { meta: { cwd: join(repo, 'sub') } })
    const subAgent = { ...agent, session, id: session.id } as Agent
    await expect(
      host.request(subAgent, { action: 'capture', range: 'worktree', path: 'a.ts' }, signal()),
    ).rejects.toThrow('moved or disappeared')
  })

  it('retains the original even after Git metadata disappears; explicit unique rebind retains the earliest origin', async () => {
    const block = 'b1\nb2\nb3\ntarget\na1\na2\na3\n'
    await put('a.ts', block)
    const source = await anchor(await capture('a.ts'), 'new', 4)
    await put('a.ts', `prefix\n${block}`)
    const current = await capture('a.ts')
    expect(relocationCandidates(source, current)).toEqual([5])
    const rebound = (await request({
      action: 'anchor',
      snapshot: current,
      side: 'new',
      startLine: 5,
      endLine: 5,
      reboundFrom: source,
    })) as { source: DiffSource }
    expect(rebound.source.reboundFrom).toEqual(source)
    await put('a.ts', block + block)
    const ambiguous = await capture('a.ts')
    await expect(
      request({
        action: 'anchor',
        snapshot: ambiguous,
        side: 'new',
        startLine: 4,
        endLine: 4,
        reboundFrom: source,
      }),
    ).rejects.toThrow('one matching range')
    await rm(join(repo, '.git'), { recursive: true, force: true })
    host.validate(diffAnnotation(source), agent)
    expect(diffQuote(source).exact).toBe('target')
    await expect(request({ action: 'recapture', source })).rejects.toThrow('Git read failed')
  })

  it('uses official command admission for selected mixed v3 payloads and idempotent replay', async () => {
    await put('a.ts', 'one\ntwo\n')
    await ctx.plugin(CommandRuntime)
    ctx.commands.register(createAnnotationCommand(DEFAULT_CONFIG, () => host))
    const read = await ctx.commands.execute(
      agent,
      encodeJsonCommand(`${DEFAULT_CONFIG.commandName} diff`, { action: 'list', range: 'worktree' }),
      [],
      signal(),
    )
    expect(JSON.parse(read?.result.text ?? '{}').files).toHaveLength(1)
    expect(messages).toHaveLength(0)
    const source = await anchor(await capture('a.ts'))
    const message = fixturePayload().annotations[0]!
    const payload = parseSubmissionPayload({
      ...fixturePayload(),
      protocolVersion: 3,
      annotations: [
        { ...message, ...sourceFields(message) },
        { ...diffAnnotation(source), annotationId: 'diff-second', ordinal: 2 },
      ],
    })
    const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, payload)
    await ctx.commands.execute(agent, line, [], signal())
    await put('a.ts', 'changed\n')
    await ctx.commands.execute(agent, line, [], signal())
    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toEqual({ kind: 'user', annotationSubmission: payload })
    const modelText = messages[0]?.content[0]
    expect(modelText).toMatchObject({ type: 'text' })
    expect(JSON.stringify(modelText)).toContain('two')
    expect(JSON.stringify(modelText)).toContain('a.ts')
    expect(JSON.stringify(modelText)).toContain(source.snapshot.new.sha256)
    expect(JSON.stringify(modelText)).toContain('"ordinal":2'.replaceAll('"', '\\"'))
  })
})

it('parses complete NUL-delimited rename records and rejects unmerged or incomplete status output', () => {
  expect(parseChangedPaths('R100\0old\t.ts\0new\n.ts\0')).toEqual([
    { path: 'new\n.ts', oldPath: 'old\t.ts', newPath: 'new\n.ts', status: 'R100' },
  ])
  for (const value of ['M\0missing terminator', 'R100\0old\0', 'U\0conflict\0'])
    expect(() => parseChangedPaths(value)).toThrow()
})
