/** Validates confirmed side references and renders only their frozen model-visible content. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { encodeJsonCommand } from './codec.ts'
import {
  formatSubmissionMessage,
  parseAttachmentIdentities,
  parseSubmissionPayload,
  parseTextQuoteSelector,
  sameAttachmentIdentities,
  validateSubmissionLimits,
} from './protocol.ts'
import { sha256Hex } from './snapshot-hash.ts'
import {
  SIDE_CHAT_COMMAND_NAME,
  SIDE_CHAT_PROTOCOL_SOURCE,
  SIDE_CHAT_PROTOCOL_VERSION,
} from './side-chat-types.ts'
import type {
  SideChatCommandReceipt,
  SideChatCommandFailureCode,
  SideChatReceiptState,
  SideChatReference,
  SideChatReferenceId,
  SideChatSubmissionPayload,
} from './side-chat-types.ts'
import type { AnnotationConfig, MessageIdentity, SubmissionId } from './types.ts'

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`)
  return value as Record<string, unknown>
}

function identity(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be nonblank`)
  return value
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a nonnegative integer`)
  return value
}

/** @param value - Untrusted persisted or wire reference. @returns A detached immutable occurrence. */
export function parseSideChatReference(value: unknown): SideChatReference {
  const source = record(value, 'side-chat reference')
  const messageId = identity(source.messageId, 'messageId') as MessageIdentity
  const responseVersion = identity(source.responseVersion, 'responseVersion') as MessageIdentity
  if (responseVersion !== messageId)
    throw new Error('side-chat reference version differs from its finalized message')
  return Object.freeze({
    referenceId: identity(source.referenceId, 'referenceId') as SideChatReferenceId,
    sourceSessionId: identity(source.sourceSessionId, 'sourceSessionId') as SessionId,
    messageId,
    messageSeq: integer(source.messageSeq, 'messageSeq'),
    responseVersion,
    quote: Object.freeze(parseTextQuoteSelector(source.quote, 'quote')),
    createdAt: integer(source.createdAt, 'createdAt'),
  })
}

/** @param value - Untrusted command or durable source payload. @returns Validated immutable request. */
export function parseSideChatSubmissionPayload(value: unknown): SideChatSubmissionPayload {
  const source = record(value, 'side-chat submission')
  if (source.protocolVersion !== SIDE_CHAT_PROTOCOL_VERSION || source.source !== SIDE_CHAT_PROTOCOL_SOURCE)
    throw new Error('unsupported side-chat submission protocol')
  const mainSessionId = identity(source.mainSessionId, 'mainSessionId') as SessionId
  const sideSessionId = identity(source.sideSessionId, 'sideSessionId') as SessionId
  if (mainSessionId === sideSessionId) throw new Error('side chat must target an independent Session')
  if (source.delivery !== 'queue') throw new Error('side chat must use queued delivery')
  if (source.protocolLocale !== 'zh' && source.protocolLocale !== 'en')
    throw new Error('invalid side-chat protocol locale')
  if (typeof source.question !== 'string') throw new Error('side-chat question must be text')
  if (!Array.isArray(source.references) || source.references.length === 0)
    throw new Error('side-chat submission requires a confirmed reference')
  const references = Object.freeze(source.references.map(parseSideChatReference))
  if (references.some((item) => item.sourceSessionId !== mainSessionId))
    throw new Error('side-chat reference belongs to another main Session')
  if (new Set(references.map((item) => item.referenceId)).size !== references.length)
    throw new Error('side-chat reference identities must be unique')
  const submissionId = identity(source.submissionId, 'submissionId') as SubmissionId
  const annotationSubmission =
    source.annotationSubmission === undefined
      ? undefined
      : parseSubmissionPayload(source.annotationSubmission)
  const attachmentIdentities = parseAttachmentIdentities(source.attachmentIdentities)
  if (annotationSubmission !== undefined) {
    if (
      String(annotationSubmission.sessionId) !== String(sideSessionId) ||
      annotationSubmission.submissionId !== submissionId ||
      annotationSubmission.delivery !== 'queue'
    )
      throw new Error('combined annotations must share the side-chat submission identity and target')
    if (
      annotationSubmission.attachmentIdentities !== undefined &&
      !sameAttachmentIdentities(annotationSubmission.attachmentIdentities, attachmentIdentities)
    )
      throw new Error('combined annotations must share the frozen attachment identities')
  }
  if (source.question.trim() === '' && annotationSubmission === undefined)
    throw new Error('side-chat question must be nonblank')
  return Object.freeze({
    protocolVersion: SIDE_CHAT_PROTOCOL_VERSION,
    source: SIDE_CHAT_PROTOCOL_SOURCE,
    submissionId,
    mainSessionId,
    sideSessionId,
    delivery: 'queue',
    createdAt: integer(source.createdAt, 'createdAt'),
    protocolLocale: source.protocolLocale,
    question: source.question,
    references,
    attachmentIdentities,
    ...(annotationSubmission === undefined ? {} : { annotationSubmission }),
  })
}

