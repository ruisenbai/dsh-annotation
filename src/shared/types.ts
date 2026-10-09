import type { AnnotationAnchor } from './annotation-source.ts'
/** JSON protocol shared by the Host command bridge and browser client. */

import type { ImageBlock } from '@deepseek-ai/dsh-llm'

/** Internal command input that resolves attachment identities without submitting a message. */
export const ATTACHMENT_PREPARE_INPUT = 'prepare-attachments'
/** Shared transport diagnostic; the Client presents its localized equivalent. */
export const ATTACHMENT_IDENTITY_MISMATCH = 'Annotation attachments differ from the frozen submission.'

/** Ordered identity of one admitted attachment; excludes raw content and temporary upload receipts. */
export type SubmittedAttachmentIdentity =
  | {
      readonly type: 'image'
      readonly attachmentId: ImageBlock['attachment']['attachmentId']
      readonly bytes: number
      readonly mediaType: ImageBlock['attachment']['mediaType']
      readonly name?: string
    }
  | {
      readonly type: 'file'
      readonly attachmentId: ImageBlock['attachment']['attachmentId']
      readonly bytes: number
      readonly name: string
    }

/** Current submission protocol; v5 stores compact official file and turn-Diff sources. */
export const PROTOCOL_VERSION = 5 as const
/** Protocol source identity written into every non-v1 payload. */
export const PROTOCOL_SOURCE = 'dsh-annotation' as const
/** Acknowledgement marker prefix emitted into new model prompts. */
export const MODEL_ACK_PREFIX = 'dsh-annotation:'
/** Pre-rename acknowledgement prefixes still parsed from durable history. */
export const LEGACY_MODEL_ACK_PREFIXES = ['dsh-inline-comments:', 'dsh-inline-annotations:'] as const
/** Reply-association marker prefix emitted into new model prompts. */
export const REPLY_MARKER_PREFIX = 'dsh-annotation-reply:'
/** Pre-rename reply markers still parsed from durable history. */
export const LEGACY_REPLY_MARKER_PREFIXES = [
  'dsh-inline-comments-reply:',
  'dsh-inline-annotations-reply:',
] as const
/** Stable across the product rename so failed persisted retries keep their authoritative queue identity. */
export const MESSAGE_ID_PREFIX = 'dsh-inline-annotations:'

export type AnnotationDeletionId = string & { readonly __annotationDeletionId: unique symbol }
export type AnnotationId = string & { readonly __annotationId: unique symbol }
export type SubmissionId = string & { readonly __submissionId: unique symbol }
export type SessionIdentity = string & { readonly __sessionIdentity: unique symbol }
export type MessageIdentity = string & { readonly __messageIdentity: unique symbol }

export type DeliveryMode = 'queue' | 'steer'
export type AnnotationStatus = 'draft' | 'queued' | 'sent' | 'processed'
export type OutboxStatus = 'ready' | 'sending' | 'accepted' | 'queued' | 'sent' | 'failed' | 'withdrawn'

/** 注解类型：普通注解或仅标记原文。 */
export type AnnotationKind = 'note' | 'highlight-only'
/** 模型协议语言：随待发送记录冻结，重试期间不随界面语言改变。 */
export type ProtocolLocale = 'zh' | 'en'
/** 旧待发送记录缺少语言信息时继续使用的协议语言。 */
export const FALLBACK_PROTOCOL_LOCALE: ProtocolLocale = 'en'

/** How the model handles one immutable annotation submission. */
export type ProcessingMode = 'answer' | 'rewrite' | 'modify'
/** Missing modes in durable records retain the original per-annotation behavior. */
export const DEFAULT_PROCESSING_MODE: ProcessingMode = 'answer'
/** Browser-local selection behavior; the Host setting chooses the active mode. */
export type AnnotationSelectionMode = 'all' | 'individual'

/** Rendered-text selector retained beside the exact human-visible quote. */
export interface TextQuoteSelector {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
  readonly start: number
  readonly end: number
}

/** Source-specific coordinates captured when a quote belongs to a code block. */
export interface CodeSelection {
  readonly kind: 'code'
  readonly language: string | null
  readonly startLine: number
  readonly endLine: number
}

