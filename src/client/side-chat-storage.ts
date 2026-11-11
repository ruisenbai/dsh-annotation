/** Browser-local association and pending-reference persistence, separate from annotation records. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  parseSideChatReference,
  parseSideChatSubmissionPayload,
  sideChatSubmissionFingerprint,
} from '../shared/side-chat-protocol.ts'
import {
  SIDE_CHAT_STORAGE_VERSION,
  type PersistedSideChatEntry,
  type PersistedSideChatState,
  type SideChatId,
  type SideChatOutbox,
  type SideChatReference,
  type SideChatReferenceId,
} from '../shared/side-chat-types.ts'
import type { StorageCoordination, StorageLike } from './storage.ts'
import { mergeSideChatStates } from './side-chat-merge.ts'

/** Current per-main association record; each parallel chat is one entry inside it. */
const SIDE_CHAT_STORAGE_PREFIX = 'dsh-annotation:side-chat:v2:'
/** Released single-chat record; read once and migrated into the current list form. */
const LEGACY_SIDE_CHAT_STORAGE_PREFIX = 'dsh-annotation:side-chat:v1:'
/** Stable migration identity for the one chat a released record represented. */
const LEGACY_SIDE_CHAT_ID = 'side-chat-legacy'

/** Browser-local writes distinguish durable changes from retained, unresolved conflicts. */
export type SideChatSaveResult =
  | { readonly status: 'saved' | 'merged'; readonly state: PersistedSideChatState }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict'; readonly state?: PersistedSideChatState }

/** Unique, immutable edits remain readable even when pages race or a merge cannot finish. */
interface SideChatJournal {
  readonly version: 1
  readonly id: string
  readonly dependencies: readonly string[]
  readonly before: PersistedSideChatState
  readonly after: PersistedSideChatState
}

function sameState(left: PersistedSideChatState, right: PersistedSideChatState): boolean {
  const comparable = (state: PersistedSideChatState) => [
    state.mainSessionId,
    state.activeSideChatId,
    state.visible,
    state.deletedSideChatIds ?? [],
    state.chats.map((entry) => [
      entry.sideChatId,
      entry.sideSessionId,
      entry.created,
      entry.archived ?? false,
      entry.title ?? null,
      entry.panelOpen ?? false,
      entry.references.map((item) => [
        item.referenceId,
        item.sourceSessionId,
        item.messageId,
        item.messageSeq,
        item.responseVersion,
        item.quote.exact,
        item.quote.prefix,
        item.quote.suffix,
        item.quote.start,
        item.quote.end,
        item.createdAt,
      ]),
      entry.referenceRecords ?? entry.references,
      entry.referenceRecordIds ??
        (entry.referenceRecords ?? entry.references).map((item) => item.referenceId),
      entry.removedReferenceIds ?? [],
      entry.outbox === null
        ? null
        : [
            entry.outbox.status,
            entry.outbox.failureCode ?? null,
            sideChatSubmissionFingerprint(entry.outbox.payload),
          ],
    ]),
  ]
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

/**
 * Find association owners by this plugin's browser-storage keys, including damaged records.
 * @param storage - Origin storage with optional key enumeration.
 * @returns Distinct main Session identities, or an empty list when enumeration is unavailable.
 */
export function storedSideChatMainIds(storage: StorageLike): readonly SessionId[] {
  try {
    const length = storage.length
    if (storage.key === undefined || length === undefined || !Number.isSafeInteger(length) || length < 0)
      return Object.freeze([])
    const mainIds = new Set<SessionId>()
    for (let index = 0; index < length; index++) {
      const key = storage.key(index)
      if (key === null) continue
      const prefix = [SIDE_CHAT_STORAGE_PREFIX, LEGACY_SIDE_CHAT_STORAGE_PREFIX].find((candidate) =>
        key.startsWith(candidate),
      )
      if (prefix === undefined) continue
      const mainId = key.slice(prefix.length).split(/:journal:|:deleted:|:recovery:/)[0]!
      if (mainId.trim() !== '') mainIds.add(mainId as SessionId)
    }
    return Object.freeze([...mainIds])
  } catch (error: unknown) {
    // Denied enumeration leaves each controller responsible for its own stored record.
    void error
    return Object.freeze([])
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`invalid side-chat ${name}`)
  return value as Record<string, unknown>
}

/** Released v2 records have no generation; a present value must be a nonnegative integer. */
function readRevision(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('invalid side-chat revision')
  return value
}

function optionalSessionId(value: unknown, mainSessionId: SessionId): SessionId | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') throw new Error('invalid side-chat Session identity')
  if (value === mainSessionId) throw new Error('side chat targets its main Session')
  return value as SessionId
}

