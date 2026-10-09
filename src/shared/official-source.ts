/** Validation and quote reconstruction for official workspace file and turn-Diff snapshots. */
import type {
  AnnotationCreationEntry,
  FileAnnotationSource,
  OfficialDiffAnnotationSource,
  OfficialDiffHunk,
  OfficialDiffSnapshot,
} from './annotation-source.ts'
import type { AnnotationId, SessionIdentity, TextQuoteSelector } from './types.ts'
import { officialDiffHash, sha256Hex } from './snapshot-hash.ts'

const HASH = /^[a-f0-9]{64}$/u
const MAX_PATH = 4096

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0))
    throw new Error(`${field} must be a string`)
  if (value.includes('\0')) throw new Error(`${field} must not contain NUL`)
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${field} must be a safe integer`)
  return value as number
}

function hash(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (!HASH.test(parsed)) throw new Error(`${field} must be a SHA-256 hex digest`)
  return parsed
}

function boundedContext(value: unknown, field: string): string {
  const parsed = text(value, field, true)
  if (parsed.length > 64) throw new Error(`${field} exceeds 64 UTF-16 units`)
  return parsed
}

function entry(value: unknown, field: string): AnnotationCreationEntry {
  if (value !== 'body' && value !== 'hover' && value !== 'sidebar')
    throw new Error(`${field} is not a supported creation entry`)
  return value
}

function fileResourceIdentity(value: string): { readonly sessionId: string; readonly path: string } {
  const prefix = 'dsh-resource://file/session/'
  if (!value.startsWith(prefix)) throw new Error('file resourceAddress is invalid')
  const slash = value.indexOf('/', prefix.length)
  if (slash < 0) throw new Error('file resourceAddress is invalid')
  try {
    const sessionId = decodeURIComponent(value.slice(prefix.length, slash))
    const path = decodeURIComponent(value.slice(slash + 1))
    if (sessionId.length === 0 || path.length === 0) throw new Error('file resourceAddress is invalid')
    return { sessionId, path }
  } catch {
    throw new Error('file resourceAddress is invalid')
  }
}

function isNormalizedWorkspacePath(value: string): boolean {
  const body = value.startsWith('/') ? value.slice(1) : value
  return (
    body.length > 0 &&
    !value.includes('\\') &&
    !body.includes('//') &&
    !body.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
    !value.startsWith('./')
  )
}

function freezeDeep(value: object): void {
  for (const nested of Object.values(value)) {
    if (typeof nested === 'object' && nested !== null) freezeDeep(nested)
  }
  Object.freeze(value)
}

function parseHunk(value: unknown, index: number): OfficialDiffHunk {
  const source = record(value, `source.snapshot.hunks[${index}]`)
  const parsed = {
    oldStart: integer(source.oldStart, `hunks[${index}].oldStart`),
    oldLines: integer(source.oldLines, `hunks[${index}].oldLines`),
    newStart: integer(source.newStart, `hunks[${index}].newStart`),
    newLines: integer(source.newLines, `hunks[${index}].newLines`),
    lines: Array.isArray(source.lines)
      ? source.lines.map((line, lineIndex) => {
          const value = text(line, `hunks[${index}].lines[${lineIndex}]`, true)
          if (!/^[+ -]/u.test(value))
            throw new Error(`hunks[${index}].lines must be prefixed with +, -, or space`)
          return value
        })
      : (() => {
          throw new Error(`hunks[${index}].lines must be an array`)
        })(),
  }
  const oldCount = parsed.lines.filter((line) => line[0] !== '+').length
  const newCount = parsed.lines.filter((line) => line[0] !== '-').length
  if (
    parsed.oldStart < 1 ||
    parsed.newStart < 1 ||
    oldCount !== parsed.oldLines ||
    newCount !== parsed.newLines
  )
    throw new Error(`hunks[${index}] line counts disagree with its coordinates`)
  if (parsed.lines.some((line) => line.includes('\n')))
    throw new Error(`hunks[${index}] contains an embedded newline`)
  return Object.freeze({ ...parsed, lines: Object.freeze(parsed.lines) })
}

/** Validate and freeze a file preview source from durable or wire data. */
export function parseFileAnnotationSource(value: unknown): FileAnnotationSource {
  const source = record(value, 'annotation.source')
  if (source.kind !== 'file') throw new Error('annotation source is not a file source')
  const snapshot = record(source.snapshot, 'file snapshot')
  if (snapshot.version !== 1 && snapshot.version !== 2) throw new Error('file snapshot version is invalid')
  if (typeof source.wholeFile !== 'boolean') throw new Error('file wholeFile must be a boolean')
  const sessionId = text(source.sessionId, 'file sessionId') as SessionIdentity
  const resourceAddress = text(source.resourceAddress, 'file resourceAddress')
  const path = text(source.path, 'file path')
  const resourceIdentity = fileResourceIdentity(resourceAddress)
  if (
    path.length > MAX_PATH ||
    path.includes('\\') ||
    !isNormalizedWorkspacePath(path) ||
    resourceIdentity.sessionId !== sessionId ||
    resourceIdentity.path !== path
  )
    throw new Error('file identity is invalid')
  const parsed: FileAnnotationSource = {
    kind: 'file',
    sessionId,
    resourceAddress,
    path,
    resourceVersion: text(source.resourceVersion, 'file resourceVersion'),
    format: text(source.format, 'file format'),
    snapshot: {
      version: snapshot.version,
      hash: hash(snapshot.hash, 'file snapshot.hash'),
      bytes: integer(snapshot.bytes, 'file snapshot.bytes'),
      format: text(snapshot.format, 'file snapshot.format'),
      ...(snapshot.version === 2
        ? {
            coordinateSpace:
              snapshot.coordinateSpace === 'raw' || snapshot.coordinateSpace === 'rendered'
                ? snapshot.coordinateSpace
                : (() => {
                    throw new Error('file coordinate space is invalid')
                  })(),
            ...(snapshot.fragmentHash === undefined
              ? {}
              : { fragmentHash: hash(snapshot.fragmentHash, 'file snapshot.fragmentHash') }),
          }
        : {}),
      ...(snapshot.version === 2 || snapshot.text === undefined
        ? {}
        : { text: text(snapshot.text, 'file snapshot.text', true) }),
      ...(snapshot.version === 2 || snapshot.renderedText === undefined
        ? {}
        : { renderedText: text(snapshot.renderedText, 'file snapshot.renderedText', true) }),
      ...(snapshot.version === 2 || snapshot.renderedHash === undefined
        ? {}
        : { renderedHash: hash(snapshot.renderedHash, 'file snapshot.renderedHash') }),
    },
    wholeFile: source.wholeFile === true,
    ...(source.startLine === undefined ? {} : { startLine: integer(source.startLine, 'file startLine', 1) }),
    ...(source.endLine === undefined ? {} : { endLine: integer(source.endLine, 'file endLine', 1) }),
    ...(source.startColumn === undefined
      ? {}
      : { startColumn: integer(source.startColumn, 'file startColumn') }),
    ...(source.endColumn === undefined ? {} : { endColumn: integer(source.endColumn, 'file endColumn') }),
    entry: entry(source.entry, 'file entry'),
    ...(source.expired === true ? { expired: true } : {}),
  }
  if (parsed.snapshot.format !== parsed.format) throw new Error('file snapshot format disagrees with source')
  if (
    snapshot.version === 2 &&
    (snapshot.text !== undefined || snapshot.renderedText !== undefined || snapshot.hunks !== undefined)
  )
    throw new Error('compact file snapshot must not retain full contents')
  if (parsed.snapshot.text !== undefined) {
    const encoded = new TextEncoder().encode(parsed.snapshot.text)
    const bom = new Uint8Array(encoded.length + 3)
    bom.set([0xef, 0xbb, 0xbf])
    bom.set(encoded, 3)
    if (!(
      (encoded.byteLength === parsed.snapshot.bytes && sha256Hex(encoded) === parsed.snapshot.hash) ||
      (bom.byteLength === parsed.snapshot.bytes && sha256Hex(bom) === parsed.snapshot.hash)
    ))
      throw new Error(
        encoded.byteLength === parsed.snapshot.bytes || bom.byteLength === parsed.snapshot.bytes
          ? 'file snapshot digest does not match its text'
          : 'file snapshot text disagrees with byte size',
      )
  }
  if (
    (parsed.snapshot.renderedText === undefined) !== (parsed.snapshot.renderedHash === undefined) ||
    (parsed.snapshot.renderedText !== undefined &&
      sha256Hex(parsed.snapshot.renderedText) !== parsed.snapshot.renderedHash)
  )
    throw new Error('file rendered text digest is invalid')
  if ((parsed.startLine === undefined) !== (parsed.endLine === undefined))
    throw new Error('file line anchor must include both bounds')
  if (parsed.endLine !== undefined && parsed.startLine !== undefined && parsed.endLine < parsed.startLine)
    throw new Error('file endLine precedes startLine')
  if ((parsed.startColumn === undefined) !== (parsed.endColumn === undefined))
    throw new Error('file character anchor must include both bounds')
  if (
    parsed.startColumn !== undefined &&
    (parsed.startLine === undefined ||
      (parsed.startLine === parsed.endLine && parsed.endColumn! <= parsed.startColumn))
  )
    throw new Error('file character anchor is invalid')
  if (parsed.wholeFile && parsed.startLine !== undefined)
    throw new Error('whole-file source cannot carry text coordinates')
  if (
    !parsed.wholeFile &&
    parsed.snapshot.version === 1 &&
    (parsed.startLine === undefined || parsed.snapshot.text === undefined)
  )
    throw new Error('file range requires a text snapshot and line anchor')
  if (parsed.snapshot.version === 2) {
    if (parsed.wholeFile && parsed.snapshot.fragmentHash !== undefined)
      throw new Error('whole-file source cannot carry a fragment digest')
    if (!parsed.wholeFile && parsed.snapshot.fragmentHash === undefined)
      throw new Error('file range requires a fragment digest')
    if (!parsed.wholeFile && parsed.snapshot.coordinateSpace === 'raw' && parsed.startLine === undefined)
      throw new Error('raw file range requires line coordinates')
    if (parsed.snapshot.coordinateSpace === 'rendered' && parsed.startLine !== undefined)
      throw new Error('rendered file range must use rendered offsets')
  }
  if (parsed.snapshot.renderedText !== undefined && parsed.format !== 'markdown')
    throw new Error('only Markdown may retain rendered text')
  freezeDeep(parsed)
  return parsed
}

/** Validate and freeze one official turn-Diff snapshot and source anchor. */
export function parseOfficialDiffSource(value: unknown): OfficialDiffAnnotationSource {
  const source = record(value, 'annotation.source')
  if (source.kind !== 'official-diff') throw new Error('annotation source is not an official Diff source')
  const snapshot = record(source.snapshot, 'official Diff snapshot')
  if (snapshot.version !== 1 && snapshot.version !== 2) throw new Error('Diff snapshot version is invalid')
  if (typeof source.wholeFile !== 'boolean') throw new Error('Diff wholeFile must be a boolean')
  const hunks = Array.isArray(snapshot.hunks)
    ? snapshot.hunks.map(parseHunk)
    : (() => {
        throw new Error('Diff hunks must be an array')
      })()
  const parsedSnapshot: OfficialDiffSnapshot = {
    version: snapshot.version,
    hash: hash(snapshot.hash, 'Diff snapshot.hash'),
    sessionId: text(snapshot.sessionId, 'Diff snapshot.sessionId') as SessionIdentity,
    seq: integer(snapshot.seq, 'Diff snapshot.seq'),
    turn: integer(snapshot.turn, 'Diff snapshot.turn', 1),
    fileIndex: integer(snapshot.fileIndex, 'Diff snapshot.fileIndex'),
    path: text(snapshot.path, 'Diff snapshot.path'),
    display: text(snapshot.display, 'Diff snapshot.display'),
    kind:
      snapshot.kind === 'text' || snapshot.kind === 'binary' || snapshot.kind === 'oversized'
        ? snapshot.kind
        : (() => {
            throw new Error('invalid Diff snapshot kind')
          })(),
    before: snapshot.kind === 'text' ? snapshot.before === true : null,
    after: snapshot.kind === 'text' ? snapshot.after === true : null,
    coarse: snapshot.kind === 'text' ? snapshot.coarse === true : false,
    hunks: Object.freeze(hunks),
    ...(snapshot.version === 2 && snapshot.fragmentHash !== undefined
      ? { fragmentHash: hash(snapshot.fragmentHash, 'Diff snapshot.fragmentHash') }
      : {}),
    ...(snapshot.version === 2
      ? {
          contextBefore: boundedContext(snapshot.contextBefore, 'Diff snapshot.contextBefore'),
          contextAfter: boundedContext(snapshot.contextAfter, 'Diff snapshot.contextAfter'),
        }
      : {}),
  }
  if (parsedSnapshot.kind === 'text') {
    if (
      typeof snapshot.before !== 'boolean' ||
      typeof snapshot.after !== 'boolean' ||
      typeof snapshot.coarse !== 'boolean'
    )
      throw new Error('text Diff snapshot side metadata is invalid')
    if (!parsedSnapshot.before && !parsedSnapshot.after) throw new Error('Diff snapshot must retain one side')
  } else if (snapshot.before !== null || snapshot.after !== null || snapshot.coarse !== false) {
    throw new Error('non-text Diff snapshot must not invent text side metadata')
  }
  if (parsedSnapshot.kind !== 'text' && parsedSnapshot.hunks.length !== 0)
    throw new Error('binary Diff cannot contain text hunks')
  if (snapshot.version === 1 && officialDiffHash(parsedSnapshot) !== parsedSnapshot.hash)
    throw new Error('Diff snapshot digest does not match its contents')
  if (snapshot.version === 2 && parsedSnapshot.hunks.length !== 0)
    throw new Error('compact Diff snapshot must not retain hunks')
  for (let index = 1; index < parsedSnapshot.hunks.length; index += 1) {
    const previous = parsedSnapshot.hunks[index - 1]!
    const current = parsedSnapshot.hunks[index]!
    if (
      current.oldStart < previous.oldStart + previous.oldLines ||
      current.newStart < previous.newStart + previous.newLines
    )
      throw new Error('Diff hunks overlap or run backwards')
  }
  const parsed: OfficialDiffAnnotationSource = {
    kind: 'official-diff',
    snapshot: parsedSnapshot,
    side:
      source.side === 'old' || source.side === 'new' || source.side === 'file'
        ? source.side
        : (() => {
            throw new Error('invalid Diff side')
          })(),
    ...(source.startLine === undefined ? {} : { startLine: integer(source.startLine, 'Diff startLine', 1) }),
    ...(source.endLine === undefined ? {} : { endLine: integer(source.endLine, 'Diff endLine', 1) }),
    ...(source.startColumn === undefined
      ? {}
      : { startColumn: integer(source.startColumn, 'Diff startColumn') }),
    ...(source.endColumn === undefined ? {} : { endColumn: integer(source.endColumn, 'Diff endColumn') }),
    wholeFile: source.wholeFile === true,
    entry: entry(source.entry, 'Diff entry'),
    ...(source.expired === true ? { expired: true } : {}),
  }
  if ((parsed.startLine === undefined) !== (parsed.endLine === undefined))
    throw new Error('Diff line anchor must include both bounds')
  if (parsed.startLine !== undefined && parsed.endLine! < parsed.startLine)
    throw new Error('Diff endLine precedes startLine')
  if ((parsed.startColumn === undefined) !== (parsed.endColumn === undefined))
    throw new Error('Diff inline anchor must include both bounds')
  if (
    parsed.startColumn !== undefined &&
    parsed.startLine === parsed.endLine &&
    parsed.endColumn! <= parsed.startColumn
  )
    throw new Error('Diff endColumn must follow startColumn')
  if (
    parsed.wholeFile &&
    (parsed.startLine !== undefined || parsed.startColumn !== undefined || parsed.endColumn !== undefined)
  )
    throw new Error('whole-file Diff cannot carry coordinates')
  if (!parsed.wholeFile && parsed.startLine === undefined)
    throw new Error('range Diff must carry line coordinates')
  if (parsedSnapshot.version === 2 && parsed.wholeFile === (parsedSnapshot.fragmentHash !== undefined))
    throw new Error('Diff fragment digest must match range selection')
  if (parsed.startColumn !== undefined && parsed.side !== 'file' && parsedSnapshot.version === 1) {
    const lines = officialDiffLines(parsedSnapshot, parsed.side)
    const first = lines.find(({ line }) => line === parsed.startLine)
    const last = lines.find(({ line }) => line === parsed.endLine)
    if (
      first === undefined ||
      last === undefined ||
      parsed.startColumn > first.text.length ||
      parsed.endColumn! > last.text.length
    )
      throw new Error('Diff inline anchor exceeds its snapshot line')
  }
  if (parsed.side === 'file' && (!parsed.wholeFile || parsedSnapshot.kind === 'text'))
    throw new Error('file side is only valid for a non-text whole-file Diff')
  if (parsedSnapshot.kind !== 'text' && parsed.side !== 'file')
    throw new Error('non-text Diff has no known old or new side')
  if (parsed.side === 'old' && !parsedSnapshot.before)
    throw new Error('old side is absent from Diff snapshot')
  if (parsed.side === 'new' && !parsedSnapshot.after) throw new Error('new side is absent from Diff snapshot')
  freezeDeep(parsed)
  return parsed
}

/** Expand hunk lines into the selected side's visible lines. */
export function officialDiffLines(
  snapshot: OfficialDiffSnapshot,
  side: 'old' | 'new',
): readonly { line: number; text: string }[] {
  const values: { line: number; text: string }[] = []
  for (const hunk of snapshot.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const raw of hunk.lines) {
      const marker = raw[0]
      const lineText = raw.slice(1)
      if (marker !== '+') {
        if (side === 'old') values.push({ line: oldLine, text: lineText })
        oldLine += 1
      }
      if (marker !== '-') {
        if (side === 'new') values.push({ line: newLine, text: lineText })
        newLine += 1
      }
    }
  }
  return values
}

/** Reconstruct a quote from a frozen official Diff range, never from current disk. */
export function officialDiffQuote(source: OfficialDiffAnnotationSource): TextQuoteSelector {
  if (source.wholeFile || source.startLine === undefined || source.endLine === undefined)
    throw new Error('whole-file Diff has no text quote')
  if (source.side === 'file') throw new Error('non-text Diff has no line quote')
  const lines = officialDiffLines(source.snapshot, source.side)
  const selected = lines.filter(({ line }) => line >= source.startLine! && line <= source.endLine!)
  if (selected.length !== source.endLine - source.startLine + 1)
    throw new Error('Diff line anchor is absent from its snapshot')
  if (source.startColumn !== undefined) {
    if (source.endColumn === undefined) throw new Error('Diff inline anchor is absent from its snapshot')
    const first = selected[0]!
    const last = selected[selected.length - 1]!
    const exact = selected
      .map(({ text }, index) =>
        index === 0 && index === selected.length - 1
          ? text.slice(source.startColumn, source.endColumn)
          : index === 0
            ? text.slice(source.startColumn)
            : index === selected.length - 1
              ? text.slice(0, source.endColumn)
              : text,
      )
      .join('\n')
    return Object.freeze({
      exact,
      prefix: first.text.slice(Math.max(0, source.startColumn - 32), source.startColumn),
      suffix: last.text.slice(source.endColumn, source.endColumn + 32),
      start: 0,
      end: exact.length,
    })
  }
  const exact = selected.map(({ text }) => text).join('\n')
  return Object.freeze({ exact, prefix: '', suffix: '', start: 0, end: exact.length })
}

/** Derive nearby context from the same immutable official Diff lines. */
export function officialDiffContext(source: OfficialDiffAnnotationSource): {
  readonly before: string
  readonly after: string
} {
  if (source.snapshot.version === 2)
    return {
      before: source.snapshot.contextBefore ?? '',
      after: source.snapshot.contextAfter ?? '',
    }
  if (source.wholeFile || source.startLine === undefined || source.endLine === undefined)
    return { before: '', after: '' }
  if (source.side === 'file') return { before: '', after: '' }
  const lines = officialDiffLines(source.snapshot, source.side)
  const start = lines.findIndex(({ line }) => line === source.startLine)
  const end = lines.findIndex(({ line }, index) => index >= start && line === source.endLine)
  if (start < 0 || end < start) return { before: '', after: '' }
  return {
    before: lines
      .slice(Math.max(0, start - 2), start)
      .map(({ text }) => text)
      .join('\n')
      .slice(-64),
    after: lines
      .slice(end + 1, end + 3)
      .map(({ text }) => text)
      .join('\n')
      .slice(0, 64),
  }
}

/** Human-facing path and line range for official Diff records. */
export function officialDiffPosition(source: OfficialDiffAnnotationSource): string {
  if (source.wholeFile) return `${source.snapshot.path} · whole file`
  const lines =
    source.startLine === source.endLine ? String(source.startLine) : `${source.startLine}–${source.endLine}`
  const columns =
    source.startColumn === undefined || source.endColumn === undefined
      ? ''
      : `:${source.startColumn + 1}–${source.endColumn}`
  return `${source.snapshot.path} · ${source.side} · ${lines}${columns}`
}

/** Stable annotation lookup key for an official snapshot. */
export function officialSnapshotKey(source: FileAnnotationSource | OfficialDiffAnnotationSource): string {
  return source.kind === 'file'
    ? `file:${source.sessionId}:${source.path}:${source.resourceVersion ?? ''}:${source.snapshot.hash}`
    : `official-diff:${source.snapshot.sessionId}:${source.snapshot.seq}:${source.snapshot.fileIndex}:${source.snapshot.hash}:${source.side}`
}

/** Keep the public id type available to adapters without importing controller code. */
export type OfficialSourceAnnotationId = AnnotationId
