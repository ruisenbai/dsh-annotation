import { describe, expect, it } from 'vitest'
import { orderedRecords } from '../src/client/record-order.ts'
import type {
  AnnotationDraft,
  AnnotationId,
  AnnotationStatus,
  MessageIdentity,
  OutboxPayloadEntry,
  OutboxStatus,
} from '../src/shared/types.ts'
import { diffAnnotation } from './diff-fixtures.ts'
import { fixturePayload } from './fixtures.ts'

function record(id: string, createdAt: number, status: AnnotationStatus = 'draft'): AnnotationDraft {
  return Object.freeze({
    ...fixturePayload().annotations[0]!,
    annotationId: id as AnnotationId,
    annotation: id,
    createdAt,
    updatedAt: createdAt,
    status,
  })
}

function submission(status: OutboxStatus, annotations: readonly AnnotationDraft[]): OutboxPayloadEntry {
  const payload = { ...fixturePayload(), annotations }
  return Object.freeze({
    payload: Object.freeze(payload),
    targetSessionId: payload.sessionId,
    messageId: 'record-order-message' as MessageIdentity,
    attempts: 1,
    status,
  })
}

describe('annotation record display order', () => {
  it('puts current attachments before drafts and keeps read-only legacy Diff in history', () => {
    const attached = record('attached', 20)
    const reattached = record('reattached', 10, 'processed')
    const detached = record('detached', 30)
    const history = record('history', 40, 'sent')
    const legacy: AnnotationDraft = Object.freeze({
      ...diffAnnotation(),
      annotationId: 'legacy' as AnnotationId,
      createdAt: 50,
      updatedAt: 50,
      status: 'draft',
    })
    const annotations = Object.freeze([history, detached, legacy, reattached, attached])
    const view = {
      annotations,
      selectedAnnotationIds: [legacy.annotationId, reattached.annotationId, attached.annotationId],
      outbox: [],
    }
    const result = orderedRecords(view)
    expect(result).toEqual([attached, reattached, detached, legacy, history])
    expect(view.annotations).toBe(annotations)
    expect(result.every((item) => annotations.includes(item))).toBe(true)
    expect(reattached.status).toBe('processed')
  })

  it.each(['ready', 'sending', 'accepted', 'queued', 'failed'] as const)(
    'keeps a historical resend with a %s submission ahead of newer unselected drafts',
    (status) => {
      const resent = record('resent', 10, 'sent')
      const draft = record('draft', 20)
      const history = record('history', 30, 'processed')
      const entry = submission(status, [resent])
      const payloadBefore = JSON.stringify(entry.payload)
      expect(
        orderedRecords({ annotations: [draft, history, resent], selectedAnnotationIds: [], outbox: [entry] }),
      ).toEqual([resent, draft, history])
      expect(JSON.stringify(entry.payload)).toBe(payloadBefore)
    },
  )

  it.each(['sent', 'withdrawn'] as const)(
    'returns a %s resend to history and accepts content-free receipts',
    (status) => {
      const resent = record('resent', 10, 'sent')
      const draft = record('draft', 20)
      const history = record('history', 30, 'processed')
      const entry = submission(status, [resent])
      const receipt = {
        kind: 'receipt' as const,
        submissionId: entry.payload.submissionId,
        targetSessionId: entry.targetSessionId,
        messageId: entry.messageId,
        attempts: entry.attempts,
        status,
      }
      for (const outbox of [[entry], [receipt]]) {
        expect(
          orderedRecords({ annotations: [resent, history, draft], selectedAnnotationIds: [], outbox }),
        ).toEqual([draft, history, resent])
      }
    },
  )

  it('keeps frozen queued records first without a selected attachment', () => {
    const queued = record('queued', 10, 'queued')
    const draft = record('draft', 20)
    expect(orderedRecords({ annotations: [draft, queued], selectedAnnotationIds: [], outbox: [] })).toEqual([
      queued,
      draft,
    ])
  })

  it('uses stable IDs for equal creation times regardless of storage order or later edits', () => {
    const first = { ...record('ann-a', 10), updatedAt: 100 }
    const second = record('ann-z', 10)
    const newest = record('ann-new', 20)
    for (const annotations of [
      [second, first, newest],
      [newest, first, second],
    ]) {
      expect(orderedRecords({ annotations, selectedAnnotationIds: [], outbox: [] })).toEqual([
        newest,
        first,
        second,
      ])
    }
  })
})
