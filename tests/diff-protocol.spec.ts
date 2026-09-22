import { describe, expect, it } from 'vitest'
import {
  parseSubmissionPayload,
  formatSubmissionMessage,
  parseAnnotationSource,
} from '../src/shared/protocol.ts'
import { sourceFields } from '../src/shared/annotation-source.ts'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { diffAnnotation, diffSource, diffSnapshot } from './diff-fixtures.ts'
import { fixturePayload, fixtureV1Payload } from './fixtures.ts'

const payload = () => {
  const legacy = fixturePayload()
  return {
    ...legacy,
    protocolVersion: 3,
    annotations: [
      { ...legacy.annotations[0]!, ...sourceFields(legacy.annotations[0]!) },
      { ...diffAnnotation(), annotationId: 'diff-second', ordinal: 2 },
    ],
  }
}

describe('mixed-source protocol v3', () => {
  it('round-trips mixed sources and quotes without inventing a Diff message identity', () => {
    const parsed = parseSubmissionPayload(JSON.parse(JSON.stringify(payload())))
    expect(parsed.protocolVersion).toBe(3)
    expect(parsed.annotations[0]?.source?.kind).toBe('message')
    expect(parsed.annotations[1]?.source?.kind).toBe('diff')
    expect(parsed.annotations[1]).not.toHaveProperty('messageId')
    expect(Object.isFrozen(parsed.annotations[1]?.source)).toBe(true)
    const text = formatSubmissionMessage(parsed)
    for (const value of [
      'src/example.ts',
      'index',
      'working',
      'new',
      '2',
      'new value',
      'header',
      'Check this file line.',
      'diff-second',
    ])
      expect(text).toContain(value)
    expect(text).toContain('"ordinal":1')
    expect(text).toContain('"ordinal":2')
    expect(text).not.toContain('messageId: undefined')
    expect(parseAnnotationSource({ kind: 'user', annotationSubmission: parsed })).toEqual(parsed)
  })

  it('keeps v1/v2 messages, code blocks and table history readable without source tags', () => {
    expect(parseSubmissionPayload(fixtureV1Payload()).protocolVersion).toBe(2)
    const legacy = fixturePayload()
    for (const structure of [
      undefined,
      { kind: 'code', language: 'ts', startLine: 1, endLine: 2 },
      { kind: 'table', startRow: 0, startColumn: 0, endRow: 1, endColumn: 2 },
    ]) {
      const parsed = parseSubmissionPayload({
        ...legacy,
        annotations: [{ ...legacy.annotations[0], structure }],
      })
      expect(parsed.protocolVersion).toBe(2)
      expect(parsed.annotations[0]?.structure).toEqual(structure)
    }
  })

  it('rejects unknown, contradictory, incomplete and protocol-incompatible sources', () => {
    const valid = payload()
    const diff = valid.annotations[1]!
    for (const item of [
      { ...diff, source: { kind: 'other' } },
      { ...diff, messageId: 'invented' },
      { ...diff, source: { kind: 'diff', snapshot: {} } },
      { ...diff, quote: { ...diff.quote, exact: 'fake' } },
      { ...valid.annotations[0], source: undefined },
      {
        ...valid.annotations[0],
        source: { kind: 'message', messageId: 'disagrees', messageSeq: 42, responseVersion: 'x' },
      },
    ])
      expect(() => parseSubmissionPayload({ ...valid, annotations: [{ ...item, ordinal: 1 }] })).toThrow()
    for (const protocolVersion of [1, 2, 4])
      expect(() => parseSubmissionPayload({ ...valid, protocolVersion })).toThrow()
  })

  it('keeps genuine blank code lines readable in v3', () => {
    const source = diffSource(diffSnapshot('', 'before\n\nafter\n'))
    const parsed = parseSubmissionPayload({ ...payload(), annotations: [diffAnnotation(source)] })
    expect(parsed.annotations[0]?.quote).toMatchObject({ exact: '', start: 7, end: 7 })
  })
})

it('migrates local state under the same storage key without changing legacy failed retries', () => {
  const memory = new Map<string, string>()
  const storage = new AnnotationStorage(
    {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value)
      },
      removeItem: (key) => {
        memory.delete(key)
      },
    },
    'session-test' as SessionIdentity,
  )
  const old = fixturePayload()
  const outbox = {
    payload: old,
    messageId: 'dsh-inline-annotations:sub-test',
    targetSessionId: old.sessionId,
    status: 'failed',
    attempts: 1,
  }
  memory.set(storage.key, JSON.stringify({ ...emptyPersistedState(), storageVersion: 2, outbox: [outbox] }))
  expect(storage.load()).toMatchObject({ storageVersion: 3, outbox: [outbox] })
  expect(JSON.parse(memory.get(storage.key)!).storageVersion).toBe(3)
  expect(JSON.parse(memory.get(storage.key)!).outbox[0].payload).toEqual(old)
})
