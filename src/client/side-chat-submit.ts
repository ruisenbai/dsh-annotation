/** Admission of frozen side references through the existing composer command claim. */
import type { SubmitAttachment } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { sameAttachmentIdentities } from '../shared/protocol.ts'
import {
  parseSideChatCommandReceipt,
  parseSideChatSubmissionPayload,
  validateSideChatSubmissionLimits,
} from '../shared/side-chat-protocol.ts'
import {
  SIDE_CHAT_PROTOCOL_SOURCE,
  SIDE_CHAT_PROTOCOL_VERSION,
  type SideChatReference,
  type SideChatOutbox,
  type SideChatSubmissionPayload,
} from '../shared/side-chat-types.ts'
import type {
  AnnotationConfig,
  AnnotationSubmissionPayload,
  OutboxAttachments,
  ProtocolLocale,
  SessionIdentity,
  SubmittedAttachmentIdentity,
} from '../shared/types.ts'
import {
  retryEntry,
  selectedAnnotations,
  type AnnotationController,
  type AnnotationView,
} from './controller.ts'
import { SideChatFailure, type SideChatController } from './side-chat-controller.ts'
import type { SideChatId } from '../shared/side-chat-types.ts'

/** Session-addressed effects captured at the start of one official composer submission. */
export interface SideChatSend {
  readonly owner: SideChatController
  /** Receiving chat; omission uses the owner's active chat. */
  readonly sideChatId?: SideChatId
  readonly annotations: AnnotationController
  readonly annotationSnapshot?: AnnotationView
  readonly references: readonly SideChatReference[]
  readonly outbox: SideChatOutbox | null
  readonly question: string
  readonly attachments: readonly SubmitAttachment[]
  readonly attachmentMetadata?: OutboxAttachments
  readonly protocolLocale: ProtocolLocale
  readonly config: AnnotationConfig
  readonly signal: AbortSignal
  readonly available: () => boolean
  readonly prepareAttachments: () => Promise<readonly SubmittedAttachmentIdentity[]>
  readonly execute: (payload: SideChatSubmissionPayload) => Promise<string | undefined>
  readonly t: PropsLocale<'dshAnnotation'>['t']
}

/**
 * Submit the captured references and optional annotations as one standard side-session message.
 * @param request - Frozen input and effects owned by this Session and feature lifetime.
 * @returns Completion only after a matching receipt; failures leave the Host composer unchanged.
 */
