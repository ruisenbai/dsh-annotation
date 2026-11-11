import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import type { StorageCoordination, StorageLike } from '../src/client/storage.ts'
import type { PersistedSideChatState, SideChatId, SideChatReference } from '../src/shared/side-chat-types.ts'
import type { SubmissionId } from '../src/shared/types.ts'
import { sideChatPayload } from './side-chat-fixtures.ts'

const mainId = SessionId('main-test')
const key = `dsh-annotation:side-chat:v2:${mainId}`
const chatId = 'side-chat-a' as SideChatId

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  getItem(name: string): string | null {
    return this.values.get(name) ?? null
  }
  setItem(name: string, value: string): void {
    this.values.set(name, value)
  }
  removeItem(name: string): void {
    this.values.delete(name)
  }
}

function reference(id: string, createdAt: number): SideChatReference {
  const original = sideChatPayload().references[0]!
  return { ...original, referenceId: id as SideChatReference['referenceId'], createdAt }
}
const a = reference('reference-a', 1)
const b = reference('reference-b', 2)
const c = reference('reference-c', 3)
const d = reference('reference-d', 4)

function state(references: readonly SideChatReference[] = [a, b]): PersistedSideChatState {
  return {
    storageVersion: 2,
    mainSessionId: mainId,
    revision: 1,
    chats: [
      {
        sideChatId: chatId,
        sideSessionId: SessionId('side-test'),
        created: true,
        panelOpen: false,
        references,
        outbox: null,
      },
    ],
    activeSideChatId: chatId,
    visible: false,
  }
}

function fixture(initial = state()) {
  const memory = new MemoryStorage()
  memory.setItem(key, JSON.stringify(initial))
  const coordination: StorageCoordination = { keys: () => [...memory.values.keys()] }
  const first = new SideChatStorage(memory, mainId, coordination)
  const second = new SideChatStorage(memory, mainId, coordination)
  first.load()
  second.load()
  const restore = () => new SideChatStorage(memory, mainId, coordination).load()
  return { memory, coordination, first, second, restore }
}

