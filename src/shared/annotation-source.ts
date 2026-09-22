/** Message selectors remain readable; Diff selectors never manufacture a message id. */
import type { DiffSource } from './diff-source.ts'
import type { MessageIdentity } from './types.ts'

/** A selection from a specific rendered message version. */
export interface MessageAnnotationSource {
  readonly kind: 'message'
  readonly messageId: MessageIdentity
  readonly messageSeq: number
  readonly responseVersion: MessageIdentity
}
/** Message and real Git coordinates have disjoint identities. */
export type AnnotationSource = MessageAnnotationSource | DiffSource
/** Legacy message aliases remain readable but are forbidden on Diff records. */
export type AnnotationAnchor =
  | {
      /** Optional only for legacy v1/v2 message records. New writes include the discriminator. */
      readonly source?: MessageAnnotationSource
      readonly messageId: MessageIdentity
      readonly messageSeq: number
      readonly responseVersion: MessageIdentity
    }
  | {
      readonly source: DiffSource
      readonly messageId?: never
      readonly messageSeq?: never
      readonly responseVersion?: never
    }

/** Project only source fields, retaining legacy message aliases for old consumers.
 * @param value - A decoded annotation or selection.
 * @returns An explicit source plus message aliases only when applicable.
 */
export function sourceFields(value: AnnotationAnchor): AnnotationAnchor {
  if (value.source?.kind === 'diff') return { source: value.source }
  const messageId = value.messageId!
  const messageSeq = value.messageSeq!
  const responseVersion = value.responseVersion!
  return {
    messageId,
    messageSeq,
    responseVersion,
    source: { kind: 'message', messageId, messageSeq, responseVersion },
  }
}

/** Source identity includes the version and side, not merely the file name.
 * @param value - A decoded annotation or selection.
 * @returns A grouping key for overlapping selections on the same source.
 */
export function sourceKey(value: AnnotationAnchor): string {
  const source = value.source
  return source?.kind === 'diff' ? `diff:${source.snapshot.id}:${source.side}` : `message:${value.messageId}`
}
