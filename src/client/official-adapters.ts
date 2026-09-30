/** Browser adapters for public document and workspace-change data. */
import type {
  AnnotationCreationEntry,
  FileAnnotationSource,
  OfficialDiffAnnotationSource,
  OfficialDiffHunk,
  OfficialDiffSnapshot,
} from '../shared/annotation-source.ts'
import { captureOfficialSelection, type SelectionCapture } from './selection.ts'
import type { SessionIdentity } from '../shared/types.ts'
import { officialDiffHash, quoteFragmentHash } from '../shared/snapshot-hash.ts'
import { officialDiffContext, parseOfficialDiffSource } from '../shared/official-source.ts'
import type { TextQuoteSelector } from '../shared/types.ts'

/** The authenticated browser-relative route served by the official changes plugin. */
export const OFFICIAL_CHANGES_DIFF_ROUTE = 'api/changes.diff'
/** The authenticated browser-relative summary route served by the official changes plugin. */
export const OFFICIAL_CHANGES_SUMMARY_ROUTE = 'api/changes.summary'

function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0))
    throw new Error(`${field} must be a string`)
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${field} must be a safe integer`)
  return value as number
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function hunk(value: unknown, index: number): OfficialDiffHunk {
  const item = record(value, `hunks[${index}]`)
  const lines = item.lines
  if (!Array.isArray(lines)) throw new Error(`hunks[${index}].lines must be an array`)
  return Object.freeze({
    oldStart: integer(item.oldStart, `hunks[${index}].oldStart`),
    oldLines: integer(item.oldLines, `hunks[${index}].oldLines`),
    newStart: integer(item.newStart, `hunks[${index}].newStart`),
    newLines: integer(item.newLines, `hunks[${index}].newLines`),
    lines: Object.freeze(
      lines.map((line, lineIndex) => {
        const text = string(line, `hunks[${index}].lines[${lineIndex}]`, true)
        if (!/^[+ -]/u.test(text)) throw new Error(`hunks[${index}] has an invalid line prefix`)
        return text
      }),
    ),
  })
}

/** Validate official changes.diff JSON while retaining the Host's comparison exactly. */
export function parseOfficialDiffResponse(
  value: unknown,
  identity: {
    readonly sessionId: SessionIdentity
    readonly seq: number
    readonly turn: number
    readonly fileIndex: number
  },
): OfficialDiffSnapshot {
  const item = record(value, 'changes.diff')
  const kind = item.kind
  if (kind !== 'text' && kind !== 'binary' && kind !== 'oversized')
    throw new Error('changes.diff has an invalid kind')
  if (
    kind !== 'text' &&
    (item.before !== undefined ||
      item.after !== undefined ||
      item.coarse !== undefined ||
      item.hunks !== undefined)
  )
    throw new Error('non-text changes.diff must not contain text fields')
  const parsed: Omit<OfficialDiffSnapshot, 'hash'> = {
    version: 1,
    sessionId: identity.sessionId,
    seq: identity.seq,
    turn: identity.turn,
    fileIndex: identity.fileIndex,
    path: string(item.path, 'changes.diff.path'),
    display: string(item.display, 'changes.diff.display'),
    kind,
    before: kind === 'text' ? item.before === true : null,
    after: kind === 'text' ? item.after === true : null,
    coarse: kind === 'text' ? item.coarse === true : false,
    hunks:
      kind === 'text'
        ? Object.freeze(
            Array.isArray(item.hunks)
              ? item.hunks.map(hunk)
              : (() => {
                  throw new Error('changes.diff.hunks must be an array')
                })(),
          )
        : Object.freeze([]),
  }
  if (kind === 'text') {
    if (
      typeof item.before !== 'boolean' ||
      typeof item.after !== 'boolean' ||
      typeof item.coarse !== 'boolean'
    )
      throw new Error('changes.diff text side metadata is invalid')
    if (!parsed.before && !parsed.after) throw new Error('changes.diff contains no file side')
  }
  const snapshot = Object.freeze({ ...parsed, hash: officialDiffHash(parsed) })
  const side = kind === 'text' ? (parsed.after ? 'new' : 'old') : 'file'
  return parseOfficialDiffSource({
    kind: 'official-diff',
    snapshot,
    side,
    wholeFile: true,
    entry: 'sidebar',
  }).snapshot
}

/** Build an immutable source for a currently displayed official turn Diff. */
export function officialDiffSource(
  snapshot: OfficialDiffSnapshot,
  side: 'old' | 'new' | 'file',
  entry: AnnotationCreationEntry,
  range?: {
    readonly startLine: number
    readonly endLine: number
    readonly startColumn?: number
    readonly endColumn?: number
  },
): OfficialDiffAnnotationSource {
  return Object.freeze({
    kind: 'official-diff',
    snapshot,
    side,
    ...(range === undefined ? {} : { startLine: range.startLine, endLine: range.endLine }),
    ...(range?.startColumn === undefined ? {} : { startColumn: range.startColumn }),
    ...(range?.endColumn === undefined ? {} : { endColumn: range.endColumn }),
    wholeFile: range === undefined,
    entry,
  })
}

/** Build an immutable source for a file preview revision. */
export function fileSource(
  input: {
    readonly sessionId: SessionIdentity
    readonly resourceAddress: string
    readonly path: string
    readonly resourceVersion: string
    readonly format: string
    readonly hash: string
    readonly bytes: number
    readonly text?: string
    readonly renderedText?: string
    readonly pages?: readonly { readonly offset: number; readonly text: string; readonly lines: number }[]
  },
  entry: AnnotationCreationEntry,
  wholeFile: boolean,
): FileAnnotationSource {
  return Object.freeze({
    kind: 'file',
    sessionId: input.sessionId,
    resourceAddress: input.resourceAddress,
    path: input.path,
    resourceVersion: input.resourceVersion,
    format: input.format,
    snapshot: Object.freeze({
      version: 1,
      hash: input.hash,
      bytes: input.bytes,
      format: input.format,
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.renderedText === undefined ? {} : { renderedText: input.renderedText }),
      ...(input.pages === undefined ? {} : { pages: input.pages }),
    }),
    wholeFile,
    entry,
  })
}

/** Drop transient complete file text after the selected fragment has been checked against the Host revision. */
export function compactFileSource(
  source: FileAnnotationSource,
  quote?: TextQuoteSelector,
  coordinateSpace: 'raw' | 'rendered' = 'raw',
): FileAnnotationSource {
  return Object.freeze({
    ...source,
    snapshot: Object.freeze({
      version: 2,
      hash: source.snapshot.hash,
      bytes: source.snapshot.bytes,
      format: source.format,
      coordinateSpace,
      ...(quote === undefined ? {} : { fragmentHash: quoteFragmentHash(quote) }),
    }),
  })
}

/** Retain identity, positions, and a verified fragment instead of every official Diff hunk. */
export function compactOfficialDiffSource(
  source: OfficialDiffAnnotationSource,
  quote?: TextQuoteSelector,
): OfficialDiffAnnotationSource {
  const context = officialDiffContext(source)
  return Object.freeze({
    ...source,
    snapshot: Object.freeze({
      ...source.snapshot,
      version: 2,
      hunks: Object.freeze([]),
      contextBefore: context.before,
      contextAfter: context.after,
      ...(quote === undefined ? {} : { fragmentHash: quoteFragmentHash(quote) }),
    }),
  })
}

/** Capture a selection against a file/Diff snapshot while preserving the visible rectangle. */
export function captureOfficialRange(
  root: HTMLElement,
  range: Range,
  source: FileAnnotationSource | OfficialDiffAnnotationSource,
): SelectionCapture {
  return captureOfficialSelection(root, range, source)
}

/** Parse coordinates from the public review resource address. */
export function parseOfficialReviewAddress(
  address: string,
): { sessionId: SessionIdentity; seq: number; turn: number } | undefined {
  const prefix = 'dsh-resource://changes-review/session/'
  if (!address.startsWith(prefix)) return undefined
  const parts = address.slice(prefix.length).split('/')
  if (parts.length !== 3 || parts[0] === undefined || parts[1] === undefined || parts[2] === undefined)
    return undefined
  if (!/^\d+$/u.test(parts[1]) || !/^[1-9]\d*$/u.test(parts[2])) return undefined
  try {
    return {
      sessionId: decodeURIComponent(parts[0]) as SessionIdentity,
      seq: Number(parts[1]),
      turn: Number(parts[2]),
    }
  } catch {
    return undefined
  }
}

/** Parse the official file index from a public changes action URL. */
export function parseOfficialFileActionUrl(
  url: string,
): { sessionId: SessionIdentity; seq: number; fileIndex: number } | undefined {
  try {
    const query = new URL(url, document.baseURI).searchParams
    const sessionId = query.get('sessionId')
    const seq = query.get('seq')
    const index = query.get('index')
    if (sessionId === null || seq === null || index === null || !/^\d+$/u.test(seq) || !/^\d+$/u.test(index))
      return undefined
    return { sessionId: sessionId as SessionIdentity, seq: Number(seq), fileIndex: Number(index) }
  } catch {
    return undefined
  }
}

/** Build the authenticated comparison route without depending on deliverables runtime code. */
export function officialDiffUrl(sessionId: SessionIdentity, seq: number, fileIndex: number): string {
  return `${OFFICIAL_CHANGES_DIFF_ROUTE}?${new URLSearchParams({ sessionId, seq: String(seq), index: String(fileIndex) })}`
}
