// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { SourceSnapshotStore } from '../src/client/source-snapshots.ts'

interface StoredRow {
  readonly key: string
  readonly [field: string]: unknown
}

type RequestRecord<T> = EventTarget & {
  result: T
  error: DOMException | null
  readyState: IDBRequestReadyState
  onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null
  onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null
}

function mockEventTarget<T extends object>(members: Partial<T>): T {
  return Object.assign(new EventTarget(), members) as T
}

function copyRow<T>(value: T): T {
  return structuredClone(value)
}

function memoryIndexedDb() {
  const stores = new Map<string, Map<string, StoredRow>>()
  let failNextWrite = false

  const database = Object.assign(new EventTarget(), {
    name: 'dsh-annotation-source-snapshots',
    version: 1,
    objectStoreNames: Object.assign([] as string[], {
      contains: (name: string) => stores.has(name),
      item: (index: number) => [...stores.keys()][index] ?? null,
    }) as DOMStringList,
    onabort: null,
    onclose: null,
    onerror: null,
    onversionchange: null,
    createObjectStore(name: string) {
      const values = new Map<string, StoredRow>()
      stores.set(name, values)
      return {} as IDBObjectStore
    },
    deleteObjectStore(name: string) {
      stores.delete(name)
    },
    transaction(names: string | Iterable<string>, mode: IDBTransactionMode = 'readonly') {
      const selected = typeof names === 'string' ? [names] : [...names]
      const working = new Map(selected.map((name) => [name, new Map(stores.get(name) ?? [])] as const))
      let pending = 0
      let completed = false
      let aborted = false
      let completionTimer: ReturnType<typeof setTimeout> | undefined
      let transactionError: DOMException | null = null
      let transaction: IDBTransaction
      transaction = mockEventTarget<IDBTransaction>({
        db: database,
        durability: 'default' as IDBTransactionDurability,
        get error() {
          return transactionError
        },
        mode,
        objectStoreNames: Object.assign([...selected], {
          contains: (name: string) => selected.includes(name),
          item: (index: number) => selected[index] ?? null,
        }) as DOMStringList,
        onabort: null,
        oncomplete: null,
        onerror: null,
        abort() {
          if (completed || aborted) return
          aborted = true
          if (completionTimer !== undefined) clearTimeout(completionTimer)
          queueMicrotask(() => transaction.onabort?.call(transaction as IDBTransaction, new Event('abort')))
        },
        commit() {},
        objectStore(name: string): IDBObjectStore {
          const values = working.get(name)
          if (values === undefined) throw new DOMException('Missing store', 'NotFoundError')
          const makeRequest = <T>(operation: () => T, write = false): IDBRequest<T> => {
            pending += 1
            const request: RequestRecord<T> = Object.assign(new EventTarget(), {
              result: undefined as T,
              error: null as DOMException | null,
              readyState: 'pending' as IDBRequestReadyState,
              onsuccess: null,
              onerror: null,
            })
            queueMicrotask(() => {
              try {
                if (aborted) throw new DOMException('Transaction aborted', 'AbortError')
                if (write && failNextWrite) {
                  failNextWrite = false
                  throw new DOMException('Quota exceeded', 'QuotaExceededError')
                }
                request.result = copyRow(operation())
                request.readyState = 'done'
                request.onsuccess?.call(request as IDBRequest<T>, new Event('success'))
              } catch (error) {
                request.error =
                  error instanceof DOMException
                    ? error
                    : new DOMException(error instanceof Error ? error.message : String(error))
                request.readyState = 'done'
                transactionError = request.error
                request.onerror?.call(request as IDBRequest<T>, new Event('error'))
                aborted = true
                transaction.onerror?.call(transaction as IDBTransaction, new Event('error'))
                transaction.onabort?.call(transaction as IDBTransaction, new Event('abort'))
              } finally {
                pending -= 1
                scheduleCompletion()
              }
            })
            return request as IDBRequest<T>
          }
          return mockEventTarget<IDBObjectStore>({
            name,
            keyPath: 'key',
            indexNames: Object.assign([] as string[], {
              contains: () => false,
              item: () => null,
            }) as DOMStringList,
            transaction,
            autoIncrement: false,
            get(key: IDBValidKey) {
              return makeRequest(() => values.get(String(key)))
            },
            getAll() {
              return makeRequest(() => [...values.values()])
            },
            put(value: StoredRow) {
              return makeRequest<IDBValidKey>(() => {
                values.set(value.key, copyRow(value))
                return value.key
              }, true)
            },
            delete(key: IDBValidKey) {
              return makeRequest(() => {
                values.delete(String(key))
                return undefined
              }, true)
            },
          })
        },
      })
      const scheduleCompletion = (): void => {
        if (completed || aborted) return
        if (completionTimer !== undefined) clearTimeout(completionTimer)
        completionTimer = setTimeout(() => {
          if (completed || aborted || pending !== 0) return
          if (mode === 'readwrite') for (const [name, values] of working) stores.set(name, new Map(values))
          completed = true
          transaction.oncomplete?.call(transaction as IDBTransaction, new Event('complete'))
        }, 0)
      }
      scheduleCompletion()
      return transaction as IDBTransaction
    },
    close() {},
  }) as IDBDatabase

  let opened = false
  const factory = {
    open() {
      const request = Object.assign(new EventTarget(), {
        result: database,
        error: null as DOMException | null,
        onupgradeneeded: null as ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null,
        onsuccess: null as ((this: IDBOpenDBRequest, event: Event) => unknown) | null,
        onerror: null as ((this: IDBOpenDBRequest, event: Event) => unknown) | null,
        onblocked: null as ((this: IDBOpenDBRequest, event: Event) => unknown) | null,
      })
      queueMicrotask(() => {
        if (!opened) {
          opened = true
          request.onupgradeneeded?.call(
            request as IDBOpenDBRequest,
            new Event('upgradeneeded') as IDBVersionChangeEvent,
          )
        }
        queueMicrotask(() => request.onsuccess?.call(request as IDBOpenDBRequest, new Event('success')))
      })
      return request as IDBOpenDBRequest
    },
    deleteDatabase() {
      stores.clear()
      return {} as IDBOpenDBRequest
    },
    cmp(first: IDBValidKey, second: IDBValidKey) {
      return String(first).localeCompare(String(second))
    },
    async databases() {
      return []
    },
  } as IDBFactory

  return {
    factory,
    rows(name: 'owners' | 'contents') {
      return [...(stores.get(name)?.values() ?? [])].map(copyRow)
    },
    failWrite() {
      failNextWrite = true
    },
  }
}

