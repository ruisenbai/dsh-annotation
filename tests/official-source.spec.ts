import { describe, expect, it } from 'vitest'
import {
  formatSubmissionMessage,
  parseAnnotationQuote,
  parseSubmissionPayload,
} from '../src/shared/protocol.ts'
import {
  parseFileAnnotationSource,
  parseOfficialDiffSource,
  officialDiffContext,
  officialDiffQuote,
  officialSnapshotKey,
} from '../src/shared/official-source.ts'
import { sourceKey } from '../src/shared/annotation-source.ts'
import type { FileAnnotationSource, OfficialDiffAnnotationSource } from '../src/shared/annotation-source.ts'
import type { AnnotationAnchor } from '../src/shared/annotation-source.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { officialDiffHash, quoteFragmentHash, sha256Hex } from '../src/shared/snapshot-hash.ts'
import { compactFileSource, compactOfficialDiffSource } from '../src/client/official-adapters.ts'

const sessionId = 'session-official' as SessionIdentity
const hash = sha256Hex('one\ntwo\n')

const fileSource: FileAnnotationSource = {
  kind: 'file',
  sessionId,
  resourceAddress: 'dsh-resource://file/session/session-official/%2Fworkspace%2Fnotes.md',
  path: '/workspace/notes.md',
  resourceVersion: 'file-v1',
  format: 'markdown',
  snapshot: { version: 1, hash, bytes: 8, format: 'markdown', text: 'one\ntwo\n' },
  wholeFile: true,
  entry: 'sidebar',
}

const diffSnapshot = {
  version: 1,
  sessionId,
  seq: 2,
  turn: 1,
  fileIndex: 0,
  path: 'notes.md',
  display: 'notes.md',
  kind: 'text',
  before: true,
  after: true,
  coarse: false,
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' context', '-old', '+new'] }],
} as const

const diffSource: OfficialDiffAnnotationSource = {
  kind: 'official-diff',
  snapshot: { ...diffSnapshot, hash: officialDiffHash(diffSnapshot) },
  side: 'new',
  startLine: 1,
  endLine: 2,
  wholeFile: false,
  entry: 'hover',
}

