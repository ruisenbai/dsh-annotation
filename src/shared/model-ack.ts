import { MODEL_ACK_PREFIX } from './types.ts'
import type { AnnotationId, ModelAcknowledgement, SubmissionId } from './types.ts'

const MARKER = /<!--\s*(?:dsh-inline-comments|dsh-inline-annotations):(\{[\s\S]*?\})\s*-->/gu

/** Parse only explicit, well-formed model acknowledgements; prose guesses never change status. */
export function parseModelAcknowledgements(text: string): ModelAcknowledgement[] {
  const acknowledgements: ModelAcknowledgement[] = []
  for (const match of text.matchAll(MARKER)) {
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

/** Remove machine acknowledgements before Markdown rendering while retaining them in durable raw text. */
export function stripModelAcknowledgementMarkers(text: string): string {
  return text
    .replace(MARKER, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()
}

/** Exposed for diagnostics and tests without duplicating the protocol token. */
export const modelAcknowledgementPrefix = MODEL_ACK_PREFIX
