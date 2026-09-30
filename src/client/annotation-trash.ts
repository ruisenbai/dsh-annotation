/** All-session recycle-bin projection over the existing durable per-session journals. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AnnotationConfig,
  AnnotationId,
  AnnotationTrashEntry,
  SessionIdentity,
} from '../shared/types.ts'
import { AnnotationController } from './controller.ts'
import { AnnotationStorage, type StorageCoordination, type StorageLike } from './storage.ts'
import { snapshotOwner, type SourceSnapshotStore, type SourceSnapshotView } from './source-snapshots.ts'

/** The Session is retained even when its conversation is not currently mounted. */
export interface AnnotationTrashRow {
  readonly sessionId: SessionIdentity
  readonly entry: AnnotationTrashEntry
}

/** Read failures retain the previous rows instead of pretending the recycle bin is empty. */
export interface AnnotationTrashView {
  readonly rows: readonly AnnotationTrashRow[]
  readonly error: 'read' | 'write' | 'locked' | 'cleanup' | null
}

/** Settings injection reuses the same mutations as the conversation controls. */
export interface AnnotationTrashInjected {
  readonly hooks: {
    readonly annotationTrash: HostObservable<AnnotationTrashView>
    readonly sourceSnapshots: HostObservable<number>
  }
  readonly refreshTrash: () => void
  readonly restoreTrashed: (sessionId: SessionIdentity, ids: readonly AnnotationId[]) => Promise<void>
  readonly purgeTrashed: (rows: readonly AnnotationTrashRow[]) => Promise<void>
  readonly readSourceSnapshot: (sessionId: SessionIdentity, id: AnnotationId) => Promise<SourceSnapshotView>
}

/** Global settings view for browser-local records; immutable Session messages are never deleted. */
export class AnnotationTrashController {
  private view: AnnotationTrashView = { rows: [], error: null }
  private readonly listeners = new Set<() => void>()
  private readonly cleaned = new Set<string>()
  private readonly cleaning = new Map<string, Promise<void>>()
  private readonly failedCleanups = new Set<string>()
  private readonly readers = new Map<AnnotationStorage, Promise<void>>()
  private disposed = false

  constructor(
    private readonly storage: StorageLike,
    private readonly coordination: StorageCoordination,
    private readonly config: AnnotationConfig,
    private readonly snapshots: SourceSnapshotStore,
    private readonly mounted: (sessionId: SessionIdentity) => AnnotationController | undefined,
  ) {}