function parseOutbox(
  value: unknown,
  mainSessionId: SessionId,
  sideSessionId: SessionId | null,
  created: boolean,
  restoring: boolean,
): SideChatOutbox | null {
  if (value === null) return null
  if (!created) throw new Error('side-chat outbox has no created Session')
  const entry = record(value, 'outbox')
  if (!['ready', 'sending', 'accepted', 'failed', 'unknown'].includes(String(entry.status)))
    throw new Error('invalid side-chat outbox status')
  if (entry.failureCode !== undefined && entry.failureCode !== 'receipt-conflict')
    throw new Error('invalid side-chat outbox failure')
  const payload = parseSideChatSubmissionPayload(entry.payload)
  if (payload.mainSessionId !== mainSessionId || payload.sideSessionId !== sideSessionId)
    throw new Error('side-chat outbox targets another association')
  return Object.freeze({
    payload,
    // A frozen in-flight or accepted record becomes an unknown outcome after reload.
    status:
      restoring && (entry.status === 'sending' || entry.status === 'accepted')
        ? 'unknown'
        : (entry.status as SideChatOutbox['status']),
    ...(entry.failureCode === 'receipt-conflict' ? { failureCode: 'receipt-conflict' as const } : {}),
  })
}

function parseEntry(value: unknown, mainSessionId: SessionId, restoring: boolean): PersistedSideChatEntry {
  const source = record(value, 'chat')
  const sideChatId = source.sideChatId
  if (typeof sideChatId !== 'string' || sideChatId.trim() === '')
    throw new Error('invalid side-chat identity')
  const sideSessionId = optionalSessionId(source.sideSessionId, mainSessionId)
  const created = source.created
  if (typeof created !== 'boolean') throw new Error('invalid side-chat creation flag')
  if (created && sideSessionId === null) throw new Error('created side chat has no Session identity')
  if (source.title !== undefined && (typeof source.title !== 'string' || source.title.trim() === ''))
    throw new Error('invalid side-chat title')
  if (source.panelOpen !== undefined && typeof source.panelOpen !== 'boolean')
    throw new Error('invalid side-chat panel state')
  if (source.archived !== undefined && typeof source.archived !== 'boolean')
    throw new Error('invalid side-chat archive state')
  if (!Array.isArray(source.references)) throw new Error('invalid side-chat references')
  const references = Object.freeze(source.references.map(parseSideChatReference))
  if (source.referenceRecords !== undefined && !Array.isArray(source.referenceRecords))
    throw new Error('invalid side-chat reference records')
  const parseIds = (value: unknown): readonly SideChatReferenceId[] => {
    if (value === undefined) return []
    if (
      !Array.isArray(value) ||
      value.some((id) => typeof id !== 'string' || id.trim() === '') ||
      new Set(value).size !== value.length
    )
      throw new Error('invalid source reference identities')
    return Object.freeze(value.map((id) => id as SideChatReferenceId))
  }
  const removedReferenceIds = parseIds(source.removedReferenceIds)
  const referenceRecordIds =
    source.referenceRecordIds === undefined
      ? (source.referenceRecords ?? source.references)
          .map(parseSideChatReference)
          .map((item: SideChatReference) => item.referenceId)
      : parseIds(source.referenceRecordIds)
  const referenceRecords = Object.freeze(
    (source.referenceRecords ?? source.references).map(parseSideChatReference),
  )
  if (
    referenceRecords.some((item) => item.sourceSessionId !== mainSessionId) ||
    new Set(referenceRecords.map((item) => item.referenceId)).size !== referenceRecords.length
  )
    throw new Error('invalid side-chat reference record identities')
  if (referenceRecords.some((item) => !referenceRecordIds.includes(item.referenceId)))
    throw new Error('source reference order is incomplete')
  if (references.some((item) => item.sourceSessionId !== mainSessionId))
    throw new Error('side-chat reference owner differs')
  if (new Set(references.map((item) => item.referenceId)).size !== references.length)
    throw new Error('side-chat reference identities differ')
  return Object.freeze({
    sideChatId: sideChatId as SideChatId,
    sideSessionId,
    created,
    ...(source.title === undefined ? {} : { title: source.title }),
    ...(source.panelOpen === undefined ? {} : { panelOpen: source.panelOpen }),
    ...(source.archived === undefined ? {} : { archived: source.archived }),
    references: Object.freeze(references.filter((item) => !removedReferenceIds.includes(item.referenceId))),
    referenceRecords: Object.freeze(
      referenceRecords.filter((item) => !removedReferenceIds.includes(item.referenceId)),
    ),
    referenceRecordIds,
    removedReferenceIds,
    outbox: parseOutbox(source.outbox, mainSessionId, sideSessionId, created, restoring),
  })
}

