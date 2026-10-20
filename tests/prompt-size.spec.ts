import { describe, expect, it } from 'vitest'
import { createAnnotationId, createSubmissionId } from '../src/shared/ids.ts'
import { parseReplyMarkers } from '../src/shared/model-ack.ts'
import { formatSubmissionMessage, parseSubmissionPayload } from '../src/shared/protocol.ts'
import { PROTOCOL_VERSION } from '../src/shared/types.ts'
import type { MessageIdentity, ProtocolLocale } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'

function sampleText(length: number): string {
  return '这段内容用于评估注解功能的上下文占用'.repeat(length).slice(0, length)
}

function samplePayload(protocolLocale: ProtocolLocale, count: number) {
  const base = fixturePayload({ protocolLocale, overallRequirement: '' })
  const messageId = 'ad7d54c4-dc3c-4e09-ab64-80d3740b7f51' as MessageIdentity
  return parseSubmissionPayload({
    ...base,
    protocolVersion: PROTOCOL_VERSION,
    submissionId: createSubmissionId(() => '8c4d2f6a-5b7e-49d1-a3f0-2d8c9b1e4a65'),
    annotations: Array.from({ length: count }, (_, index) => ({
      ...base.annotations[0]!,
      annotationId: createAnnotationId(
        () => `75ea23b1-e68f-45a9-9c27-${String(index + 1).padStart(12, '0')}`,
      ),
      ordinal: index + 1,
      messageId,
      responseVersion: messageId,
      source: { kind: 'message', messageId, messageSeq: 42, responseVersion: messageId },
      quote: {
        exact: sampleText(100),
        prefix: sampleText(32),
        suffix: sampleText(32),
        start: 32,
        end: 132,
      },
      annotation: sampleText(30),
    })),
  })
}

describe('annotation prompt size', () => {
  // 字符预算覆盖完整编号与原文；实际 token 数取决于所用模型。
  it.each([
    ['zh', 1, 800],
    ['en', 1, 1150],
    ['zh', 5, 2750],
    ['en', 5, 3200],
    ['zh', 10, 5200],
    ['en', 10, 5800],
  ] as const)('keeps %s batches of %i notes within %i characters', (locale, count, maxCharacters) => {
    const payload = samplePayload(locale, count)
    const text = formatSubmissionMessage(payload)
    expect(text.length).toBeLessThanOrEqual(maxCharacters)
    expect(
      parseReplyMarkers(text).map(({ submissionId, annotationId, ordinal }) => ({
        submissionId,
        annotationId,
        ordinal,
      })),
    ).toEqual(
      payload.annotations.map(({ annotationId, ordinal }) => ({
        submissionId: payload.submissionId,
        annotationId,
        ordinal,
      })),
    )
    for (const annotation of payload.annotations) {
      expect(text).toContain(annotation.quote.exact)
      expect(text).toContain(annotation.quote.prefix)
      expect(text).toContain(annotation.quote.suffix)
      expect(text).toContain(annotation.annotation)
    }
  })
})
