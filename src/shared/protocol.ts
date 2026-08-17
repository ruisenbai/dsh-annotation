import { MODEL_ACK_PREFIX, PROTOCOL_VERSION } from './types.ts'
import type {
  AnnotationConfig,
  AnnotationId,
  AnnotationSubmissionPayload,
  CodeSelection,
  InlineCommentMessageSource,
  LegacyInlineAnnotationMessageSource,
  MessageIdentity,
  SessionIdentity,
  StructuredSelection,
  SubmissionId,
  SubmittedAnnotation,
  TableSelection,
  TextQuoteSelector,
} from './types.ts'

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${field} must be an object`)
  }
  return value as UnknownRecord
}

function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new ProtocolError(`${field} must be ${allowEmpty ? 'a string' : 'a non-blank string'}`)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return string(value, field, true)
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ProtocolError(`${field} must be a safe integer >= ${minimum}`)
  }
  return value as number
}

function id<T extends string>(value: unknown, field: string): T {
  const parsed = string(value, field)
  if (parsed.length > 256) throw new ProtocolError(`${field} is too long`)
  return parsed as T
}

export function parseTextQuoteSelector(value: unknown, field: string): TextQuoteSelector {
  const source = record(value, field)
  const start = integer(source.start, `${field}.start`)
  const end = integer(source.end, `${field}.end`)
  if (end <= start) throw new ProtocolError(`${field}.end must be greater than start`)
  const exact = string(source.exact, `${field}.exact`)
  const prefix = string(source.prefix, `${field}.prefix`, true)
  const suffix = string(source.suffix, `${field}.suffix`, true)
  if (exact.length !== end - start) throw new ProtocolError(`${field} offsets must span exact text`)
  if (prefix.length > 32 || suffix.length > 32) {
    throw new ProtocolError(`${field} prefix and suffix must not exceed 32 characters`)
  }
  return Object.freeze({ exact, prefix, suffix, start, end })
}

export function parseStructuredSelection(value: unknown, field: string): StructuredSelection | undefined {
  if (value === undefined) return undefined
  const source = record(value, field)
  if (source.kind === 'code') {
    const parsed: CodeSelection = {
      kind: 'code',
      language: source.language === null ? null : string(source.language, `${field}.language`),
      startLine: integer(source.startLine, `${field}.startLine`, 1),
      endLine: integer(source.endLine, `${field}.endLine`, 1),
    }
    if (parsed.endLine < parsed.startLine) throw new ProtocolError(`${field}.endLine precedes startLine`)
    return Object.freeze(parsed)
  }
  if (source.kind === 'table') {
    const parsed: TableSelection = {
      kind: 'table',
      startRow: integer(source.startRow, `${field}.startRow`),
      startColumn: integer(source.startColumn, `${field}.startColumn`),
      endRow: integer(source.endRow, `${field}.endRow`),
      endColumn: integer(source.endColumn, `${field}.endColumn`),
    }
    if (
      parsed.endRow < parsed.startRow ||
      (parsed.endRow === parsed.startRow && parsed.endColumn < parsed.startColumn)
    ) {
      throw new ProtocolError(`${field} table end precedes start`)
    }
    return Object.freeze(parsed)
  }
  throw new ProtocolError(`${field}.kind must be code or table`)
}

export function parseSubmittedAnnotation(value: unknown, index: number): SubmittedAnnotation {
  const field = `annotations[${index}]`
  const source = record(value, field)
  const parsedStructure = parseStructuredSelection(source.structure, `${field}.structure`)
  const parsed: SubmittedAnnotation = {
    annotationId: id<AnnotationId>(source.annotationId, `${field}.annotationId`),
    ordinal: integer(source.ordinal, `${field}.ordinal`, 1),
    messageId: id<MessageIdentity>(source.messageId, `${field}.messageId`),
    messageSeq: integer(source.messageSeq, `${field}.messageSeq`),
    responseVersion: id<MessageIdentity>(source.responseVersion, `${field}.responseVersion`),
    quote: parseTextQuoteSelector(source.quote, `${field}.quote`),
    comment: string(source.comment, `${field}.comment`),
    createdAt: integer(source.createdAt, `${field}.createdAt`),
    ...(parsedStructure === undefined ? {} : { structure: parsedStructure }),
  }
  if (parsed.responseVersion !== parsed.messageId) {
    throw new ProtocolError(`${field}.responseVersion must equal the finalized assistant message id`)
  }
  return Object.freeze(parsed)
}

/** Parse durable or wire JSON without trusting TypeScript declarations across the boundary. */
export function parseSubmissionPayload(value: unknown): AnnotationSubmissionPayload {
  const source = record(value, 'submission')
  if (source.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported protocolVersion ${String(source.protocolVersion)}`)
  }
  if (!Array.isArray(source.annotations) || source.annotations.length === 0) {
    throw new ProtocolError('annotations must be a non-empty array')
  }
  const annotations = source.annotations.map(parseSubmittedAnnotation)
  const ids = new Set(annotations.map((item) => item.annotationId))
  if (ids.size !== annotations.length) throw new ProtocolError('annotation ids must be unique')
  const ordinals = annotations.map((item) => item.ordinal)
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new ProtocolError('annotation ordinals must be contiguous and start at 1')
  }
  const delivery = source.delivery
  if (delivery !== 'queue' && delivery !== 'steer') {
    throw new ProtocolError('delivery must be queue or steer')
  }
  const overallRequirement = optionalString(source.overallRequirement, 'overallRequirement')
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    submissionId: id<SubmissionId>(source.submissionId, 'submissionId'),
    sessionId: id<SessionIdentity>(source.sessionId, 'sessionId'),
    delivery,
    createdAt: integer(source.createdAt, 'createdAt'),
    ...(overallRequirement === undefined ? {} : { overallRequirement }),
    annotations: Object.freeze(annotations),
  })
}

