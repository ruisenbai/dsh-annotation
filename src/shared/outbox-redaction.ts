/**
 * Remove annotation content from terminal submission records after permanent deletion.
 *
 * Deliverable batches keep their exact protocol payload. A terminal batch containing any
 * permanently deleted annotation becomes a content-free receipt instead of filtering or
 * renumbering its payload, so surviving annotation records retain their original batch ordinals.
 *
 * @module dsh-annotation/outbox-redaction
 */
import type {
  AnnotationDeletionMark,
  AnnotationId,
  OutboxEntry,
  OutboxPayloadEntry,
  OutboxReceiptEntry,
  PersistedEditorDraft,
  PersistedSessionState,
  SubmissionId,
} from './types.ts'

/** Whether a durable outbox row still owns a protocol payload. */
export function isOutboxPayloadEntry(entry: OutboxEntry): entry is OutboxPayloadEntry {
  return 'payload' in entry
}

/** Stable submission identity shared by payload rows and content-free receipts. */
export function outboxSubmissionId(entry: OutboxEntry): SubmissionId {
  return isOutboxPayloadEntry(entry) ? entry.payload.submissionId : entry.submissionId
}

/** Statuses that are never transported again and may be reduced to receipts. */
export function isEndedOutboxStatus(status: OutboxEntry['status']): status is 'sent' | 'withdrawn' {
  return status === 'sent' || status === 'withdrawn'
}

/** Annotation ids whose content must not remain in any local copy. */
export function purgedAnnotationIds(
  marks: readonly AnnotationDeletionMark[] | undefined,
): ReadonlySet<AnnotationId> {
  const purged = new Set<AnnotationId>()
  for (const mark of marks ?? []) if (mark.state === 'purged') purged.add(mark.annotationId)
  return purged
}

/** Convert a terminal payload row to its content-free durable receipt. */
export function toOutboxReceipt(entry: OutboxPayloadEntry): OutboxReceiptEntry {
  if (!isEndedOutboxStatus(entry.status)) throw new Error('active outbox payload cannot become a receipt')
  return Object.freeze({
    kind: 'receipt',
    submissionId: entry.payload.submissionId,
    targetSessionId: entry.targetSessionId,
    messageId: entry.messageId,
    status: entry.status,
    attempts: entry.attempts,
  })
}

/**
 * Remove a terminal batch payload when any member has been permanently deleted.
 *
 * @param entry - Durable payload or receipt.
 * @param purged - Annotation ids carrying a `purged` deletion mark.
 * @returns The same entry when no content is affected, otherwise a content-free receipt.
 */
export function redactOutboxEntry(entry: OutboxEntry, purged: ReadonlySet<AnnotationId>): OutboxEntry {
  if (
    purged.size === 0 ||
    !isOutboxPayloadEntry(entry) ||
    !isEndedOutboxStatus(entry.status) ||
    !entry.payload.annotations.some((item) => purged.has(item.annotationId))
  )
    return entry
  return toOutboxReceipt(entry)
}

/** Rewrite an immutable outbox list against durable deletion marks. */
export function redactOutbox(
  outbox: readonly OutboxEntry[],
  marks: readonly AnnotationDeletionMark[] | undefined,
): readonly OutboxEntry[] {
  return redactOutboxIds(outbox, purgedAnnotationIds(marks))
}

function redactOutboxIds(
  outbox: readonly OutboxEntry[],
  purged: ReadonlySet<AnnotationId>,
): readonly OutboxEntry[] {
  if (purged.size === 0) return outbox
  let changed = false
  const redacted = outbox.map((entry) => {
    const next = redactOutboxEntry(entry, purged)
    if (next !== entry) changed = true
    return next
  })
  return changed ? Object.freeze(redacted) : outbox
}

function keepsEditor(editor: PersistedEditorDraft, purged: ReadonlySet<AnnotationId>): boolean {
  if (editor.kind === 'edit') return !purged.has(editor.annotationId)
  return (
    (editor.draftId === undefined || !purged.has(editor.draftId)) &&
    (editor.supplementalTo === undefined || !purged.has(editor.supplementalTo))
  )
}

/**
 * Remove every local content copy of permanently deleted records from one persisted state.
 *
 * This runs before journal writes and after journal merges. Purged deletion marks remain as the
 * minimal durable state that prevents an older page or history replay from restoring content.
 */
export function redactStoredState(
  state: PersistedSessionState,
  purged: ReadonlySet<AnnotationId>,
): PersistedSessionState {
  if (purged.size === 0) return state
  const outbox = redactOutboxIds(state.outbox, purged)
  const annotations = state.annotations.some((item) => purged.has(item.annotationId))
    ? Object.freeze(state.annotations.filter((item) => !purged.has(item.annotationId)))
    : state.annotations
  const trash =
    state.trash !== undefined && state.trash.some((entry) => purged.has(entry.annotation.annotationId))
      ? Object.freeze(state.trash.filter((entry) => !purged.has(entry.annotation.annotationId)))
      : state.trash
  const keep = (editor: PersistedEditorDraft): boolean => keepsEditor(editor, purged)
  const { editorDraft: storedEditorDraft, ...stateWithoutEditorDraft } = state
  const editorDraft =
    storedEditorDraft !== undefined && !keep(storedEditorDraft) ? undefined : storedEditorDraft
  const editorDrafts =
    state.editorDrafts !== undefined && state.editorDrafts.some((editor) => !keep(editor))
      ? Object.freeze(state.editorDrafts.filter(keep))
      : state.editorDrafts
  const selectedAnnotationIds =
    state.selectedAnnotationIds !== undefined && state.selectedAnnotationIds.some((id) => purged.has(id))
      ? Object.freeze(state.selectedAnnotationIds.filter((id) => !purged.has(id)))
      : state.selectedAnnotationIds
  if (
    outbox === state.outbox &&
    annotations === state.annotations &&
    trash === state.trash &&
    editorDraft === state.editorDraft &&
    editorDrafts === state.editorDrafts &&
    selectedAnnotationIds === state.selectedAnnotationIds
  )
    return state
  return Object.freeze({
    ...stateWithoutEditorDraft,
    annotations,
    outbox,
    ...(trash === undefined ? {} : { trash }),
    ...(editorDraft === undefined ? {} : { editorDraft }),
    ...(editorDrafts === undefined ? {} : { editorDrafts }),
    ...(selectedAnnotationIds === undefined ? {} : { selectedAnnotationIds }),
  })
}