function readState(
  raw: string,
  mainSessionId: SessionId,
  storageVersion: 1 | typeof SIDE_CHAT_STORAGE_VERSION,
  restoring = false,
): PersistedSideChatState {
  const source = record(JSON.parse(raw), 'storage')
  if (source.storageVersion !== storageVersion || source.mainSessionId !== mainSessionId)
    throw new Error('invalid side-chat association')
  if (typeof source.visible !== 'boolean') throw new Error('invalid side-chat visibility')
  const revision = readRevision(source.revision)
  if (
    source.appliedJournalIds !== undefined &&
    (!Array.isArray(source.appliedJournalIds) ||
      source.appliedJournalIds.some((id: unknown) => typeof id !== 'string'))
  )
    throw new Error('invalid applied side-chat journals')
  const withRevision = (state: PersistedSideChatState): PersistedSideChatState =>
    Object.freeze({
      ...state,
      revision,
      ...(source.appliedJournalIds === undefined
        ? {}
        : { appliedJournalIds: Object.freeze(source.appliedJournalIds as string[]) }),
    })
  if (storageVersion === 1) {
    // The released single-chat record: one chat, always selected while it exists.
    const sideSessionId = optionalSessionId(source.sideSessionId, mainSessionId)
    const created = source.created
    if (typeof created !== 'boolean') throw new Error('invalid side-chat creation flag')
    if (created && sideSessionId === null) throw new Error('created side chat has no Session identity')
    if (!Array.isArray(source.references)) throw new Error('invalid side-chat references')
    const references = Object.freeze(source.references.map(parseSideChatReference))
    if (references.some((item) => item.sourceSessionId !== mainSessionId))
      throw new Error('side-chat reference owner differs')
    const chat: PersistedSideChatEntry = Object.freeze({
      sideChatId: LEGACY_SIDE_CHAT_ID as SideChatId,
      sideSessionId,
      created,
      references,
      outbox: parseOutbox(source.outbox, mainSessionId, sideSessionId, created, restoring),
    })
    return withRevision(
      Object.freeze({
        storageVersion: SIDE_CHAT_STORAGE_VERSION,
        mainSessionId,
        chats: Object.freeze([chat]),
        activeSideChatId: chat.sideChatId,
        visible: source.visible,
      }),
    )
  }
  if (!Array.isArray(source.chats)) throw new Error('invalid side-chat list')
  const deleted = source.deletedSideChatIds ?? []
  if (!Array.isArray(deleted) || deleted.some((id: unknown) => typeof id !== 'string' || id.trim() === ''))
    throw new Error('invalid deleted side-chat identities')
  const deletedSideChatIds = Object.freeze(deleted as SideChatId[])
  const chats = Object.freeze(
    source.chats
      .map((entry) => parseEntry(entry, mainSessionId, restoring))
      .filter((entry) => !deletedSideChatIds.includes(entry.sideChatId)),
  )
  if (new Set(chats.map((chat) => chat.sideChatId)).size !== chats.length)
    throw new Error('side-chat identities differ')
  if (source.activeSideChatId !== null && typeof source.activeSideChatId !== 'string')
    throw new Error('invalid active side-chat identity')
  const activeSideChatId = (source.activeSideChatId ?? null) as SideChatId | null
  if (
    activeSideChatId !== null &&
    !chats.some((chat) => chat.sideChatId === activeSideChatId) &&
    !deletedSideChatIds.includes(activeSideChatId)
  )
    throw new Error('active side chat is absent from the list')
  return withRevision(
    Object.freeze({
      storageVersion: SIDE_CHAT_STORAGE_VERSION,
      mainSessionId,
      chats,
      deletedSideChatIds,
      activeSideChatId: chats.some((chat) => chat.sideChatId === activeSideChatId && chat.archived !== true)
        ? activeSideChatId
        : (chats.find((chat) => chat.archived !== true)?.sideChatId ?? null),
      visible: source.visible,
    }),
  )
}

