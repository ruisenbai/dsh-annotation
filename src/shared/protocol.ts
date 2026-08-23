import {
  FALLBACK_PROTOCOL_LOCALE,
  MODEL_ACK_PREFIX,
  PROTOCOL_SOURCE,
  PROTOCOL_VERSION,
  REPLY_MARKER_PREFIX,
} from './types.ts'
import type {
  AnnotationConfig,
  AnnotationId,
  AnnotationKind,
  AnnotationMessageSource,
  AnnotationSubmissionPayload,
  CodeSelection,
  InlineCommentMessageSource,
  LegacyInlineAnnotationMessageSource,
  MessageIdentity,
  ProtocolLocale,
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

/** 解析注解类型：显式 kind 优先，缺失或自相矛盾时按内容是否为空推断。 */
export function resolveAnnotationKind(rawKind: unknown, annotation: string): AnnotationKind {
  if (rawKind === 'highlight-only') return 'highlight-only'
  if (rawKind === 'note' && annotation.trim().length > 0) return 'note'
  return annotation.trim().length > 0 ? 'note' : 'highlight-only'
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
  // 注解内容允许为空：空内容表示仅标记原文。
  const annotation = string(annotationText, `${field}.annotation`, true)
  const parsed: SubmittedAnnotation = {
    annotationId: id<AnnotationId>(source.annotationId, `${field}.annotationId`),
    ordinal: integer(source.ordinal, `${field}.ordinal`, 1),
    messageId: id<MessageIdentity>(source.messageId, `${field}.messageId`),
    messageSeq: integer(source.messageSeq, `${field}.messageSeq`),
    responseVersion: id<MessageIdentity>(source.responseVersion, `${field}.responseVersion`),
    quote: parseTextQuoteSelector(source.quote, `${field}.quote`),
    annotation,
    kind: resolveAnnotationKind(source.kind, annotation),
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
  const protocolLocale: ProtocolLocale = source.protocolLocale === 'zh' ? 'zh' : 'en'
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    source: PROTOCOL_SOURCE,
    submissionId: id<SubmissionId>(source.submissionId, 'submissionId'),
    sessionId: id<SessionIdentity>(source.sessionId, 'sessionId'),
    delivery,
    protocolLocale,
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

/** 中英文协议中“注解 N”段的显示前缀（回复识别也接受这些格式）。 */
export function replyHeading(ordinal: number, protocolLocale: ProtocolLocale): string {
  return protocolLocale === 'zh' ? `注解 ${ordinal}` : `Annotation ${ordinal}`
}

/** 回复文本中“注解 N”的识别候选（中英文与新旧格式）。 */
export function replyHeadingNeedles(ordinal: number): readonly string[] {
  return [`注解 ${ordinal}`, `Annotation ${ordinal}`]
}

/** 协议模板中“仅标记原文”的说明；机器标记与 ID 永远不本地化。 */
function highlightOnlyLabel(protocolLocale: ProtocolLocale): string {
  return protocolLocale === 'zh' ? '（仅标记原文）' : '(Highlight only)'
}

/** Produce the exact readable text sent to the model and retained in the standard user/message event. */
export function formatSubmissionMessage(payload: AnnotationSubmissionPayload): string {
  return payload.protocolLocale === 'zh'
    ? formatSubmissionMessageZh(payload)
    : formatSubmissionMessageEn(payload)
}

function formatSubmissionMessageZh(payload: AnnotationSubmissionPayload): string {
  const lines: string[] = [
    '[DSH 注解提交]',
    `Submission ID: ${payload.submissionId}`,
    `Reply annotations: ${payload.annotations.length}`,
    '',
    '总体要求：',
    payload.overallRequirement?.trim() || '请按注解逐条处理，并保持未涉及的原文不变。',
    '',
    '请按顺序逐条回应每一条注解：',
    '- 每段必须以「注解 N：」开头，N 为该注解的编号。',
    '- 不要合并不同注解；每个注解单独一段。',
    '- 「仅标记原文」表示需要检查并回应对应原文；不允许因为注解内容为空而跳过该项。',
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
      item.kind === 'highlight-only' ? highlightOnlyLabel('zh') : item.annotation,
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

function formatSubmissionMessageEn(payload: AnnotationSubmissionPayload): string {
  const lines: string[] = [
    '[DSH annotation submission]',
    `Submission ID: ${payload.submissionId}`,
    `Reply annotations: ${payload.annotations.length}`,
    '',
    'Overall requirement:',
    payload.overallRequirement?.trim() || 'Handle every annotation in order and preserve unaffected content.',
    '',
    'Respond to every annotation in order.',
    'Start each section with "Annotation N:".',
    'Do not merge different annotations.',
    '"Highlight only" means reviewing and responding to the selected text; never skip an item because its annotation content is empty.',
    'Emit the annotation\u2019s hidden association marker (an HTML comment, invisible to the user) before each section.',
    '',
  ]
  for (const item of payload.annotations) {
    lines.push(
      replyMarkerFor(payload, item),
      `Annotation ${item.ordinal} (${item.annotationId})`,
      `Reply message: ${item.messageId}`,
      `Reply event seq: ${item.messageSeq}`,
      'Selected text:',
      item.quote.exact,
      'User annotation:',
      item.kind === 'highlight-only' ? highlightOnlyLabel('en') : item.annotation,
    )
    const label = structureLabel(item.structure)
    if (label !== null) lines.push(`Source coordinates: ${label}`)
    lines.push('')
  }
  lines.push(
    'Processing acknowledgement:',
    'Only include annotation ids you actually handled in processed; append one hidden HTML comment at the end of the reply:',
    `<!-- ${MODEL_ACK_PREFIX}${JSON.stringify({
      submissionId: payload.submissionId,
      processed: ['annotation-id'],
    })} -->`,
    'Do not include annotation ids in processed unless your answer addresses them.',
  )
  return lines.join('\n')
}

/** 协议回退语言：DSH locale 无法识别或旧记录缺省时使用。 */
export const fallbackProtocolLocale: ProtocolLocale = FALLBACK_PROTOCOL_LOCALE

/** Text shown in the collapsed timeline row. */
export function submissionSummary(payload: AnnotationSubmissionPayload, locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'zh'
    ? `基于上一条回复添加了 ${payload.annotations.length} 条注解`
    : `Added ${payload.annotations.length} annotations to an earlier reply`
}
