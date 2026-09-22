/** Signing-key persistence uses the public domain service and real JSON backend. */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { it, expect, vi } from 'vitest'
import { installDiffHost } from '../src/host/diff-storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { type DiffReadResult, parseDiffSource } from '../src/shared/diff-source.ts'
import { diffAnnotation } from './diff-fixtures.ts'

it('reopens the same private identity and validates a frozen source after plugin restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'annotation-diff-domain-'))
  const contexts: Context[] = []
  const cwd = join(root, 'repo')
  const mount = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalFileSystem, { cwd })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    await ctx.plugin(storageJson, { root: join(root, 'storage') })
    await ctx.plugin(storageDomain, { backend: 'json' })
    let getHost: ReturnType<typeof installDiffHost> = () => undefined
    await ctx.plugin((scope: Context) => {
      getHost = installDiffHost(scope, DEFAULT_CONFIG)
    })
    await vi.waitFor(() => expect(getHost()).toBeDefined())
    const session = ctx.sessions.create(SessionId('session-test'), { meta: { cwd } })
    return { ctx, host: getHost()!, agent: { id: session.id, session } as Agent }
  }
  try {
    await mkdir(cwd)
    await promisify(execFile)('git', ['init', '-q'], { cwd })
    await writeFile(join(cwd, 'a.ts'), 'original\n')
    const first = await mount()
    const result = (await first.host.request(
      first.agent,
      { action: 'capture', range: 'worktree', path: 'a.ts' },
      new AbortController().signal,
    )) as DiffReadResult
    if (result.kind !== 'text') throw new Error(result.reason)
    const anchored = (await first.host.request(
      first.agent,
      { action: 'anchor', snapshot: result.snapshot, side: 'new', startLine: 1, endLine: 1 },
      new AbortController().signal,
    )) as { source: unknown }
    const source = parseDiffSource(anchored.source)
    await first.ctx.fiber.dispose()
    await writeFile(join(cwd, 'a.ts'), 'changed after restart\n')
    const second = await mount()
    expect(() => second.host.validate(diffAnnotation(source), second.agent)).not.toThrow()
    const pending = vi.spyOn(second.ctx.subprocess, 'resolveExecutable').mockImplementation(
      (_command, _env, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        }),
    )
    const read = second.host.request(
      second.agent,
      { action: 'list', range: 'worktree' },
      new AbortController().signal,
    )
    const rejected = expect(read).rejects.toThrow()
    await vi.waitFor(() => expect(pending).toHaveBeenCalled())
    await second.host.dispose()
    await rejected
  } finally {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
