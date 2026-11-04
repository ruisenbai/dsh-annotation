/** Display order for annotation records, independent of source ordinals and frozen submissions. */
import type { AnnotationDraft } from '../shared/types.ts'
import type { AnnotationView } from './controller.ts'

/**
 * Order all records newest first, independently of attachment selection and delivery.
 * Equal creation times use annotation IDs, independently of storage order and later edits.
 * @param view Saved records; extra view fields do not affect display order.
 * @returns A new array retaining each record's identity, content, and ordinal.
 */
export function orderedRecords(
  view: Pick<AnnotationView, 'annotations' | 'selectedAnnotationIds' | 'outbox'>,
): readonly AnnotationDraft[] {
  return [...view.annotations].sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      (left.annotationId < right.annotationId ? -1 : left.annotationId > right.annotationId ? 1 : 0),
  )
}
