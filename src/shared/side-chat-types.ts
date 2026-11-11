/** Independent side-chat references and the immutable standard-message submission. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AnnotationSubmissionPayload,
  MessageIdentity,
  ProtocolLocale,
  SubmissionId,
  SubmittedAttachmentIdentity,
  TextQuoteSelector,
} from './types.ts'

/** Browser-created identity of one explicitly confirmed source occurrence. */
export type SideChatReferenceId = Branded<'SideChatReferenceId'>

/** Browser-created identity of one parallel side chat owned by a main Session. */
export type SideChatId = Branded<'SideChatId'>

/** A confirmed occurrence in one exact main-session assistant message. */
export interface SideChatReference {
  readonly referenceId: SideChatReferenceId
  readonly sourceSessionId: SessionId
  readonly messageId: MessageIdentity
  readonly messageSeq: number
  readonly responseVersion: MessageIdentity
  readonly quote: TextQuoteSelector
  readonly createdAt: number
}

/** Internal command name; the existing annotation command still owns attachment preflight. */
export const SIDE_CHAT_COMMAND_NAME = 'annotation_side_chat_submit'
/** Independent version domain, stored only in standard user-message source metadata. */
export const SIDE_CHAT_PROTOCOL_VERSION = 1 as const
/** Identifies the side-reference protocol without treating references as annotations. */
export const SIDE_CHAT_PROTOCOL_SOURCE = 'dsh-annotation-side-chat' as const
/** Existing-event projection that remembers accepted submission fingerprints. */
export const SIDE_CHAT_RECEIPTS_PROJECTION = 'annotationSideChatReceipts' as const
/** Browser-owned association record version; v2 adds parallel chats beside the v1 single chat. */
export const SIDE_CHAT_STORAGE_VERSION = 2 as const

/** Everything the model sees in one side-chat request, frozen before transport. */
export interface SideChatSubmissionPayload {
  readonly protocolVersion: typeof SIDE_CHAT_PROTOCOL_VERSION
  readonly source: typeof SIDE_CHAT_PROTOCOL_SOURCE
  readonly submissionId: SubmissionId
  readonly mainSessionId: SessionId
  readonly sideSessionId: SessionId
  readonly delivery: 'queue'
  readonly createdAt: number
  readonly protocolLocale: ProtocolLocale
  readonly question: string
  readonly references: readonly SideChatReference[]
  readonly attachmentIdentities: readonly SubmittedAttachmentIdentity[]
  /** Separate annotation semantics sharing the same standard user message. */
  readonly annotationSubmission?: AnnotationSubmissionPayload
}

/** Standard user-message source; the annotation reader sees its ordinary field when present. */
export interface SideChatMessageSource {
  readonly kind: 'user'
  readonly sideChatSubmission: SideChatSubmissionPayload
  readonly annotationSubmission?: AnnotationSubmissionPayload
}

/** Fingerprints survive queue consumption and model-history compaction. */
export interface SideChatReceiptState {
  readonly receipts: Readonly<Record<string, string>>
}

/** Stable admission categories transported separately from localized UI text. */
export type SideChatCommandFailureCode =
  'payload' | 'target' | 'attachments' | 'identity-conflict' | 'historical-source' | 'admission'

/** Structured result carried by the existing command's text field. */
export interface SideChatCommandReceipt {
  readonly protocolVersion: 1
  readonly source: 'dsh-annotation-side-chat-result'
  readonly kind: 'accepted' | 'duplicate' | 'rejected' | 'unknown'
  readonly submissionId?: SubmissionId
  readonly code?: SideChatCommandFailureCode
}

/** Browser-owned transport state; unknown outcomes cannot be retried automatically. */
export interface SideChatOutbox {
  readonly payload: SideChatSubmissionPayload
  readonly status: 'ready' | 'sending' | 'accepted' | 'failed' | 'unknown'
  /** A conflicting accepted identity remains blocked after browser recovery. */
  readonly failureCode?: 'receipt-conflict'
}

/** One parallel side chat: its ordinary Session plus this browser's pending occurrences. */
export interface PersistedSideChatEntry {
  readonly sideChatId: SideChatId
  readonly sideSessionId: SessionId | null
  readonly created: boolean
  readonly title?: string
  /** Official archive state; absent released records are active until Host reconciliation. */
  readonly archived?: boolean
  readonly references: readonly SideChatReference[]
  /** Saved source occurrences, including those already consumed by a submission. */
  readonly referenceRecords?: readonly SideChatReference[]
  /** Append-only occurrence order keeps bubble numbers stable after removal. */
  readonly referenceRecordIds?: readonly SideChatReferenceId[]
  /** Removed source occurrences cannot be recovered by an older page or Session history. */
  readonly removedReferenceIds?: readonly SideChatReferenceId[]
  readonly outbox: SideChatOutbox | null
  /** Whether this chat's compact reference record panel is expanded; absent in released v2 records. */
  readonly panelOpen?: boolean
}

/** Browser-local association and pending references; the Host owns chat history and input drafts. */
export interface PersistedSideChatState {
  readonly storageVersion: typeof SIDE_CHAT_STORAGE_VERSION
  readonly mainSessionId: SessionId
  /** Chats in stable creation order; the active one receives newly confirmed references. */
  readonly chats: readonly PersistedSideChatEntry[]
  readonly activeSideChatId: SideChatId | null
  readonly visible: boolean
  /** Permanently removed associations; unioned across pages so stale edits cannot restore them. */
  readonly deletedSideChatIds?: readonly SideChatId[]
  /** Monotonic write generation; absent in released v2 records, which start at zero. */
  readonly revision?: number
  /** Journals included in the compact record, retained until their storage keys are gone. */
  readonly appliedJournalIds?: readonly string[]
}
