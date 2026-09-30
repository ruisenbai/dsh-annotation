import { diffQuote, parseDiffSource, diffPosition } from './diff-source.ts'
import {
  officialDiffContext,
  officialDiffPosition,
  officialDiffQuote,
  parseFileAnnotationSource,
  parseOfficialDiffSource,
} from './official-source.ts'
import type { AnnotationAnchor } from './annotation-source.ts'
import { quoteFragmentHash } from './snapshot-hash.ts'
import {
  DEFAULT_PROCESSING_MODE,
  FALLBACK_PROTOCOL_LOCALE,
  MODEL_ACK_PREFIX,
  PROTOCOL_SOURCE,
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
  ProcessingMode,
  ProtocolLocale,
  SessionIdentity,
  StructuredSelection,
  SubmissionId,
  SubmittedAnnotation,
  SubmittedAttachmentIdentity,
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

/**
 * Read ordered attachment identities from Host preflight, wire JSON, or durable records.
 * @param value Untrusted identity array; raw bytes and receipt fields are not retained.
 * @returns Frozen, validated attachment identities in their original order.
 */
export function parseAttachmentIdentities(value: unknown): readonly SubmittedAttachmentIdentity[] {
  if (!Array.isArray(value)) throw new ProtocolError('attachmentIdentities must be an array')
  return Object.freeze(
    value.map((entry, index): SubmittedAttachmentIdentity => {
      const field = `attachmentIdentities[${index}]`
      const source = record(entry, field)
      const attachmentId = id<SubmittedAttachmentIdentity['attachmentId']>(
        source.attachmentId,
        `${field}.attachmentId`,
      )
      const bytes = integer(source.bytes, `${field}.bytes`)
      if (source.type === 'file') {
        return Object.freeze({
          type: 'file',
          attachmentId,
          bytes,
          name: string(source.name, `${field}.name`),
        })
      }
      if (source.type !== 'image') throw new ProtocolError(`${field}.type must be image or file`)
      const mediaType = source.mediaType
      if (
        mediaType !== 'image/png' &&
        mediaType !== 'image/jpeg' &&
        mediaType !== 'image/webp' &&
        mediaType !== 'image/gif'
      ) {
        throw new ProtocolError(`${field}.mediaType must be a supported image type`)
      }
      const name = optionalString(source.name, `${field}.name`)
      return Object.freeze({
        type: 'image',
        attachmentId,
        bytes,
        mediaType,
        ...(name === undefined ? {} : { name }),
      })
    }),
  )
}

/**
 * Compare complete attachment identity and order without temporary upload credentials.
 * @param expected Frozen identities from the original submission.
 * @param actual Identities admitted for this attempt.
 * @returns Whether this attempt carries the original attachments in order.
 */
export function sameAttachmentIdentities(
  expected: readonly SubmittedAttachmentIdentity[],
  actual: readonly SubmittedAttachmentIdentity[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((item, index) => {
      const other = actual[index]!
      return (
        item.type === other.type &&
        item.attachmentId === other.attachmentId &&
        item.bytes === other.bytes &&
        item.name === other.name &&
        (item.type !== 'image' || (other.type === 'image' && item.mediaType === other.mediaType))
      )
    })
  )
}

/**
 * Parse a persisted or wire processing mode, defaulting only when the field is absent.
 * @param value Untrusted mode field from wire or browser persistence.
 * @returns A supported processing mode.
 * @throws {ProtocolError} When an explicit value is not a supported mode.
 */
export function parseProcessingMode(value: unknown): ProcessingMode {
  if (value === undefined) return DEFAULT_PROCESSING_MODE
  if (value === 'answer' || value === 'rewrite' || value === 'modify') return value
  throw new ProtocolError('processingMode must be answer, rewrite, or modify')
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

/** Decode source-specific coordinates; legacy records without a discriminator remain message sources. */
export function parseAnnotationAnchor(value: Record<string, unknown>): AnnotationAnchor {
  if (value.source !== undefined) {
    const source = record(value.source, 'annotation.source')
    if (source.kind === 'diff' || source.kind === 'file' || source.kind === 'official-diff') {
      if (
        value.messageId !== undefined ||
        value.messageSeq !== undefined ||
        value.responseVersion !== undefined
      ) {
        throw new ProtocolError('Non-message annotations must not carry message coordinates')
      }
      try {
        if (source.kind === 'diff') return { source: parseDiffSource(source) }
        if (source.kind === 'file') return { source: parseFileAnnotationSource(source) }
        return { source: parseOfficialDiffSource(source) }
      } catch (error: unknown) {
        throw new ProtocolError(error instanceof Error ? error.message : String(error))
      }
    }
    if (source.kind !== 'message') throw new ProtocolError('Unknown annotation source kind')
  }
  const messageId = id<MessageIdentity>(value.messageId, 'messageId')
  const messageSeq = integer(value.messageSeq, 'messageSeq')
  const responseVersion = id<MessageIdentity>(value.responseVersion, 'responseVersion')
  if (responseVersion !== messageId)
    throw new ProtocolError('responseVersion must equal the finalized assistant message id')
  const anchor = { messageId, messageSeq, responseVersion }
  if (value.source === undefined) return anchor
  const source = record(value.source, 'annotation.source')
  if (
    source.messageId !== messageId ||
    source.messageSeq !== messageSeq ||
    source.responseVersion !== responseVersion
  ) {
    throw new ProtocolError('Message source coordinates disagree')
  }
  return { ...anchor, source: Object.freeze({ kind: 'message' as const, ...anchor }) }
}

/** Diff quotes are reconstructed from immutable snapshots, never from current files. */
export function parseAnnotationQuote(value: unknown, anchor: AnnotationAnchor): TextQuoteSelector {
  if (
    anchor.source?.kind !== 'diff' &&
    anchor.source?.kind !== 'official-diff' &&
    anchor.source?.kind !== 'file'
  )
    return parseTextQuoteSelector(value, 'quote')
  if (
    (anchor.source.kind === 'official-diff' && anchor.source.wholeFile) ||
    (anchor.source.kind === 'file' && anchor.source.wholeFile)
  ) {
    const quote = record(value, 'quote')
    if (quote.exact !== '' || quote.start !== 0 || quote.end !== 0) {
      throw new ProtocolError('Whole-file official sources must not carry a text quote')
    }
    return Object.freeze({ exact: '', prefix: '', suffix: '', start: 0, end: 0 })
  }
  if (anchor.source.kind === 'file') {
    const quote = parseTextQuoteSelector(value, 'quote')
    if (anchor.source.snapshot.version === 2) {
      if (quote.exact.length === 0 || quoteFragmentHash(quote) !== anchor.source.snapshot.fragmentHash)
        throw new ProtocolError('File quote does not match its verified fragment')
      if (anchor.source.snapshot.coordinateSpace === 'raw') {
        const lines = quote.exact.split('\n')
        if (lines.length !== anchor.source.endLine! - anchor.source.startLine! + 1)
          throw new ProtocolError('File quote does not match its line range')
        if (
          lines.length === 1 &&
          anchor.source.endColumn! - anchor.source.startColumn! !== quote.exact.length
        )
          throw new ProtocolError('File quote does not match its column range')
        if (lines.length > 1 && anchor.source.endColumn !== lines[lines.length - 1]!.length)
          throw new ProtocolError('File quote does not match its final column')
      }
      return quote
    }
    const text = anchor.source.snapshot.renderedText ?? anchor.source.snapshot.text
    if (text === undefined || quote.exact.length === 0 || text.slice(quote.start, quote.end) !== quote.exact)
      throw new ProtocolError('File quote does not match its immutable snapshot')
    if (
      text.slice(Math.max(0, quote.start - quote.prefix.length), quote.start) !== quote.prefix ||
      text.slice(quote.end, quote.end + quote.suffix.length) !== quote.suffix
    )
      throw new ProtocolError('File quote context does not match its immutable snapshot')
    const startLine = text.slice(0, quote.start).split('\n').length
    const endLine = text.slice(0, quote.end).split('\n').length
    const startColumn = quote.start - text.lastIndexOf('\n', quote.start - 1) - 1
    const endColumn = quote.end - text.lastIndexOf('\n', quote.end - 1) - 1
    if (
      anchor.source.startLine !== startLine ||
      anchor.source.endLine !== endLine ||
      anchor.source.startColumn !== startColumn ||
      anchor.source.endColumn !== endColumn
    )
      throw new ProtocolError('File anchor does not match its immutable snapshot')
    return quote
  }
  const quote = record(value, 'quote')
  if (anchor.source.kind === 'official-diff' && anchor.source.snapshot.version === 2) {
    const parsed = parseTextQuoteSelector(quote, 'quote')
    if (parsed.exact.length === 0 || quoteFragmentHash(parsed) !== anchor.source.snapshot.fragmentHash)
      throw new ProtocolError('Diff quote does not match its verified fragment')
    const lines = parsed.exact.split('\n')
    if (
      lines.length !== anchor.source.endLine! - anchor.source.startLine! + 1 ||
      (lines.length === 1 &&
        anchor.source.startColumn !== undefined &&
        parsed.exact.length !== anchor.source.endColumn! - anchor.source.startColumn) ||
      (lines.length > 1 &&
        anchor.source.endColumn !== undefined &&
        lines[lines.length - 1]!.length !== anchor.source.endColumn)
    )
      throw new ProtocolError('Diff quote does not match its line and column range')
    return parsed
  }
  const expected = anchor.source.kind === 'diff' ? diffQuote(anchor.source) : officialDiffQuote(anchor.source)
  if (Object.entries(expected).some(([key, item]) => quote[key] !== item)) {
    throw new ProtocolError('Diff quote does not match its immutable snapshot')
  }
  return expected
}

/** Read one wire annotation and convert legacy `comment` into the v2 `annotation` model. */
export function parseSubmittedAnnotation(value: unknown, index: number): SubmittedAnnotation {
  const field = `annotations[${index}]`
  const source = record(value, field) as UnknownRecord & WireAnnotation
  const parsedStructure = parseStructuredSelection(source.structure, `${field}.structure`)
  const annotationText = source.annotation ?? source.comment
  // 注解内容允许为空：空内容表示仅标记原文。
  const annotation = string(annotationText, `${field}.annotation`, true)
  const annotationId = id<AnnotationId>(source.annotationId, `${field}.annotationId`)
  const supplementalTo =
    source.supplementalTo === undefined
      ? undefined
      : id<AnnotationId>(source.supplementalTo, `${field}.supplementalTo`)
  if (supplementalTo === annotationId) {
    throw new ProtocolError(`${field}.supplementalTo must not reference the annotation itself`)
  }
  const anchor = parseAnnotationAnchor(source)
  if (
    (anchor.source?.kind === 'diff' || anchor.source?.kind === 'official-diff') &&
    parsedStructure !== undefined
  )
    throw new ProtocolError('Diff sources cannot use message-fragment coordinates')
  const parsed: SubmittedAnnotation = {
    annotationId,
    ordinal: integer(source.ordinal, `${field}.ordinal`, 1),
    ...anchor,
    quote: parseAnnotationQuote(source.quote, anchor),
    annotation,
    kind: resolveAnnotationKind(source.kind, annotation),
    createdAt: integer(source.createdAt, `${field}.createdAt`),
    ...(parsedStructure === undefined ? {} : { structure: parsedStructure }),
    ...(supplementalTo === undefined ? {} : { supplementalTo }),
  }
  return Object.freeze(parsed)
}

/** Parse durable or wire JSON without trusting TypeScript declarations across the boundary. */
export function parseSubmissionPayload(value: unknown): AnnotationSubmissionPayload {
  const source = record(value, 'submission')
  const version = source.protocolVersion
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    throw new ProtocolError(`unsupported protocolVersion ${String(version)}`)
  }
  if (!Array.isArray(source.annotations) || source.annotations.length === 0) {
    throw new ProtocolError('annotations must be a non-empty array')
  }
  if (version !== 1) {
    if (source.source !== PROTOCOL_SOURCE) {
      throw new ProtocolError(`source must be ${PROTOCOL_SOURCE}`)
    }
  }
  const annotations = source.annotations.map(parseSubmittedAnnotation)
  if (
    (version === 3 || version === 4 || version === 5) &&
    annotations.some((item) => item.source === undefined)
  )
    throw new ProtocolError(`Protocol v${version} requires an explicit annotation source`)
  if (version !== 3 && annotations.some((item) => item.source?.kind === 'diff'))
    throw new ProtocolError('Historical Diff sources require protocol v3')
  if (
    version !== 4 &&
    version !== 5 &&
    annotations.some((item) => item.source?.kind === 'file' || item.source?.kind === 'official-diff')
  )
    throw new ProtocolError('Official file and Diff sources require protocol v4')
  if (
    version !== 5 &&
    annotations.some(
      (item) =>
        (item.source?.kind === 'file' || item.source?.kind === 'official-diff') &&
        item.source.snapshot.version === 2,
    )
  )
    throw new ProtocolError('Compact official sources require protocol v5')
  if (
    version === 5 &&
    annotations.some(
      (item) =>
        (item.source?.kind === 'file' || item.source?.kind === 'official-diff') &&
        item.source.wholeFile &&
        item.annotation.trim() === '',
    )
  )
    throw new ProtocolError('Whole-file annotations require an opinion')
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
    protocolVersion: version === 5 ? 5 : version === 4 ? 4 : version === 3 ? 3 : 2,
    source: PROTOCOL_SOURCE,
    submissionId: id<SubmissionId>(source.submissionId, 'submissionId'),
    sessionId: id<SessionIdentity>(source.sessionId, 'sessionId'),
    delivery,
    protocolLocale,
    processingMode: parseProcessingMode(source.processingMode),
    createdAt: integer(source.createdAt, 'createdAt'),
    ...(overallRequirement === undefined ? {} : { overallRequirement }),
    annotations: Object.freeze(annotations),
    ...(source.attachmentIdentities === undefined
      ? {}
      : { attachmentIdentities: parseAttachmentIdentities(source.attachmentIdentities) }),
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

const PROCESSING_INSTRUCTIONS_ZH: Readonly<Record<ProcessingMode, readonly string[]>> = {
  answer: [
    '交付方式：逐条回答',
    '请按顺序逐条回答每一条注解：',
    '- 每段必须以「注解 N：」开头，N 为该注解的编号。',
    '- 不要合并不同注解；每个注解单独一段。',
    '- 每段回答前先输出该注解的隐藏关联标记（HTML 注释，用户不可见）。',
  ],
  rewrite: [
    '交付方式：连贯重写',
    '请把批注意见落实为一篇连贯的整合正文：',
    '- 先输出重写后的完整正文，把相关注解自然融入内容；可以合并处理相互关联的注解。',
    '- 不要把正文写成逐条问答，也不要为了对应注解而破坏正文连贯性。',
    '- 正文后附上简短的批注处理说明；按注解顺序排列，每条以「注解 N：」开头，并在前面输出该注解的隐藏关联标记（HTML 注释，用户不可见）。',
  ],
  modify: [
    '交付方式：实际修改',
    '请围绕被批注对象实际执行修改并报告结果：',
    '- 对可访问的被批注对象落实修改，保留未涉及部分；需要工具时使用可用工具。',
    '- 不要只解释应该如何修改，也不要把建议当作已经完成的修改。',
    '- 如果缺少工具、权限或必要材料而不能执行，明确说明未完成原因和所需条件。',
    '- 修改结果后附上简短的批注处理说明；按注解顺序排列，每条以「注解 N：」开头，并在前面输出该注解的隐藏关联标记（HTML 注释，用户不可见）。',
  ],
}

const PROCESSING_INSTRUCTIONS_EN: Readonly<Record<ProcessingMode, readonly string[]>> = {
  answer: [
    'Delivery mode: answer',
    'Answer every annotation in order:',
    '- Start each section with "Annotation N:", where N is the annotation ordinal.',
    '- Do not merge different annotations; use a separate section for each.',
    '- Emit the annotation\u2019s hidden association marker (an HTML comment, invisible to the user) before each section.',
  ],
  rewrite: [
    'Delivery mode: rewrite',
    'Produce a coherent integrated rewrite as the primary deliverable:',
    '- Output the complete rewritten body first, naturally integrate the relevant annotations, and combine related annotations when useful.',
    '- Do not turn the rewritten body into a per-annotation Q&A or break its flow to mirror the annotation list.',
    '- After the body, add brief annotation-handling notes in annotation order. Start each note with "Annotation N:" and emit its hidden association marker (an HTML comment, invisible to the user) before it.',
  ],
  modify: [
    'Delivery mode: modify',
    'Make actual changes to the annotated target and report the result:',
    '- Apply changes to the accessible target, preserve unaffected parts, and use available tools when needed.',
    '- Do not only explain what should change or present a suggestion as a completed change.',
    '- If missing tools, permissions, or required materials prevent execution, state what remains undone and what is needed.',
    '- After the modification result, add brief annotation-handling notes in annotation order. Start each note with "Annotation N:" and emit its hidden association marker (an HTML comment, invisible to the user) before it.',
  ],
}

/** Human-readable source context is derived solely from the durable submitted source. */
function annotationLocationLines(item: SubmittedAnnotation): string[] {
  const source = item.source
  if (source === undefined || source.kind === 'message')
    return [`Reply message: ${item.messageId}`, `Reply event seq: ${item.messageSeq}`]
  if (source.kind === 'file') {
    const coordinateSpace =
      source.snapshot.coordinateSpace ?? (source.snapshot.renderedText === undefined ? 'raw' : 'rendered')
    return [
      `Source: file preview; ${source.path}${source.wholeFile ? ' · whole file' : ''}`,
      `Session: ${source.sessionId}; resource: ${source.resourceAddress}`,
      `Format: ${source.format}; snapshot: ${source.snapshot.hash}; bytes: ${source.snapshot.bytes}`,
      `Resource version: ${source.resourceVersion}; whole file: ${source.wholeFile ? 'yes' : 'no'}`,
      ...(source.wholeFile
        ? ['Range: entire captured file']
        : coordinateSpace === 'rendered' && source.startLine === undefined
          ? [
              `Coordinates (rendered): UTF-16 offsets ${item.quote.start}–${item.quote.end} (zero-based, end exclusive; original file line mapping unavailable)`,
            ]
          : source.startColumn === undefined || source.endColumn === undefined
            ? [`Coordinates (${coordinateSpace}): lines ${source.startLine}–${source.endLine} (one-based)`]
            : [
                `Coordinates (${coordinateSpace}): lines ${source.startLine}–${source.endLine}; UTF-16 columns ${source.startColumn}–${source.endColumn} (zero-based, end exclusive)`,
              ]),
      `Creation entry: ${source.entry}`,
      'These coordinates refer to the captured resource version, not the current file at the same path.',
    ]
  }
  if (source.kind === 'official-diff') {
    const context = officialDiffContext(source)
    return [
      `Source: official turn Diff; ${officialDiffPosition(source)}`,
      `Session: ${source.snapshot.sessionId}; changes event seq: ${source.snapshot.seq}; turn: ${source.snapshot.turn}`,
      `File index: ${source.snapshot.fileIndex}; snapshot: ${source.snapshot.hash}`,
      `Diff kind: ${source.snapshot.kind}; creation entry: ${source.entry}`,
      `Side: ${source.side}; whole file: ${source.wholeFile ? 'yes' : 'no'}`,
      ...(source.startLine === undefined
        ? []
        : [
            `Coordinates: ${source.startLine}${source.endLine === source.startLine ? '' : `-${source.endLine}`}${
              source.startColumn === undefined ? '' : `:${source.startColumn + 1}-${source.endColumn}`
            }`,
          ]),
      `Snapshot context before: ${JSON.stringify(context.before)}`,
      `Snapshot context after: ${JSON.stringify(context.after)}`,
      'These coordinates refer to the captured official turn snapshot, not the current workspace or Git state.',
    ]
  }
  const snapshot = source.snapshot
  const version = (side: typeof snapshot.old) =>
    side.kind === 'absent' ? 'absent' : `${side.kind} ${side.oid ?? `sha256:${side.sha256}`}`
  return [
    `Source: Git diff; ${diffPosition(source)} (1-based file lines)`,
    `Repository: ${JSON.stringify(snapshot.repository)}`,
    `File: ${JSON.stringify(snapshot.newPath ?? snapshot.oldPath)}`,
    `Old path: ${JSON.stringify(snapshot.oldPath)}; new path: ${JSON.stringify(snapshot.newPath)}`,
    `Comparison: ${snapshot.range === 'staged' ? 'HEAD -> index (staged)' : 'index -> working tree (unstaged)'}`,
    `Old version: ${version(snapshot.old)}; new version: ${version(snapshot.new)}`,
    `HEAD at capture: ${snapshot.head ?? 'unborn'}; snapshot: ${snapshot.id}`,
    `Side: ${source.side}; file lines: ${source.startLine}-${source.endLine}`,
    `Context before: ${JSON.stringify(source.contextBefore)}`,
    `Context after: ${JSON.stringify(source.contextAfter)}`,
    'These coordinates refer to the captured versions, not the current file at the same line numbers.',
    ...(source.reboundFrom === undefined
      ? []
      : [
          `Explicitly rebound from snapshot ${source.reboundFrom.snapshot.id}; the original source is retained.`,
        ]),
  ]
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
    `Processing mode: ${payload.processingMode}`,
    '',
    '总体要求：',
    payload.overallRequirement?.trim() || '（没有额外的用户目标或约束。）',
    '总体要求用于指定目标、范围与约束；处理方式用于指定交付形式。如果二者直接冲突，请明确指出冲突并请求澄清，不要静默忽略其中一项。',
    '',
    ...PROCESSING_INSTRUCTIONS_ZH[payload.processingMode],
    '- 「仅标记原文」表示没有额外注解文字；仍须按当前交付方式处理对应原文，不能跳过。',
    '',
  ]
  for (const item of payload.annotations) {
    lines.push(replyMarkerFor(payload, item), `注解 ${item.ordinal} (${item.annotationId})`)
    if (item.supplementalTo !== undefined) {
      lines.push(`补充关联注解 ID：${item.supplementalTo}`)
    }
    lines.push(
      ...annotationLocationLines(item),
      '原文前文：',
      item.quote.prefix,
      '被选中的原文：',
      item.quote.exact,
      '原文后文：',
      item.quote.suffix,
      '用户的注解：',
      item.kind === 'highlight-only' ? highlightOnlyLabel('zh') : item.annotation,
    )
    const label = structureLabel(item.structure)
    if (label !== null) lines.push(`Source coordinates: ${label}`)
    lines.push('')
  }
  lines.push(
    '处理确认：',
    '只把你在本次回复中按当前处理模式实际处理完成的注解 ID 写进 processed；不要自动写入本批次的全部 ID。',
    '在回复结尾附加一个隐藏 HTML 注释：',
    `<!-- ${MODEL_ACK_PREFIX}${JSON.stringify({
      submissionId: payload.submissionId,
      processed: ['annotation-id'],
    })} -->`,
    '没有实际处理完成的注解 ID 不要放进 processed。',
  )
  return lines.join('\n')
}

function formatSubmissionMessageEn(payload: AnnotationSubmissionPayload): string {
  const lines: string[] = [
    '[DSH annotation submission]',
    `Submission ID: ${payload.submissionId}`,
    `Reply annotations: ${payload.annotations.length}`,
    `Processing mode: ${payload.processingMode}`,
    '',
    'Overall requirement:',
    payload.overallRequirement?.trim() || '(No additional user goal or constraint was provided.)',
    'The overall requirement defines goals, scope, and constraints; the processing mode defines the deliverable. If they directly conflict, explain the conflict and ask for clarification instead of silently ignoring either one.',
    '',
    ...PROCESSING_INSTRUCTIONS_EN[payload.processingMode],
    '- "Highlight only" means there is no additional annotation text; still handle the selected text in the current delivery mode and never skip it.',
    '',
  ]
  for (const item of payload.annotations) {
    lines.push(replyMarkerFor(payload, item), `Annotation ${item.ordinal} (${item.annotationId})`)
    if (item.supplementalTo !== undefined) {
      lines.push(`Supplemental to annotation ID: ${item.supplementalTo}`)
    }
    lines.push(
      ...annotationLocationLines(item),
      'Quote prefix:',
      item.quote.prefix,
      'Selected text:',
      item.quote.exact,
      'Quote suffix:',
      item.quote.suffix,
      'User annotation:',
      item.kind === 'highlight-only' ? highlightOnlyLabel('en') : item.annotation,
    )
    const label = structureLabel(item.structure)
    if (label !== null) lines.push(`Source coordinates: ${label}`)
    lines.push('')
  }
  lines.push(
    'Processing acknowledgement:',
    'Only include annotation ids actually completed in this reply under the selected processing mode; do not automatically include the full batch.',
    'Append one hidden HTML comment at the end of the reply:',
    `<!-- ${MODEL_ACK_PREFIX}${JSON.stringify({
      submissionId: payload.submissionId,
      processed: ['annotation-id'],
    })} -->`,
    'Do not include an annotation id in processed unless its requested handling was actually completed.',
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
