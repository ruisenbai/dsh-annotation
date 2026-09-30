/** Settings recycle-bin operations cover mounted and unopened sessions through one persistence path. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationTrashController } from '../src/client/annotation-trash.ts'
import { AnnotationStorage, type StorageCoordination } from '../src/client/storage.ts'
import { SourceSnapshotStore, snapshotOwner } from '../src/client/source-snapshots.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
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

const owners: { dispose(): void }[] = []
afterEach(() => {
  for (const owner of owners.splice(0).reverse()) owner.dispose()
  vi.restoreAllMocks()
})

function harness() {
  const memory = new MemoryStorage()
  const coordination: StorageCoordination = { keys: () => [...memory.values.keys()] }
  const mounted = new Map<SessionIdentity, AnnotationController>()
  const snapshots = new SourceSnapshotStore(undefined)
  owners.push(snapshots)
  const release = vi.spyOn(snapshots, 'release').mockResolvedValue(undefined)
  const catalog = new AnnotationTrashController(memory, coordination, DEFAULT_CONFIG, snapshots, (id) =>
    mounted.get(id),
  )
  owners.push(catalog)
  const create = (session = 'session-one') => {
    const sessionId = session as SessionIdentity
    const storage = new AnnotationStorage(memory, sessionId, coordination)
    const controller = new AnnotationController(
      sessionId,
      storage,
      {
        getSnapshot: () => ({ hasMore: false }),
        loadOlder: async () => undefined,
      },
      DEFAULT_CONFIG,
      () => 1_700_000_000_000,
    )
    owners.push(controller)
    const messageId = 'message' as MessageIdentity
    controller.beginSelection({
      messageId,
      messageSeq: 1,
      responseVersion: messageId,
      quote: { exact: 'source', prefix: '', suffix: '', start: 0, end: 6 },
      rect: { top: 0, left: 0, bottom: 10, right: 60 },
    })
    controller.updateEditorText(`opinion in ${session}`)
    const id = controller.saveEditor()
    expect(controller.trashAnnotations([id])).toBe(true)
    return { sessionId, id, controller, storage }
  }
  return { memory, coordination, mounted, snapshots, release, catalog, create }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((ok, no) => {
    resolve = ok
    reject = no
  })
  return { promise, resolve, reject }
}

describe('all-session annotation recycle bin', () => {
  it('lists unopened sessions and restores the selected record without attaching it', async () => {
    const { catalog, create, memory } = harness()
    const first = create()
    const second = create('session-two')
    catalog.refresh()
    expect(
      catalog
        .getSnapshot()
        .rows.map((row) => row.sessionId)
        .sort(),
    ).toEqual([first.sessionId, second.sessionId])
    await catalog.restore(first.sessionId, [first.id])
    expect(catalog.getSnapshot().error).toBeNull()
    expect(catalog.getSnapshot().rows).toHaveLength(1)
    const storage = new AnnotationStorage(memory, first.sessionId)
    expect(storage.load(true)).toMatchObject({
      annotations: [{ annotationId: first.id }],
      selectedAnnotationIds: [],
      trash: [],
    })
    storage.dispose()
  })

  it('keeps previous rows on read failure and retries the same session later', () => {
    const { catalog, create, memory } = harness()
    const { sessionId } = create()
    catalog.refresh()
    const rows = catalog.getSnapshot().rows
    const snapshot = new Map(memory.values)
    for (const key of memory.values.keys())
      if (key.startsWith(`dsh-annotation:v1:${sessionId}`)) memory.values.delete(key)
    memory.values.set(`dsh-annotation:v1:${sessionId}`, '{broken')
    catalog.refresh()
    expect(catalog.getSnapshot()).toEqual({ rows, error: 'read' })
    memory.values.clear()
    for (const [key, value] of snapshot) memory.values.set(key, value)
    catalog.retry()
    expect(catalog.getSnapshot()).toEqual({ rows, error: null })
  })

  it('retains a row and its source copy when restore or purge cannot be written', async () => {
    const { catalog, create, memory, release } = harness()
    const { sessionId, id } = create()
    catalog.refresh()
    const writes = vi.spyOn(memory, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await catalog.restore(sessionId, [id])
    expect(catalog.getSnapshot().error).toBe('write')
    expect(catalog.getSnapshot().rows).toHaveLength(1)
    await catalog.purge(catalog.getSnapshot().rows)
    expect(catalog.getSnapshot().error).toBe('write')
    expect(catalog.getSnapshot().rows).toHaveLength(1)
    expect(release).not.toHaveBeenCalled()
    writes.mockRestore()
  })

  it('keeps the first batch error when later sessions are successfully purged', async () => {
    const { catalog, create, memory } = harness()
    const failed = create('a-failed')
    create('b-successful')
    catalog.refresh()
    const write = memory.setItem.bind(memory)
    const writes = vi.spyOn(memory, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith(`dsh-annotation:v1:${failed.sessionId}`)) throw new Error('quota')
      write(key, value)
    })
    await catalog.purge(catalog.getSnapshot().rows)
    expect(catalog.getSnapshot().error).toBe('write')
    expect(catalog.getSnapshot().rows).toHaveLength(1)
    expect(catalog.getSnapshot().rows[0]?.sessionId).toBe(failed.sessionId)
    writes.mockRestore()
  })

  it('awaits mounted-controller persistence and retains compaction errors', async () => {
    const { catalog, create, mounted } = harness()
    const { sessionId, controller } = create()
    mounted.set(sessionId, controller)
    catalog.refresh()
    const pending = deferred<boolean>()
    const idle = vi.spyOn(controller, 'whenStorageIdle').mockReturnValue(pending.promise)
    let settled = false
    const operation = catalog.purge(catalog.getSnapshot().rows).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(idle).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    pending.resolve(false)
    await operation
    expect(catalog.getSnapshot().error).toBe('write')
    expect(settled).toBe(true)
  })

  it('cleans snapshots only after the reader journal has finished compacting', async () => {
    const { catalog, create, release } = harness()
    const { controller } = create()
    controller.purgeAnnotations(controller.getSnapshot().trash.map((entry) => entry.annotation.annotationId))
    const pending = deferred<void>()
    const idle = vi.spyOn(AnnotationStorage.prototype, 'whenIdle').mockReturnValue(pending.promise)
    catalog.refresh()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
    pending.resolve(undefined)
    await catalog.whenIdle()
    expect(release).toHaveBeenCalledOnce()
    idle.mockRestore()
  })

  it('keeps a cleanup failure retryable after the recycled row has been permanently removed', async () => {
    const { catalog, create, release } = harness()
    const { sessionId, id } = create()
    release.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined)
    catalog.refresh()
    await catalog.purge(catalog.getSnapshot().rows)
    await catalog.whenIdle()
    expect(catalog.getSnapshot()).toEqual({ rows: [], error: 'cleanup' })
    catalog.retry()
    await catalog.whenIdle()
    expect(release).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenLastCalledWith(snapshotOwner(sessionId, id))
    expect(catalog.getSnapshot()).toEqual({ rows: [], error: null })
    catalog.refresh()
    await catalog.whenIdle()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('does not repeat or notify cleanup after disposal', async () => {
    const { catalog, create, release } = harness()
    const { controller } = create()
    controller.purgeAnnotations(controller.getSnapshot().trash.map((entry) => entry.annotation.annotationId))
    const pending = deferred<void>()
    vi.spyOn(AnnotationStorage.prototype, 'whenIdle').mockReturnValue(pending.promise)
    const subscriber = vi.fn()
    catalog.subscribe(subscriber)
    catalog.refresh()
    const calls = subscriber.mock.calls.length
    catalog.dispose()
    pending.resolve(undefined)
    await catalog.whenIdle()
    expect(release).not.toHaveBeenCalled()
    expect(subscriber).toHaveBeenCalledTimes(calls)
  })

  it('exposes local mutations independently of Host settings permissions', async () => {
    const { catalog, create, snapshots } = harness()
    const { sessionId, id } = create()
    vi.spyOn(snapshots, 'read').mockResolvedValue({
      state: 'complete',
      content: { kind: 'message', text: 'original', mediaType: 'text/plain' },
    })
    const injected = catalog.inject()
    injected.refreshTrash()
    expect(injected.hooks.annotationTrash).toBe(catalog)
    expect(injected.hooks.sourceSnapshots).toBe(snapshots)
    expect(await injected.readSourceSnapshot(sessionId, id as AnnotationId)).toMatchObject({
      state: 'complete',
    })
    await injected.restoreTrashed(sessionId, [id])
    expect(catalog.getSnapshot().rows).toEqual([])
  })
})
