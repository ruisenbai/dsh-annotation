import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  formatSubmissionMessage,
  parseInlineAnnotationSource,
  parseSubmissionPayload,
  ProtocolError,
  submissionSummary,
  validateSubmissionLimits,
} from '../src/shared/protocol.ts'
import { fixturePayload } from './fixtures.ts'

describe('annotation wire protocol', () => {
  it('round-trips a valid immutable payload', () => {
    const fixture = fixturePayload()
    const parsed = parseSubmissionPayload(JSON.parse(JSON.stringify(fixture)))
    expect(parsed).toEqual(fixture)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.annotations)).toBe(true)
  })

  it.each([
    ['wrong version', { protocolVersion: 2 }],
    ['empty annotations', { annotations: [] }],
    ['wrong delivery', { delivery: 'now' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseSubmissionPayload({ ...fixturePayload(), ...patch })).toThrow(ProtocolError)
  })

  it('rejects duplicate ids and non-contiguous ordinals', () => {
    const item = fixturePayload().annotations[0]!
    expect(() =>
      parseSubmissionPayload({
        ...fixturePayload(),
        annotations: [item, { ...item, ordinal: 2 }],
      }),
    ).toThrow('unique')
    expect(() =>
      parseSubmissionPayload({ ...fixturePayload(), annotations: [{ ...item, ordinal: 2 }] }),
    ).toThrow('contiguous')
  })

  it('rejects selectors whose offsets, context, or table order are inconsistent', () => {
    const item = fixturePayload().annotations[0]!
    expect(() =>
      parseSubmissionPayload({
        ...fixturePayload(),
        annotations: [{ ...item, quote: { ...item.quote, end: item.quote.end + 1 } }],
      }),
    ).toThrow('span exact text')
    expect(() =>
      parseSubmissionPayload({
        ...fixturePayload(),
        annotations: [{ ...item, quote: { ...item.quote, prefix: 'x'.repeat(33) } }],
      }),
    ).toThrow('32 characters')
    expect(() =>
      parseSubmissionPayload({
        ...fixturePayload(),
        annotations: [
          {
            ...item,
            structure: { kind: 'table', startRow: 2, startColumn: 1, endRow: 1, endColumn: 3 },
          },
        ],
      }),
    ).toThrow('precedes')
  })

  it('enforces complete decoded byte and item limits', () => {
    const payload = fixturePayload()
    expect(() => validateSubmissionLimits(payload, { ...DEFAULT_CONFIG, maxPayloadBytes: 3 }, 4)).toThrow(
      '4 bytes',
    )
    expect(() =>
      validateSubmissionLimits(payload, { ...DEFAULT_CONFIG, maxAnnotationsPerSubmission: 0 }, 1),
    ).toThrow('maximum is 0')
    expect(() => validateSubmissionLimits(payload, DEFAULT_CONFIG, 100)).not.toThrow()
  })

  it('formats model-visible text without truncating source or comments', () => {
    const text = formatSubmissionMessage(fixturePayload())
    expect(text).toContain('selected source')
    expect(text).toContain('Explain this claim.')
    expect(text).toContain('ann-test-1')
    expect(text).toContain('dsh-inline-annotations:')
  })

  it('reads only valid plugin provenance and builds summaries', () => {
    const payload = fixturePayload()
    expect(parseInlineAnnotationSource({ kind: 'user', inlineAnnotations: payload })).toEqual(payload)
    expect(parseInlineAnnotationSource({ kind: 'user' })).toBeNull()
    expect(parseInlineAnnotationSource({ kind: 'plugin', inlineAnnotations: payload })).toBeNull()
    expect(submissionSummary(payload, 'zh')).toContain('1 条')
    expect(submissionSummary(payload, 'en')).toContain('1 inline')
  })
})