/** @param payload - Frozen request. @param config - Deployment admission limits. @returns Nothing. */
export function validateSideChatSubmissionLimits(
  payload: SideChatSubmissionPayload,
  config: AnnotationConfig,
): void {
  if (
    payload.references.length + (payload.annotationSubmission?.annotations.length ?? 0) >
    config.maxAnnotationsPerSubmission
  )
    throw new Error('side-chat reference count exceeds the configured submission limit')
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
  if (bytes > config.maxPayloadBytes) throw new Error('side-chat payload exceeds the configured byte limit')
  if (payload.annotationSubmission !== undefined)
    validateSubmissionLimits(payload.annotationSubmission, config, bytes)
}

/** @param payload - Frozen request. @returns Standard command line for the existing command Remote. */
export function encodeSideChatSubmissionCommand(payload: SideChatSubmissionPayload): string {
  return encodeJsonCommand(SIDE_CHAT_COMMAND_NAME, payload)
}

/** @param payload - Validated frozen request. @returns Fingerprint binding retries to identical content. */
export function sideChatSubmissionFingerprint(payload: SideChatSubmissionPayload): string {
  return sha256Hex(JSON.stringify(parseSideChatSubmissionPayload(payload)))
}

/** @param payload - Frozen request. @returns Exact model-visible user text recorded by the Host. */
export function formatSideChatSubmissionMessage(payload: SideChatSubmissionPayload): string {
  const zh = payload.protocolLocale === 'zh'
  const lines = [
    zh
      ? '以下引用来自主会话中用户明确选中的助手回复。根据这些引用和问题回答，不要假设能访问主会话的其他内容。'
      : 'The user explicitly selected these quotations from assistant replies in the main conversation. Answer using these quotations and the question; do not assume access to other main-conversation content.',
    '',
  ]
  payload.references.forEach((reference, index) => {
    lines.push(
      `${zh ? '引用' : 'Reference'} ${index + 1} [${reference.referenceId}]`,
      `${zh ? '来源会话' : 'Source session'}: ${reference.sourceSessionId}`,
      `${zh ? '助手消息' : 'Assistant message'}: ${reference.messageId}; seq=${reference.messageSeq}; version=${reference.responseVersion}`,
      `${zh ? '原文' : 'Quotation'}:`,
      reference.quote.exact,
      '',
    )
  })
  lines.push(zh ? '问题：' : 'Question:', payload.question)
  if (payload.annotationSubmission !== undefined)
    lines.push('', formatSubmissionMessage(payload.annotationSubmission))
  return lines.join('\n')
}

/** @param source - Standard message source. @returns Its side-chat request, or null for another source. */
export function parseSideChatSource(source: unknown): SideChatSubmissionPayload | null {
  if (typeof source !== 'object' || source === null || !('sideChatSubmission' in source)) return null
  const value = source.sideChatSubmission
  if (
    typeof value !== 'object' ||
    value === null ||
    !('protocolVersion' in value) ||
    value.protocolVersion !== SIDE_CHAT_PROTOCOL_VERSION
  )
    return null
  return parseSideChatSubmissionPayload(source.sideChatSubmission)
}

/** @param text - Existing command's serialized structured result. @returns Validated result, or null when unavailable; absent acknowledgement never implies acceptance. */
export function parseSideChatCommandReceipt(text: string | undefined): SideChatCommandReceipt | null {
  if (text === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    // Generic transport diagnostics are not an acknowledgement of this submission.
    void error
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source.protocolVersion !== 1 || source.source !== 'dsh-annotation-side-chat-result') return null
  if (
    source.submissionId !== undefined &&
    (typeof source.submissionId !== 'string' || source.submissionId.trim() === '')
  )
    return null
  const submissionId = source.submissionId as SubmissionId | undefined
  if (source.kind === 'accepted' || source.kind === 'duplicate') {
    if (submissionId === undefined) return null
    return Object.freeze({
      protocolVersion: 1,
      source: 'dsh-annotation-side-chat-result',
      kind: source.kind,
      submissionId,
    })
  }
  if (source.kind !== 'rejected' && source.kind !== 'unknown') return null
  if (
    !['payload', 'target', 'attachments', 'identity-conflict', 'historical-source', 'admission'].includes(
      String(source.code),
    )
  )
    return null
  return Object.freeze({
    protocolVersion: 1,
    source: 'dsh-annotation-side-chat-result',
    kind: source.kind,
    code: source.code as SideChatCommandFailureCode,
    ...(submissionId === undefined ? {} : { submissionId }),
  })
}

/** @param value - Existing Session Projection value. @returns Validated receipt state, or undefined while absent. */
export function parseSideChatReceiptState(value: unknown): SideChatReceiptState | undefined {
  if (value === undefined) return undefined
  const source = record(value, 'side-chat receipts')
  const entries = record(source.receipts, 'side-chat receipt entries')
  const receipts = Object.fromEntries(
    Object.entries(entries).map(([key, fingerprint]) => {
      if (key.trim() === '' || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(fingerprint))
        throw new Error('invalid side-chat receipt identity or fingerprint')
      return [key, fingerprint]
    }),
  )
  return Object.freeze({ receipts: Object.freeze(receipts) })
}
