import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  formatSideChatSubmissionMessage,
  parseSideChatCommandReceipt,
  parseSideChatReceiptState,
  parseSideChatReference,
  parseSideChatSource,
  parseSideChatSubmissionPayload,
  sideChatSubmissionFingerprint,
  validateSideChatSubmissionLimits,
} from '../src/shared/side-chat-protocol.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'
import { sideChatPayload } from './side-chat-fixtures.ts'

describe('side-chat submission protocol', () => {
  it('retains ordered exact occurrences and all source coordinates without annotation records', () => {
    const base = sideChatPayload()
    const first = base.references[0]!
    const second = parseSideChatReference({
      ...first,
      referenceId: 'side-ref-b',
      quote: { ...first.quote, start: 30, end: 45 },
    })
    const third = parseSideChatReference({
      ...first,
      referenceId: 'side-ref-c',
      messageId: 'assistant-c',
      responseVersion: 'assistant-c',
    })
    const payload = sideChatPayload({ references: [first, second, third] })
    expect(payload.references.map((item) => item.referenceId)).toEqual([
      'side-ref-a',
      'side-ref-b',
      'side-ref-c',
    ])
    expect(payload.references[1]?.quote.start).toBe(30)
    expect(payload.references[2]?.messageId).toBe('assistant-c')
    expect(payload.annotationSubmission).toBeUndefined()
    expect(Object.isFrozen(payload.references[0]?.quote)).toBe(true)
  })

  it('serializes only confirmed quotes and the question into recorded model text', () => {
    const payload = sideChatPayload()
    expect(formatSideChatSubmissionMessage(payload)).toBe(
      'The user explicitly selected these quotations from assistant replies in the main conversation. Answer using these quotations and the question; do not assume access to other main-conversation content.\n\n' +
        'Reference 1 [side-ref-a]\nSource session: main-test\nAssistant message: assistant-a; seq=42; version=assistant-a\nQuotation:\nselected source\n\nQuestion:\nExplain this claim.',
    )
    expect(formatSideChatSubmissionMessage(payload)).not.toContain('before ')
    expect(formatSideChatSubmissionMessage(payload)).not.toContain(' after')
    const unusual = sideChatPayload({ question: '<script>alert(1)</script>\n```html\n<a>link</a>\n```' })
    expect(formatSideChatSubmissionMessage(unusual)).toContain(unusual.question)
  })

  it('keeps annotations separate while sharing the receiving identity and immutable attachments', () => {
    const annotations = fixturePayload({
      sessionId: 'side-test' as SessionIdentity,
      attachmentIdentities: [],
    })
    const payload = sideChatPayload({
      submissionId: annotations.submissionId,
      annotationSubmission: annotations,
    })
    expect(payload).not.toHaveProperty('annotations')
    expect(payload.annotationSubmission?.annotations).toHaveLength(1)
    expect(formatSideChatSubmissionMessage(payload)).toContain('dsh-annotation:')
    expect(() => sideChatPayload({ annotationSubmission: annotations })).toThrow('share')
    expect(() =>
      validateSideChatSubmissionLimits(payload, { ...DEFAULT_CONFIG, maxAnnotationsPerSubmission: 1 }),
    ).toThrow('count')
  })

  it.each([
    [
      'main target',
      (base: ReturnType<typeof sideChatPayload>) => ({ ...base, sideSessionId: base.mainSessionId }),
    ],
    [
      'foreign source',
      (base: ReturnType<typeof sideChatPayload>) => ({
        ...base,
        references: [{ ...base.references[0], sourceSessionId: 'foreign' }],
      }),
    ],
    [
      'duplicate identity',
      (base: ReturnType<typeof sideChatPayload>) => ({
        ...base,
        references: [base.references[0], base.references[0]],
      }),
    ],
    [
      'version mismatch',
      (base: ReturnType<typeof sideChatPayload>) => ({
        ...base,
        references: [{ ...base.references[0], responseVersion: 'other-version' }],
      }),
    ],
    [
      'invalid offsets',
      (base: ReturnType<typeof sideChatPayload>) => ({
        ...base,
        references: [{ ...base.references[0], quote: { ...base.references[0]!.quote, end: -1 } }],
      }),
    ],
    ['empty question', (base: ReturnType<typeof sideChatPayload>) => ({ ...base, question: '  ' })],
    ['steering', (base: ReturnType<typeof sideChatPayload>) => ({ ...base, delivery: 'steer' })],
  ])('rejects %s at the JSON admission point', (_name, mutate) => {
    expect(() => parseSideChatSubmissionPayload(mutate(sideChatPayload()))).toThrow()
  })

  it('rejects missing or invalid acknowledgements without inferring acceptance', () => {
    expect(parseSideChatCommandReceipt(undefined)).toBeNull()
    expect(parseSideChatCommandReceipt('Side chat accepted')).toBeNull()
    expect(
      parseSideChatCommandReceipt(
        '{"protocolVersion":1,"source":"dsh-annotation-side-chat-result","kind":"accepted"}',
      ),
    ).toBeNull()
    expect(
      parseSideChatCommandReceipt(
        JSON.stringify({
          protocolVersion: 1,
          source: 'dsh-annotation-side-chat-result',
          kind: 'accepted',
          submissionId: 'sub-side-test',
        }),
      ),
    ).toMatchObject({ kind: 'accepted', submissionId: 'sub-side-test' })
    expect(
      parseSideChatCommandReceipt(
        JSON.stringify({
          protocolVersion: 1,
          source: 'dsh-annotation-side-chat-result',
          kind: 'rejected',
          code: 'attachments',
        }),
      ),
    ).toMatchObject({ kind: 'rejected', code: 'attachments' })
  })

  it('retains optional request identities in rejection and unknown receipts', () => {
    for (const kind of ['rejected', 'unknown']) {
      const result = {
        protocolVersion: 1,
        source: 'dsh-annotation-side-chat-result',
        kind,
        code: 'admission',
        submissionId: 'another-submission',
      }
      expect(parseSideChatCommandReceipt(JSON.stringify(result))).toEqual(result)
      for (const submissionId of [null, 42, ''])
        expect(parseSideChatCommandReceipt(JSON.stringify({ ...result, submissionId }))).toBeNull()
    }
  })

  it('reads known sources and validated receipts while leaving unsupported source versions unavailable', () => {
    const payload = sideChatPayload()
    expect(parseSideChatSource({ kind: 'user' })).toBeNull()
    expect(parseSideChatSource({ sideChatSubmission: { ...payload, protocolVersion: 2 } })).toBeNull()
    expect(parseSideChatSource({ sideChatSubmission: payload })).toEqual(payload)
    const fingerprint = sideChatSubmissionFingerprint(payload)
    expect(parseSideChatReceiptState({ receipts: { [payload.submissionId]: fingerprint } })).toEqual({
      receipts: { [payload.submissionId]: fingerprint },
    })
    expect(() => parseSideChatReceiptState({ receipts: { 'sub-side-test': 'bad' } })).toThrow('fingerprint')
    expect(parseSideChatReceiptState(undefined)).toBeUndefined()
    expect(() =>
      validateSideChatSubmissionLimits(payload, { ...DEFAULT_CONFIG, maxPayloadBytes: 10 }),
    ).toThrow('byte')
  })
})
