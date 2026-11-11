/** Side-chat command and compaction-safe receipts folded from standard persisted events. */
import { Buffer } from 'node:buffer'
import { TextDecoder } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'
import { isLegacyDiffSource } from '../shared/annotation-source.ts'
import { submissionMessageId } from '../shared/ids.ts'
import { sameAttachmentIdentities } from '../shared/protocol.ts'
import {
  formatSideChatSubmissionMessage,
  parseSideChatSource,
  parseSideChatSubmissionPayload,
  sideChatSubmissionFingerprint,
  validateSideChatSubmissionLimits,
} from '../shared/side-chat-protocol.ts'
import { SIDE_CHAT_COMMAND_NAME, SIDE_CHAT_RECEIPTS_PROJECTION } from '../shared/side-chat-types.ts'
import type {
  SideChatMessageSource,
  SideChatCommandReceipt,
  SideChatCommandFailureCode,
  SideChatReceiptState,
  SideChatSubmissionPayload,
} from '../shared/side-chat-types.ts'
import type { AnnotationConfig, SubmissionId, SubmittedAttachmentIdentity } from '../shared/types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Explicit side references and the optional independent annotation batch. */
    sideChatSubmission: SideChatMessageSource
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Compaction-safe side-chat receipts; excluded from Session list summaries. */
    annotationSideChatReceipts: SessionProjectionSummaryExcluded<SideChatReceiptState>
  }
}

const receiptSchema = z.object({ receipts: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)) })

function addReceipt(state: SideChatReceiptState, source: unknown): SideChatReceiptState {
  const payload = parseSideChatSource(source)
  if (payload === null) return state
  const fingerprint = sideChatSubmissionFingerprint(payload)
  const existing = Object.hasOwn(state.receipts, payload.submissionId)
    ? state.receipts[payload.submissionId]
    : undefined
  if (existing === fingerprint) return state
  if (existing !== undefined)
    throw new Error('Side-chat submission identity has conflicting persisted content')
  return Object.freeze({
    receipts: Object.freeze({ ...state.receipts, [payload.submissionId]: fingerprint }),
  })
}

/** @returns A pure receipt fold with O(n) retained space, O(1) lookup, and O(n) state copying per new accepted submission. */
export function createSideChatReceiptProjection(): Omit<
  ProjectionDefinition<typeof SIDE_CHAT_RECEIPTS_PROJECTION, SideChatReceiptState>,
  'wire'
> & {
  wire: NonNullable<ProjectionDefinition<typeof SIDE_CHAT_RECEIPTS_PROJECTION, SideChatReceiptState>['wire']>
} {
  return {
    key: SIDE_CHAT_RECEIPTS_PROJECTION,
    stateVersion: 1,
    stateSchema: receiptSchema,
    init: () => Object.freeze({ receipts: Object.freeze({}) }),
    apply(state: SideChatReceiptState, event: SessionEvent): SideChatReceiptState {
      if (event.type === 'user/message') return addReceipt(state, event.data.source)
      if (event.type !== 'agent/inbox/spliced') return state
      let next = state
      for (const message of event.data.inserted) next = addReceipt(next, message.source)
      return next
    },
    wire: { viewSchema: receiptSchema, view: (state) => state, summary: false },
  }
}

/** Admission failure with explicit effect classification, separate from its diagnostic wording. */
export class SideChatCommandFailure extends Error {
  /** @param code - Failure category. @param effect - Whether inbox admission may have occurred. @param cause - Original failure. */
  constructor(
    readonly code: SideChatCommandFailureCode,
    readonly effect: 'none' | 'unknown',
    cause?: unknown,
  ) {
    super(`Side-chat submission failed: ${code}`, cause === undefined ? undefined : { cause })
    this.name = 'SideChatCommandFailure'
  }
}

/** Ready Projection reader kept private; all receipt reads go through this domain owner. */
export class SideChatSubmissionOwner {
  /** @param handle - Ready effect-owned Projection handle. */
  constructor(private readonly handle: ProjectionHandle<SideChatReceiptState>) {}

  /** @param session - Receiving Session. @param submissionId - Frozen identity. @returns Its accepted fingerprint, if any. */
  receipt(session: Session, submissionId: SubmissionId): string | undefined {
    const state = this.handle.stateOf(session)
    return Object.hasOwn(state.receipts, submissionId) ? state.receipts[submissionId] : undefined
  }