describe('official workspace source snapshots', () => {
  it('accepts a legacy UTF-8 BOM when the stored byte digest includes it', () => {
    const source = {
      ...fileSource,
      snapshot: {
        ...fileSource.snapshot,
        text: 'one\ntwo\n',
        bytes: 11,
        hash: sha256Hex(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('one\ntwo\n')])),
      },
    }
    expect(parseFileAnnotationSource(source).snapshot).toEqual(source.snapshot)
  })

  it('accepts a compact v2 file range and rejects a changed fragment', () => {
    const source = {
      ...fileSource,
      wholeFile: false,
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 3,
      snapshot: {
        version: 2,
        hash,
        bytes: 8,
        format: 'markdown',
        coordinateSpace: 'raw',
        fragmentHash: quoteFragmentHash({ exact: 'two', prefix: 'one\n', suffix: '\n', start: 4, end: 7 }),
      },
    }
    const parsed = parseFileAnnotationSource(source)
    expect(
      parseAnnotationQuote(
        { exact: 'two', prefix: 'one\n', suffix: '\n', start: 4, end: 7 },
        { source: parsed },
      ),
    ).toMatchObject({ exact: 'two' })
    expect(() =>
      parseAnnotationQuote(
        { exact: 'TWO', prefix: 'one\n', suffix: '\n', start: 4, end: 7 },
        { source: parsed },
      ),
    ).toThrow()
  })

  it('retains UTF-16 columns and CRLF context in a compact file range', () => {
    const quote = { exact: '中😀\r\n', prefix: '', suffix: '末', start: 0, end: 5 }
    const compact = {
      ...fileSource,
      format: 'text',
      wholeFile: false,
      startLine: 1,
      endLine: 2,
      startColumn: 0,
      endColumn: 0,
      snapshot: {
        version: 2,
        hash: sha256Hex('revision'),
        bytes: 12,
        format: 'text',
        coordinateSpace: 'raw',
        fragmentHash: quoteFragmentHash(quote),
      },
    }
    const source = parseFileAnnotationSource(compact)
    expect(parseAnnotationQuote(quote, { source })).toEqual(quote)
    expect(() => parseAnnotationQuote({ ...quote, suffix: '错' }, { source })).toThrow('verified fragment')
  })

  it('prints rendered Markdown offsets without inventing raw file lines', () => {
    const quote = { exact: 'two', prefix: 'one ', suffix: '', start: 4, end: 7 }
    const rendered = compactFileSource({ ...fileSource, wholeFile: false }, quote, 'rendered')
    const payload = parseSubmissionPayload({
      protocolVersion: 5,
      source: 'dsh-annotation',
      submissionId: 'sub-rendered',
      sessionId,
      delivery: 'queue',
      protocolLocale: 'en',
      processingMode: 'answer',
      createdAt: 1_700_000_000_000,
      annotations: [
        {
          annotationId: 'ann-rendered',
          ordinal: 1,
          source: rendered,
          quote,
          annotation: 'Review this.',
          kind: 'note',
          createdAt: 1_700_000_000_000,
        },
      ],
    })
    const text = formatSubmissionMessage(payload)
    expect(text).toContain(
      'Coordinates (rendered): UTF-16 offsets 4–7 (zero-based, end exclusive; original file line mapping unavailable)',
    )
    expect(text).not.toContain('undefined')

    const raw = compactFileSource(
      { ...fileSource, wholeFile: false, startLine: 2, endLine: 2, startColumn: 0, endColumn: 3 },
      { exact: 'two', prefix: 'one\n', suffix: '\n', start: 4, end: 7 },
    )
    const rawText = formatSubmissionMessage(
      parseSubmissionPayload({
        ...payload,
        annotations: [
          {
            annotationId: 'ann-rendered',
            ordinal: 1,
            source: raw,
            quote: { exact: 'two', prefix: 'one\n', suffix: '\n', start: 4, end: 7 },
            annotation: 'Review this.',
            kind: 'note',
            createdAt: 1_700_000_000_000,
          },
        ],
      }),
    )
    expect(rawText).toContain('Coordinates (raw): lines 2–2; UTF-16 columns 0–3 (zero-based, end exclusive)')
  })

  it('writes compact v2 official Diff ranges under protocol v5', () => {
    const range = { ...diffSource, startColumn: 2, endColumn: 3 }
    const quote = officialDiffQuote(range)
    const compact = compactOfficialDiffSource(range, quote)
    expect(compact.snapshot).toMatchObject({ version: 2, hunks: [], fragmentHash: quoteFragmentHash(quote) })
    const parsed = parseOfficialDiffSource(compact)
    expect(() =>
      parseOfficialDiffSource({
        ...compact,
        snapshot: { ...compact.snapshot, contextBefore: 'x'.repeat(65) },
      }),
    ).toThrow('exceeds 64')
    expect(parseAnnotationQuote(quote, { source: parsed })).toEqual(quote)
    const payload = {
      protocolVersion: 5,
      source: 'dsh-annotation',
      submissionId: 'sub-compact',
      sessionId,
      delivery: 'queue',
      protocolLocale: 'en',
      processingMode: 'answer',
      createdAt: 1_700_000_000_000,
      annotations: [
        {
          annotationId: 'ann-compact',
          ordinal: 1,
          source: parsed,
          quote,
          annotation: 'Keep this line.',
          kind: 'note',
          createdAt: 1_700_000_000_000,
        },
      ],
    }
    expect(parseSubmissionPayload(payload).protocolVersion).toBe(5)
    expect(() => parseSubmissionPayload({ ...payload, protocolVersion: 4 })).toThrow('protocol v5')
  })

  it('does not copy a large file body into each v2 source', () => {
    const large = { ...fileSource, snapshot: { ...fileSource.snapshot, text: 'a'.repeat(500_000) } }
    const compact = compactFileSource(large)
    expect(JSON.stringify(compact).length).toBeLessThan(600)
    expect(compact.snapshot.text).toBeUndefined()
  })
  it('accepts Host absolute resource paths and preserves the immutable file snapshot', () => {
    expect(parseFileAnnotationSource(JSON.parse(JSON.stringify(fileSource)))).toEqual(fileSource)
    expect(
      parseAnnotationQuote({ exact: '', prefix: '', suffix: '', start: 0, end: 0 }, {
        source: fileSource,
      } as AnnotationAnchor),
    ).toEqual({ exact: '', prefix: '', suffix: '', start: 0, end: 0 })
  })

  it('rejects non-absolute or contradictory file identities', () => {
    expect(() => parseFileAnnotationSource({ ...fileSource, path: 'notes.md' })).toThrow(
      'file identity is invalid',
    )
    expect(() => parseFileAnnotationSource({ ...fileSource, path: '/workspace/../notes.md' })).toThrow(
      'file identity is invalid',
    )
    expect(() =>
      parseFileAnnotationSource({
        ...fileSource,
        resourceAddress: 'dsh-resource://file/session/other/%2Fworkspace%2Fnotes.md',
      }),
    ).toThrow('file identity is invalid')
  })

  it('groups a file revision by both resource version and immutable snapshot hash', () => {
    const versioned = { ...fileSource, resourceVersion: 'renderer-1' as string }
    const changedSnapshot = { ...versioned, snapshot: { ...versioned.snapshot, hash: 'b'.repeat(64) } }
    expect(sourceKey({ source: versioned })).not.toBe(sourceKey({ source: changedSnapshot }))
    expect(officialSnapshotKey(versioned)).not.toBe(officialSnapshotKey(changedSnapshot))
  })

  it('rejects altered file text, rendered text, and selection coordinates', () => {
    expect(() =>
      parseFileAnnotationSource({ ...fileSource, snapshot: { ...fileSource.snapshot, version: 3 } }),
    ).toThrow('snapshot version')
    expect(() => parseFileAnnotationSource({ ...fileSource, wholeFile: undefined })).toThrow(
      'wholeFile must be a boolean',
    )
    expect(() =>
      parseFileAnnotationSource({
        ...fileSource,
        snapshot: { ...fileSource.snapshot, text: 'one\nONE\n' },
      }),
    ).toThrow('digest does not match')
    const range: FileAnnotationSource = {
      ...fileSource,
      wholeFile: false,
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 3,
    }
    const anchor = { source: parseFileAnnotationSource(range) } as AnnotationAnchor
    expect(
      parseAnnotationQuote({ exact: 'two', prefix: 'one\n', suffix: '\n', start: 4, end: 7 }, anchor).exact,
    ).toBe('two')
    expect(() =>
      parseAnnotationQuote({ exact: 'one', prefix: '', suffix: '', start: 4, end: 7 }, anchor),
    ).toThrow('immutable snapshot')
    expect(() =>
      parseAnnotationQuote({ exact: 'two', prefix: 'wrong', suffix: '', start: 4, end: 7 }, anchor),
    ).toThrow('context')
    expect(() => parseFileAnnotationSource({ ...range, resourceVersion: undefined })).toThrow(
      'resourceVersion',
    )
  })

  it('retains source expiry state without discarding the captured snapshots', () => {
    expect(parseFileAnnotationSource({ ...fileSource, expired: true }).expired).toBe(true)
    expect(parseOfficialDiffSource({ ...diffSource, expired: true }).expired).toBe(true)
  })

  it('reconstructs official Diff quotes from frozen hunk lines', () => {
    const parsed = parseOfficialDiffSource(JSON.parse(JSON.stringify(diffSource)))
    expect(officialDiffQuote(parsed)).toMatchObject({ exact: 'context\nnew', start: 0, end: 11 })
    expect(parseAnnotationQuote(officialDiffQuote(parsed), { source: parsed } as AnnotationAnchor)).toEqual(
      officialDiffQuote(parsed),
    )
  })

  it('rejects altered official Diff hunks and non-text side inventions', () => {
    expect(() =>
      parseOfficialDiffSource({
        ...diffSource,
        snapshot: { ...diffSource.snapshot, version: 3 },
      }),
    ).toThrow('snapshot version')
    expect(() => parseOfficialDiffSource({ ...diffSource, wholeFile: undefined })).toThrow(
      'wholeFile must be a boolean',
    )
    expect(() =>
      parseOfficialDiffSource({
        ...diffSource,
        snapshot: { ...diffSource.snapshot, path: 'other.md' },
      }),
    ).toThrow('digest does not match')
    const nonText = {
      ...diffSource,
      snapshot: {
        ...diffSnapshot,
        kind: 'binary' as const,
        before: null,
        after: null,
        coarse: false,
        hunks: [],
      },
      side: 'file',
      wholeFile: true,
      startLine: undefined,
      endLine: undefined,
    }
    expect(
      parseOfficialDiffSource({
        ...nonText,
        snapshot: { ...nonText.snapshot, hash: officialDiffHash(nonText.snapshot) },
      }).side,
    ).toBe('file')
    expect(() =>
      parseOfficialDiffSource({
        ...nonText,
        snapshot: { ...nonText.snapshot, hash: officialDiffHash(nonText.snapshot) },
        side: 'old',
      }),
    ).toThrow('non-text Diff has no known')
  })

  it('reconstructs an inline Diff quote from immutable line columns', () => {
    const inline = parseOfficialDiffSource({
      ...diffSource,
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 3,
    })
    expect(officialDiffQuote(inline)).toEqual({ exact: 'new', prefix: '', suffix: '', start: 0, end: 3 })
    expect(officialDiffContext(inline)).toEqual({ before: 'context', after: '' })
    expect(() =>
      parseOfficialDiffSource({ ...diffSource, startLine: 2, endLine: 2, startColumn: 3, endColumn: 4 }),
    ).toThrow('Diff inline anchor exceeds its snapshot line')
  })

  it('accepts an empty quote only for whole-file official sources', () => {
    const source = parseOfficialDiffSource({
      ...diffSource,
      wholeFile: true,
      startLine: undefined,
      endLine: undefined,
      entry: 'sidebar',
    })
    const empty = { exact: '', prefix: '', suffix: '', start: 0, end: 0 }
    expect(parseAnnotationQuote(empty, { source } as AnnotationAnchor)).toEqual(empty)
    expect(() => parseAnnotationQuote({ ...empty, end: 1 }, { source } as AnnotationAnchor)).toThrow(
      'Whole-file official sources must not carry a text quote',
    )
  })

  it('accepts file and turn-Diff sources only in protocol v4 submissions', () => {
    const wholeDiff = parseOfficialDiffSource({
      ...diffSource,
      wholeFile: true,
      startLine: undefined,
      endLine: undefined,
      entry: 'sidebar',
    })
    const empty = { exact: '', prefix: '', suffix: '', start: 0, end: 0 }
    const payload = (
      source: FileAnnotationSource | OfficialDiffAnnotationSource,
      quote: typeof empty,
      annotationId: string,
    ) => ({
      protocolVersion: 4,
      source: 'dsh-annotation',
      submissionId: 'sub-official',
      sessionId,
      delivery: 'queue',
      protocolLocale: 'en',
      processingMode: 'answer',
      createdAt: 1_700_000_000_000,
      annotations: [
        {
          annotationId,
          ordinal: 1,
          source,
          quote,
          annotation: '',
          kind: 'note',
          createdAt: 1_700_000_000_000,
        },
      ],
    })
    expect(
      parseSubmissionPayload(payload(fileSource, empty, 'ann-official-file')).annotations[0]?.source?.kind,
    ).toBe('file')
    expect(
      parseSubmissionPayload(payload(diffSource, officialDiffQuote(diffSource), 'ann-official-diff'))
        .annotations[0]?.source?.kind,
    ).toBe('official-diff')
    expect(
      parseSubmissionPayload(payload(wholeDiff, empty, 'ann-official-whole-diff')).annotations[0]?.quote,
    ).toEqual(empty)
    expect(() =>
      parseSubmissionPayload({ ...payload(fileSource, empty, 'ann-official-v3'), protocolVersion: 3 }),
    ).toThrow('Official file and Diff sources require protocol v4')
  })
})
