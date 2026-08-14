import { PROTOCOL_VERSION } from '../src/shared/types.ts'
import type {
  AnnotationSubmissionPayload,
  MessageIdentity,
  SessionIdentity,
  SubmissionId,
} from '../src/shared/types.ts'

export function fixturePayload(
  overrides: Partial<AnnotationSubmissionPayload> = {},
): AnnotationSubmissionPayload {
  const messageId = 'assistant-message-1' as MessageIdentity
  return {
    protocolVersion: PROTOCOL_VERSION,
    submissionId: 'sub-test' as SubmissionId,
    sessionId: 'session-test' as SessionIdentity,
    delivery: 'queue',
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
        comment: 'Explain this claim.',
        createdAt: 1_700_000_000_000,
      },
    ],
    ...overrides,
  }
}