/** Browser-local owner with immutable edits and optional Web-Lock compaction. */
export class SideChatStorage {
  private writable = true
  private stale = false
  private base: PersistedSideChatState | null = null
  private observed: readonly string[] = []
  private recovery: PersistedSideChatState | null = null
  private deletedRecovery: string | null = null
  private drainPending: Promise<void> = Promise.resolve()
  private draining = false
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()

  /** @param storage - Origin storage, or null when denied. @param mainSessionId - Association owner. @param coordination - Browser key enumeration and optional exclusive compaction; absent for a single-owner storage adapter. */
  constructor(
    private readonly storage: StorageLike | null,
    readonly mainSessionId: SessionId,
    private readonly coordination?: StorageCoordination,
  ) {}

  /** @returns Whether storage accepts recoverable edits. */
  get available(): boolean {
    return this.storage !== null && this.writable
  }

  /** @returns Whether conflicting edits currently block dependent mutations. */
  get outdated(): boolean {
    return this.stale
  }

  /** @returns Whether the most recent local edit is durable, including an unresolved journal. */
  get recoveryAvailable(): boolean {
    return this.recovery !== null || this.deletedRecovery !== null
  }

  /** @returns The last observed compacted generation. */
  get revision(): number {
    return this.base?.revision ?? 0
  }

  /** @param key - Storage event key, including null for a cleared origin. @returns Whether this association must be read again. */
  ownsKey(key: string | null): boolean {
    return (
      key === null ||
      key === this.key() ||
      key === this.legacyKey() ||
      key.startsWith(`${this.key()}:journal:`) ||
      key.startsWith(`${this.key()}:deleted:`) ||
      key.startsWith(`${this.key()}:recovery:`)
    )
  }

  /** @returns Durable permanent-association markers, independent of conflicting edit journals. */
  deletedIds(): readonly SideChatId[] {
    const keys =
      this.coordination?.keys() ??
      Array.from({ length: this.storage?.length ?? 0 }, (_, index) => this.storage?.key?.(index) ?? '')
    const prefix = `${this.key()}:deleted:`
    return keys
      .filter((key) => key.startsWith(prefix) && this.storage?.getItem(key) === '1')
      .map((key) => key.slice(prefix.length) as SideChatId)
  }

  /** @param sideChatId - Association whose Host Session is permanently deleted. @returns Whether the independent deletion marker is durable. */
  markDeleted(sideChatId: SideChatId): boolean {
    try {
      if (this.storage === null) return false
      this.storage.setItem(`${this.key()}:deleted:${sideChatId}`, '1')
      return true
    } catch (error: unknown) {
      // The caller retains the Host deletion state and offers cleanup retry.
      void error
      this.writable = false
      return false
    }
  }

  private excludeDeleted(state: PersistedSideChatState, ids = this.deletedIds()): PersistedSideChatState {
    const deleted = new Set([...(state.deletedSideChatIds ?? []), ...ids])
    const chats = state.chats.filter((chat) => !deleted.has(chat.sideChatId))
    return {
      ...state,
      chats,
      deletedSideChatIds: [...deleted],
      activeSideChatId: chats.some(
        (chat) => chat.sideChatId === state.activeSideChatId && chat.archived !== true,
      )
        ? state.activeSideChatId
        : (chats.find((chat) => chat.archived !== true)?.sideChatId ?? null),
    }
  }

