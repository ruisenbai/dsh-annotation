/** Archive selection, durable deletion and stale-page recovery through the real controller and storage. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatController } from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { parallelSideChatFixture, sideChatCapture, SideChatMemoryStorage } from './side-chat-fixtures.ts'
import type { PersistedSideChatState } from '../src/shared/side-chat-types.ts'
import type { SessionIdentity } from '../src/shared/types.ts'

class Origin extends SideChatMemoryStorage {
  get length() {
    return this.values.size
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
}

it('archives current and noncurrent chats, selects right then left, and restores the same Session and references', async () => {
  const h = parallelSideChatFixture()
  onTestFinished(h.dispose)
  const a = h.owner.createChat()
  const ref = h.owner.collect(sideChatCapture('A quote'), a.sideChatId)
  await h.owner.prepare(a.sideChatId)
  const b = h.owner.createChat()
  await h.owner.prepare(b.sideChatId)
  const c = h.owner.createChat()
  h.owner.selectChat(b.sideChatId)
  h.owner.setArchived(a.sideChatId, true)
  expect(h.owner.getSnapshot().activeSideChatId).toBe(b.sideChatId)
  expect(h.owner.chatView(a.sideChatId)?.references).toEqual([ref])
  h.owner.setArchived(b.sideChatId, true)
  expect(h.owner.getSnapshot().activeSideChatId).toBe(c.sideChatId)
  h.owner.setArchived(a.sideChatId, false)
  expect(h.owner.getSnapshot().activeSideChatId).toBe(c.sideChatId)
  h.owner.removeChat(c.sideChatId)
  expect(h.owner.getSnapshot().activeSideChatId).toBe(a.sideChatId)
  expect(h.owner.chatView(a.sideChatId)?.sideSessionId).toBe(h.first.sideId)
  h.owner.setArchived(a.sideChatId, true)
  expect(h.owner.getSnapshot().active).toBeNull()
  expect(h.owner.getSnapshot().chats.filter((chat) => !chat.archived)).toHaveLength(0)
  h.owner.setArchived(a.sideChatId, false)
  expect(h.owner.getSnapshot().activeSideChatId).toBe(a.sideChatId)
  expect(() => h.owner.selectChat(b.sideChatId)).toThrow()
})

it('keeps references in an archived association across stale-page edits and restores its original identity', async () => {
  const h = parallelSideChatFixture()
  onTestFinished(h.dispose)
  const origin = new Origin()
  const coordination = { keys: () => [...origin.values.keys()] }
  const first = new SideChatController(
    h.owner.mainSessionId,
    h.sessions,
    new SideChatStorage(origin, h.owner.mainSessionId, coordination),
  )
  const a = first.createChat()
  first.collect(sideChatCapture('initial'), a.sideChatId)
  await first.prepare(a.sideChatId)
  const second = new SideChatController(
    h.owner.mainSessionId,
    h.sessions,
    new SideChatStorage(origin, h.owner.mainSessionId, coordination),
  )
  onTestFinished(() => {
    first.dispose()
    second.dispose()
  })
  first.setArchived(a.sideChatId, true)
  second.collect(sideChatCapture('concurrent'), a.sideChatId)
  second.synchronizeStorage()
  expect(second.chatView(a.sideChatId)?.archived).toBe(true)
  expect(second.getSnapshot().activeSideChatId).toBeNull()
  second.setArchived(a.sideChatId, false)
  first.synchronizeStorage()
  expect(first.chatView(a.sideChatId)).toMatchObject({ archived: false, sideSessionId: h.first.sideId })
  expect(first.chatView(a.sideChatId)?.references.map((ref) => ref.quote.exact)).toEqual([
    'initial',
    'concurrent',
  ])
})

it('deletion wins over older-page additions and survives old compact-record writes without reviving the association', async () => {
  const h = parallelSideChatFixture()
  onTestFinished(h.dispose)
  const origin = new Origin()
  const coordination = { keys: () => [...origin.values.keys()] }
  const storageA = new SideChatStorage(origin, h.owner.mainSessionId, coordination)
  const first = new SideChatController(h.owner.mainSessionId, h.sessions, storageA)
  const a = first.createChat()
  first.collect(sideChatCapture('initial'), a.sideChatId)
  await first.prepare(a.sideChatId)
  const stale = new SideChatController(
    h.owner.mainSessionId,
    h.sessions,
    new SideChatStorage(origin, h.owner.mainSessionId, coordination),
  )
  onTestFinished(() => {
    first.dispose()
    stale.dispose()
  })
  const key = `dsh-annotation:side-chat:v2:${h.owner.mainSessionId}`
  // A prior compact record remains a valid released-v2 input.
  const old = JSON.stringify({
    storageVersion: 2,
    mainSessionId: h.owner.mainSessionId,
    chats: [
      {
        sideChatId: a.sideChatId,
        sideSessionId: h.first.sideId,
        created: true,
        references: first.chatView(a.sideChatId)!.references,
        outbox: null,
      },
    ],
    activeSideChatId: a.sideChatId,
    visible: true,
  } satisfies PersistedSideChatState)
  first.removeChat(a.sideChatId)
  stale.collect(sideChatCapture('late reference'), a.sideChatId)
  expect(stale.chatView(a.sideChatId)).toBeNull()
  origin.setItem(key, old)
  const reload = new SideChatController(
    h.owner.mainSessionId,
    h.sessions,
    new SideChatStorage(origin, h.owner.mainSessionId, coordination),
  )
  onTestFinished(() => reload.dispose())
  expect(reload.getSnapshot().chats).toEqual([])
  expect(reload.getSnapshot().active).toBeNull()
  expect(reload.exportStorageRecovery()).toContain('late reference')
})

it('reading a restored active record does not write or produce a new journal', () => {
  const origin = new Origin()
  const main = SessionId('read-only-main')
  origin.setItem(
    `dsh-annotation:side-chat:v2:${main}`,
    JSON.stringify({
      storageVersion: 2,
      mainSessionId: main,
      chats: [],
      activeSideChatId: null,
      visible: false,
      revision: 4,
    }),
  )
  const write = vi.spyOn(origin, 'setItem')
  const storage = new SideChatStorage(origin, main, { keys: () => [...origin.values.keys()] })
  onTestFinished(() => storage.dispose())
  storage.load()
  storage.synchronize()
  expect(write).not.toHaveBeenCalled()
})

it('compacts permanent deletion with no edit journal and preserves the noncurrent selection', async () => {
  const h = parallelSideChatFixture()
  onTestFinished(h.dispose)
  const origin = new Origin()
  const coordination = {
    keys: () => [...origin.values.keys()],
    runExclusive: async (_name: string, task: () => void) => {
      task()
    },
  }
  const storage = new SideChatStorage(origin, h.owner.mainSessionId, coordination)
  const owner = new SideChatController(h.owner.mainSessionId, h.sessions, storage)
  onTestFinished(() => {
    owner.dispose()
  })
  const a = owner.createChat()
  owner.collect(sideChatCapture('deleted reference'), a.sideChatId)
  const b = owner.createChat()
  owner.collect(sideChatCapture('retained reference'), b.sideChatId)
  await owner.whenStorageIdle()
  expect([...origin.values.keys()].some((key) => key.includes(':journal:'))).toBe(false)

  owner.removeChat(a.sideChatId)
  await owner.whenStorageIdle()
  const compact = JSON.parse(
    origin.getItem(`dsh-annotation:side-chat:v2:${h.owner.mainSessionId}`)!,
  ) as PersistedSideChatState
  expect(compact.chats.map((chat) => chat.sideChatId)).toEqual([b.sideChatId])
  expect(compact.activeSideChatId).toBe(b.sideChatId)
  expect(compact.deletedSideChatIds).toContain(a.sideChatId)
  expect(JSON.stringify(compact)).not.toContain('deleted reference')
  const write = vi.spyOn(origin, 'setItem')
  const restored = new SideChatStorage(origin, h.owner.mainSessionId, coordination)
  onTestFinished(() => {
    restored.dispose()
  })
  expect(restored.load()?.chats.map((chat) => chat.sideChatId)).toEqual([b.sideChatId])
  restored.synchronize()
  await restored.whenIdle()
  expect(write).not.toHaveBeenCalled()
})

it('cleans only a deleted side Session annotation record and rejects subsequent writes from an old owner', () => {
  const origin = new Origin()
  const side = 'annotation-side-a' as SessionIdentity
  const sibling = 'annotation-side-b' as SessionIdentity
  const coordination = { keys: () => [...origin.values.keys()] }
  const older = new AnnotationStorage(origin, side, coordination)
  const current = older.load()
  older.save(current)
  origin.setItem(`dsh-annotation:v1:${side}:journal:obsolete`, 'old')
  origin.setItem(`dsh-annotation:v1:${sibling}`, 'keep sibling')
  origin.setItem('dsh-annotation:v1:main', 'keep main')
  AnnotationStorage.retireSession(origin, side, coordination)
  expect(origin.getItem(`dsh-annotation:v1:${side}`)).toBeNull()
  expect(origin.getItem(`dsh-annotation:v1:${side}:journal:obsolete`)).toBeNull()
  expect(origin.getItem(`dsh-annotation:v1:${sibling}`)).toBe('keep sibling')
  expect(origin.getItem('dsh-annotation:v1:main')).toBe('keep main')
  expect(older.save(current)).toBe(false)
  older.dispose()
})
