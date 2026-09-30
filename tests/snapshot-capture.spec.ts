/** Full source copies are recovered from retained records without changing their submitted quotes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationController } from '../src/client/controller.ts'
import type { ReadFileSnapshot } from '../src/client/components/FileWholeAnnotationAction.tsx'
import { captureSourceContent, observeSourceSnapshots } from '../src/client/snapshot-capture.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import {
  SourceSnapshotStore,
  snapshotOwner,
  type SourceSnapshotContent,
  type SourceSnapshotView,
} from '../src/client/source-snapshots.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { sha256Hex } from '../src/shared/snapshot-hash.ts'
import type { SelectionCapture } from '../src/client/selection.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

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

const sessionId = 'snapshot-session' as SessionIdentity
const messageId = 'message-one' as MessageIdentity
const releases: Array<() => void> = []

afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  vi.restoreAllMocks()
})

function controller(memory = new MemoryStorage()): AnnotationController {
  const owner = new AnnotationController(
    sessionId,
    new AnnotationStorage(memory, sessionId),
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
    DEFAULT_CONFIG,
    () => 1_700_000_000_000,
  )
  releases.push(() => owner.dispose())
  return owner
}

function messageCapture(): SelectionCapture {
  return {
    messageId,
    messageSeq: 1,
    responseVersion: messageId,
    quote: { exact: 'source', prefix: '', suffix: '', start: 0, end: 6 },
    rect: { top: 0, left: 0, bottom: 10, right: 60 },
  }
}

function fileCapture(text = 'abcd'): SelectionCapture {
  return {
    source: {
      kind: 'file',
      sessionId,
      resourceAddress: 'dsh-resource://file/session/snapshot-session/%2Fworkspace%2Fnotes.txt',
      path: '/workspace/notes.txt',
      resourceVersion: 'file-v1',
      format: 'text',
      snapshot: {
        version: 1,
        hash: sha256Hex(text),
        bytes: new TextEncoder().encode(text).length,
        format: 'text',
        text,
      },
      wholeFile: false,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: text.length,
      entry: 'sidebar',
    },
    quote: { exact: text, prefix: '', suffix: '', start: 0, end: text.length },
    rect: { top: 0, left: 0, bottom: 10, right: 60 },
  }
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

describe('retained source snapshots', () => {
  it('shares an in-flight owner capture and cancels it when the store is disposed', async () => {
    const objectStoreNames: DOMStringList = Object.assign([] as string[], {
      contains: () => false,
      item: () => null,
    })
    const database: IDBDatabase = Object.assign(new EventTarget(), {
      name: 'snapshot-test',
      version: 1,
      objectStoreNames,
      onabort: null,
      onclose: null,
      onerror: null,
      onversionchange: null,
      createObjectStore: vi.fn(),
      deleteObjectStore: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn(),
    })
    const request = {
      result: database,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    } as IDBOpenDBRequest
    const factory: IDBFactory = {
      open: vi.fn(() => request),
      cmp: vi.fn(() => 0),
      databases: vi.fn(async () => []),
      deleteDatabase: vi.fn(() => request),
    }
    const snapshots = new SourceSnapshotStore(factory)
    const load = vi.fn(async () => ({ kind: 'message' as const, text: 'source', mediaType: 'text/plain' }))
    const first = snapshots.capture('owner', load)
    const second = snapshots.capture('owner', load)
    expect(second).toBe(first)
    expect(factory.open).toHaveBeenCalledOnce()
    snapshots.dispose()
    request.onsuccess?.call(request, new Event('success'))
    await first
    expect(load).not.toHaveBeenCalled()
    expect(database.close).toHaveBeenCalledOnce()
  })

  it('retries a quick save after the initial editor capture loses its source', async () => {
    const owner = controller()
    const snapshots = new SourceSnapshotStore(undefined)
    releases.push(() => snapshots.dispose())
    const first = deferred<SourceSnapshotContent>()
    const complete = deferred<void>()
    const state = new Map<string, SourceSnapshotView>()
    const capture = vi.spyOn(snapshots, 'capture').mockImplementation(async (key, load) => {
      try {
        const content = await load(new AbortController().signal)
        state.set(key, { state: 'complete', content })
      } catch {
        state.set(key, { state: 'fragment', error: 'source' })
      }
    })
    vi.spyOn(snapshots, 'read').mockImplementation(async (key) => {
      const result = state.get(key) ?? { state: 'fragment' as const }
      if (result.state === 'complete') complete.resolve(undefined)
      return result
    })
    vi.spyOn(snapshots, 'release').mockResolvedValue(undefined)
    const load = vi
      .fn<(capture: SelectionCapture) => Promise<SourceSnapshotContent>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ kind: 'message', text: 'original source', mediaType: 'text/markdown' })
    const stop = observeSourceSnapshots(owner, snapshots, load, vi.fn(), vi.fn(), vi.fn())
    releases.push(stop)

    owner.beginSelection(messageCapture())
    expect(load).toHaveBeenCalledOnce()
    owner.updateEditorText('opinion')
    const id = owner.saveEditor()
    first.reject(new Error('snapshot-source-unavailable'))
    await complete.promise
    expect(load).toHaveBeenCalledTimes(2)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture.mock.calls[0]?.[0]).toBe(snapshotOwner(sessionId, id))
    expect(capture.mock.calls[1]?.[0]).toBe(snapshotOwner(sessionId, id))
    expect(load.mock.calls[1]?.[0]).toMatchObject({ messageId, quote: { exact: 'source' } })
    expect(owner.getSnapshot().annotations[0]?.annotation).toBe('opinion')
  })

  it('retries a saved fragment when the original source becomes readable later', async () => {
    const owner = controller()
    owner.beginSelection(messageCapture())
    owner.updateEditorText('opinion')
    owner.saveEditor()
    const snapshots = new SourceSnapshotStore(undefined)
    releases.push(() => snapshots.dispose())
    const first = deferred<void>()
    const complete = deferred<void>()
    let readable = false
    let state: SourceSnapshotView = { state: 'fragment' }
    const capture = vi.spyOn(snapshots, 'capture').mockImplementation(async (_key, load) => {
      try {
        state = { state: 'complete', content: await load(new AbortController().signal) }
      } catch {
        state = { state: 'fragment', error: 'source' }
      }
    })
    vi.spyOn(snapshots, 'read').mockImplementation(async () => {
      if (state.state === 'complete') complete.resolve(undefined)
      else first.resolve(undefined)
      return state
    })
    const load = vi.fn(async (): Promise<SourceSnapshotContent> => {
      if (!readable) throw new Error('snapshot-source-unavailable')
      return { kind: 'message', text: 'source', mediaType: 'text/markdown' }
    })
    const stop = observeSourceSnapshots(owner, snapshots, load, vi.fn(), vi.fn(), vi.fn())
    releases.push(stop)
    await first.promise
    expect(capture).toHaveBeenCalledOnce()
    readable = true
    owner.setPanelOpen(true)
    await complete.promise
    expect(capture).toHaveBeenCalledTimes(2)
    expect(state.state).toBe('complete')
  })

  it.each(['saved', 'trash'] as const)(
    'recovers a %s record when its controller mounts again',
    async (place) => {
      const memory = new MemoryStorage()
      const original = controller(memory)
      original.beginSelection(messageCapture())
      original.updateEditorText('opinion')
      const id = original.saveEditor()
      if (place === 'trash') original.trashAnnotations([id])
      original.dispose()

      const restored = controller(memory)
      const snapshots = new SourceSnapshotStore(undefined)
      releases.push(() => snapshots.dispose())
      const captured = deferred<void>()
      const capture = vi.spyOn(snapshots, 'capture').mockImplementation(async (key, load) => {
        expect(key).toBe(snapshotOwner(sessionId, id))
        await load(new AbortController().signal)
        captured.resolve(undefined)
      })
      vi.spyOn(snapshots, 'read').mockResolvedValue({
        state: 'complete',
        content: { kind: 'message', text: 'source', mediaType: 'text/markdown' },
      })
      const load = vi.fn(async (entry: SelectionCapture) => {
        expect(entry).toMatchObject({ messageId, quote: { exact: 'source' } })
        return { kind: 'message' as const, text: 'source', mediaType: 'text/markdown' }
      })
      const stop = observeSourceSnapshots(restored, snapshots, load, vi.fn(), vi.fn(), vi.fn())
      releases.push(stop)
      await captured.promise
      expect(capture).toHaveBeenCalledOnce()
      expect(load).toHaveBeenCalledOnce()
      expect(restored.getSnapshot()[place === 'saved' ? 'annotations' : 'trash']).toHaveLength(1)
    },
  )

  it('rejects mixed file versions and an early EOF before creating complete text', async () => {
    const capture = fileCapture()
    const bytes = new TextEncoder().encode('abcd')
    const mixed = vi.fn<ReadFileSnapshot>().mockImplementation(async (_session, _path, _signal, range) => ({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.txt',
        version: range?.offset === 0 ? 'file-v1' : 'file-v2',
        bytes: 4,
        data: range?.offset === 0 ? bytes.slice(0, 2) : bytes.slice(2),
        offset: range?.offset ?? 0,
        eof: range?.offset !== 0,
      },
    }))
    await expect(
      captureSourceContent(capture, mixed, () => undefined, new AbortController().signal),
    ).rejects.toThrow('snapshot-source-changed')
    expect(mixed).toHaveBeenCalledTimes(2)

    const short: ReadFileSnapshot = async () => ({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.txt',
        version: 'file-v1',
        bytes: 4,
        data: bytes.slice(0, 2),
        offset: 0,
        eof: true,
      },
    })
    await expect(
      captureSourceContent(capture, short, () => undefined, new AbortController().signal),
    ).rejects.toThrow('snapshot-source-incomplete')
  })

  it('accepts only every byte of a single file version and stops at an aborted page', async () => {
    const capture = fileCapture()
    const bytes = new TextEncoder().encode('abcd')
    const read: ReadFileSnapshot = async (_session, _path, _signal, range) => ({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.txt',
        version: 'file-v1',
        bytes: 4,
        data: range?.offset === 0 ? bytes.slice(0, 2) : bytes.slice(2),
        offset: range?.offset ?? 0,
        eof: range?.offset !== 0,
      },
    })
    await expect(
      captureSourceContent(capture, read, () => undefined, new AbortController().signal),
    ).resolves.toMatchObject({ kind: 'file', text: 'abcd', data: bytes })

    const pending = deferred<Awaited<ReturnType<ReadFileSnapshot>>>()
    const abort = new AbortController()
    const operation = captureSourceContent(
      capture,
      () => pending.promise,
      () => undefined,
      abort.signal,
    )
    abort.abort()
    pending.resolve({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.txt',
        version: 'file-v1',
        bytes: 4,
        data: bytes,
        offset: 0,
        eof: true,
      },
    })
    await expect(operation).rejects.toThrow('snapshot-cancelled')
  })
})
