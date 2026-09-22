/** Read-only Git capture through the Host filesystem and subprocess providers. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import {
  relocationCandidates,
  diffContext,
  diffPathSchema,
  diffQuote,
  diffSnapshotSchema,
  fileLines,
  parseDiffSource,
  type DiffFileEntry,
  type DiffGitObjectId,
  type DiffRange,
  type DiffReadResult,
  type DiffSnapshot,
  type DiffSource,
} from '../shared/diff-source.ts'
import type { AnnotationConfig, SubmittedAnnotation } from '../shared/types.ts'

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), range: z.enum(['worktree', 'staged']) }),
  z.object({ action: z.literal('capture'), range: z.enum(['worktree', 'staged']), path: diffPathSchema }),
  z.object({ action: z.literal('recapture'), source: z.unknown() }),
  z.object({
    action: z.literal('anchor'),
    snapshot: diffSnapshotSchema,
    side: z.enum(['old', 'new']),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    reboundFrom: z.unknown().optional(),
  }),
])
type SnapshotSide = DiffSnapshot['old']
type CaptureBody = Omit<z.input<typeof diffSnapshotSchema>, 'id' | 'seal'>
const absent: SnapshotSide = { kind: 'absent', content: null, oid: null, sha256: null }

class UnsupportedDiff extends Error {}

/** SHA-256 identifies captured bytes independently of mutable Git revision names.
 * @param text - Exact UTF-8 content to hash.
 * @returns Lowercase SHA-256 hex digest.
 */
export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Parse NUL-delimited Git status records, including both paths of a rename.
 * @param text - Complete Git name-status output with its final NUL.
 * @returns Literal changed paths; unsafe, unmerged or incomplete records throw.
 */
export function parseChangedPaths(text: string): DiffFileEntry[] {
  const fields = text.split('\0')
  if (fields.pop() !== '') throw new Error('Incomplete Git path listing')
  const files: DiffFileEntry[] = []
  for (let at = 0; at < fields.length;) {
    const status = fields[at++]!
    if (!/^(?:[AMDT]|[RC]\d{1,3})$/.test(status)) throw new UnsupportedDiff('incomplete')
    const first = diffPathSchema.parse(fields[at++])
    const second = /^[RC]/.test(status) ? diffPathSchema.parse(fields[at++]) : first
    files.push({
      path: status === 'D' ? first : second,
      oldPath: status === 'A' ? null : first,
      newPath: status === 'D' ? null : second,
      status,
    })
  }
  return files
}

/** A persistent signing key attests only snapshots the Host actually read. */
export class AnnotationDiffHost {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(
    private readonly fs: FileSystem,
    private readonly subprocess: SubprocessRuntime,
    private readonly config: AnnotationConfig,
    private readonly key: string,
  ) {}

