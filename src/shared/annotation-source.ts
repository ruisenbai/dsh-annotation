/** Message selectors remain readable; official workspace sources retain their own identities and snapshots. */
import type { DiffSource } from './diff-source.ts'
import type { MessageIdentity, SessionIdentity } from './types.ts'

/** A selection from a specific rendered message version. */
export interface MessageAnnotationSource {
  readonly kind: 'message'
  readonly messageId: MessageIdentity
  readonly messageSeq: number
  readonly responseVersion: MessageIdentity
}

/** How a new official source record entered the annotation experience. */
export type AnnotationCreationEntry = 'body' | 'hover' | 'sidebar'

/** Immutable metadata for one file preview revision. */
export interface FileAnnotationSnapshot {
  readonly version: 1 | 2
  readonly hash: string
  readonly bytes: number
  readonly format: string
  /** Complete text is retained when the renderer supplied text to the adapter. */
  readonly text?: string
  /** Visible Markdown text retained for selectors whose rendered text differs from source Markdown. */
  readonly renderedText?: string
  readonly renderedHash?: string
  /** Transient Host pages; compact v2 records never persist these contents. */
  readonly pages?: readonly { readonly offset: number; readonly text: string; readonly lines: number }[]
  /** V2 retains a verified quote digest and its coordinate system, without file contents. */
  readonly coordinateSpace?: 'raw' | 'rendered'
  readonly fragmentHash?: string
}

/** A file preview source, independent of message and Git identities. */
export interface FileAnnotationSource {
  readonly kind: 'file'
  readonly sessionId: SessionIdentity
  readonly resourceAddress: string
  readonly path: string
  readonly resourceVersion: string
  readonly format: string
  readonly snapshot: FileAnnotationSnapshot
  readonly wholeFile: boolean
  readonly startLine?: number
  readonly endLine?: number
  readonly startColumn?: number
  readonly endColumn?: number
  readonly entry: AnnotationCreationEntry
  /** Set when the Host can no longer open the captured resource; the snapshot remains durable. */
  readonly expired?: boolean
}

/** One line-prefixed official workspace comparison hunk. */
export interface OfficialDiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

/** Immutable response from the official workspace changes comparison route. */
export interface OfficialDiffSnapshot {
  readonly version: 1 | 2
  readonly hash: string
  readonly sessionId: SessionIdentity
  readonly seq: number
  readonly turn: number
  readonly fileIndex: number
  readonly path: string
  readonly display: string
  readonly kind: 'text' | 'binary' | 'oversized'
  /** Null when the Host serves only a binary/oversized refusal and does not report side existence. */
  readonly before: boolean | null
  readonly after: boolean | null
  readonly coarse: boolean
  readonly hunks: readonly OfficialDiffHunk[]
  /** V2 stores only the digest of the selected quote and its surrounding context. */
  readonly fragmentHash?: string
  readonly contextBefore?: string
  readonly contextAfter?: string
}

/** A selection from one official turn Diff snapshot. */
export interface OfficialDiffAnnotationSource {
  readonly kind: 'official-diff'
  readonly snapshot: OfficialDiffSnapshot
  /** A non-text whole-file refusal has no known text side. */
  readonly side: 'old' | 'new' | 'file'
  readonly startLine?: number
  readonly endLine?: number
  /** Optional zero-based character bounds for a same-line inline selection. */
  readonly startColumn?: number
  readonly endColumn?: number
  readonly wholeFile: boolean
  readonly entry: AnnotationCreationEntry
  /** Set when the Host can no longer open the captured Diff resource; the snapshot remains durable. */
  readonly expired?: boolean
}

/** Message, historical Git, file-preview and official turn-Diff identities. */
export type AnnotationSource =
  MessageAnnotationSource | DiffSource | FileAnnotationSource | OfficialDiffAnnotationSource

/** Legacy message aliases remain readable but are forbidden on non-message records. */
export type AnnotationAnchor =
  | {
      /** Optional only for legacy v1/v2 message records. New writes include the discriminator. */
      readonly source?: MessageAnnotationSource
      readonly messageId: MessageIdentity
      readonly messageSeq: number
      readonly responseVersion: MessageIdentity
    }
  | {
      readonly source: DiffSource | FileAnnotationSource | OfficialDiffAnnotationSource
      readonly messageId?: never
      readonly messageSeq?: never
      readonly responseVersion?: never
    }

/** Project only source fields, retaining legacy message aliases for old consumers. */
export function sourceFields(value: AnnotationAnchor): AnnotationAnchor {
  if (value.source !== undefined && value.source.kind !== 'message') return { source: value.source }
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

/** Stable grouping key includes the immutable version and official coordinates. */
export function sourceKey(value: AnnotationAnchor): string {
  const source = value.source
  if (source?.kind === 'diff') return `diff:${source.snapshot.id}:${source.side}`
  if (source?.kind === 'file') {
    return `file:${source.sessionId}:${source.path}:${source.resourceVersion}:${source.snapshot.version === 2 ? 'v2' : source.snapshot.hash}`
  }
  if (source?.kind === 'official-diff') {
    return `official-diff:${source.snapshot.sessionId}:${source.snapshot.seq}:${source.snapshot.turn}:${source.snapshot.fileIndex}:${source.snapshot.version === 2 ? 'v2' : source.snapshot.hash}:${source.side}`
  }
  return `message:${value.messageId}`
}

/** Historical Git Diff records are the only source that remains permanently read-only. */
export function isLegacyDiffSource(value: AnnotationAnchor | AnnotationSource): boolean {
  if ('source' in value) return value.source?.kind === 'diff'
  return 'kind' in value && value.kind === 'diff'
}

/** Sources that can be created and edited by the current plugin. */
export function isEditableSource(value: AnnotationAnchor): boolean {
  return !isLegacyDiffSource(value)
}

/** Human-facing source type used by records and accessibility labels. */
export function sourceType(value: AnnotationAnchor): 'message' | 'diff' | 'file' {
  if (value.source?.kind === 'diff' || value.source?.kind === 'official-diff') return 'diff'
  if (value.source?.kind === 'file') return 'file'
  return 'message'
}
