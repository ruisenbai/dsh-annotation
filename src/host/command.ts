import { Buffer } from 'node:buffer'
import { TextDecoder } from 'node:util'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  formatSubmissionMessage,
  parseSubmissionPayload,
  validateSubmissionLimits,
} from '../shared/protocol.ts'
import { submissionMessageId } from '../shared/ids.ts'
import type {
  AnnotationConfig,
  AnnotationSubmissionPayload,
  InlineCommentMessageSource,
  LegacyInlineAnnotationMessageSource,
} from '../shared/types.ts'

/** Make the plugin's durable user provenance visible to DSH's merge-extensible source union. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    inlineComments: InlineCommentMessageSource
    inlineAnnotations: LegacyInlineAnnotationMessageSource
  }
}

function decodePayload(rawInput: string, config: AnnotationConfig): AnnotationSubmissionPayload {
  const encoded = rawInput.trim()
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('annotation payload is not base64url')
  const bytes = Buffer.from(encoded, 'base64url')
  if (bytes.byteLength > config.maxPayloadBytes) {
    throw new Error(`annotation payload is ${bytes.byteLength} bytes; maximum is ${config.maxPayloadBytes}`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new Error('annotation payload is not valid UTF-8', { cause: error })
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error('annotation payload is not valid JSON', { cause: error })
  }
  const payload = parseSubmissionPayload(value)
  validateSubmissionLimits(payload, config, bytes.byteLength)
  return payload
}

function hasMessage(agent: Agent, messageId: string): boolean {
  if (agent.inbox.nextTurn.some((message) => message.id === messageId)) return true
  if (agent.inbox.nextStep.some((message) => message.id === messageId)) return true
  return agent.session.events.some((event) => event.type === 'user/message' && event.data.id === messageId)
}

function createAnnotationMessage(payload: AnnotationSubmissionPayload): UserMessage {
  const source: InlineCommentMessageSource = Object.freeze({
    kind: 'user',
    inlineComments: payload,
  })
  return Object.freeze({
    id: submissionMessageId(payload.submissionId) as unknown as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text' as const, text: formatSubmissionMessage(payload) }],
    source,
  })
}

/** Validate and enqueue one idempotent annotation batch against the exact receiving agent. */
export function submitAnnotationPayload(
  agent: Agent,
  payload: AnnotationSubmissionPayload,
): { readonly duplicate: boolean; readonly messageId: string } {
  if (String(agent.id) !== payload.sessionId) {
    throw new Error(`annotation payload targets session ${payload.sessionId}, not ${String(agent.id)}`)
  }
  const messageId = submissionMessageId(payload.submissionId)
  if (hasMessage(agent, messageId)) return Object.freeze({ duplicate: true, messageId })
  const message = createAnnotationMessage(payload)
  if (payload.delivery === 'steer') agent.steer(message)
  else agent.followup(message)
  return Object.freeze({ duplicate: false, messageId })
}

/** Build the internal command definition used by the browser half. */
export function createAnnotationCommand(config: AnnotationConfig): CommandDefinition {
  return Object.freeze({
    name: config.commandName,
    description: 'Submit an idempotent batch of inline reply comments',
    input: { hint: '<internal-base64url-payload>' },
    recordInput: false,
    handler(invocation: CommandInvocation): CommandResult {
      if (invocation.signal.aborted) {
        throw invocation.signal.reason ?? new Error('annotation submission was aborted')
      }
      const payload = decodePayload(invocation.rawInput, config)
      const result = submitAnnotationPayload(invocation.agent, payload)
      return Object.freeze({
        kind: 'success',
        text: result.duplicate ? 'Comment batch was already accepted.' : 'Comment batch accepted.',
      })
    },
  })
}