  /** Abort and await every read before releasing the plugin's storage handle. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.pending)
  }

  private async git(cwd: string, args: readonly string[], signal: AbortSignal, stdin?: string) {
    const combined = AbortSignal.any([
      signal,
      this.lifetime.signal,
      AbortSignal.timeout(this.config.diffTimeoutMs),
    ])
    const executable = await this.subprocess.resolveExecutable('git', undefined, combined)
    const child = this.subprocess.spawn({
      argv: [executable, '--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args],
      cwd,
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: this.config.maxPayloadBytes },
        stderr: { maxBytes: 8192 },
      },
      graceMs: 2000,
      signal: combined,
      env: {
        GIT_DIR: undefined,
        GIT_NAMESPACE: undefined,
        GIT_ATTR_SOURCE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_OBJECT_DIRECTORY: undefined,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG_PARAMETERS: undefined,
        GIT_CONFIG_COUNT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
        LC_ALL: 'C',
      },
    })
    const result = await child.done
    combined.throwIfAborted()
    const output = child.collected.stdout!.readFrom(0)
    if (output.lossy) throw new UnsupportedDiff('oversized')
    return { code: result.exitCode, text: output.text, error: child.collected.stderr!.readFrom(0).text }
  }

  private async required(
    cwd: string,
    args: readonly string[],
    signal: AbortSignal,
    stdin?: string,
  ): Promise<string> {
    const result = await this.git(cwd, args, signal, stdin)
    if (result.code !== 0) throw new Error(`Git read failed: ${result.error.trim()}`)
    return result.text
  }

  private async repository(agent: Agent, signal: AbortSignal) {
    const workspace = agent.session.header.cwd
    if (workspace === undefined) throw new Error('The current session has no workspace')
    const target = await this.fs.resolve(workspace, { signal })
    const cwd = this.fs.processPath(target)
    const repository = (await this.required(cwd, ['rev-parse', '--show-toplevel'], signal)).replace(
      /\r?\n$/,
      '',
    )
    const root = await this.fs.resolve(repository, { signal })
    const gitDir = (await this.required(cwd, ['rev-parse', '--absolute-git-dir'], signal)).replace(
      /\r?\n$/,
      '',
    )
    const prefix = (await this.required(cwd, ['rev-parse', '--show-prefix'], signal)).replace(/\r?\n$/, '')
    return {
      workspace,
      repository,
      target,
      prefix,
      workspaceId: digest(this.fs.fileUrl(target)),
      repositoryId: digest(`${this.fs.fileUrl(root)}\n${gitDir}`),
    }
  }

  private async files(agent: Agent, range: DiffRange, signal: AbortSignal): Promise<DiffFileEntry[]> {
    const repo = await this.repository(agent, signal)
    const text = await this.required(
      repo.repository,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '-z',
        '--find-renames',
        ...(range === 'staged' ? ['--cached'] : []),
        '--',
        repo.prefix || '.',
      ],
      signal,
    )
    const files = parseChangedPaths(text)
    if (range === 'worktree') {
      const untracked = await this.required(
        repo.repository,
        ['ls-files', '--others', '--exclude-standard', '-z', '--', repo.prefix || '.'],
        signal,
      )
      for (const path of untracked.split('\0').filter(Boolean)) {
        diffPathSchema.parse(path)
        if (!files.some((file) => file.path === path))
          files.push({ path, oldPath: null, newPath: path, status: 'A' })
      }
    }
    return files
  }

  private async assertTextDiff(
    repository: string,
    range: DiffRange,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    const attributes = (
      await this.required(repository, ['check-attr', '-z', 'diff', '--', ...paths], signal)
    ).split('\0')
    for (let at = 2; at < attributes.length; at += 3) {
      if (attributes[at] === 'unset') throw new UnsupportedDiff('binary')
      const driver = attributes[at]!
      if (driver !== 'set' && driver !== 'unspecified') {
        const binary = await this.git(
          repository,
          ['config', '--type=bool', '--get', `diff.${driver}.binary`],
          signal,
        )
        if (binary.code !== 0 && binary.code !== 1) throw new UnsupportedDiff('incomplete')
        if (binary.text.trim() === 'true') throw new UnsupportedDiff('binary')
      }
    }
    const counts = await this.required(
      repository,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--numstat',
        '-z',
        ...(range === 'staged' ? ['--cached'] : []),
        '--',
        ...paths,
      ],
      signal,
    )
    if (/(?:^|\0)-\t-\t/.test(counts)) throw new UnsupportedDiff('binary')
  }

  private text(content: string): string {
    if (content.includes('\0')) throw new UnsupportedDiff('binary')
    if (
      Buffer.byteLength(content) > this.config.maxDiffFileBytes ||
      fileLines(content).length > this.config.maxDiffLines
    ) {
      throw new UnsupportedDiff('oversized')
    }
    return content
  }

  private async blob(
    repository: string,
    revision: string | null,
    path: string | null,
    signal: AbortSignal,
  ): Promise<SnapshotSide> {
    if (revision === null || path === null) return absent
    const listing = await this.required(
      repository,
      revision === ':index'
        ? ['ls-files', '--stage', '-z', '--', path]
        : ['ls-tree', '-z', revision, '--', path],
      signal,
    )
    if (listing === '') return absent
    const records = listing.split('\0').filter(Boolean)
    const match = /^(\d+) (?:blob )?([a-f0-9]{40}|[a-f0-9]{64})(?: (\d))?\t([^\0]+)$/.exec(records[0]!)
    if (records.length !== 1 || match === null || (match[3] !== undefined && match[3] !== '0'))
      throw new UnsupportedDiff('incomplete')
    if (!['100644', '100755'].includes(match[1]!)) throw new UnsupportedDiff('special')
    const oid = match[2]! as DiffGitObjectId
    const bytes = Number((await this.required(repository, ['cat-file', '-s', oid], signal)).trim())
    if (!Number.isSafeInteger(bytes) || bytes > this.config.maxDiffFileBytes)
      throw new UnsupportedDiff('oversized')
    const content = this.text(await this.required(repository, ['cat-file', 'blob', oid], signal))
    if ((await this.required(repository, ['hash-object', '--stdin'], signal, content)).trim() !== oid)
      throw new UnsupportedDiff('binary')
    return { kind: 'blob', content, oid, sha256: digest(content) }
  }

  private async working(
    repo: Awaited<ReturnType<AnnotationDiffHost['repository']>>,
    path: string | null,
    signal: AbortSignal,
  ): Promise<SnapshotSide> {
    if (path === null) return absent
    const before = await this.fs.lstat(path, { cwd: repo.repository }, signal)
    if (before === undefined) return absent
    if (before.type !== 'file') throw new UnsupportedDiff('special')
    const target = await this.fs.resolve(path, { cwd: repo.repository, signal })
    if (!this.fs.contains(repo.target, target))
      throw new Error('Diff file is outside the current session workspace')
    if (before.size !== undefined && before.size > this.config.maxDiffFileBytes)
      throw new UnsupportedDiff('oversized')
    let content = ''
    try {
      for await (const chunk of await this.fs.streamText(target, signal)) {
        content += chunk
        if (Buffer.byteLength(content) > this.config.maxDiffFileBytes) throw new UnsupportedDiff('oversized')
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FS_NOT_TEXT')
        throw new UnsupportedDiff('binary')
      throw error
    }
    const after = await this.fs.lstat(path, { cwd: repo.repository }, signal)
    if (before.version !== after?.version) throw new UnsupportedDiff('changed')
    return { kind: 'working-tree', content: this.text(content), oid: null, sha256: digest(content) }
  }

  private signed(body: CaptureBody): DiffSnapshot {
    const {
      id: _id,
      seal: _seal,
      ...normalized
    } = diffSnapshotSchema.parse({ ...body, id: '0'.repeat(64), seal: '0'.repeat(64) })
    const { capturedAt, ...version } = normalized
    const id = digest(JSON.stringify(version))
    const seal = createHmac('sha256', this.key).update(`${id}:${capturedAt}`).digest('hex')
    return diffSnapshotSchema.parse({ ...normalized, id, seal })
  }

  private verify(snapshot: DiffSnapshot, agent: Agent): void {
    const { id, seal, ...body } = diffSnapshotSchema.parse(snapshot)
    const expected = this.signed(body)
    if (
      id !== expected.id ||
      !timingSafeEqual(Buffer.from(seal, 'hex'), Buffer.from(expected.seal, 'hex')) ||
      snapshot.sessionId !== String(agent.id) ||
      snapshot.workspace !== agent.session.header.cwd
    ) {
      throw new Error('Diff snapshot is not attested for this session and workspace')
    }
    for (const side of [snapshot.old, snapshot.new]) {
      if (
        side.kind !== 'absent' &&
        (digest(side.content) !== side.sha256 || this.text(side.content) !== side.content)
      ) {
        throw new Error('Diff snapshot content fingerprint does not match')
      }
    }
  }

  /** Validate immutable source and quote again at the actual submission boundary.
   * @param item - A decoded submission annotation; message sources need no Git validation.
   * @param agent - Receiving Session and workspace identity.
   */
  validate(item: SubmittedAnnotation, agent: Agent): void {
    if (item.source?.kind !== 'diff') return
    const source = parseDiffSource(item.source)
    this.verify(source.snapshot, agent)
    if (source.reboundFrom !== undefined) {
      this.verify(source.reboundFrom.snapshot, agent)
      if (source.reboundFrom.fingerprint !== digest(diffQuote(source.reboundFrom).exact))
        throw new Error('Original Diff fingerprint does not match')
    }
    const quote = diffQuote(source)
    if (
      Object.entries(quote).some(([field, value]) => item.quote[field as keyof typeof quote] !== value) ||
      source.fingerprint !== digest(quote.exact)
    ) {
      throw new Error('Diff annotation does not match its attested file lines')
    }
  }

