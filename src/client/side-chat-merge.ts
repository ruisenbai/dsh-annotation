/** Three-way reconciliation of browser-owned side-chat records; transport identities never merge implicitly. */
import type {
  PersistedSideChatEntry,
  PersistedSideChatState,
  SideChatOutbox,
  SideChatReference,
} from '../shared/side-chat-types.ts'
import { sideChatSubmissionFingerprint } from '../shared/side-chat-protocol.ts'

/** A merge either preserves both pages' changes or leaves both inputs for explicit recovery. */
export type SideChatMergeResult =
  { readonly status: 'merged'; readonly state: PersistedSideChatState } | { readonly status: 'conflict' }

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

class MergeConflict extends Error {}

function value<T>(before: T, local: T, incoming: T): T {
  if (same(local, before)) return incoming
  if (same(incoming, before) || same(local, incoming)) return local
  throw new MergeConflict()
}

function references(
  before: readonly SideChatReference[],
  local: readonly SideChatReference[],
  incoming: readonly SideChatReference[],
): readonly SideChatReference[] {
  const base = new Map(before.map((item) => [item.referenceId, item]))
  const mine = new Map(local.map((item) => [item.referenceId, item]))
  const theirs = new Map(incoming.map((item) => [item.referenceId, item]))
  const ids = new Set([...theirs.keys(), ...mine.keys(), ...base.keys()])
  const result: SideChatReference[] = []
  for (const id of ids) {
    const merged = value(base.get(id), mine.get(id), theirs.get(id))
    if (merged !== undefined) result.push(merged)
  }
  return Object.freeze(result.sort((left, right) => left.createdAt - right.createdAt))
}

function outbox(
  before: SideChatOutbox | null,
  local: SideChatOutbox | null,
  incoming: SideChatOutbox | null,
): SideChatOutbox | null {
  if (same(local, before)) return incoming
  if (same(incoming, before) || same(local, incoming)) return local
  // A consumed request wins over a late status update for that same request.
  if (before !== null && (local === null || incoming === null)) {
    const retained = local ?? incoming
    if (retained?.payload.submissionId === before.payload.submissionId) return null
    return retained
  }
  if (
    local === null ||
    incoming === null ||
    sideChatSubmissionFingerprint(local.payload) !== sideChatSubmissionFingerprint(incoming.payload)
  )
    throw new MergeConflict()
  if (local.failureCode === 'receipt-conflict') return local
  if (incoming.failureCode === 'receipt-conflict') return incoming
  // Uncertain admission must remain uncertain until the Host receipt is read.
  const order: readonly SideChatOutbox['status'][] = ['ready', 'failed', 'accepted', 'sending', 'unknown']
  return order.indexOf(local.status) > order.indexOf(incoming.status) ? local : incoming
}

function chat(
  before: PersistedSideChatEntry | undefined,
  local: PersistedSideChatEntry | undefined,
  incoming: PersistedSideChatEntry | undefined,
): PersistedSideChatEntry | undefined {
  if (same(local, before)) return incoming
  if (same(incoming, before) || same(local, incoming)) return local
  if (local === undefined || incoming === undefined) throw new MergeConflict()
  const sideSessionId = value(before?.sideSessionId ?? null, local.sideSessionId, incoming.sideSessionId)
  const mergedOutbox = outbox(before?.outbox ?? null, local.outbox, incoming.outbox)
  let mergedReferences = references(before?.references ?? [], local.references, incoming.references)
  if (before?.outbox != null && mergedOutbox === null) {
    const sent = new Set(before.outbox.payload.references.map((item) => item.referenceId))
    mergedReferences = Object.freeze(mergedReferences.filter((item) => !sent.has(item.referenceId)))
  }
  const removed = new Set([
    ...(before?.removedReferenceIds ?? []),
    ...(local.removedReferenceIds ?? []),
    ...(incoming.removedReferenceIds ?? []),
  ])
  const recordIds = [
    ...new Set([
      ...(before?.referenceRecordIds ?? []),
      ...(incoming.referenceRecordIds ??
        (incoming.referenceRecords ?? incoming.references).map((item) => item.referenceId)),
      ...(local.referenceRecordIds ??
        (local.referenceRecords ?? local.references).map((item) => item.referenceId)),
    ]),
  ]
  const title = local.title === before?.title ? incoming.title : local.title
  return Object.freeze({
    sideChatId: local.sideChatId,
    sideSessionId,
    created: local.created || incoming.created,
    ...(title === undefined ? {} : { title }),
    archived: value(before?.archived ?? false, local.archived ?? false, incoming.archived ?? false),
    panelOpen: local.panelOpen ?? false,
    references: Object.freeze(mergedReferences.filter((item) => !removed.has(item.referenceId))),
    referenceRecordIds: recordIds,
    removedReferenceIds: [...removed],
    referenceRecords: references(
      before?.referenceRecords ?? before?.references ?? [],
      local.referenceRecords ?? local.references,
      incoming.referenceRecords ?? incoming.references,
    ).filter((item) => !removed.has(item.referenceId)),
    outbox: mergedOutbox,
  })
}

/**
 * Apply changes since one page's last observed record to the current record.
 * @param before - That page's observed state, before its local changes.
 * @param local - Its latest state, including additions, removals and frozen requests.
 * @param incoming - Current browser state, including other pages' changes.
 * @returns A combined record, or a conflict for incompatible Session/request identities or delete/edit races.
 */
export function mergeSideChatStates(
  before: PersistedSideChatState,
  local: PersistedSideChatState,
  incoming: PersistedSideChatState,
): SideChatMergeResult {
  const deleted = new Set([
    ...(before.deletedSideChatIds ?? []),
    ...(local.deletedSideChatIds ?? []),
    ...(incoming.deletedSideChatIds ?? []),
  ])
  const base = new Map(before.chats.map((entry) => [entry.sideChatId, entry]))
  const mine = new Map(local.chats.map((entry) => [entry.sideChatId, entry]))
  const theirs = new Map(incoming.chats.map((entry) => [entry.sideChatId, entry]))
  const ids = new Set([...theirs.keys(), ...mine.keys(), ...base.keys()])
  try {
    const chats: PersistedSideChatEntry[] = []
    for (const id of ids) {
      if (deleted.has(id)) continue
      const entry = chat(base.get(id), mine.get(id), theirs.get(id))
      if (entry !== undefined) chats.push(entry)
    }
    const selected =
      local.activeSideChatId === before.activeSideChatId ? incoming.activeSideChatId : local.activeSideChatId
    const active = chats.filter((entry) => entry.archived !== true)
    return {
      status: 'merged',
      state: Object.freeze({
        storageVersion: local.storageVersion,
        mainSessionId: local.mainSessionId,
        chats: Object.freeze(chats),
        deletedSideChatIds: Object.freeze([...deleted]),
        activeSideChatId: active.some((entry) => entry.sideChatId === selected)
          ? selected
          : (active[0]?.sideChatId ?? null),
        visible: local.visible === before.visible ? incoming.visible : local.visible,
        revision: Math.max(before.revision ?? 0, incoming.revision ?? 0),
      }),
    }
  } catch (error) {
    if (error instanceof MergeConflict) return { status: 'conflict' }
    throw error
  }
}