  /** @returns Restored state, including durable unresolved local edits. @throws On denied or invalid stored data; no stored record is overwritten. */
  load(): PersistedSideChatState | null {
    const result = this.read()
    if (result.status === 'unavailable')
      throw new Error('Side-chat refresh recovery is unavailable; stored data was preserved.')
    const state = result.status === 'conflict' ? (result.state ?? this.recovery) : result.state
    if (state === null || (state.chats.length === 0 && this.storage?.getItem(this.key()) == null)) return null
    return readState(
      JSON.stringify(this.excludeDeleted(state)),
      this.mainSessionId,
      SIDE_CHAT_STORAGE_VERSION,
      true,
    )
  }

  private retainDeletedEdits(state: PersistedSideChatState, before: PersistedSideChatState): boolean {
    const deleted = new Set(this.deletedIds())
    const edits = state.chats.filter(
      (chat) =>
        deleted.has(chat.sideChatId) &&
        JSON.stringify(chat) !==
          JSON.stringify(before.chats.find((entry) => entry.sideChatId === chat.sideChatId)),
    )
    if (edits.length === 0) return false
    const raw = JSON.stringify({ ...state, chats: edits })
    if (raw !== this.deletedRecovery) {
      this.storage!.setItem(`${this.key()}:recovery:${crypto.randomUUID()}`, raw)
      this.deletedRecovery = raw
    }
    return true
  }

  /**
   * Save a local edit without replacing another page's unseen changes.
   * @param state - Local association, excluding official drafts, attachments and Host messages.
   * @returns Durable combined state, a durable unresolved conflict, or unavailable storage with local memory untouched.
   */
  save(state: PersistedSideChatState): SideChatSaveResult {
    if (!this.available || this.lifetime.signal.aborted) return { status: 'unavailable' }
    try {
      const originalBefore = this.base ?? this.empty()
      const deletedEdits = this.retainDeletedEdits(state, originalBefore)
      state = this.excludeDeleted(state)
      const before = this.excludeDeleted(originalBefore)
      if (this.stale) return { status: 'conflict', state }
      if (this.coordination !== undefined) {
        if (!sameState(before, state)) {
          const id = crypto.randomUUID()
          const journal: SideChatJournal = {
            version: 1,
            id,
            dependencies: this.observed,
            before,
            after: state,
          }
          this.storage!.setItem(`${this.key()}:journal:${id}`, JSON.stringify(journal))
          this.recovery = state
        }
        const result = this.read()
        if (deletedEdits && (result.status === 'saved' || result.status === 'merged')) {
          this.stale = true
          return { status: 'conflict', state: result.state }
        }
        this.scheduleDrain()
        return result.status === 'saved' && !sameState(result.state, state)
          ? { status: 'merged', state: result.state }
          : result
      }
      const incoming = this.excludeDeleted(this.stored())
      const merged = mergeSideChatStates(before, state, incoming)
      if (merged.status === 'conflict') {
        this.stale = true
        this.recovery = null
        return { status: 'conflict' }
      }
      const next = Object.freeze({ ...merged.state, revision: (incoming.revision ?? 0) + 1 })
      this.storage!.setItem(this.key(), JSON.stringify(next))
      this.base = next
      this.recovery = next
      this.stale = deletedEdits
      if (deletedEdits) return { status: 'conflict', state: next }
      return { status: sameState(state, next) ? 'saved' : 'merged', state: next }
    } catch (error) {
      // The failed write leaves both the durable records and the caller's local state intact.
      void error
      this.writable = false
      this.recovery = null
      return { status: 'unavailable' }
    }
  }

