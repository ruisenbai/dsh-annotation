/** Immutable, Host-attested Git comparisons and one-based file coordinates. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { TextQuoteSelector } from './types.ts'

/** Content-addressed identity of an attested comparison. */
export type DiffSnapshotId = Branded<'AnnotationDiffSnapshotId'>
/** Canonical Session workspace identity. */
export type DiffWorkspaceId = Branded<'AnnotationDiffWorkspaceId'>
/** Canonical Git checkout and metadata identity. */
export type DiffRepositoryId = Branded<'AnnotationDiffRepositoryId'>
/** Immutable Git commit or blob object identity. */
export type DiffGitObjectId = Branded<'AnnotationDiffGitObjectId'>

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const objectId = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
  .transform((value) => value as DiffGitObjectId)
const identity = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'))
/** Git paths are literal repository-relative paths, never pathspec expressions. */
export const diffPathSchema = identity.refine(
  (value) =>
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'),
)
const absent = z.object({ kind: z.literal('absent'), content: z.null(), sha256: z.null(), oid: z.null() })
const textContent = z
  .string()
  .refine((value) => !value.includes('\0'), 'Binary content has no text line anchors')
const blob = z.object({ kind: z.literal('blob'), content: textContent, sha256: hash, oid: objectId })
const working = z.object({
  kind: z.literal('working-tree'),
  content: textContent,
  sha256: hash,
  oid: z.null(),
})
/** Captured text or an absent side; binary data has no line coordinates. */
export const diffSideSchema = z.discriminatedUnion('kind', [absent, blob, working])
/** Wire and storage validation for an explicit Git comparison and its full contents. */
export const diffSnapshotSchema = z
  .object({
    version: z.literal(1),
    id: hash.transform((value) => value as DiffSnapshotId),
    sessionId: identity.transform((value) => value as SessionId),
    workspace: identity,
    workspaceId: hash.transform((value) => value as DiffWorkspaceId),
    repository: identity,
    repositoryId: hash.transform((value) => value as DiffRepositoryId),
    range: z.enum(['worktree', 'staged']),
    oldPath: diffPathSchema.nullable(),
    newPath: diffPathSchema.nullable(),
    head: objectId.nullable(),
    old: diffSideSchema,
    new: diffSideSchema,
    capturedAt: z.number().int().nonnegative(),
    seal: hash,
  })
  .superRefine((value, ctx) => {
    if (
      value.old.kind === 'working-tree' ||
      (value.range === 'staged' && value.new.kind === 'working-tree') ||
      (value.range === 'worktree' && value.new.kind === 'blob') ||
      (value.oldPath === null) !== (value.old.kind === 'absent') ||
      (value.newPath === null) !== (value.new.kind === 'absent') ||
      (value.oldPath === null && value.newPath === null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Diff paths and comparison sides disagree' })
    }
  })
/** Complete immutable comparison retained with drafts and durable submissions. */
export type DiffSnapshot = z.infer<typeof diffSnapshotSchema>
/** Old and new counters are independent and one-based. */
export type DiffSide = 'old' | 'new'
/** Actual Host comparison, never inferred from a Client tab name. */
export type DiffRange = DiffSnapshot['range']

const originSchema = z.object({
  kind: z.literal('diff'),
  snapshot: diffSnapshotSchema,
  side: z.enum(['old', 'new']),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  fingerprint: hash,
  contextBefore: z.string(),
  contextAfter: z.string(),
})
/** Anchored lines with at most one retained original location after explicit rebinding. */
export const diffSourceSchema = originSchema.extend({ reboundFrom: originSchema.optional() })
/** A frozen file-side range and its attested source. */
export type DiffSource = z.infer<typeof diffSourceSchema>
/** Literal paths from one Git change listing; renames retain both names. */
export interface DiffFileEntry {
  readonly path: string
  readonly oldPath: string | null
  readonly newPath: string | null
  readonly status: string
}
/** Unsupported content is explicit and never represented by fabricated text rows. */
export type DiffReadResult =
  | { readonly kind: 'text'; readonly snapshot: DiffSnapshot }
  | { readonly kind: 'unsupported'; readonly reason: string }

/** Split real file lines without inventing a final line after a terminator.
 * @param content - Complete captured UTF-8 file text.
 * @returns Lines without LF terminators; CR characters remain part of the captured text.
 */
export function fileLines(content: string): string[] {
  if (content === '') return []
  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  return lines
}

/** Reconstruct a quote from a frozen side, including exact character offsets.
 * @param source - An inclusive one-based range on an existing text side.
 * @returns The exact quote and full-file UTF-16 offsets; invalid coordinates throw.
 */
export function diffQuote(
  source: Pick<DiffSource, 'snapshot' | 'side' | 'startLine' | 'endLine'>,
): TextQuoteSelector {
  const content = source.snapshot[source.side].content
  if (content === null) throw new Error('The selected side has no text')
  const lines = fileLines(content)
  if (
    !Number.isSafeInteger(source.startLine) ||
    !Number.isSafeInteger(source.endLine) ||
    source.startLine < 1 ||
    source.endLine < source.startLine ||
    source.endLine > lines.length
  ) {
    throw new Error('Diff lines must be an existing, contiguous one-based range on one side')
  }
  const start = lines.slice(0, source.startLine - 1).reduce((size, line) => size + line.length + 1, 0)
  const exact = lines.slice(source.startLine - 1, source.endLine).join('\n')
  const end = start + exact.length
  return Object.freeze({
    exact,
    start,
    end,
    prefix: content.slice(Math.max(0, start - 32), start),
    suffix: content.slice(end, end + 32),
  })
}

/** Context is bounded by three complete file lines, not DOM or fragment offsets.
 * @param source - A validated file-side range.
 * @returns Up to three captured lines before and after the selected range.
 */
export function diffContext(source: Pick<DiffSource, 'snapshot' | 'side' | 'startLine' | 'endLine'>) {
  const lines = fileLines(source.snapshot[source.side].content ?? '')
  return {
    contextBefore: lines.slice(Math.max(0, source.startLine - 4), source.startLine - 1).join('\n'),
    contextAfter: lines.slice(source.endLine, source.endLine + 3).join('\n'),
  }
}

/** Validate persisted coordinates and their quoted code without accessing live files.
 * @param value - Untrusted wire or storage data.
 * @returns A deeply frozen source; malformed coordinates or context throw. Host admission separately checks the signature and hashes.
 */
export function parseDiffSource(value: unknown): DiffSource {
  const parsed = diffSourceSchema.parse(value)
  for (const source of [parsed, ...(parsed.reboundFrom === undefined ? [] : [parsed.reboundFrom])]) {
    diffQuote(source)
    const context = diffContext(source)
    if (source.contextBefore !== context.contextBefore || source.contextAfter !== context.contextAfter) {
      throw new Error('Diff context does not match its frozen file lines')
    }
  }
  const freeze = (value: object): void => {
    for (const nested of Object.values(value))
      if (typeof nested === 'object' && nested !== null) freeze(nested)
    Object.freeze(value)
  }
  freeze(parsed)
  return parsed
}

/** Match complete lines and their context; never break a tie by proximity.
 * @param source - The frozen original range.
 * @param snapshot - A captured candidate version of the same file comparison.
 * @returns Every matching one-based start line; only a unique match may be offered for explicit rebinding.
 */
export function relocationCandidates(source: DiffSource, snapshot: DiffSnapshot): readonly number[] {
  if (
    snapshot.repositoryId !== source.snapshot.repositoryId ||
    snapshot.workspaceId !== source.snapshot.workspaceId ||
    snapshot.range !== source.snapshot.range
  )
    return []
  const originalPath = source.snapshot[source.side === 'old' ? 'oldPath' : 'newPath']
  if (originalPath !== snapshot.oldPath && originalPath !== snapshot.newPath) return []
  const content = snapshot[source.side].content
  if (content === null) return []
  const oldLines = fileLines(source.snapshot[source.side].content ?? '')
  const lines = fileLines(content)
  const count = source.endLine - source.startLine + 1
  const quote = oldLines.slice(source.startLine - 1, source.endLine)
  const before = oldLines.slice(Math.max(0, source.startLine - 4), source.startLine - 1)
  const after = oldLines.slice(source.endLine, source.endLine + 3)
  const matches: number[] = []
  for (let at = 0; at + count <= lines.length; at++) {
    if (
      quote.every((line, offset) => lines[at + offset] === line) &&
      before.every((line, offset) => lines[at - before.length + offset] === line) &&
      after.every((line, offset) => lines[at + count + offset] === line)
    )
      matches.push(at + 1)
  }
  return matches
}

/** Human-facing position; immutable identifiers belong in diagnostic details.
 * @param source - A validated file-side range.
 * @returns File path, side and one-based lines for model-visible text.
 */
export function diffPosition(source: DiffSource): string {
  return `${source.snapshot[source.side === 'old' ? 'oldPath' : 'newPath']} · ${source.side} · ${source.startLine}${source.endLine === source.startLine ? '' : `–${source.endLine}`}`
}
