import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Commands, { CommandId } from '@deepseek-ai/dsh-commands'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, {
  SessionId,
  SessionLogOffset,
  type SessionEvent,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import {
  createSideChatCommand,
  createSideChatReceiptProjection,
  installSideChatCommand,
  SideChatSubmissionOwner,
} from '../src/host/side-chat-command.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  encodeSideChatSubmissionCommand,
  parseSideChatCommandReceipt,
  sideChatSubmissionFingerprint,
} from '../src/shared/side-chat-protocol.ts'
import { SIDE_CHAT_RECEIPTS_PROJECTION } from '../src/shared/side-chat-types.ts'
import { sideChatPayload } from './side-chat-fixtures.ts'

async function host() {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Commands)
    const handle = await ctx.sessionProjections.register(createSideChatReceiptProjection())
    const owner = new SideChatSubmissionOwner(handle)
    const session = ctx.sessions.create(SessionId('side-test'))
    const events: SessionEvent[] = []
    ctx.on('session/event', (changed, event) => {
      if (changed === session) events.push(event)
    })
    const messages: UserMessage[] = []
    const followup = vi.fn((message: UserMessage) => {
      messages.push(message)
      session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
    })
    const agent: Pick<Agent, 'id' | 'session' | 'followup'> = { id: session.id, session, followup }
    const dispose = async () => {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
    return { ctx, owner, session, agent, messages, events, followup, dispose }
  } catch (cause: unknown) {
    await ctx.fiber.dispose()
    throw cause
  }
}