  /** @returns The latest logical record without writing or replaying admission; invalid data blocks edits. */
  synchronize(local?: PersistedSideChatState): SideChatSaveResult {
    if (!this.available) return { status: 'unavailable' }
    try {
      const deletedEdits = local !== undefined && this.retainDeletedEdits(local, this.base ?? this.empty())
      if (this.stale)
        return { status: 'conflict', ...(local === undefined ? {} : { state: this.excludeDeleted(local) }) }
      const result = this.read()
      if (deletedEdits && (result.status === 'saved' || result.status === 'merged')) {
        this.stale = true
        return { status: 'conflict', state: result.state }
      }
      this.scheduleDrain()
      return result
    } catch (error: unknown) {
      // A denied recovery write retains the caller's local edits and pauses further mutations.
      void error
      this.writable = false
      return { status: 'unavailable' }
    }
  }

  /** @param state - Local state retained through the failed write. @returns A renewed save attempt without discarding either page's edits. */
  retry(state: PersistedSideChatState): SideChatSaveResult {
    this.writable = true
    this.stale = false
    if (this.coordination !== undefined && this.recovery !== null && sameState(this.recovery, state))
      return this.synchronize()
    return this.save(state)
  }

  /** @param state - Current local state, including unsaved memory. @returns An export retaining this page and every available recovery record; no official draft or attachment is included. */
  exportRecovery(state: PersistedSideChatState): string {
    const records: Record<string, string> = {}
    try {
      const keys =
        this.coordination?.keys() ??
        Array.from({ length: this.storage?.length ?? 0 }, (_, index) => this.storage?.key?.(index) ?? '')
      for (const key of [
        this.key(),
        this.legacyKey(),
        ...this.journalKeys(),
        ...this.deletedIds().map((id) => `${this.key()}:deleted:${id}`),
        ...keys.filter((key) => key.startsWith(`${this.key()}:recovery:`)),
      ]) {
        const raw = this.storage?.getItem(key)
        if (raw != null) records[key] = raw
      }
    } catch (error) {
      // Denied reads still permit export of the caller's complete in-memory association.
      void error
    }
    return JSON.stringify({ version: 1, association: state, records }, null, 2)
  }

