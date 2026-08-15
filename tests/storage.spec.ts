import { describe, expect, it } from 'vitest'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('draft storage', () => {
  it('saves and reloads a validated state', () => {
    const memory = new MemoryStorage()
    const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
    const payload = fixturePayload({ sessionId: 'session-1' as SessionIdentity })
    const annotation = {
      ...payload.annotations[0]!,
      status: 'queued' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const state = {
      storageVersion: 2 as const,
      annotations: [annotation],
      outbox: [
        {
          payload,
          targetSessionId: payload.sessionId,
          messageId: 'dsh-inline-annotations:sub-test' as MessageIdentity,
          status: 'queued' as const,
          attempts: 1,
        },
      ],
      overallRequirementDraft: 'whole task',
    }
    expect(storage.save(state)).toBe(true)
    expect(storage.load()).toEqual(state)
    expect(storage.lastError()).toBeNull()
    expect(storage.usageBytes()).toBeGreaterThan(0)
    storage.clear()
    expect(storage.usageBytes()).toBe(0)
  })

  it('restores an unfinished compact editor from version-two storage', () => {
    const memory = new MemoryStorage()
    const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
    const source = fixturePayload().annotations[0]!
    const editorDraft = {
      kind: 'new' as const,
      capture: {
        messageId: source.messageId,
        messageSeq: source.messageSeq,
        responseVersion: source.responseVersion,
        quote: source.quote,
        rect: { top: 10, left: 20, bottom: 30, right: 80 },
      },
      text: 'Work in progress',
      longSelectionConfirmed: true,
    }
    const state = { ...emptyPersistedState(), editorDraft }
    expect(storage.save(state)).toBe(true)
    expect(storage.load().editorDraft).toEqual(editorDraft)
  })

  it('drops a corrupt optional editor without losing valid recovery records', () => {
    const memory = new MemoryStorage()
    const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
    const source = fixturePayload().annotations[0]!
    memory.values.set(
      storage.key,
      JSON.stringify({
        storageVersion: 2,
        annotations: [{ ...source, status: 'draft', updatedAt: source.createdAt }],
        outbox: [],
        overallRequirementDraft: 'Keep this request',
        editorDraft: { kind: 'new', text: 42 },
      }),
    )

    const restored = storage.load()
    expect(restored.annotations).toHaveLength(1)
    expect(restored.overallRequirementDraft).toBe('Keep this request')
    expect(restored.editorDraft).toBeUndefined()
    expect(storage.lastError()).toBeNull()
  })

  it.each(['sending', 'accepted'] as const)(
    'recovers an unobserved %s send as an idempotent failed retry',
    (unobservedStatus) => {
      const memory = new MemoryStorage()
      const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
      const payload = fixturePayload({ sessionId: 'session-1' as SessionIdentity })
      memory.values.set(
        storage.key,
        JSON.stringify({
          storageVersion: 1,
          annotations: [
            {
              ...payload.annotations[0],
              status: 'queued',
              updatedAt: payload.createdAt,
              submissionId: payload.submissionId,
            },
          ],
          outbox: [
            {
              payload,
              targetSessionId: payload.sessionId,
              messageId: 'dsh-inline-annotations:sub-test',
              status: unobservedStatus,
              attempts: 1,
            },
          ],
          overallRequirementDraft: '',
        }),
      )
      const restored = storage.load()
      expect(restored.storageVersion).toBe(2)
      expect(restored.outbox[0]).toMatchObject({
        status: 'failed',
        attempts: 1,
        messageId: 'dsh-inline-annotations:sub-test',
      })
    },
  )

  it('fails closed when outbox provenance does not match its immutable payload', () => {
    const memory = new MemoryStorage()
    const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
    const payload = fixturePayload({ sessionId: 'session-1' as SessionIdentity })
    memory.values.set(
      storage.key,
      JSON.stringify({
        storageVersion: 1,
        annotations: [],
        outbox: [
          {
            payload,
            targetSessionId: 'another-session',
            messageId: 'wrong-message',
            status: 'ready',
            attempts: 0,
          },
        ],
        overallRequirementDraft: '',
      }),
    )
    expect(storage.load()).toEqual(emptyPersistedState())
    expect(storage.lastError()).toContain('target')
  })

  it('fails closed on corrupt or unsupported state', () => {
    const memory = new MemoryStorage()
    const storage = new AnnotationStorage(memory, 'session-1' as SessionIdentity)
    memory.values.set(storage.key, '{bad')
    expect(storage.load()).toEqual(emptyPersistedState())
    expect(storage.lastError()).not.toBeNull()
    memory.values.set(storage.key, JSON.stringify({ storageVersion: 99 }))
    expect(storage.load()).toEqual(emptyPersistedState())
  })

  it('reports unavailable browser storage without throwing', () => {
    const storage = new AnnotationStorage(
      {
        getItem() {
          throw new Error('denied')
        },
        setItem() {
          throw new Error('denied')
        },
        removeItem() {
          throw new Error('denied')
        },
      },
      'session-1' as SessionIdentity,
    )
    expect(storage.load()).toEqual(emptyPersistedState())
    expect(storage.lastError()).toBe('denied')
    expect(storage.save(emptyPersistedState())).toBe(false)
  })
})
