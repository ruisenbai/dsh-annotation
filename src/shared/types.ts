/** JSON protocol shared by the Host command bridge and browser client. */

export const PROTOCOL_VERSION = 1 as const
export const MODEL_ACK_PREFIX = 'dsh-inline-comments:'
export const LEGACY_MODEL_ACK_PREFIX = 'dsh-inline-annotations:'
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
  readonly comment: string
  readonly structure?: StructuredSelection
  readonly createdAt: number
}

/** Idempotent batch transported through the internal slash command. */
export interface AnnotationSubmissionPayload {
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly submissionId: SubmissionId
  readonly sessionId: SessionIdentity
  readonly delivery: DeliveryMode
  readonly createdAt: number
  readonly overallRequirement?: string
  readonly annotations: readonly SubmittedAnnotation[]
}

/** Extra durable provenance attached to a new standard user/message event. */
export interface InlineCommentMessageSource {
  readonly kind: 'user'
  readonly inlineComments: AnnotationSubmissionPayload
}

/** Durable provenance written before the project rename. */
export interface LegacyInlineAnnotationMessageSource {
  readonly kind: 'user'
  readonly inlineAnnotations: AnnotationSubmissionPayload
}

/** Browser-only editable record. */
export interface AnnotationDraft extends SubmittedAnnotation {
  readonly status: AnnotationStatus
  readonly updatedAt: number
  readonly submissionId?: SubmissionId
  readonly supplementalTo?: AnnotationId
}

/** Immutable retry record. The payload never changes after its first attempt. */
export interface OutboxEntry {
  readonly payload: AnnotationSubmissionPayload
  readonly targetSessionId: SessionIdentity
  readonly messageId: MessageIdentity
  readonly status: OutboxStatus
  readonly attempts: number
  readonly lastError?: string
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

export interface AnnotationConfig {
  readonly commandName: string
  readonly maxPayloadBytes: number
  readonly maxAnnotationsPerSubmission: number
  readonly warnSelectionChars: number
  readonly locateHistoryPages: number
}
