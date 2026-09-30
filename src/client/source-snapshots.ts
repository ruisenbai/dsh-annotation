/** Browser-local, content-addressed source copies independent of submitted annotation payloads. */
import { sha256Hex } from '../shared/snapshot-hash.ts'

/** A captured source is rendered as text or as a browser-supported binary preview. */
export interface SourceSnapshotContent {
  readonly kind: 'message' | 'file' | 'diff'
  readonly text: string
  readonly mediaType: string
  readonly data?: Uint8Array
}

/** Full content is available only after its IndexedDB transaction has committed. */
export interface SourceSnapshotView {
  readonly state: 'capturing' | 'complete' | 'fragment'
  readonly content?: SourceSnapshotContent
  readonly error?: 'storage' | 'source'
}

interface SnapshotOwner {
  readonly key: string
  readonly captureId: string
  readonly state: SourceSnapshotView['state']
  readonly contentKey?: string
  readonly error?: SourceSnapshotView['error']
}

interface StoredContent extends SourceSnapshotContent {
  readonly key: string
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('snapshot-storage'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('snapshot-storage'))
  })
  // A request can reject before its transaction is awaited; retain both failure observations.
  void done.catch(() => undefined)
  return done
}

function ownerValue(value: unknown): SnapshotOwner | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('key' in value) || typeof value.key !== 'string') return undefined
  if (!('captureId' in value) || typeof value.captureId !== 'string') return undefined
  if (!('state' in value) || !['capturing', 'complete', 'fragment'].includes(String(value.state)))
    return undefined
  if ('contentKey' in value && typeof value.contentKey !== 'string') return undefined
  if (value.state === 'complete' && (!('contentKey' in value) || typeof value.contentKey !== 'string'))
    return undefined
  if ('error' in value && value.error !== 'source' && value.error !== 'storage') return undefined
  return value as SnapshotOwner
}

function contentValue(value: unknown): SourceSnapshotContent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('kind' in value) || !['message', 'file', 'diff'].includes(String(value.kind))) return undefined
  if (!('text' in value) || typeof value.text !== 'string') return undefined
  if (!('mediaType' in value) || typeof value.mediaType !== 'string') return undefined
  if ('data' in value && !(value.data instanceof Uint8Array)) return undefined
  return value as SourceSnapshotContent
}