  /** @param agent - Exact receiving Agent. @param payload - Frozen request. @param attachments - Ordered admitted blocks. @returns Acceptance or an identical duplicate; throws with effect classification. */
  submit(
    agent: Pick<Agent, 'id' | 'session' | 'followup'>,
    payload: SideChatSubmissionPayload,
    attachments: readonly (ImageBlock | FileBlock)[] = [],
  ): SideChatCommandReceipt {
    if (agent.id !== payload.sideSessionId) throw new SideChatCommandFailure('target', 'none')
    const identities = attachments.map((block): SubmittedAttachmentIdentity => {
      const { attachmentId, bytes, name } = block.attachment
      return block.type === 'file'
        ? { type: 'file', attachmentId, bytes, name: block.attachment.name }
        : {
            type: 'image',
            attachmentId,
            bytes,
            mediaType: block.attachment.mediaType,
            ...(name === undefined ? {} : { name }),
          }
    })
    if (!sameAttachmentIdentities(payload.attachmentIdentities, identities))
      throw new SideChatCommandFailure('attachments', 'none')
    if (payload.annotationSubmission?.annotations.some(isLegacyDiffSource))
      throw new SideChatCommandFailure('historical-source', 'none')
    const fingerprint = sideChatSubmissionFingerprint(payload)
    const existing = this.receipt(agent.session, payload.submissionId)
    if (existing !== undefined) {
      if (existing !== fingerprint) throw new SideChatCommandFailure('identity-conflict', 'none')
      return this.acceptance(payload.submissionId, true)
    }
    const source: SideChatMessageSource = Object.freeze({
      kind: 'user',
      sideChatSubmission: payload,
      ...(payload.annotationSubmission === undefined
        ? {}
        : { annotationSubmission: payload.annotationSubmission }),
    })
    const message: UserMessage = Object.freeze({
      id: MessageId(String(submissionMessageId(payload.submissionId))),
      role: 'user',
      content: [{ type: 'text' as const, text: formatSideChatSubmissionMessage(payload) }, ...attachments],
      source,
    })
    try {
      agent.followup(message)
      if (this.receipt(agent.session, payload.submissionId) !== fingerprint)
        throw new SideChatCommandFailure('admission', 'unknown')
    } catch (cause: unknown) {
      // The receipt observes committed splices even when a later notification fails.
      if (this.receipt(agent.session, payload.submissionId) === fingerprint)
        return this.acceptance(payload.submissionId, false)
      throw new SideChatCommandFailure('admission', 'unknown', cause)
    }
    return this.acceptance(payload.submissionId, false)
  }

  private acceptance(submissionId: SubmissionId, duplicate: boolean): SideChatCommandReceipt {
    return Object.freeze({
      protocolVersion: 1,
      source: 'dsh-annotation-side-chat-result',
      kind: duplicate ? 'duplicate' : 'accepted',
      submissionId,
    })
  }
}

function decodePayload(rawInput: string, config: AnnotationConfig): SideChatSubmissionPayload {
  try {
    const encoded = rawInput.trim()
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('Side-chat payload is not base64url')
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.byteLength > config.maxPayloadBytes)
      throw new Error('Side-chat payload exceeds the configured byte limit')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value: unknown = JSON.parse(text)
    const payload = parseSideChatSubmissionPayload(value)
    validateSideChatSubmissionLimits(payload, config)
    return payload
  } catch (cause: unknown) {
    throw new SideChatCommandFailure('payload', 'none', cause)
  }
}

/** @param config - Validated admission limits. @param owner - Ready receipt owner. @returns The internal standard-message command. */
export function createSideChatCommand(
  config: AnnotationConfig,
  owner: SideChatSubmissionOwner,
): CommandDefinition {
  return Object.freeze({
    name: SIDE_CHAT_COMMAND_NAME,
    description: 'Submit confirmed quotations and a question to an independent side conversation',
    input: { hint: '<internal-base64url-payload>', attachments: true },
    recordInput: false,
    handler(invocation: CommandInvocation): CommandResult {
      if (invocation.signal.aborted)
        throw invocation.signal.reason ?? new Error('Side-chat submission was aborted')
      try {
        const payload = decodePayload(invocation.rawInput, config)
        const result = owner.submit(invocation.agent, payload, invocation.attachments)
        return Object.freeze({ kind: 'success', text: JSON.stringify(result) })
      } catch (cause: unknown) {
        if (!(cause instanceof SideChatCommandFailure)) throw cause
        const result: SideChatCommandReceipt = {
          protocolVersion: 1,
          source: 'dsh-annotation-side-chat-result',
          kind: cause.effect === 'none' ? 'rejected' : 'unknown',
          code: cause.code,
        }
        return Object.freeze({ kind: 'error', text: JSON.stringify(result) })
      }
    },
  })
}

/** @param ctx - Host plugin owner with required commands and Projection services. @param config - Validated admission limits. @returns After registration is ready; disposal during registration installs no command. */
export async function installSideChatCommand(ctx: Context, config: AnnotationConfig): Promise<void> {
  let closed = false
  ctx.effect(
    () => () => {
      closed = true
    },
    'dsh-annotation: side-chat registration lifetime',
  )
  const handle = await ctx.sessionProjections.register(createSideChatReceiptProjection())
  if (closed) {
    await handle.dispose()
    return
  }
  const owner = new SideChatSubmissionOwner(handle)
  ctx.effect(
    () => ctx.commands.register(createSideChatCommand(config, owner)),
    'dsh-annotation: side-chat submission command',
  )
}
