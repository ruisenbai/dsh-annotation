import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  formatSubmissionMessage,
  parseAnnotationSource,
  parseInlineCommentSource,
  parseSubmissionPayload,
  ProtocolError,
  submissionSummary,
  validateSubmissionLimits,
} from '../src/shared/protocol.ts'
import { fixturePayload, fixtureV1Payload } from './fixtures.ts'

describe('annotation wire protocol', () => {
  it('round-trips a valid immutable v2 payload', () => {
    const fixture = fixturePayload()
    const parsed = parseSubmissionPayload(JSON.parse(JSON.stringify(fixture)))
    expect(parsed).toEqual(fixture)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.annotations)).toBe(true)
  })

  it.each([
    ['wrong version', { protocolVersion: 3 }],
    ['empty annotations', { annotations: [] }],
    ['wrong delivery', { delivery: 'now' }],
    ['wrong source', { source: 'dsh-other' }],
    ['missing source', { source: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseSubmissionPayload({ ...fixturePayload(), ...patch })).toThrow(ProtocolError)
  })

  it('reads a pre-rename v1 payload and converts it into the v2 model', () => {
    const parsed = parseSubmissionPayload(fixtureV1Payload())
    expect(parsed).toMatchObject({
      protocolVersion: 2,
      source: 'dsh-annotation',
      submissionId: 'sub-legacy',
      annotations: [{ annotationId: 'ann-legacy-1', annotation: 'Legacy comment.', ordinal: 1 }],
    })
    expect(parsed.annotations[0]).not.toHaveProperty('comment')
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

  it('formats model-visible text demanding ordered per-annotation replies with markers', () => {
    const text = formatSubmissionMessage(fixturePayload())
    expect(text).toContain('selected source')
    expect(text).toContain('Explain this claim.')
    expect(text).toContain('ann-test-1')
    expect(text).toContain('注解 1')
    expect(text).toContain('请按注解顺序逐条回答')
    expect(text).toContain(
      '<!-- dsh-annotation-reply:{"submissionId":"sub-test","annotationId":"ann-test-1","ordinal":1} -->',
    )
    expect(text).toContain(
      '<!-- dsh-annotation:{"submissionId":"sub-test","processed":["annotation-id"]} -->',
    )
    expect(text).not.toContain('dsh-inline-comments:')
  })

  it('reads current and legacy provenance sources and builds summaries', () => {
    const payload = fixturePayload()
    expect(parseAnnotationSource({ kind: 'user', annotationSubmission: payload })).toEqual(payload)
    expect(parseAnnotationSource({ kind: 'user', inlineComments: payload })).toEqual(payload)
    expect(parseAnnotationSource({ kind: 'user', inlineAnnotations: payload })).toEqual(payload)
    expect(parseAnnotationSource({ kind: 'user' })).toBeNull()
    expect(parseAnnotationSource({ kind: 'plugin', annotationSubmission: payload })).toBeNull()
    expect(parseInlineCommentSource({ kind: 'user', annotationSubmission: payload })).toEqual(payload)
    expect(submissionSummary(payload, 'zh')).toContain('1 条')
    expect(submissionSummary(payload, 'en')).toContain('1 annotation')
  })
})
