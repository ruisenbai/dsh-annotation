import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { SideChatStorage, storedSideChatMainIds } from '../src/client/side-chat-storage.ts'
import type { StorageLike } from '../src/client/storage.ts'
import type {
  PersistedSideChatEntry,
  PersistedSideChatState,
  SideChatId,
  SideChatReference,
} from '../src/shared/side-chat-types.ts'
import { sideChatPayload } from './side-chat-fixtures.ts'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  get length(): number {
    return this.values.size
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const MAIN = SessionId('main-test')

function storedEntry(): PersistedSideChatEntry {
  const payload = sideChatPayload()
  return {
    sideChatId: 'side-chat-a' as SideChatId,
    sideSessionId: payload.sideSessionId,
    created: true,
    title: 'First discussion',
    references: payload.references,
    outbox: { payload, status: 'unknown', failureCode: 'receipt-conflict' },
  }
}

function storedState(): PersistedSideChatState {
  return {
    storageVersion: 2,
    mainSessionId: MAIN,
    chats: [storedEntry()],
    activeSideChatId: 'side-chat-a' as SideChatId,
    visible: false,
  }
}

function legacyState() {
  const payload = sideChatPayload()
  return {
    storageVersion: 1 as const,
    mainSessionId: payload.mainSessionId,
    sideSessionId: payload.sideSessionId,
    created: true,
    visible: false,
    references: payload.references,
    outbox: { payload, status: 'unknown', failureCode: 'receipt-conflict' },
  }
}

describe('side-chat browser-storage associations', () => {
  it('discovers owners from plugin keys without reading or discarding damaged records', () => {
    const memory = new MemoryStorage()
    memory.setItem('other:main-a', 'unrelated')
    memory.setItem('dsh-annotation:side-chat:v2:main-future', 'future')
    memory.setItem('dsh-annotation:side-chat:v1:', 'empty identity')
    memory.setItem('dsh-annotation:side-chat:v2:main-test', '{broken')
    memory.setItem('dsh-annotation:side-chat:v1:main-other', 'null')
    expect(storedSideChatMainIds(memory)).toEqual(['main-future', 'main-test', 'main-other'])
    const owner = new SideChatStorage(memory, MAIN)
    expect(() => owner.load()).toThrow('stored data was preserved')
    expect(owner.available).toBe(false)
    expect(memory.getItem('dsh-annotation:side-chat:v2:main-test')).toBe('{broken')
  })

  it('returns no association owners when key enumeration is absent or denied', () => {
    const memory = new MemoryStorage()
    const noKeys: StorageLike = {
      getItem: memory.getItem.bind(memory),
      setItem: memory.setItem.bind(memory),
      removeItem: memory.removeItem.bind(memory),
    }
    expect(storedSideChatMainIds(noKeys)).toEqual([])
    const denied: StorageLike = {
      ...noKeys,
      length: 1,
      key: () => {
        throw new Error('Storage denied')
      },
    }
    expect(storedSideChatMainIds(denied)).toEqual([])
  })

  it('round-trips several parallel chats with their own references and scope state', () => {
    const memory = new MemoryStorage()
    const owner = new SideChatStorage(memory, MAIN)
    const first = storedEntry()
    const second: PersistedSideChatEntry = {
      ...first,
      sideChatId: 'side-chat-b' as SideChatId,
      references: Object.freeze([]),
      outbox: null,
    }
    const state: PersistedSideChatState = {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [first, second],
      activeSideChatId: second.sideChatId,
      visible: true,
    }
    expect(owner.save(state)).toMatchObject({ status: 'saved' })
    const loaded = new SideChatStorage(memory, MAIN).load()
    expect(loaded).toMatchObject(state)
    expect(loaded?.revision).toBe(1)
    expect(owner.revision).toBe(1)
  })

  it('restores an expanded reference record panel as display state', () => {
    const memory = new MemoryStorage()
    const owner = new SideChatStorage(memory, MAIN)
    const state: PersistedSideChatState = {
      ...storedState(),
      chats: [{ ...storedEntry(), panelOpen: true }],
    }
    expect(owner.save(state)).toMatchObject({ status: 'saved' })
    expect(new SideChatStorage(memory, MAIN).load()?.chats[0]?.panelOpen).toBe(true)
  })

  it('retains a newer page update while merging the stale page addition', () => {
    const memory = new MemoryStorage()
    const first = new SideChatStorage(memory, MAIN)
    expect(first.save(storedState())).toMatchObject({ status: 'saved' })
    const stale = new SideChatStorage(memory, MAIN)
    stale.load()
    const newer = new SideChatStorage(memory, MAIN)
    newer.load()
    newer.save({ ...storedState(), visible: true })
    const added = {
      ...storedEntry().references[0]!,
      referenceId: 'new-reference' as SideChatReference['referenceId'],
      createdAt: 2,
    }
    const local = {
      ...storedState(),
      chats: [{ ...storedEntry(), references: [...storedEntry().references, added] }],
    }
    expect(stale.save(local)).toMatchObject({ status: 'merged' })
    expect(stale.outdated).toBe(false)
    expect(new SideChatStorage(memory, MAIN).load()).toMatchObject({
      visible: true,
      chats: [{ references: [...storedEntry().references, added] }],
    })
  })

  it('advances the generation on every successful write', () => {
    const memory = new MemoryStorage()
    const owner = new SideChatStorage(memory, MAIN)
    expect(owner.save(storedState())).toMatchObject({ status: 'saved' })
    expect(owner.save({ ...storedState(), visible: true })).toMatchObject({ status: 'saved' })
    expect(owner.revision).toBe(2)
    expect(new SideChatStorage(memory, MAIN).load()?.revision).toBe(2)
  })

  it('restores the exact frozen request and permanent receipt-conflict failure', () => {
    const memory = new MemoryStorage()
    memory.setItem('dsh-annotation:side-chat:v2:main-test', JSON.stringify(storedState()))
    const owner = new SideChatStorage(memory, MAIN)
    expect(owner.load()).toMatchObject(storedState())
    expect(owner.available).toBe(true)
  })

  it('migrates a released single-chat record while preserving the released key', () => {
    const memory = new MemoryStorage()
    memory.setItem('dsh-annotation:side-chat:v1:main-test', JSON.stringify(legacyState()))
    const owner = new SideChatStorage(memory, MAIN)
    const loaded = owner.load()
    expect(loaded?.chats).toHaveLength(1)
    expect(loaded?.activeSideChatId).toBe(loaded?.chats[0]?.sideChatId)
    expect(loaded?.chats[0]?.references).toEqual(legacyState().references)
    expect(owner.save(loaded!)).toMatchObject({ status: 'saved' })
    expect(memory.getItem('dsh-annotation:side-chat:v1:main-test')).not.toBeNull()
    expect(memory.getItem('dsh-annotation:side-chat:v2:main-test')).not.toBeNull()
  })

  it.each(['sending', 'accepted'])(
    'requires receipt reconciliation after restoring a %s request',
    (status) => {
      const memory = new MemoryStorage()
      const entry = storedEntry()
      const outbox = entry.outbox!
      memory.setItem(
        'dsh-annotation:side-chat:v2:main-test',
        JSON.stringify({
          ...storedState(),
          chats: [
            {
              ...entry,
              outbox: { payload: outbox.payload, status },
            },
          ],
        }),
      )
      const owner = new SideChatStorage(memory, MAIN)
      expect(owner.load()?.chats[0]).toMatchObject({
        references: entry.references,
        outbox: { payload: outbox.payload, status: 'unknown' },
      })
    },
  )

  it.each([
    { storageVersion: 2, mainSessionId: MAIN, chats: [], activeSideChatId: null, visible: 'yes' },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [{ ...storedEntry(), sideSessionId: null }],
      activeSideChatId: 'side-chat-a',
      visible: true,
    },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [{ ...storedEntry(), created: false }],
      activeSideChatId: 'side-chat-a',
      visible: true,
    },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [{ ...storedEntry(), sideSessionId: MAIN }],
      activeSideChatId: 'side-chat-a',
      visible: true,
    },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [storedEntry(), storedEntry()],
      activeSideChatId: 'side-chat-a',
      visible: true,
    },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [storedEntry()],
      activeSideChatId: 'side-chat-missing',
      visible: true,
    },
    {
      storageVersion: 2,
      mainSessionId: MAIN,
      chats: [{ ...storedEntry(), outbox: { ...storedEntry().outbox, failureCode: 'other' } }],
      activeSideChatId: 'side-chat-a',
      visible: true,
    },
  ])('preserves an invalid association and prevents later overwrites: %j', (invalid) => {
    const memory = new MemoryStorage()
    const raw = JSON.stringify(invalid)
    memory.setItem('dsh-annotation:side-chat:v2:main-test', raw)
    const owner = new SideChatStorage(memory, MAIN)
    expect(() => owner.load()).toThrow('stored data was preserved')
    expect(owner.save(storedState())).toMatchObject({ status: 'unavailable' })
    expect(memory.getItem('dsh-annotation:side-chat:v2:main-test')).toBe(raw)
  })
})