/** IndexedDB content ownership survives normal deletion and ends only on cancellation or purge. */
export class SourceSnapshotStore {
  private database: Promise<IDBDatabase> | undefined
  private readonly pending = new Map<string, AbortController>()
  private readonly captureTasks = new Map<string, Promise<void>>()
  private readonly failures = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private revision = 0

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (this.disposed || this.factory === undefined) return Promise.reject(new Error('snapshot-storage'))
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory!.open('dsh-annotation-source-snapshots', 1)
      let rejected = false
      request.onupgradeneeded = () => {
        request.result.createObjectStore('owners', { keyPath: 'key' })
        request.result.createObjectStore('contents', { keyPath: 'key' })
      }
      request.onsuccess = () => {
        const database = request.result
        if (this.disposed || rejected) {
          database.close()
          reject(new Error('snapshot-storage'))
          return
        }
        database.onversionchange = () => {
          database.close()
          this.database = undefined
        }
        resolve(database)
      }
      request.onerror = () => {
        this.database = undefined
        reject(request.error ?? new Error('snapshot-storage'))
      }
      request.onblocked = () => {
        rejected = true
        this.database = undefined
        reject(new Error('snapshot-storage'))
      }
    })
    return this.database
  }

  /** Subscribe to completed captures and releases. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Revision used by mounted detail views to re-read completed captures. */
  getSnapshot = (): number => this.revision

  private publish(): void {
    this.revision += 1
    if (!this.disposed) for (const listener of this.listeners) listener()
  }

  /** Read a verified local copy; unavailable storage leaves the record's original quote usable. */
  async read(key: string): Promise<SourceSnapshotView> {
    if (this.failures.has(key)) return { state: 'fragment', error: 'storage' }
    try {
      const db = await this.open()
      const tx = db.transaction(['owners', 'contents'], 'readonly')
      const done = transactionDone(tx)
      const owner = ownerValue(await requestValue(tx.objectStore('owners').get(key)))
      const content =
        owner?.contentKey === undefined
          ? undefined
          : contentValue(await requestValue(tx.objectStore('contents').get(owner.contentKey)))
      await done
      if (owner?.state === 'complete' && content !== undefined) return { state: 'complete', content }
      if (owner?.state === 'capturing' && this.pending.has(key)) return { state: 'capturing' }
      return { state: 'fragment', ...(owner?.error === undefined ? {} : { error: owner.error }) }
    } catch {
      return { state: 'fragment', error: 'storage' }
    }
  }

  /** Capture one immutable source. Concurrent callers await the same owner result. */
  capture(key: string, load: (signal: AbortSignal) => Promise<SourceSnapshotContent>): Promise<void> {
    const current = this.captureTasks.get(key)
    if (current !== undefined) return current
    if (this.disposed) return Promise.resolve()
    const task = this.captureOnce(key, load)
    this.captureTasks.set(key, task)
    const forget = () => {
      if (this.captureTasks.get(key) === task) this.captureTasks.delete(key)
    }
    void task.then(forget, forget)
    return task
  }

  private async captureOnce(
    key: string,
    load: (signal: AbortSignal) => Promise<SourceSnapshotContent>,
  ): Promise<void> {
    const abort = new AbortController()
    const captureId = crypto.randomUUID()
    this.pending.set(key, abort)
    this.failures.delete(key)
    let stored = false
    let failure: SourceSnapshotView['error'] = 'storage'
    try {
      const db = await this.open()
      if (abort.signal.aborted) return
      const start = db.transaction(['owners', 'contents'], 'readwrite')
      const started = transactionDone(start)
      const existing = ownerValue(await requestValue(start.objectStore('owners').get(key)))
      if (existing?.state === 'complete' && existing.contentKey !== undefined) {
        const content = contentValue(
          await requestValue(start.objectStore('contents').get(existing.contentKey)),
        )
        if (content !== undefined) {
          await started
          return
        }
      }
      start.objectStore('owners').put({ key, captureId, state: 'capturing' } satisfies SnapshotOwner)
      await started
      stored = true
      this.publish()
      failure = 'source'
      const content = await load(abort.signal)
      if (abort.signal.aborted) return
      failure = 'storage'
      const contentKey = [content.kind, content.mediaType, sha256Hex(content.data ?? content.text)].join(':')
      const tx = db.transaction(['owners', 'contents'], 'readwrite')
      const done = transactionDone(tx)
      const current = ownerValue(await requestValue(tx.objectStore('owners').get(key)))
      if (current?.captureId === captureId) {
        try {
          tx.objectStore('contents').put({ ...content, key: contentKey } satisfies StoredContent)
          tx.objectStore('owners').put({
            key,
            captureId,
            state: 'complete',
            contentKey,
          } satisfies SnapshotOwner)
        } catch (error) {
          tx.abort()
          throw error
        }
      }
      await done
    } catch {
      if (!abort.signal.aborted) {
        if (stored) {
          try {
            const db = await this.open()
            const tx = db.transaction('owners', 'readwrite')
            const done = transactionDone(tx)
            const current = ownerValue(await requestValue(tx.objectStore('owners').get(key)))
            if (current?.captureId === captureId)
              tx.objectStore('owners').put({
                key,
                captureId,
                state: 'fragment',
                error: failure,
              } satisfies SnapshotOwner)
            await done
          } catch {
            this.failures.add(key)
          }
        } else this.failures.add(key)
      }
    } finally {
      if (this.pending.get(key) === abort) this.pending.delete(key)
      this.publish()
    }
  }

  /** Release one owner and remove content only when no remaining annotation refers to it. */
  async release(key: string): Promise<void> {
    this.pending.get(key)?.abort()
    this.pending.delete(key)
    this.captureTasks.delete(key)
    this.failures.delete(key)
    const db = await this.open()
    const tx = db.transaction(['owners', 'contents'], 'readwrite')
    const done = transactionDone(tx)
    const owners = tx.objectStore('owners')
    try {
      const owner = ownerValue(await requestValue(owners.get(key)))
      owners.delete(key)
      if (owner?.contentKey !== undefined) {
        const remaining: unknown[] = await requestValue(owners.getAll())
        if (!remaining.some((item) => ownerValue(item)?.contentKey === owner.contentKey))
          tx.objectStore('contents').delete(owner.contentKey)
      }
      await done
    } catch (error) {
      try {
        tx.abort()
      } catch (abortError) {
        void abortError
        /* A failed request can already have aborted its transaction. */
      }
      throw error
    }
    this.publish()
  }

  /** Stop in-flight reads and close the database when the plugin unloads. */
  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) pending.abort()
    this.pending.clear()
    this.captureTasks.clear()
    this.listeners.clear()
    void this.database?.then(
      (database) => database.close(),
      () => undefined,
    )
  }
}

/** Session qualification prevents restored or imported ids from sharing private local content. */
export function snapshotOwner(sessionId: string, annotationId: string): string {
  return JSON.stringify([sessionId, annotationId])
}
