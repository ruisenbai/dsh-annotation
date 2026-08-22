import {
  LEGACY_MODEL_ACK_PREFIXES,
  LEGACY_REPLY_MARKER_PREFIXES,
  MODEL_ACK_PREFIX,
  REPLY_MARKER_PREFIX,
} from './types.ts'
import type { AnnotationId, ModelAcknowledgement, ReplyMarker, SubmissionId } from './types.ts'

const ACK_PREFIXES = [MODEL_ACK_PREFIX, ...LEGACY_MODEL_ACK_PREFIXES]
const REPLY_PREFIXES = [REPLY_MARKER_PREFIX, ...LEGACY_REPLY_MARKER_PREFIXES]
const PREFIX_GROUP = ACK_PREFIXES.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')
const ACK_MARKER = new RegExp(`<!--\\s*(?:${PREFIX_GROUP})(\\{[\\s\\S]*?\\})\\s*-->`, 'gu')
const REPLY_PREFIX_GROUP = REPLY_PREFIXES.map((prefix) =>
  prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
).join('|')
const REPLY_MARKER = new RegExp(`<!--\\s*(?:${REPLY_PREFIX_GROUP})(\\{[\\s\\S]*?\\})\\s*-->`, 'gu')
const ANY_MARKER = new RegExp(
  `<!--\\s*(?:${PREFIX_GROUP}|${REPLY_PREFIX_GROUP})\\{[\\s\\S]*?\\}\\s*-->`,
  'gu',
)

function integerField(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null
}

/** Parse only explicit, well-formed model acknowledgements; prose guesses never change status. */
export function parseModelAcknowledgements(text: string): ModelAcknowledgement[] {
  const acknowledgements: ModelAcknowledgement[] = []
  for (const match of text.matchAll(ACK_MARKER)) {
    const payload = match[1]
    if (payload === undefined) continue
    try {
      const value: unknown = JSON.parse(payload)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      if (typeof record.submissionId !== 'string' || !Array.isArray(record.processed)) continue
      if (!record.processed.every((item) => typeof item === 'string')) continue
      acknowledgements.push(
        Object.freeze({
          submissionId: record.submissionId as SubmissionId,
          processed: Object.freeze([...new Set(record.processed as string[])] as AnnotationId[]),
        }),
      )
    } catch {
      // A malformed marker is ordinary model text and carries no status authority.
    }
  }
  return acknowledgements
}

/** Parse reply-association markers; unknown ids are dropped by the caller, never trusted here. */
export function parseReplyMarkers(text: string): ReplyMarker[] {
  const markers: ReplyMarker[] = []
  for (const match of text.matchAll(REPLY_MARKER)) {
    const payload = match[1]
    if (payload === undefined) continue
    try {
      const value: unknown = JSON.parse(payload)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      if (typeof record.submissionId !== 'string' || typeof record.annotationId !== 'string') continue
      const ordinal = integerField(record.ordinal)
      if (ordinal === null || ordinal < 1) continue
      markers.push(
        Object.freeze({
          submissionId: record.submissionId as SubmissionId,
          annotationId: record.annotationId as AnnotationId,
          ordinal,
          offset: match.index,
        }),
      )
    } catch {
      // A malformed marker is ordinary model text and carries no display authority.
    }
  }
  return markers
}

/** Raw spans of every machine marker, sorted by offset; used to translate raw offsets into stripped ones. */
export function machineMarkerSpans(text: string): readonly { start: number; length: number }[] {
  const spans: { start: number; length: number }[] = []
  for (const match of text.matchAll(ANY_MARKER)) {
    spans.push({ start: match.index, length: match[0].length })
  }
  return Object.freeze(spans)
}

/** Offset inside the stripped text where the given raw offset lands. */
export function strippedOffset(
  rawOffset: number,
  spans: readonly { start: number; length: number }[],
): number {
  let shift = 0
  for (const span of spans) {
    if (span.start >= rawOffset) break
    shift += span.length
  }
  return rawOffset - shift
}

/** Remove machine acknowledgements before Markdown rendering while retaining them in durable raw text. */
export function stripModelAcknowledgementMarkers(text: string): string {
  return text
    .replace(ACK_MARKER, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()
}

/** Strip every machine marker (acknowledgements and reply associations) from raw model text. */
export function stripMachineMarkers(text: string): string {
  return text
    .replace(ANY_MARKER, '')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^\n+/u, '')
    .trimEnd()
}

/** Exposed for diagnostics and tests without duplicating the protocol token. */
export const modelAcknowledgementPrefix = MODEL_ACK_PREFIX

/** Exposed for diagnostics and tests without duplicating the protocol token. */
export const replyMarkerPrefix = REPLY_MARKER_PREFIX