const stores: SourceSnapshotStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

function snapshotStore(factory: IDBFactory): SourceSnapshotStore {
  const store = new SourceSnapshotStore(factory)
  stores.push(store)
  return store
}

const sharedContent = Object.freeze({
  kind: 'file' as const,
  text: 'UNIQUE-SNAPSHOT-SENTINEL',
  mediaType: 'text/plain',
})

describe('source snapshot ownership', () => {
  it('keeps shared content until its last owner is released', async () => {
    const database = memoryIndexedDb()
    const snapshots = snapshotStore(database.factory)

    await snapshots.capture('owner-one', async () => sharedContent)
    await snapshots.capture('owner-two', async () => sharedContent)
    expect(database.rows('contents')).toHaveLength(1)

    await snapshots.release('owner-one')
    expect(database.rows('owners').map((owner) => owner.key)).toEqual(['owner-two'])
    expect(database.rows('contents')).toHaveLength(1)
    await expect(snapshots.read('owner-two')).resolves.toMatchObject({
      state: 'complete',
      content: { text: sharedContent.text },
    })

    await snapshots.release('owner-two')
    expect(database.rows('owners')).toEqual([])
    expect(database.rows('contents')).toEqual([])
  })

  it('writes a content-free tombstone and prevents a delayed capture from restoring content', async () => {
    const database = memoryIndexedDb()
    const snapshots = snapshotStore(database.factory)
    let finish!: () => void
    const loaded = new Promise<void>((resolve) => {
      finish = resolve
    })
    const capture = snapshots.capture('purged-owner', async () => {
      await loaded
      return sharedContent
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await snapshots.purge('purged-owner')
    finish()
    await capture

    expect(database.rows('owners')).toEqual([
      expect.objectContaining({ key: 'purged-owner', state: 'purged' }),
    ])
    expect(database.rows('owners')[0]).not.toHaveProperty('contentKey')
    expect(JSON.stringify(database.rows('owners'))).not.toContain(sharedContent.text)
    expect(JSON.stringify(database.rows('contents'))).not.toContain(sharedContent.text)
    await snapshots.capture('purged-owner', async () => sharedContent)
    expect(JSON.stringify(database.rows('contents'))).not.toContain(sharedContent.text)
    await expect(snapshots.read('purged-owner')).resolves.toEqual({ state: 'fragment', error: 'source' })
  })

  it('retains content after a failed purge and removes it on an idempotent retry', async () => {
    const database = memoryIndexedDb()
    const snapshots = snapshotStore(database.factory)
    await snapshots.capture('retry-owner', async () => sharedContent)

    database.failWrite()
    await expect(snapshots.purge('retry-owner')).rejects.toThrow()
    expect(JSON.stringify(database.rows('contents'))).toContain(sharedContent.text)

    await snapshots.purge('retry-owner')
    expect(database.rows('contents')).toEqual([])
    expect(database.rows('owners')).toEqual([
      expect.objectContaining({ key: 'retry-owner', state: 'purged' }),
    ])
    expect(database.rows('owners')[0]).not.toHaveProperty('contentKey')
  })
})