/** Apply deployment limits after decoding the complete payload. */
export function validateSubmissionLimits(
  payload: AnnotationSubmissionPayload,
  config: AnnotationConfig,
  payloadBytes: number,
): void {
  if (payloadBytes > config.maxPayloadBytes) {
    throw new ProtocolError(`payload is ${payloadBytes} bytes; maximum is ${config.maxPayloadBytes}`)
  }
  if (payload.annotations.length > config.maxAnnotationsPerSubmission) {
    throw new ProtocolError(
      `submission has ${payload.annotations.length} annotations; maximum is ${config.maxAnnotationsPerSubmission}`,
    )
  }
}

/** Read current or pre-rename metadata from one persisted user-message source. */
export function parseInlineCommentSource(value: unknown): AnnotationSubmissionPayload | null {
  try {
    const source = record(value, 'source') as UnknownRecord &
      Partial<InlineCommentMessageSource & LegacyInlineAnnotationMessageSource>
    if (source.kind !== 'user') return null
    const payload = source.inlineComments ?? source.inlineAnnotations
    return payload === undefined ? null : parseSubmissionPayload(payload)
  } catch {
    return null
  }
}

function structureLabel(value: StructuredSelection | undefined): string | null {
  if (value?.kind === 'code') {
    const language = value.language === null ? 'unknown' : value.language
    return `code (${language}), lines ${value.startLine}-${value.endLine}`
  }
  if (value?.kind === 'table') {
    return `table, r${value.startRow + 1}c${value.startColumn + 1} to r${value.endRow + 1}c${value.endColumn + 1}`
  }
  return null
}

/** Produce the exact readable text sent to the model and retained in the standard user/message event. */
export function formatSubmissionMessage(payload: AnnotationSubmissionPayload): string {
  const lines: string[] = [
    '[DSH inline comments]',
    `Submission ID: ${payload.submissionId}`,
    `Reply comments: ${payload.annotations.length}`,
    '',
    'Overall requirement:',
    payload.overallRequirement?.trim() || 'Handle every comment together and preserve unaffected content.',
  ]
  for (const item of payload.annotations) {
    lines.push(
      '',
      `Comment ${item.ordinal} (${item.annotationId})`,
      `Reply message: ${item.messageId}`,
      `Reply event seq: ${item.messageSeq}`,
      'Original text:',
      item.quote.exact,
      'Comment:',
      item.comment,
    )
    const label = structureLabel(item.structure)
    if (label !== null) lines.push(`Source coordinates: ${label}`)
  }
  lines.push(
    '',
    'Processing acknowledgement:',
    'Only for comments you actually handled, append one hidden HTML comment with their exact IDs:',
    `<!-- ${MODEL_ACK_PREFIX}{"submissionId":"${payload.submissionId}","processed":["comment-id"]} -->`,
    'Do not include a comment ID in processed unless your answer addresses it.',
  )
  return lines.join('\n')
}

/** Text shown in the collapsed timeline row. */
export function submissionSummary(payload: AnnotationSubmissionPayload, locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'zh'
    ? `基于上一条回复添加了 ${payload.annotations.length} 条正文注释`
    : `Added ${payload.annotations.length} inline comments to an earlier reply`
}