  getSnapshot = (): AnnotationTrashView => this.view

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(view: AnnotationTrashView): void {
    if (this.disposed) return
    if (JSON.stringify(this.view) === JSON.stringify(view)) return
    this.view = view
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-annotation] recycle-bin subscriber failed:', error)
      }
    }
  }

  /** Refresh all saved Sessions, including unopened conversations and committed journals. */
  refresh = (): void => {
    if (this.disposed) return
    const rows: AnnotationTrashRow[] = []
    let failed = false
    try {
      for (const sessionId of AnnotationStorage.listSessionIds(this.storage, this.coordination)) {
        const store = new AnnotationStorage(this.storage, sessionId, this.coordination)
        const state = store.load(true)
        const settled = store
          .whenIdle()
          .then(() => {
            if (store.lastError() !== null) throw new Error('trash-compaction')
          })
          .finally(() => {
            this.readers.delete(store)
            store.dispose()
          })
        this.readers.set(store, settled)
        void settled.catch(() => undefined)
        if (store.loadStatus() === 'failed') {
          failed = true
          rows.push(...this.view.rows.filter((row) => row.sessionId === sessionId))
        } else {
          rows.push(...(state.trash ?? []).map((entry) => ({ sessionId, entry })))
          for (const mark of state.deletionMarks ?? [])
            if (mark.state === 'purged') this.clean(snapshotOwner(sessionId, mark.annotationId), settled)
        }
      }
    } catch {
      this.publish({ ...this.view, error: 'read' })
      return
    }
    rows.sort((left, right) => right.entry.deletedAt - left.entry.deletedAt)
    this.publish({ rows, error: failed ? 'read' : this.view.error === 'read' ? null : this.view.error })
  }

  private clean(key: string, settled: Promise<void>): void {
    if (this.cleaned.has(key) || this.cleaning.has(key)) return
    const task = settled
      .then(() => {
        if (this.disposed) return
        return this.snapshots.release(key)
      })
      .then(
        () => {
          if (this.disposed) return
          this.cleaned.add(key)
          this.failedCleanups.delete(key)
          if (this.failedCleanups.size === 0 && this.view.error === 'cleanup')
            this.publish({ ...this.view, error: null })
        },
        () => {
          this.failedCleanups.add(key)
          this.publish({ ...this.view, error: this.view.error ?? 'cleanup' })
        },
      )
      .finally(() => this.cleaning.delete(key))
    this.cleaning.set(key, task)
  }

  private async change(
    sessionId: SessionIdentity,
    ids: readonly AnnotationId[],
    action: 'restore' | 'purge',
  ): Promise<AnnotationTrashView['error']> {
    if (this.disposed) return 'write'
    const existing = this.mounted(sessionId)
    const store =
      existing === undefined ? new AnnotationStorage(this.storage, sessionId, this.coordination) : undefined
    const controller =
      existing ??
      new AnnotationController(
        sessionId,
        store!,
        {
          getSnapshot: () => ({ hasMore: false }),
          loadOlder: async () => undefined,
        },
        this.config,
      )
    try {
      controller.synchronizeStorage()
      const saved =
        action === 'restore' ? controller.restoreAnnotations(ids) : controller.purgeAnnotations(ids)
      if (!saved || !(await controller.whenStorageIdle())) return 'write'
      return null
    } catch (error) {
      return error instanceof Error && error.message === 'annotation-submission-locked' ? 'locked' : 'write'
    } finally {
      if (existing === undefined) controller.dispose()
    }
  }

  private finish(error: AnnotationTrashView['error']): void {
    this.publish({ ...this.view, error: error ?? (this.failedCleanups.size > 0 ? 'cleanup' : null) })
    this.refresh()
  }

  /** Restore one Session's records without arming the composer. */
  restore = async (sessionId: SessionIdentity, ids: readonly AnnotationId[]): Promise<void> => {
    this.finish(await this.change(sessionId, ids, 'restore'))
  }

  /** Permanently remove selected recycle-bin rows, retaining durable anti-resurrection marks. */
  purge = async (rows: readonly AnnotationTrashRow[]): Promise<void> => {
    const groups = new Map<SessionIdentity, AnnotationId[]>()
    for (const row of rows) {
      const ids = groups.get(row.sessionId) ?? []
      if (!ids.includes(row.entry.annotation.annotationId)) ids.push(row.entry.annotation.annotationId)
      groups.set(row.sessionId, ids)
    }
    let firstError: AnnotationTrashView['error'] = null
    for (const [sessionId, ids] of groups) {
      const error = await this.change(sessionId, ids, 'purge')
      firstError ??= error
    }
    this.finish(firstError)
    await this.whenIdle()
  }

  /** Wait for currently owned readers and source cleanup without polling the browser. */
  async whenIdle(): Promise<void> {
    while (this.readers.size > 0 || this.cleaning.size > 0)
      await Promise.allSettled([...this.readers.values(), ...this.cleaning.values()])
  }

  /** Retry reading and outstanding content cleanup after a recoverable storage failure. */
  retry = (): void => {
    this.publish({ ...this.view, error: null })
    this.refresh()
  }

  /** Expose local data operations independently of the Host's settings-save permission. */
  inject(): AnnotationTrashInjected {
    return {
      hooks: { annotationTrash: this, sourceSnapshots: this.snapshots },
      refreshTrash: this.retry,
      restoreTrashed: this.restore,
      purgeTrashed: this.purge,
      readSourceSnapshot: (sessionId, id) => this.snapshots.read(snapshotOwner(sessionId, id)),
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    for (const reader of this.readers.keys()) reader.dispose()
    this.readers.clear()
  }
}