describe('side-chat persistence across browser pages', () => {
  it('retains both stale-page additions in durable journals and on refresh', () => {
    const { first, second, restore } = fixture()
    expect(first.save(state([a, b, c])).status).toBe('saved')
    expect(second.save(state([a, b, d])).status).toBe('merged')
    expect(restore()?.chats[0]?.references).toEqual([a, b, c, d])
    first.synchronize()
    expect(first.save(state([a, b, c, d])).status).toBe('saved')
    expect(restore()?.chats[0]?.references).toEqual([a, b, c, d])
  })

  it.each([
    { removed: [b], expected: [b, c], label: 'one removal' },
    { removed: [], expected: [c], label: 'clear all' },
  ])('honors $label while retaining the other page addition', ({ removed, expected }) => {
    const { first, second, restore } = fixture()
    first.save(state(removed))
    expect(second.save(state([a, b, c])).status).toBe('merged')
    expect(restore()?.chats[0]?.references).toEqual(expected)
  })

  it('does not resurrect consumed references or an admitted outbox after a stale status update', () => {
    const payload = sideChatPayload({ references: [a] })
    const initial: PersistedSideChatState = {
      ...state(),
      chats: [{ ...state().chats[0]!, outbox: { payload, status: 'ready' } }],
    }
    const { first, second, restore } = fixture(initial)
    first.save(state([b]))
    const stale: PersistedSideChatState = {
      ...state([a, b, c]),
      chats: [{ ...state([a, b, c]).chats[0]!, outbox: { payload, status: 'sending' } }],
    }
    expect(second.save(stale).status).toBe('merged')
    expect(restore()?.chats[0]).toMatchObject({ references: [b, c], outbox: null })
  })

  it('keeps two incompatible frozen questions durably recoverable and blocks dependent edits', () => {
    const { first, second, restore, memory } = fixture()
    const frozen = (question: string): PersistedSideChatState => ({
      ...state(),
      chats: [
        {
          ...state().chats[0]!,
          outbox: {
            status: 'ready',
            payload: sideChatPayload({ question, submissionId: question as SubmissionId }),
          },
        },
      ],
    })
    expect(first.save(frozen('question-one')).status).toBe('saved')
    expect(second.save(frozen('question-two')).status).toBe('conflict')
    expect(second.recoveryAvailable).toBe(true)
    expect(second.outdated).toBe(true)
    const durable = [...memory.values.values()].join('\n')
    expect(durable).toContain('question-one')
    expect(durable).toContain('question-two')
    const count = memory.values.size
    expect(second.save(state([a, b, c])).status).toBe('conflict')
    expect(memory.values.size).toBe(count)
    expect(second.exportRecovery(frozen('question-two'))).toContain('question-one')
    expect(restore()?.chats).toHaveLength(1)
  })

  it('blocks incompatible Session creation without overwriting either page identity', () => {
    const initial = { ...state(), chats: [{ ...state().chats[0]!, created: false, sideSessionId: null }] }
    const { first, second, memory } = fixture(initial)
    first.save(state())
    const incoming = {
      ...state(),
      chats: [{ ...state().chats[0]!, sideSessionId: SessionId('another-side') }],
    }
    expect(second.save(incoming).status).toBe('conflict')
    expect(second.exportRecovery(incoming)).toContain('another-side')
    expect(memory.getItem(key)).toBe(JSON.stringify(initial))
  })

  it('reports quota failures, exports local additions, and retries without discarding a newer page edit', () => {
    const { first, second, restore, memory } = fixture()
    const write = vi.spyOn(memory, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    expect(first.save(state([a, b, c])).status).toBe('unavailable')
    expect(first.recoveryAvailable).toBe(false)
    expect(first.exportRecovery(state([a, b, c]))).toContain('reference-c')
    expect(restore()?.chats[0]?.references).toEqual([a, b])
    write.mockRestore()
    second.save(state([b, d]))
    expect(first.retry(state([a, b, c])).status).toBe('merged')
    expect(restore()?.chats[0]?.references).toEqual([b, c, d])
  })

  it('reads a stable generation when compaction replaces the record during enumeration', () => {
    const { memory } = fixture()
    let interleave = true
    const owner = new SideChatStorage(memory, mainId, {
      keys: () => {
        if (interleave) {
          interleave = false
          memory.setItem(key, JSON.stringify({ ...state([b, c]), revision: 2 }))
        }
        return [...memory.values.keys()]
      },
    })
    expect(owner.load()?.chats[0]?.references).toEqual([b, c])
    expect(owner.revision).toBe(2)
  })

  it('does not replay compacted additions during partial journal deletion', async () => {
    const { first, memory, coordination } = fixture()
    first.save(state([a, b, c]))
    first.save(state([b, c]))
    const reader = new SideChatStorage(memory, mainId, coordination)
    const removal = vi.spyOn(memory, 'removeItem').mockImplementation((name) => {
      expect(reader.synchronize()).toMatchObject({
        status: 'saved',
        state: { chats: [{ references: [b, c] }] },
      })
      memory.values.delete(name)
    })
    const owner = new SideChatStorage(memory, mainId, {
      ...coordination,
      runExclusive: (_name, task) => Promise.resolve().then(task),
    })
    owner.load()
    owner.synchronize()
    await owner.whenIdle()
    expect(removal).toHaveBeenCalledTimes(2)
    expect([...memory.values.keys()]).toEqual([key])
    expect(JSON.parse(memory.getItem(key)!).chats[0].references).toEqual([b, c])
    owner.dispose()
  })

  it('notifies a compaction failure while preserving journals for refresh and retry', async () => {
    const { memory, coordination } = fixture()
    let denied = true
    const owner = new SideChatStorage(memory, mainId, {
      ...coordination,
      runExclusive: (_name, task) =>
        denied ? Promise.reject(new Error('Lock unavailable')) : Promise.resolve().then(task),
    })
    owner.load()
    const notice = vi.fn()
    const unsubscribe = owner.subscribe(notice)
    expect(owner.save(state([a, b, c])).status).toBe('saved')
    await owner.whenIdle()
    expect(notice).toHaveBeenCalledOnce()
    expect(owner.available).toBe(false)
    expect(new SideChatStorage(memory, mainId, coordination).load()?.chats[0]?.references).toEqual([a, b, c])
    denied = false
    expect(owner.retry(state([a, b, c])).status).toBe('saved')
    await owner.whenIdle()
    unsubscribe()
    owner.dispose()
  })

  it('notifies an incompatible peer edit discovered after its compaction lock was queued', async () => {
    const { memory, coordination, second } = fixture()
    const release = Promise.withResolvers<void>()
    const owner = new SideChatStorage(memory, mainId, {
      ...coordination,
      runExclusive: async (_name, task) => {
        await release.promise
        task()
      },
    })
    onTestFinished(async () => {
      owner.dispose()
      release.resolve()
      await owner.whenIdle()
    })
    owner.load()
    const notice = vi.fn()
    owner.subscribe(notice)
    const frozen = (question: string): PersistedSideChatState => ({
      ...state(),
      chats: [
        {
          ...state().chats[0]!,
          outbox: {
            status: 'ready',
            payload: sideChatPayload({ question, submissionId: question as SubmissionId }),
          },
        },
      ],
    })
    expect(owner.save(frozen('local-question')).status).toBe('saved')
    expect(second.save(frozen('peer-question')).status).toBe('conflict')
    release.resolve()
    await owner.whenIdle()
    expect(notice).toHaveBeenCalledOnce()
    expect(owner.outdated).toBe(true)
    expect(owner.exportRecovery(frozen('local-question'))).toContain('peer-question')
  })

  it('cancels queued lock work and drains disposal without deleting durable recovery', async () => {
    const { memory, coordination } = fixture()
    const entered = Promise.withResolvers<void>()
    const owner = new SideChatStorage(memory, mainId, {
      ...coordination,
      runExclusive: (_name, _task, signal) =>
        new Promise<void>((_resolve, reject) => {
          entered.resolve()
          signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
        }),
    })
    owner.load()
    const notice = vi.fn()
    owner.subscribe(notice)
    owner.save(state([a, b, c]))
    await entered.promise
    owner.dispose()
    await owner.whenIdle()
    expect(notice).not.toHaveBeenCalled()
    expect(new SideChatStorage(memory, mainId, coordination).load()?.chats[0]?.references).toEqual([a, b, c])
  })
})

it('merges independent source occurrences and keeps removal tombstones ahead of stale history recovery', () => {
  const initial = {
    ...state([a]),
    chats: [
      {
        ...state([a]).chats[0]!,
        referenceRecords: [a],
        referenceRecordIds: [a.referenceId],
        removedReferenceIds: [],
      },
    ],
  }
  const { first, second, restore, memory, coordination } = fixture(initial)
  const changed = (
    records: readonly SideChatReference[],
    removed: readonly SideChatReference['referenceId'][] = [],
  ): PersistedSideChatState => ({
    ...initial,
    chats: [
      {
        ...initial.chats[0]!,
        references: [],
        referenceRecords: records,
        referenceRecordIds: [
          a.referenceId,
          ...records.filter((item) => item.referenceId !== a.referenceId).map((item) => item.referenceId),
        ],
        removedReferenceIds: removed,
      },
    ],
  })
  expect(first.save(changed([a, b])).status).toBe('saved')
  expect(second.save(changed([a, c])).status).toBe('merged')
  expect(restore()!.chats[0]!.referenceRecords).toEqual([a, b, c])
  const stale = new SideChatStorage(memory, mainId, coordination)
  stale.load()
  const current = restore()!
  expect(
    first.save({
      ...current,
      chats: [{ ...current.chats[0]!, referenceRecords: [b, c], removedReferenceIds: [a.referenceId] }],
    }).status,
  ).toBe('saved')
  expect(
    stale.save({
      ...current,
      chats: [
        {
          ...current.chats[0]!,
          referenceRecords: [a, b, c, d],
          referenceRecordIds: [a.referenceId, b.referenceId, c.referenceId, d.referenceId],
        },
      ],
    }).status,
  ).toBe('merged')
  expect(restore()!.chats[0]!.referenceRecords).toEqual([b, c, d])
  expect(restore()!.chats[0]!.removedReferenceIds).toEqual([a.referenceId])
})
