import { describe, expect, it } from 'vitest'
import {
  diffContext,
  diffPathSchema,
  diffQuote,
  fileLines,
  parseDiffSource,
  relocationCandidates,
} from '../src/shared/diff-source.ts'
import { diffRows, visibleDiffRows } from '../src/client/diff-rows.ts'
import { diffSnapshot, diffSource } from './diff-fixtures.ts'

describe('real file coordinates', () => {
  it('counts each side independently through additions, deletions, context and no-newline metadata', () => {
    const rows = diffRows(diffSnapshot())
    expect(rows).toEqual([
      { kind: 'context', old: 1, new: 1, text: 'header' },
      { kind: 'del', old: 2, text: 'old value' },
      { kind: 'add', new: 2, text: 'new value' },
      { kind: 'add', new: 3, text: 'extra value' },
      { kind: 'context', old: 3, new: 4, text: 'footer' },
    ])
    expect(diffRows(diffSnapshot('a\nlast', 'a\nLAST'))).toEqual([
      { kind: 'context', old: 1, new: 1, text: 'a' },
      { kind: 'del', old: 2, text: 'last' },
      { kind: 'add', new: 2, text: 'LAST' },
    ])
    expect(diffQuote(diffSource(diffSnapshot(), 'old', 2)).exact).toBe('old value')
    expect(diffQuote(diffSource(diffSnapshot(), 'new', 2, 3))).toMatchObject({
      exact: 'new value\nextra value',
      start: 7,
      end: 28,
    })
  })

  it.each(['', '\n', 'a\n', 'a', 'a\r\nb\r\n'])('does not invent text lines for %j', (text) => {
    const rows = diffRows(diffSnapshot('', text))
    expect(rows.map((row) => row.new)).toEqual(fileLines(text).map((_, index) => index + 1))
    expect(rows.every((row) => row.old === undefined)).toBe(true)
    expect(rows.map((row) => row.text)).toEqual(fileLines(text))
    expect(diffRows(diffSnapshot(text, '')).map((row) => row.old)).toEqual(
      fileLines(text).map((_, index) => index + 1),
    )
  })

  it('accepts a real blank line but rejects zero, reversed, absent and out-of-file coordinates', () => {
    const snapshot = diffSnapshot('a\n\nz\n', 'a\n\nz\n')
    expect(diffQuote(diffSource(snapshot, 'new', 2))).toMatchObject({ exact: '', start: 2, end: 2 })
    for (const [startLine, endLine] of [
      [0, 1],
      [3, 2],
      [1, 4],
      [1.5, 2],
    ]) {
      expect(() => diffSource(snapshot, 'new', startLine, endLine)).toThrow()
    }
    expect(() =>
      diffSource(
        diffSnapshot('', '', {
          oldPath: null,
          old: { kind: 'absent', oid: null, content: null, sha256: null },
        }),
        'old',
        1,
      ),
    ).toThrow()
    expect(() => parseDiffSource({ ...diffSource(snapshot), contextBefore: 'fabricated' })).toThrow('context')
  })

  it('folds captured context and expands to the same file line coordinates across separated hunks', () => {
    const old = Array.from({ length: 80 }, (_, at) => `line ${at + 1}`).join('\n')
    const rows = diffRows(
      diffSnapshot(old, old.replace('line 10\n', 'inserted\nline 10\n').replace('line 65\n', 'changed\n')),
    )
    expect(rows.find((row) => row.new === 66)).toMatchObject({ kind: 'add', text: 'changed' })
    expect(rows.find((row) => row.old === 65)).toMatchObject({ kind: 'del', text: 'line 65' })
    expect(rows.at(-1)).toEqual({ kind: 'context', old: 80, new: 81, text: 'line 80' })
    expect(visibleDiffRows(rows, false).some((row) => row.kind === 'fold')).toBe(true)
    expect(visibleDiffRows(rows, true)).toBe(rows)
  })

  it('bounds costly edits while preserving every original line', () => {
    const old = Array.from({ length: 520 }, (_, at) => `old-${at}`).join('\n')
    const next = Array.from({ length: 520 }, (_, at) => `new-${at}`).join('\n')
    const rows = diffRows(diffSnapshot(old, next))
    expect(rows.filter((row) => row.old !== undefined)).toHaveLength(520)
    expect(rows.filter((row) => row.new !== undefined)).toHaveLength(520)
  })

  it.each([
    '/etc/passwd',
    '../secret',
    'dir/../secret',
    '.git/config',
    'C:/secret',
    'dir\\secret',
    'a\0b',
    'a//b',
  ])('rejects unsafe path %j', (path) => {
    expect(diffPathSchema.safeParse(path).success).toBe(false)
  })
  it('preserves literal Unicode and pathspec-looking filenames', () => {
    for (const path of ['src/注解.ts', ':magic.ts', 'a\tb.ts', 'a\nb.ts', '-file.ts'])
      expect(diffPathSchema.parse(path)).toBe(path)
  })
})

describe('version-aware relocation', () => {
  const block = 'before 1\nbefore 2\nbefore 3\ntarget\nafter 1\nafter 2\nafter 3\n'
  it('matches quote and context without moving the frozen source', () => {
    const source = diffSource(diffSnapshot('', block), 'new', 4)
    const before = JSON.stringify(source)
    expect(relocationCandidates(source, diffSnapshot('', `new prefix\n${block}`))).toEqual([5])
    expect(diffContext(source)).toEqual({
      contextBefore: 'before 1\nbefore 2\nbefore 3',
      contextAfter: 'after 1\nafter 2\nafter 3',
    })
    expect(JSON.stringify(source)).toBe(before)
    expect(Object.isFrozen(source.snapshot.new)).toBe(true)
  })
  it('does not choose the nearest duplicate, a deleted quote, another file, side comparison or repository', () => {
    const source = diffSource(diffSnapshot('', block), 'new', 4)
    expect(relocationCandidates(source, diffSnapshot('', block + block))).toEqual([4, 11])
    for (const snapshot of [
      diffSnapshot('', ''),
      diffSnapshot('', block, { repositoryId: 'f'.repeat(64) }),
      diffSnapshot('', block, { oldPath: 'other.ts', newPath: 'other.ts' }),
      diffSnapshot('', block, { range: 'staged', new: diffSnapshot(block).old }),
    ]) {
      expect(relocationCandidates(source, snapshot)).toEqual([])
    }
  })
})
