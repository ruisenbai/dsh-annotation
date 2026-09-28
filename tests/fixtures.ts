import { PROTOCOL_SOURCE } from '../src/shared/types.ts'
import type {
  AnnotationSubmissionPayload,
  MessageIdentity,
  SessionIdentity,
  SubmissionId,
  SubmittedAnnotation,
} from '../src/shared/types.ts'

type MessagePayload = Omit<AnnotationSubmissionPayload, 'annotations'> & {
  readonly annotations: readonly Extract<SubmittedAnnotation, { readonly messageId: MessageIdentity }>[]
}

/** Legacy message-only v2 records remain valid without explicit source tags. */
export function fixturePayload(overrides: Partial<MessagePayload> = {}): MessagePayload {
  const messageId = 'assistant-message-1' as MessageIdentity
  return {
    protocolVersion: 2,
    source: PROTOCOL_SOURCE,
    submissionId: 'sub-test' as SubmissionId,
    sessionId: 'session-test' as SessionIdentity,
    delivery: 'queue',
    protocolLocale: 'zh',
    processingMode: 'answer',
    createdAt: 1_700_000_000_000,
    overallRequirement: 'Rewrite the proposal coherently.',
    annotations: [
      {
        annotationId: 'ann-test-1' as AnnotationSubmissionPayload['annotations'][number]['annotationId'],
        ordinal: 1,
        messageId,
        messageSeq: 42,
        responseVersion: messageId,
        quote: { exact: 'selected source', prefix: 'before ', suffix: ' after', start: 7, end: 22 },
        annotation: 'Explain this claim.',
        kind: 'note',
        createdAt: 1_700_000_000_000,
      },
    ],
    ...overrides,
  }
}

/** A pre-rename v1 payload: `comment` fields, no `source`, kind, protocolLocale, or processingMode. */
export function fixtureV1Payload(): unknown {
  const messageId = 'assistant-message-1'
  return {
    protocolVersion: 1,
    submissionId: 'sub-legacy',
    sessionId: 'session-test',
    delivery: 'queue',
    createdAt: 1_700_000_000_000,
    overallRequirement: 'Legacy request.',
    annotations: [
      {
        annotationId: 'ann-legacy-1',
        ordinal: 1,
        messageId,
        messageSeq: 42,
        responseVersion: messageId,
        quote: { exact: 'legacy source', prefix: '', suffix: '', start: 0, end: 13 },
        comment: 'Legacy comment.',
        createdAt: 1_700_000_000_000,
      },
    ],
  }
}
