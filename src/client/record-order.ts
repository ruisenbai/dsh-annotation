/** Display order for annotation records, independent of source ordinals and frozen submissions. */
import { isOutboxPayloadEntry } from '../shared/outbox-redaction.ts'
import type { AnnotationDraft } from '../shared/types.ts'
import type { AnnotationView } from './controller.ts'

/**
 * Put attached or unfinished submissions before other drafts, then history, newest first in each group.
 * Equal creation times use annotation IDs, independently of storage order and later edits.
 * @param view Saved records, local attachment selection, and frozen submission states.
 * @returns A new array retaining each record's identity, content, and ordinal.
 */
export function orderedRecords(
  view: Pick<AnnotationView, 'annotations' | 'selectedAnnotationIds' | 'outbox'>,
): readonly AnnotationDraft[] {
  const active = new Set(view.selectedAnnotationIds)
  for (const entry of view.outbox) {
    if (!isOutboxPayloadEntry(entry) || entry.status === 'sent' || entry.status === 'withdrawn') continue
    for (const annotation of entry.payload.annotations) active.add(annotation.annotationId)
  }
  const priority = (item: AnnotationDraft): number => {
    if (item.source?.kind === 'diff') return 2
    if (active.has(item.annotationId) || item.status === 'queued') return 0
    return item.status === 'draft' ? 1 : 2
  }
  return [...view.annotations].sort(
    (left, right) =>
      priority(left) - priority(right) ||
      right.createdAt - left.createdAt ||
      (left.annotationId < right.annotationId ? -1 : left.annotationId > right.annotationId ? 1 : 0),
  )
}
