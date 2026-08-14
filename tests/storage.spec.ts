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
      storageVersion: 1 as const,
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
  })

  it('recovers an interrupted send as an idempotent failed retry', () => {
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
            status: 'sending',
            attempts: 1,
          },
        ],
        overallRequirementDraft: '',
      }),
    )
    expect(storage.load().outbox[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      messageId: 'dsh-inline-annotations:sub-test',
    })
  })

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
    memory.values.set(storage.key, JSON.stringify({ storageVersion: 2 }))
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