/** Source-specific coordinates captured when a quote belongs to a table. */
export interface TableSelection {
  readonly kind: 'table'
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

export type StructuredSelection = CodeSelection | TableSelection

/** Browser selection data retained while a compact annotation editor is unfinished. */
export type AnnotationSelectionCapture = AnnotationAnchor & {
  /** 内容块序号（浏览器本地定位提示，不进入线上协议）。 */
  readonly blockIndex?: number
  readonly quote: TextQuoteSelector
  readonly structure?: StructuredSelection
  readonly rect: {
    readonly top: number
    readonly left: number
    readonly bottom: number
    readonly right: number
  }
}

/** Browser-local editor recovery state; it never crosses the Host submission protocol. */
export type PersistedEditorDraft =
  | {
      readonly kind: 'new'
      /** Stable identity allocated before saving, including across suspended editors. */
      readonly draftId?: AnnotationId
      readonly capture: AnnotationSelectionCapture
      readonly text: string
      readonly longSelectionConfirmed: boolean
      readonly supplementalTo?: AnnotationId
    }
  | {
      readonly kind: 'edit'
      readonly annotationId: AnnotationId
      readonly text: string
      readonly expandedCapture?: AnnotationSelectionCapture
      /** Supplement edits append text instead of replacing the saved opinion. */
      readonly supplement?: boolean
      readonly longSelectionConfirmed?: boolean
    }

/** One annotation as transported to the Host and embedded in durable message source metadata. */
export type SubmittedAnnotation = AnnotationAnchor & {
  readonly annotationId: AnnotationId
  readonly ordinal: number
  readonly quote: TextQuoteSelector
  /** Human-authored annotation text written beside the quoted source; empty for highlight-only. */
  readonly annotation: string
  /** 普通注解或仅标记原文；旧数据缺省时按内容是否为空推断。 */
  readonly kind: AnnotationKind
  readonly structure?: StructuredSelection
  readonly createdAt: number
  /** Stable source annotation for a separately submitted supplement. */
  readonly supplementalTo?: AnnotationId
}

/** v2 wire shape of one annotation; v1 payloads use `comment` instead of `annotation`. */
export interface WireAnnotation {
  readonly annotationId: unknown
  readonly ordinal: unknown
  readonly messageId: unknown
  readonly messageSeq: unknown
  readonly responseVersion: unknown
  readonly quote: unknown
  readonly structure?: unknown
  readonly createdAt: unknown
  /** v2 field; converted to `annotation` by the v1 compatibility layer. */
  readonly annotation?: unknown
  /** v1 field; converted to `annotation` by the v2 model. */
  readonly comment?: unknown
  /** 注解类型；缺失时按内容是否为空推断。 */
  readonly kind?: unknown
  /** Optional original annotation id for a separately saved supplement. */
  readonly supplementalTo?: unknown
}

/** Idempotent batch transported through the internal slash command. */
export interface AnnotationSubmissionPayload {
  readonly protocolVersion: 2 | 3 | 4 | 5
  readonly source: typeof PROTOCOL_SOURCE
  readonly submissionId: SubmissionId
  readonly sessionId: SessionIdentity
  readonly delivery: DeliveryMode
  readonly createdAt: number
  /** 协议语言：创建待发送记录时按 DSH 当前 locale 冻结；旧记录缺省为英文。 */
  readonly protocolLocale: ProtocolLocale
  /** Frozen with the selected annotations; never replaced by a later draft preference. */
  readonly processingMode: ProcessingMode
  readonly overallRequirement?: string
  readonly annotations: readonly SubmittedAnnotation[]
  /** Absent in legacy records; new submissions freeze the ordered admitted identities, including an empty list. */
  readonly attachmentIdentities?: readonly SubmittedAttachmentIdentity[]
}

/** v1 wire shape of one submission; read for compatibility, never emitted again. */
export interface LegacySubmissionPayloadV1 {
  readonly protocolVersion: 1
  readonly submissionId: unknown
  readonly sessionId: unknown
  readonly delivery: unknown
  readonly createdAt: unknown
  readonly overallRequirement?: unknown
  readonly annotations: unknown
}

/** Current durable source metadata attached to a new standard user/message event. */
export interface AnnotationMessageSource {
  readonly kind: 'user'
  readonly annotationSubmission: AnnotationSubmissionPayload
}

/** Durable source metadata written by the dsh-inline-comments rename era. */
export interface InlineCommentMessageSource {
  readonly kind: 'user'
  readonly inlineComments: unknown
}

/** Durable source metadata written before the dsh-inline-comments rename. */
export interface LegacyInlineAnnotationMessageSource {
  readonly kind: 'user'
  readonly inlineAnnotations: unknown
}

/** Browser-only editable record. */
export type AnnotationDraft = SubmittedAnnotation & {
  /** Browser-local source-block hint; never included in a submitted annotation. */
  readonly blockIndex?: number
  readonly status: AnnotationStatus
  readonly updatedAt: number
  readonly submissionId?: SubmissionId
  readonly supplementalTo?: AnnotationId
}

/** Legacy composer image metadata; retained when reading existing pending submissions. */
export interface OutboxImages {
  readonly count: number
  readonly mediaTypes: readonly string[]
  readonly names: readonly string[]
}

/** Retry metadata excludes attachment bytes and temporary file-upload receipts. */
export interface OutboxAttachments extends OutboxImages {
  readonly kinds: readonly ('image' | 'file')[]
}

/** Common durable identity and lifecycle fields for one submission attempt. */
interface OutboxEntryBase {
  readonly targetSessionId: SessionIdentity
  readonly messageId: MessageIdentity
  readonly attempts: number
}

/** Immutable retry record. The payload never changes while the batch can still be transported. */
export interface OutboxPayloadEntry extends OutboxEntryBase {
  readonly payload: AnnotationSubmissionPayload
  readonly status: OutboxStatus
  readonly lastError?: string
  /** Metadata for attachments carried by the original submission. */
  readonly attachments?: OutboxAttachments
  /** Image-only metadata written by plugin versions before 0.6.0. */
  readonly images?: OutboxImages
}

/** Content-free receipt retained after a terminal batch has a permanently deleted member. */
export interface OutboxReceiptEntry extends OutboxEntryBase {
  readonly kind: 'receipt'
  readonly submissionId: SubmissionId
  readonly status: 'sent' | 'withdrawn'
  readonly payload?: never
  readonly lastError?: never
  readonly attachments?: never
  readonly images?: never
}

/** Durable transport payload or a terminal content-free receipt. */
export type OutboxEntry = OutboxPayloadEntry | OutboxReceiptEntry

/** Browser-local deleted annotation; immutable submission payloads remain unchanged. */
export interface AnnotationTrashEntry {
  readonly annotation: AnnotationDraft
  readonly deletedAt: number
  readonly deletionId: AnnotationDeletionId
  readonly editorDrafts: readonly PersistedEditorDraft[]
}

/** Lifecycle revision that prevents history and stale browser pages from restoring deleted records. */
export interface AnnotationDeletionMark {
  readonly annotationId: AnnotationId
  readonly deletionId: AnnotationDeletionId
  readonly revision: number
  readonly state: 'trashed' | 'restored' | 'purged'
  readonly updatedAt: number
}

export interface PersistedSessionState {
  readonly storageVersion: 2 | 3 | 4 | 5 | 6
  readonly trash?: readonly AnnotationTrashEntry[]
  readonly deletionMarks?: readonly AnnotationDeletionMark[]
  readonly annotations: readonly AnnotationDraft[]
  readonly outbox: readonly OutboxEntry[]
  readonly overallRequirementDraft: string
  readonly editorDraft?: PersistedEditorDraft
  /** Suspended buffers are not saved annotations and never enter submission JSON. */
  readonly editorDrafts?: readonly PersistedEditorDraft[]
  readonly selectionMode?: AnnotationSelectionMode
  readonly selectedAnnotationIds?: readonly AnnotationId[]
  readonly processingMode?: ProcessingMode
  /** Null explicitly releases an old retry without discarding its immutable outbox. */
  readonly retrySubmissionId?: SubmissionId | null
}

export interface ModelAcknowledgement {
  readonly submissionId: SubmissionId
  readonly processed: readonly AnnotationId[]
}

/** One hidden reply marker emitted before its model paragraph. */
export interface ReplyMarker {
  readonly submissionId: SubmissionId
  readonly annotationId: AnnotationId
  readonly ordinal: number
  /** Offset of the marker inside the raw text block it was parsed from. */
  readonly offset: number
}

export interface AnnotationConfig {
  readonly commandName: string
  readonly maxPayloadBytes: number
  readonly maxAnnotationsPerSubmission: number
  readonly warnSelectionChars: number
  readonly locateHistoryPages: number
}