  /** @param listener - Observer of compaction failures. @returns Its lifetime disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @returns Completion of owned lock work; recovery journals survive cancellation. */
  async whenIdle(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.drainPending
      await pending
    } while (pending !== this.drainPending)
  }

  /** @returns Nothing; cancels queued compaction and notifications without deleting durable edits. */
  dispose(): void {
    this.lifetime.abort()
    this.listeners.clear()
  }

  private empty(): PersistedSideChatState {
    return {
      storageVersion: SIDE_CHAT_STORAGE_VERSION,
      mainSessionId: this.mainSessionId,
      chats: [],
      activeSideChatId: null,
      visible: false,
      revision: 0,
    }
  }

  private stored(): PersistedSideChatState {
    const current = this.storage!.getItem(this.key())
    if (current !== null) return readState(current, this.mainSessionId, SIDE_CHAT_STORAGE_VERSION)
    const legacy = this.storage!.getItem(this.legacyKey())
    return legacy === null ? this.empty() : readState(legacy, this.mainSessionId, 1)
  }

  private journalKeys(): readonly string[] {
    return (this.coordination?.keys() ?? []).filter((key) => key.startsWith(`${this.key()}:journal:`))
  }

  private journal(key: string): SideChatJournal {
    const raw = this.storage!.getItem(key)
    if (raw === null) throw new ChangedJournal()
    const parsed = record(JSON.parse(raw), 'journal')
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== 'string' ||
      key !== `${this.key()}:journal:${parsed.id}` ||
      !Array.isArray(parsed.dependencies) ||
      parsed.dependencies.some((id: unknown) => typeof id !== 'string')
    )
      throw new Error('invalid side-chat journal')
    return {
      version: 1,
      id: parsed.id,
      dependencies: parsed.dependencies as string[],
      before: readState(JSON.stringify(parsed.before), this.mainSessionId, SIDE_CHAT_STORAGE_VERSION),
      after: readState(JSON.stringify(parsed.after), this.mainSessionId, SIDE_CHAT_STORAGE_VERSION),
    }
  }

  private read(retries = 0): SideChatSaveResult {
    try {
      const raw = this.storage!.getItem(this.key())
      let state = raw === null ? this.stored() : readState(raw, this.mainSessionId, SIDE_CHAT_STORAGE_VERSION)
      const deleted = this.deletedIds()
      state = this.excludeDeleted(state, deleted)
      const journals = this.journalKeys().map((key) => this.journal(key))
      const applied = new Set(state.appliedJournalIds ?? [])
      const remaining = new Map(journals.map((entry) => [entry.id, entry]))
      const observed: string[] = journals.filter((entry) => applied.has(entry.id)).map((entry) => entry.id)
      for (const id of observed) remaining.delete(id)
      while (remaining.size > 0) {
        const entry = [...remaining.values()].find((item) =>
          item.dependencies.every((id) => !remaining.has(id)),
        )
        if (entry === undefined) throw new Error('cyclic side-chat journals')
        const result = mergeSideChatStates(
          this.excludeDeleted(entry.before, deleted),
          this.excludeDeleted(entry.after, deleted),
          state,
        )
        if (result.status === 'conflict') {
          this.stale = true
          this.recovery ??= entry.after
          return { status: 'conflict', state: this.excludeDeleted(this.recovery, deleted) }
        }
        applied.add(entry.id)
        state = { ...result.state, appliedJournalIds: [...applied] }
        observed.push(entry.id)
        remaining.delete(entry.id)
      }
      if (this.storage!.getItem(this.key()) !== raw) throw new ChangedJournal()
      this.base = state
      this.observed = observed
      this.stale = false
      return { status: 'saved', state }
    } catch (error) {
      if (error instanceof ChangedJournal && retries < 3) return this.read(retries + 1)
      this.writable = false
      return { status: 'unavailable' }
    }
  }

  private scheduleDrain(): void {
    if (
      this.draining ||
      this.stale ||
      !this.available ||
      this.lifetime.signal.aborted ||
      this.coordination?.runExclusive === undefined
    )
      return
    if (this.journalKeys().length === 0 && !this.compactDeletionPending()) return
    this.draining = true
    this.drainPending = this.coordination
      .runExclusive(
        this.key(),
        () => {
          if (this.lifetime.signal.aborted) return
          const result = this.read()
          if (result.status !== 'saved') {
            for (const listener of this.listeners) listener()
            return
          }
          if (
            this.observed.length === 0 &&
            this.storage!.getItem(this.key()) !== null &&
            !this.compactDeletionPending()
          )
            return
          const state = {
            ...result.state,
            revision: (result.state.revision ?? 0) + 1,
            appliedJournalIds: this.observed,
          }
          this.storage!.setItem(this.key(), JSON.stringify(state))
          this.base = state
          // Applied identities keep a reader from replaying an edit during partial journal deletion.
          for (const id of this.observed) this.storage!.removeItem(`${this.key()}:journal:${id}`)
          this.observed = []
        },
        this.lifetime.signal,
      )
      .catch((error: unknown) => {
        if (this.lifetime.signal.aborted) return
        // Journal writes remain durable, but dependent edits pause until the user retries.
        void error
        this.writable = false
        for (const listener of this.listeners) listener()
      })
      .finally(() => {
        this.draining = false
        if (this.lifetime.signal.aborted || !this.available || this.stale) return
        try {
          if (this.journalKeys().length > 0 || this.compactDeletionPending()) this.scheduleDrain()
        } catch (error: unknown) {
          // A denied key scan pauses compaction while immutable edits stay stored.
          void error
          this.writable = false
          for (const listener of this.listeners) listener()
        }
      })
  }

  private compactDeletionPending(): boolean {
    const saved = this.stored()
    const deleted = new Set(this.deletedIds())
    return (
      saved.chats.some((chat) => deleted.has(chat.sideChatId)) ||
      [...deleted].some((id) => !saved.deletedSideChatIds?.includes(id))
    )
  }

  private key(): string {
    return `${SIDE_CHAT_STORAGE_PREFIX}${this.mainSessionId}`
  }

  private legacyKey(): string {
    return `${LEGACY_SIDE_CHAT_STORAGE_PREFIX}${this.mainSessionId}`
  }
}

class ChangedJournal extends Error {}