export async function submitSideChat(request: SideChatSend): Promise<void> {
  const { owner, annotations, signal, t } = request
  const assertAvailable = (): void => {
    if (signal.aborted) throw new SideChatFailure('disposed')
    if (!request.available() || owner.chatView(request.sideChatId)?.status !== 'ready')
      throw new SideChatFailure('unavailable')
  }
  assertAvailable()
  const previous = request.outbox
  if (previous !== null && (previous.status === 'sending' || previous.payload.question !== request.question))
    throw new SideChatFailure('frozen')
  if (owner.chatView(request.sideChatId)?.failure?.code === 'receipt-conflict')
    throw new SideChatFailure('receipt-conflict')
  const identities = await request.prepareAttachments()
  assertAvailable()
  if (previous !== null && !sameAttachmentIdentities(previous.payload.attachmentIdentities, identities))
    throw new Error(t('error.retryAttachmentsChanged'))
  if (previous !== null && owner.chatView(request.sideChatId)?.outbox === null) {
    if (previous.payload.annotationSubmission !== undefined)
      annotations.markAccepted(previous.payload.submissionId)
    return
  }
  const validate = (payload: SideChatSubmissionPayload): void => {
    try {
      validateSideChatSubmissionLimits(payload, request.config)
    } catch (cause: unknown) {
      const count = payload.references.length + (payload.annotationSubmission?.annotations.length ?? 0)
      throw new Error(
        t(count > request.config.maxAnnotationsPerSubmission ? 'error.items' : 'error.payload'),
        { cause },
      )
    }
  }
  let annotationSubmission: AnnotationSubmissionPayload | undefined = previous?.payload.annotationSubmission
  const snapshot = request.annotationSnapshot
  if (
    previous === null &&
    snapshot !== undefined &&
    (retryEntry(snapshot) !== undefined || selectedAnnotations(snapshot).length > 0)
  ) {
    const sideId = owner.chatView(request.sideChatId)!.sideSessionId!
    const entry = annotations.createOutbox(
      'queue',
      String(sideId) as SessionIdentity,
      '',
      request.attachmentMetadata,
      request.protocolLocale,
      snapshot,
      identities,
      (payload) =>
        validate(
          parseSideChatSubmissionPayload({
            protocolVersion: SIDE_CHAT_PROTOCOL_VERSION,
            source: SIDE_CHAT_PROTOCOL_SOURCE,
            submissionId: payload.submissionId,
            mainSessionId: owner.mainSessionId,
            sideSessionId: sideId,
            delivery: 'queue',
            createdAt: payload.createdAt,
            protocolLocale: request.protocolLocale,
            question: request.question,
            references: request.references,
            attachmentIdentities: identities,
            annotationSubmission: payload,
          }),
        ),
    )
    annotationSubmission = entry.payload
  }
  const payload = owner.snapshotSubmission(
    {
      question: request.question,
      protocolLocale: request.protocolLocale,
      attachmentIdentities: identities,
      references: request.references,
      ...(annotationSubmission === undefined ? {} : { annotationSubmission }),
      retry: previous !== null,
      validate,
    },
    request.sideChatId,
  )
  assertAvailable()
  owner.markSending(payload.submissionId, request.sideChatId)
  if (annotationSubmission !== undefined) annotations.markSending(payload.submissionId)
  let result: string | undefined
  try {
    result = await request.execute(payload)
  } catch (cause: unknown) {
    if (signal.aborted) throw new SideChatFailure('disposed', cause)
    if (!request.available() || owner.chatView(request.sideChatId)?.status !== 'ready')
      throw new SideChatFailure('unavailable', cause)
    if (owner.chatView(request.sideChatId)?.failure?.code === 'receipt-conflict')
      throw new SideChatFailure('receipt-conflict', cause)
    if (owner.chatView(request.sideChatId)?.outbox === null) {
      if (annotationSubmission !== undefined) annotations.markAccepted(payload.submissionId)
      return
    }
    owner.markUnknown(payload.submissionId, cause, request.sideChatId)
    throw new SideChatFailure('send-unknown', cause)
  }
  assertAvailable()
  if (owner.chatView(request.sideChatId)?.failure?.code === 'receipt-conflict')
    throw new SideChatFailure('receipt-conflict')
  const receipt = parseSideChatCommandReceipt(result)
  if (
    owner.chatView(request.sideChatId)?.outbox === null ||
    (receipt?.submissionId === payload.submissionId &&
      (receipt.kind === 'accepted' || receipt.kind === 'duplicate'))
  ) {
    owner.markAccepted(payload.submissionId, request.sideChatId)
    if (annotationSubmission !== undefined) annotations.markAccepted(payload.submissionId)
    return
  }
  if (receipt?.submissionId !== undefined && receipt.submissionId !== payload.submissionId) {
    owner.markUnknown(payload.submissionId, receipt, request.sideChatId)
    throw new SideChatFailure('send-unknown')
  }
  if (receipt?.code === 'identity-conflict') {
    owner.markConflict(payload.submissionId, undefined, request.sideChatId)
    throw new SideChatFailure('receipt-conflict')
  }
  if (
    receipt?.kind === 'rejected' &&
    (receipt.submissionId === undefined || receipt.submissionId === payload.submissionId)
  ) {
    owner.markFailed(payload.submissionId, receipt.code, request.sideChatId)
    if (annotationSubmission !== undefined)
      annotations.markFailed(payload.submissionId, t('sideChat.failure.send-failed'))
    throw new SideChatFailure('send-failed')
  }
  owner.markUnknown(payload.submissionId, receipt?.code, request.sideChatId)
  throw new SideChatFailure('send-unknown')
}
