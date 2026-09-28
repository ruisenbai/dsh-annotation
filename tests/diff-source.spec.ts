import { describe, expect, it } from 'vitest'
import { diffContext, diffQuote, fileLines, parseDiffSource } from '../src/shared/diff-source.ts'
import { diffSnapshot, diffSource } from './diff-fixtures.ts'

describe('retained Diff source format', () => {
  it('reads frozen lines, including blank lines, without consulting current Git state', () => {
    const source = diffSource(diffSnapshot('', 'before\n\nafter\n'), 'new', 2)
    expect(fileLines('before\n\nafter\n')).toEqual(['before', '', 'after'])
    expect(diffQuote(source)).toMatchObject({ exact: '', start: 7, end: 7 })
    expect(diffContext(source)).toEqual({ contextBefore: 'before', contextAfter: 'after' })
    expect(parseDiffSource(JSON.parse(JSON.stringify(source)))).toEqual(source)
  })

  it('rejects changed quotes and out-of-range coordinates in historical records', () => {
    const source = diffSource()
    expect(() => parseDiffSource({ ...source, startLine: 100 })).toThrow()
    expect(() => parseDiffSource({ ...source, contextBefore: 'invented' })).toThrow()
    expect(() => diffQuote({ ...source, side: 'old', endLine: 100 })).toThrow()
  })
})