describe('standard side-chat Host admission and receipt lifecycle', () => {
  it('queues exactly one standard message and retains deduplication after queue consumption and compaction', async ({
    onTestFinished,
  }) => {
    const fixture = await host()
    onTestFinished(fixture.dispose)
    const payload = sideChatPayload()
    expect(fixture.owner.submit(fixture.agent, payload).kind).toBe('accepted')
    const message = fixture.messages[0]!
    expect(message).toMatchObject({
      id: 'dsh-inline-annotations:sub-side-test',
      role: 'user',
      source: { sideChatSubmission: payload },
    })
    const user = fixture.session.append('user/message', message, { surfaceOp: 'append' })
    fixture.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
    })
    fixture.session.append(
      'user/message',
      {
        id: MessageId('compacted-summary'),
        role: 'user',
        content: [{ type: 'text', text: 'Compacted context' }],
        source: { kind: 'user' },
      },
      { surfaceOp: { op: 'replace', startSeq: user.seq, endSeq: user.seq }, sourceEventSeqs: [user.seq] },
    )
    expect(fixture.session.deriveMessages().some((item) => item.id === message.id)).toBe(false)
    expect(fixture.owner.submit(fixture.agent, payload).kind).toBe('duplicate')
    expect(fixture.followup).toHaveBeenCalledOnce()
    expect(fixture.events.map((event) => event.type)).not.toContain('plugin:side-chat')
  })

  it('rejects a changed payload with an accepted identity and never resurrects a removed queue entry', async ({
    onTestFinished,
  }) => {
    const fixture = await host()
    onTestFinished(fixture.dispose)
    const payload = sideChatPayload()
    fixture.owner.submit(fixture.agent, payload)
    fixture.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
      outcome: 'canceled',
    })
    expect(() =>
      fixture.owner.submit(fixture.agent, sideChatPayload({ question: 'Changed request' })),
    ).toThrow('identity-conflict')
    expect(fixture.owner.submit(fixture.agent, payload).kind).toBe('duplicate')
    expect(fixture.messages).toHaveLength(1)
  })

  it('distinguishes an unknown admission from a throw after the durable splice already committed', async ({
    onTestFinished,
  }) => {
    const fixture = await host()
    onTestFinished(fixture.dispose)
    const payload = sideChatPayload()
    const failed = {
      ...fixture.agent,
      followup: (_message: UserMessage) => {
        throw new Error('Admission did not finish')
      },
    }
    expect(() => fixture.owner.submit(failed, payload)).toThrow('admission')
    expect(fixture.owner.receipt(fixture.session, payload.submissionId)).toBeUndefined()
    const committed = {
      ...fixture.agent,
      followup: (message: UserMessage) => {
        fixture.agent.followup(message)
        throw new Error('Post-commit observer failed')
      },
    }
    expect(fixture.owner.submit(committed, payload).kind).toBe('accepted')
    expect(fixture.owner.submit(fixture.agent, payload).kind).toBe('duplicate')
    expect(fixture.messages).toHaveLength(1)
  })

  it('restores usable, absent, and incompatible checkpoints with the same suffix receipt state', async ({
    onTestFinished,
  }) => {
    const fixture = await host()
    onTestFinished(fixture.dispose)
    const payload = sideChatPayload()
    fixture.owner.submit(fixture.agent, payload)
    const checkpoint = fixture.ctx.sessionProjections.checkpoint(fixture.session)
    const firstEventCount = fixture.events.length
    const second = sideChatPayload({
      submissionId: 'sub-second' as typeof payload.submissionId,
      question: 'Second question',
    })
    fixture.owner.submit(fixture.agent, second)
    const registry = fixture.ctx.sessionProjections
    const full = registry.restore(
      {},
      fixture.events,
      SessionLogOffset(0),
      fixture.session.header,
      fixture.session.inheritedEventCount,
    )
    const suffix = registry.restore(
      checkpoint,
      fixture.events.slice(firstEventCount),
      SessionLogOffset(firstEventCount),
      fixture.session.header,
      fixture.session.inheritedEventCount,
    )
    expect(suffix.snapshot.values[SIDE_CHAT_RECEIPTS_PROJECTION]).toEqual(
      full.snapshot.values[SIDE_CHAT_RECEIPTS_PROJECTION],
    )
    const incompatible = {
      [SIDE_CHAT_RECEIPTS_PROJECTION]: {
        ver: 0,
        seq: checkpoint[SIDE_CHAT_RECEIPTS_PROJECTION]!.seq,
        val: checkpoint[SIDE_CHAT_RECEIPTS_PROJECTION]!.val,
      },
    }
    const refolded = registry.restore(
      incompatible,
      fixture.events,
      SessionLogOffset(0),
      fixture.session.header,
      fixture.session.inheritedEventCount,
    )
    expect(refolded.snapshot.values[SIDE_CHAT_RECEIPTS_PROJECTION]).toEqual(
      full.snapshot.values[SIDE_CHAT_RECEIPTS_PROJECTION],
    )
    expect(fixture.owner.receipt(fixture.session, payload.submissionId)).toBe(
      sideChatSubmissionFingerprint(payload),
    )
    expect(fixture.followup).toHaveBeenCalledTimes(2)
  })

  it('returns structured acceptance and rejection without a second enqueue or raw payload recording', async ({
    onTestFinished,
  }) => {
    const fixture = await host()
    onTestFinished(fixture.dispose)
    const definition = createSideChatCommand(DEFAULT_CONFIG, fixture.owner)
    const payload = sideChatPayload()
    const line = encodeSideChatSubmissionCommand(payload)
    const invocation = {
      commandId: CommandId('side-command'),
      agent: fixture.agent as Agent,
      rawInput: line.slice(line.indexOf(' ') + 1),
      attachments: [],
      signal: new AbortController().signal,
    }
    const accepted = await definition.handler(invocation)
    const duplicate = await definition.handler(invocation)
    const refused = await definition.handler({ ...invocation, rawInput: '***' })
    expect(parseSideChatCommandReceipt(accepted.text)).toMatchObject({
      kind: 'accepted',
      submissionId: payload.submissionId,
    })
    expect(parseSideChatCommandReceipt(duplicate.text)).toMatchObject({
      kind: 'duplicate',
      submissionId: payload.submissionId,
    })
    expect(parseSideChatCommandReceipt(refused.text)).toMatchObject({ kind: 'rejected', code: 'payload' })
    expect(definition.recordInput).toBe(false)
    expect(fixture.followup).toHaveBeenCalledOnce()
  })

  it('removes its command and Projection registration when the plugin Context unloads', async ({
    onTestFinished,
  }) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Commands)
    const session = ctx.sessions.create(SessionId('side-test'))
    const agent = { id: session.id } as Agent
    const plugin = await ctx.plugin({
      name: 'side-chat-test-owner',
      inject: ['commands', 'sessionProjections'],
      apply: (scope: Context) => installSideChatCommand(scope, DEFAULT_CONFIG),
    })
    expect(ctx.commands.list(agent).map((item) => item.name)).toContain('annotation_side_chat_submit')
    expect(ctx.sessionProjections.snapshot(session).values).toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION)
    expect(
      ctx.sessionProjections.snapshot(session, ctx.sessionProjections.summaryKeys()).values,
    ).not.toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION)
    await plugin.dispose()
    expect(ctx.commands.list(agent).map((item) => item.name)).not.toContain('annotation_side_chat_submit')
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION)
  })

  it('installs no command when its owner unloads while the ready Projection handle is delayed', async ({
    onTestFinished,
  }) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Commands)
    const session = ctx.sessions.create(SessionId('side-test'))
    const agent = { id: session.id } as Agent
    let start!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const register = ctx.sessionProjections.register
    const delayed = vi.spyOn(ctx.sessionProjections, 'register').mockImplementationOnce(async function (
      this: SessionProjectionRegistry,
      definition,
    ) {
      const handle = await register.call(this, definition)
      start()
      await gate
      return handle
    })
    onTestFinished(() => delayed.mockRestore())
    const plugin = ctx.plugin({
      name: 'side-chat-delayed-owner',
      inject: ['commands', 'sessionProjections'],
      apply: (scope: Context) => installSideChatCommand(scope, DEFAULT_CONFIG),
    })
    await started
    const disposing = plugin.dispose()
    release()
    await disposing
    expect(ctx.commands.list(agent).map((item) => item.name)).not.toContain('annotation_side_chat_submit')
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION)
  })
})
