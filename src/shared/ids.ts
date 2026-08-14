import { MESSAGE_ID_PREFIX } from './types.ts'
import type { AnnotationId, MessageIdentity, SubmissionId } from './types.ts'

/** Mint one browser-owned annotation identity. */
export function createAnnotationId(randomUUID: () => string = () => crypto.randomUUID()): AnnotationId {
  return `ann-${randomUUID()}` as AnnotationId
}

/** Mint one idempotent batch identity. */
export function createSubmissionId(randomUUID: () => string = () => crypto.randomUUID()): SubmissionId {
  return `sub-${randomUUID()}` as SubmissionId
}

/** Derive the stable inbox/message identity used for retries and withdrawal. */
export function submissionMessageId(submissionId: SubmissionId): MessageIdentity {
  return `${MESSAGE_ID_PREFIX}${submissionId}` as MessageIdentity
}