  private async capture(
    agent: Agent,
    range: DiffRange,
    file: DiffFileEntry,
    signal: AbortSignal,
    listed = true,
  ): Promise<DiffReadResult> {
    try {
      const repo = await this.repository(agent, signal)
      for (const path of [file.oldPath, file.newPath]) {
        if (path !== null && !path.startsWith(repo.prefix))
          throw new Error('Diff path is outside the session workspace')
      }
      await this.assertTextDiff(
        repo.repository,
        range,
        [...new Set([file.oldPath, file.newPath].filter((path): path is string => path !== null))],
        signal,
      )
      const readHead = async () => {
        const result = await this.git(repo.repository, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal)
        if (result.code === 1) return null
        if (result.code !== 0) throw new Error('Unable to resolve HEAD')
        return result.text.trim()
      }
      const head = await readHead()
      // An absent side is checked at its counterpart path too: a stale A/D listing cannot attest absence.
      const oldPath = file.oldPath ?? file.path
      const newPath = file.newPath ?? file.path
      const old = await this.blob(repo.repository, range === 'staged' ? head : ':index', oldPath, signal)
      const next =
        range === 'staged'
          ? await this.blob(repo.repository, ':index', newPath, signal)
          : await this.working(repo, newPath, signal)
      const oldAgain = await this.blob(repo.repository, range === 'staged' ? head : ':index', oldPath, signal)
      const newAgain = range === 'staged' ? await this.blob(repo.repository, ':index', newPath, signal) : next
      if (old.oid !== oldAgain.oid || next.oid !== newAgain.oid || head !== (await readHead()))
        throw new UnsupportedDiff('changed')
      const current = (await this.files(agent, range, signal)).find((entry) => entry.path === file.path)
      if (
        listed
          ? current === undefined ||
            current.oldPath !== file.oldPath ||
            current.newPath !== file.newPath ||
            current.status !== file.status
          : current !== undefined
      ) {
        throw new UnsupportedDiff('changed')
      }
      if (
        listed &&
        ((file.oldPath === null) !== (old.kind === 'absent') ||
          (file.newPath === null) !== (next.kind === 'absent'))
      )
        throw new UnsupportedDiff('changed')
      if (old.kind === 'absent' && next.kind === 'absent') throw new UnsupportedDiff('missing')
      return {
        kind: 'text',
        snapshot: this.signed({
          version: 1,
          sessionId: String(agent.id),
          workspace: repo.workspace,
          workspaceId: repo.workspaceId,
          repository: repo.repository,
          repositoryId: repo.repositoryId,
          range,
          head,
          oldPath: old.kind === 'absent' ? null : oldPath,
          newPath: next.kind === 'absent' ? null : newPath,
          old,
          new: next,
          capturedAt: Date.now(),
        }),
      }
    } catch (error) {
      if (error instanceof UnsupportedDiff) return { kind: 'unsupported', reason: error.message }
      throw error
    }
  }

