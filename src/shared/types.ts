/** JSON protocol shared by the Host command bridge and browser client. */

/** Current submission protocol; new submissions only emit v2. */
export const PROTOCOL_VERSION = 2 as const
/** Protocol source identity written into every v2 payload. */
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

export type AnnotationId = string & { readonly __annotationId: unique symbol }
export type SubmissionId = string & { readonly __submissionId: unique symbol }
export type SessionIdentity = string & { readonly __sessionIdentity: unique symbol }
export type MessageIdentity = string & { readonly __messageIdentity: unique symbol }

export type DeliveryMode = 'queue' | 'steer'
export type AnnotationStatus = 'draft' | 'queued' | 'sent' | 'processed'
export type OutboxStatus = 'ready' | 'sending' | 'accepted' | 'queued' | 'sent' | 'failed' | 'withdrawn'

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
export interface AnnotationSelectionCapture {
  readonly messageId: MessageIdentity
  readonly messageSeq: number
  readonly responseVersion: MessageIdentity
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
    }

/** One annotation as transported to the Host and embedded in durable message provenance. */
export interface SubmittedAnnotation {
  readonly annotationId: AnnotationId
  readonly ordinal: number
  readonly messageId: MessageIdentity
  readonly messageSeq: number
  /** DSH has no mutable reply version; the finalized assistant message id is the version identity. */
  readonly responseVersion: MessageIdentity
  readonly quote: TextQuoteSelector
  /** Human-authored annotation text written beside the quoted source. */
  readonly annotation: string
  readonly structure?: StructuredSelection
  readonly createdAt: number
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
}

/** Idempotent batch transported through the internal slash command. */
export interface AnnotationSubmissionPayload {
  readonly protocolVersion: 2
  readonly source: typeof PROTOCOL_SOURCE
  readonly submissionId: SubmissionId
  readonly sessionId: SessionIdentity
  readonly delivery: DeliveryMode
  readonly createdAt: number
  readonly overallRequirement?: string
  readonly annotations: readonly SubmittedAnnotation[]
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

/** Current durable provenance attached to a new standard user/message event. */
export interface AnnotationMessageSource {
  readonly kind: 'user'
  readonly annotationSubmission: AnnotationSubmissionPayload
}

/** Durable provenance written by the dsh-inline-comments rename era. */
export interface InlineCommentMessageSource {
  readonly kind: 'user'
  readonly inlineComments: unknown
}

/** Durable provenance written before the dsh-inline-comments rename. */
export interface LegacyInlineAnnotationMessageSource {
  readonly kind: 'user'
  readonly inlineAnnotations: unknown
}

/** Browser-only editable record. */
export interface AnnotationDraft extends SubmittedAnnotation {
  readonly status: AnnotationStatus
  readonly updatedAt: number
  readonly submissionId?: SubmissionId
  readonly supplementalTo?: AnnotationId
}

/** Composer image metadata retained for refresh-safe retries; never the base64 bytes. */
export interface OutboxImages {
  readonly count: number
  readonly mediaTypes: readonly string[]
  readonly names: readonly string[]
}

/** Immutable retry record. The payload never changes after its first attempt. */
export interface OutboxEntry {
  readonly payload: AnnotationSubmissionPayload
  readonly targetSessionId: SessionIdentity
  readonly messageId: MessageIdentity
  readonly status: OutboxStatus
  readonly attempts: number
  readonly lastError?: string
  /** Present exactly when the original submission carried composer images. */
  readonly images?: OutboxImages
}

export interface PersistedSessionState {
  readonly storageVersion: 2
  readonly annotations: readonly AnnotationDraft[]
  readonly outbox: readonly OutboxEntry[]
  readonly overallRequirementDraft: string
  readonly editorDraft?: PersistedEditorDraft
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
