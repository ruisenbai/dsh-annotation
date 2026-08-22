import { MODEL_ACK_PREFIX, PROTOCOL_SOURCE, PROTOCOL_VERSION, REPLY_MARKER_PREFIX } from './types.ts'
import type {
  AnnotationConfig,
  AnnotationId,
  AnnotationMessageSource,
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
  WireAnnotation,
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

/** Read one wire annotation and convert legacy `comment` into the v2 `annotation` model. */
export function parseSubmittedAnnotation(value: unknown, index: number): SubmittedAnnotation {
  const field = `annotations[${index}]`
  const source = record(value, field) as UnknownRecord & WireAnnotation
  const parsedStructure = parseStructuredSelection(source.structure, `${field}.structure`)
  const annotationText = source.annotation ?? source.comment
  const parsed: SubmittedAnnotation = {
    annotationId: id<AnnotationId>(source.annotationId, `${field}.annotationId`),
    ordinal: integer(source.ordinal, `${field}.ordinal`, 1),
    messageId: id<MessageIdentity>(source.messageId, `${field}.messageId`),
    messageSeq: integer(source.messageSeq, `${field}.messageSeq`),
    responseVersion: id<MessageIdentity>(source.responseVersion, `${field}.responseVersion`),
    quote: parseTextQuoteSelector(source.quote, `${field}.quote`),
    annotation: string(annotationText, `${field}.annotation`),
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
  const version = source.protocolVersion
  if (version !== 1 && version !== 2) {
    throw new ProtocolError(`unsupported protocolVersion ${String(version)}`)
  }
  if (!Array.isArray(source.annotations) || source.annotations.length === 0) {
    throw new ProtocolError('annotations must be a non-empty array')
  }
  if (version === 2) {
    if (source.source !== PROTOCOL_SOURCE) {
      throw new ProtocolError(`source must be ${PROTOCOL_SOURCE}`)
    }
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
    source: PROTOCOL_SOURCE,
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
export function parseAnnotationSource(value: unknown): AnnotationSubmissionPayload | null {
  try {
    const source = record(value, 'source') as UnknownRecord &
      Partial<AnnotationMessageSource & InlineCommentMessageSource & LegacyInlineAnnotationMessageSource>
    if (source.kind !== 'user') return null
    const payload = source.annotationSubmission ?? source.inlineComments ?? source.inlineAnnotations
    return payload === undefined ? null : parseSubmissionPayload(payload)
  } catch {
    return null
  }
}

/** Pre-rename name retained so old integrations can keep reading one source shape. */
export const parseInlineCommentSource = parseAnnotationSource

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

/** Hidden reply marker the model must emit before each per-annotation paragraph. */
export function replyMarkerFor(payload: AnnotationSubmissionPayload, item: SubmittedAnnotation): string {
  return `<!-- ${REPLY_MARKER_PREFIX}${JSON.stringify({
    submissionId: payload.submissionId,
    annotationId: item.annotationId,
    ordinal: item.ordinal,
  })} -->`
}

/** Produce the exact readable text sent to the model and retained in the standard user/message event. */
export function formatSubmissionMessage(payload: AnnotationSubmissionPayload): string {
  const lines: string[] = [
    '[DSH 注解提交]',
    `Submission ID: ${payload.submissionId}`,
    `Reply annotations: ${payload.annotations.length}`,
    '',
    '总体要求：',
    payload.overallRequirement?.trim() || '请按注解逐条处理，并保持未涉及的原文不变。',
    '',
    '请按注解顺序逐条回答：',
    '- 每段必须以「注解 N：」开头，N 为该注解的编号。',
    '- 不要合并不同注解；每个注解单独一段。',
    '- 每段回答前先输出该注解的隐藏关联标记（HTML 注释，用户不可见）。',
    '',
  ]
  for (const item of payload.annotations) {
    lines.push(
      replyMarkerFor(payload, item),
      `注解 ${item.ordinal} (${item.annotationId})`,
      `Reply message: ${item.messageId}`,
      `Reply event seq: ${item.messageSeq}`,
      '被选中的原文：',
      item.quote.exact,
      '用户的注解：',
      item.annotation,
    )
    const label = structureLabel(item.structure)
    if (label !== null) lines.push(`Source coordinates: ${label}`)
    lines.push('')
  }
  lines.push(
    '处理确认：',
    '只把你实际处理过的注解 ID 写进 processed；在回复结尾附加一个隐藏 HTML 注释：',
    `<!-- ${MODEL_ACK_PREFIX}${JSON.stringify({
      submissionId: payload.submissionId,
      processed: ['annotation-id'],
    })} -->`,
    '没有处理的注解 ID 不要放进 processed。',
  )
  return lines.join('\n')
}

/** Text shown in the collapsed timeline row. */
export function submissionSummary(payload: AnnotationSubmissionPayload, locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'zh'
    ? `基于上一条回复添加了 ${payload.annotations.length} 条注解`
    : `Added ${payload.annotations.length} annotations to an earlier reply`
}
