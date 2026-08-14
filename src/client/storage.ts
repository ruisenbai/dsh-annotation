import { submissionMessageId } from '../shared/ids.ts'
import { parseSubmissionPayload, parseSubmittedAnnotation } from '../shared/protocol.ts'
import type {
  AnnotationDraft,
  AnnotationStatus,
  OutboxEntry,
  OutboxStatus,
  PersistedSessionState,
  SessionIdentity,
  SubmissionId,
  AnnotationId,
} from '../shared/types.ts'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const PREFIX = 'dsh-inline-annotations:v1:'
const ANNOTATION_STATUSES: readonly AnnotationStatus[] = ['draft', 'queued', 'sent', 'processed']
const OUTBOX_STATUSES: readonly OutboxStatus[] = ['ready', 'sending', 'queued', 'sent', 'failed', 'withdrawn']

export function emptyPersistedState(): PersistedSessionState {
  return Object.freeze({
    storageVersion: 1,
    annotations: Object.freeze([]),
    outbox: Object.freeze([]),
    overallRequirementDraft: '',
  })
}

function parseAnnotation(value: unknown, index: number): AnnotationDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('annotation must be an object')
  const source = value as Record<string, unknown>
  const submitted = parseSubmittedAnnotation(source, index)
  if (!ANNOTATION_STATUSES.includes(source.status as AnnotationStatus))
    throw new Error('invalid annotation status')
  if (!Number.isSafeInteger(source.updatedAt) || (source.updatedAt as number) < submitted.createdAt) {
    throw new Error('invalid annotation updatedAt')
  }
  if (source.submissionId !== undefined && typeof source.submissionId !== 'string')
    throw new Error('invalid submissionId')
  if (source.supplementalTo !== undefined && typeof source.supplementalTo !== 'string')
    throw new Error('invalid supplementalTo')
  return Object.freeze({
    ...submitted,
    status: source.status as AnnotationStatus,
    updatedAt: source.updatedAt as number,
    ...(source.submissionId === undefined ? {} : { submissionId: source.submissionId as SubmissionId }),
    ...(source.supplementalTo === undefined ? {} : { supplementalTo: source.supplementalTo as AnnotationId }),
  })
}

function parseOutbox(value: unknown): OutboxEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('outbox entry must be an object')
  const source = value as Record<string, unknown>
  const payload = parseSubmissionPayload(source.payload)
  if (typeof source.targetSessionId !== 'string' || typeof source.messageId !== 'string')
    throw new Error('invalid outbox identity')
  if (source.targetSessionId !== payload.sessionId)
    throw new Error('outbox target does not match payload session')
  if (source.messageId !== submissionMessageId(payload.submissionId)) {
    throw new Error('outbox message id does not match submission id')
  }
  if (!OUTBOX_STATUSES.includes(source.status as OutboxStatus)) throw new Error('invalid outbox status')
  if (!Number.isSafeInteger(source.attempts) || (source.attempts as number) < 0)
    throw new Error('invalid attempts')
  if (source.lastError !== undefined && typeof source.lastError !== 'string')
    throw new Error('invalid lastError')
  const interrupted = source.status === 'sending'
  return Object.freeze({
    payload,
    targetSessionId: source.targetSessionId as SessionIdentity,
    messageId: source.messageId as OutboxEntry['messageId'],
    status: interrupted ? 'failed' : (source.status as OutboxStatus),
    attempts: source.attempts as number,
    ...(interrupted
      ? { lastError: 'Submission outcome was not observed; retry with the same submission id.' }
      : source.lastError === undefined
        ? {}
        : { lastError: source.lastError }),
  })
}

function parseState(value: unknown): PersistedSessionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('state must be an object')
  const source = value as Record<string, unknown>
  if (source.storageVersion !== 1 || !Array.isArray(source.annotations) || !Array.isArray(source.outbox)) {
    throw new Error('unsupported storage state')
  }
  if (typeof source.overallRequirementDraft !== 'string') throw new Error('invalid overall requirement draft')
  const annotations = source.annotations.map(parseAnnotation)
  if (new Set(annotations.map((item) => item.annotationId)).size !== annotations.length) {
    throw new Error('persisted annotation ids must be unique')
  }
  if (annotations.some((item) => item.status !== 'draft' && item.submissionId === undefined)) {
    throw new Error('submitted annotation is missing its submission id')
  }
  const outbox = source.outbox.map(parseOutbox)
  if (new Set(outbox.map((item) => item.payload.submissionId)).size !== outbox.length) {
    throw new Error('persisted outbox submission ids must be unique')
  }
  return Object.freeze({
    storageVersion: 1,
    annotations: Object.freeze(annotations),
    outbox: Object.freeze(outbox),
    overallRequirementDraft: source.overallRequirementDraft,
  })
}

/** Browser-local repository for one Session's drafts and immutable retry records. */
export class AnnotationStorage {
  readonly key: string
  private error: string | null = null

  constructor(
    private readonly storage: StorageLike,
    sessionId: SessionIdentity,
  ) {
    this.key = `${PREFIX}${sessionId}`
  }

  load(): PersistedSessionState {
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return emptyPersistedState()
      const parsed = parseState(JSON.parse(raw))
      this.error = null
      return parsed
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
      return emptyPersistedState()
    }
  }

  save(state: PersistedSessionState): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(state))
      this.error = null
      return true
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  clear(): void {
    this.storage.removeItem(this.key)
    this.error = null
  }

  lastError(): string | null {
    return this.error
  }
}