  /** Dispatch bounded, session-scoped read requests through the existing command transport.
   * @param agent - Session that owns the workspace and returned snapshots.
   * @param value - Untrusted command JSON.
   * @param signal - Request cancellation, combined with plugin disposal and per-command timeout.
   * @returns A file listing, frozen comparison or validated anchor; no model work is enqueued.
   */
  request(agent: Agent, value: unknown, signal: AbortSignal): Promise<unknown> {
    const work = this.dispatch(agent, value, AbortSignal.any([signal, this.lifetime.signal]))
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => undefined)
    return work
  }

  private async dispatch(agent: Agent, value: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const request = requestSchema.parse(value)
    if (request.action === 'list') return { files: await this.files(agent, request.range, signal) }
    if (request.action === 'capture') {
      const file = (await this.files(agent, request.range, signal)).find((file) => file.path === request.path)
      if (file === undefined) throw new Error('The Git change moved or disappeared; refresh the file list')
      return this.capture(agent, request.range, file, signal)
    }
    if (request.action === 'recapture') {
      const source = parseDiffSource(request.source)
      this.verify(source.snapshot, agent)
      const snapshot = source.snapshot
      const path = snapshot.newPath ?? snapshot.oldPath!
      const file = (await this.files(agent, snapshot.range, signal)).find(
        (file) => file.path === path || file.oldPath === path,
      )
      return this.capture(
        agent,
        snapshot.range,
        file ?? { path, oldPath: path, newPath: path, status: 'M' },
        signal,
        file !== undefined,
      )
    }
    this.verify(request.snapshot, agent)
    const origin = {
      kind: 'diff' as const,
      snapshot: request.snapshot,
      side: request.side,
      startLine: request.startLine,
      endLine: request.endLine,
    }
    const quote = diffQuote(origin)
    const source: DiffSource = { ...origin, ...diffContext(origin), fingerprint: digest(quote.exact) }
    if (request.reboundFrom !== undefined) {
      const previous = parseDiffSource(request.reboundFrom)
      this.verify(previous.snapshot, agent)
      const candidates = relocationCandidates(previous, request.snapshot)
      if (
        previous.side !== request.side ||
        previous.endLine - previous.startLine !== request.endLine - request.startLine ||
        candidates.length !== 1 ||
        candidates[0] !== request.startLine
      ) {
        throw new Error('Rebinding requires one matching range in the same file comparison')
      }
      const { reboundFrom: earliest, ...original } = previous
      source.reboundFrom = earliest ?? original
    }
    return { source, quote }
  }
}
