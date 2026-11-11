/** Cross-Conversation source captures and idempotent conversion of pending side references. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatId, SideChatReference } from '../shared/side-chat-types.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity, SessionIdentity } from '../shared/types.ts'
import { sha256Hex } from '../shared/snapshot-hash.ts'
import type { AnnotationController } from './controller.ts'
import type { SelectionCapture } from './selection.ts'
import type { SideChatController } from './side-chat-controller.ts'

/**
 * Keep the source identity while the receiving chat prepares independently.
 * @param capture - A confirmed selection in a settled assistant reply.
 * @param sourceSessionId - Original Conversation, never the receiving side chat.
 * @returns A capture whose source survives reload, sending and navigation.
 */
export function sideAnnotationCapture(
  capture: SelectionCapture,
  sourceSessionId: SessionId,
): Extract<SelectionCapture, { readonly messageId: MessageIdentity }> {
  if (capture.source !== undefined && capture.source.kind !== 'message')
    throw new Error('Side annotations require a message selection')
  return Object.freeze({
    ...capture,
    messageId: capture.messageId!,
    messageSeq: capture.messageSeq!,
    responseVersion: capture.responseVersion!,
    source: Object.freeze({
      kind: 'message' as const,
      sessionId: String(sourceSessionId) as SessionIdentity,
      messageId: capture.messageId!,
      messageSeq: capture.messageSeq!,
      responseVersion: capture.responseVersion!,
    }),
  })
}

/**
 * Convert a pending reference without inventing an opinion or changing the selected occurrence.
 * @param reference - Browser-local legacy occurrence.
 * @param target - Receiving Session; it participates in the deterministic annotation identity.
 * @returns An unsent highlight-only annotation with its original creation time and source.
 */
export function referenceAnnotation(reference: SideChatReference, target: SessionIdentity): AnnotationDraft {
  const { messageId, messageSeq, responseVersion } = reference
  return Object.freeze({
    annotationId: `ann-side-${sha256Hex(JSON.stringify([target, reference.referenceId]))}` as AnnotationId,
    ordinal: 1,
    messageId,
    messageSeq,
    responseVersion,
    source: {
      kind: 'message' as const,
      sessionId: String(reference.sourceSessionId) as SessionIdentity,
      messageId,
      messageSeq,
      responseVersion,
    },
    quote: reference.quote,
    annotation: '',
    kind: 'highlight-only' as const,
    status: 'draft' as const,
    createdAt: reference.createdAt,
    updatedAt: reference.createdAt,
  })
}

/**
 * Commit annotation copies before retiring pending reference records; frozen requests stay untouched.
 * @param owner - Legacy association and retry owner.
 * @param chatId - Exact receiving chat.
 * @param annotations - That chat's annotation controller.
 * @returns Whether conversion is complete or safely deferred for a frozen request; false retains old data.
 */
export function migrateSideReferences(
  owner: SideChatController,
  chatId: SideChatId,
  annotations: AnnotationController,
): boolean {
  const chat = owner.chatView(chatId)
  if (chat === null || chat.outbox !== null || chat.references.length === 0) return true
  if (
    !owner.lastSaveSucceeded ||
    !annotations.importPendingAnnotations(
      chat.references.map((reference) => referenceAnnotation(reference, annotations.sessionId)),
    )
  )
    return false
  owner.retireMigratedReferences(
    chat.references.map((reference) => reference.referenceId),
    chatId,
  )
  return owner.lastSaveSucceeded
}
