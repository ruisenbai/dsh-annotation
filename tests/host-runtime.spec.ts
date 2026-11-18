import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { type CommandSubmitAttachment } from '@deepseek-ai/dsh-commands'
import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  buildForkSeed,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import { createAnnotationCommand } from '../src/host/command.ts'
import { encodeSubmissionCommand } from '../src/shared/codec.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { fixturePayload } from './fixtures.ts'
import { parseAttachmentIdentities } from '../src/shared/protocol.ts'
import { ATTACHMENT_PREPARE_INPUT, ATTACHMENT_IDENTITY_MISMATCH } from '../src/shared/types.ts'
import { apply, inject } from '../src/index.ts'
import { ownedSideSessionId } from '../src/shared/side-session-id.ts'
import { sideChatTranscriptStart } from '../src/host/side-chat-fork.ts'
import { SIDE_CHAT_COMMAND_NAME, SIDE_CHAT_RECEIPTS_PROJECTION } from '../src/shared/side-chat-types.ts'

describe('official Host command attachment admission', () => {
  it('installs annotation commands and side receipts through the Host plugin lifecycle', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(CommandRuntime)
      const session = ctx.sessions.create(SessionId('annotation-runtime'))
      const agent = { id: session.id } as Agent
      const plugin = await ctx.plugin({
        name: 'annotation-runtime-test',
        inject,
        apply: (scope: Context) => apply(scope, DEFAULT_CONFIG),
      })
      expect(ctx.commands.list(agent).map((command) => command.name)).toEqual(
        expect.arrayContaining([
          DEFAULT_CONFIG.commandName,
          'inline_comments_submit',
          'inline_annotations_submit',
          SIDE_CHAT_COMMAND_NAME,
        ]),
      )
      expect(ctx.sessionProjections.snapshot(session).values).toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION, {
        receipts: {},
      })
      expect(
        ctx.sessionProjections.snapshot(session, ctx.sessionProjections.summaryKeys()).values,
      ).not.toHaveProperty(SIDE_CHAT_RECEIPTS_PROJECTION)
      await plugin.dispose()
      expect(ctx.commands.list(agent)).toEqual([])
      expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(
        SIDE_CHAT_RECEIPTS_PROJECTION,
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('restores the visible start after inherited Turns and fork repair, including nested forks', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.sessionProjections.register(sideChatTranscriptStart)
      const parent = ctx.sessions.create(SessionId('transcript-parent'))
      parent.append('turn/start', { turn: 1 })
      parent.append('step/start', { turn: 1, step: 1 })
      const seed = buildForkSeed(parent.snapshotEvents(), SessionSeq(1))
      const first = ctx.sessions.create(ownedSideSessionId(parent.id, 'first'), {
        seed,
        inheritedEventCount: SessionLogOffset(2),
        meta: { isSeeded: true },
      })
      expect(ctx.sessionProjections.snapshot(first).values.chatTranscriptStart).toBe(seed.length)
      const checkpoint = ctx.sessionProjections.checkpoint(first)
      const own = first.append('turn/start', { turn: 2 })
      const registry = ctx.sessionProjections
      const restored = registry.restore(
        checkpoint,
        [own],
        SessionLogOffset(own.seq),
        first.header,
        first.inheritedEventCount,
      )
      expect(restored.snapshot.values.chatTranscriptStart).toBe(own.seq)
      const nestedSeed = buildForkSeed(first.snapshotEvents(), own.seq)
      const nested = ctx.sessions.create(ownedSideSessionId(first.id, 'second'), {
        seed: nestedSeed,
        inheritedEventCount: SessionLogOffset(own.seq + 1),
        meta: { isSeeded: true },
      })
      expect(registry.snapshot(nested).values.chatTranscriptStart).toBe(nestedSeed.length)
      expect(registry.snapshot(parent).values.chatTranscriptStart).toBe(0)
      const ordinary = ctx.sessions.create(SessionId('ordinary-fork'), {
        seed,
        inheritedEventCount: SessionLogOffset(2),
        meta: { isSeeded: true },
      })
      expect(registry.snapshot(ordinary).values.chatTranscriptStart).toBe(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('admits mixed attachments before enqueueing one idempotent annotation message', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(CommandRuntime)
      const session = ctx.sessions.create(SessionId('session-test'))
      const nextTurn: UserMessage[] = []
      const agent = {
        id: session.id,
        session,
        inbox: { nextTurn, nextStep: [] },
        followup: vi.fn((message: UserMessage) => nextTurn.push(message)),
        steer: vi.fn(),
      } as unknown as Agent
      const file: FileBlock['attachment'] = {
        attachmentId: 'document-attachment' as FileBlock['attachment']['attachmentId'],
        name: 'notes.txt',
        bytes: 12,
      }
      const image: ImageBlock['attachment'] = {
        attachmentId: 'image-attachment' as ImageBlock['attachment']['attachmentId'],
        name: 'shot.png',
        mediaType: 'image/png',
        bytes: 5,
        width: 1,
        height: 1,
      }
      // 图片字节在官方命令器中解码，持久化由此进程内存储替身接收。
      const saveImages = vi.fn().mockResolvedValue([image])
      ctx.provide('attachments', { saveImages } as never)
      ctx.commands.registerFileReceiptResolver((receivingAgent, receiptId) => {
        if (receivingAgent !== agent) return undefined
        if (receiptId === 'document-receipt' || receiptId === 'new-receipt-for-original') return file
        if (receiptId === 'replacement-receipt')
          return { ...file, attachmentId: 'other-file' as FileBlock['attachment']['attachmentId'] }
        return undefined
      })
      ctx.commands.register(createAnnotationCommand(DEFAULT_CONFIG))
      const attachments: readonly CommandSubmitAttachment[] = [
        { type: 'file', receiptId: 'document-receipt' },
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'shot.png' },
      ]

      const prepared = await ctx.commands.execute(
        agent,
        `/annotation_submit ${ATTACHMENT_PREPARE_INPUT}`,
        attachments,
        new AbortController().signal,
      )
      expect(prepared?.result.kind).toBe('success')
      expect(nextTurn).toEqual([])
      const payload = fixturePayload({
        attachmentIdentities: parseAttachmentIdentities(JSON.parse(prepared?.result.text ?? 'null')),
      })
      const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, payload)
      const first = await ctx.commands.execute(agent, line, attachments, new AbortController().signal)
      const retry = await ctx.commands.execute(
        agent,
        line,
        [{ type: 'file', receiptId: 'new-receipt-for-original' }, attachments[1]!],
        new AbortController().signal,
      )
      await expect(
        ctx.commands.execute(
          agent,
          line,
          [{ type: 'file', receiptId: 'replacement-receipt' }, attachments[1]!],
          new AbortController().signal,
        ),
      ).rejects.toThrow(ATTACHMENT_IDENTITY_MISMATCH)

      expect(first?.result).toMatchObject({ kind: 'success', text: 'Annotation batch accepted.' })
      expect(retry?.result).toMatchObject({ kind: 'success', text: 'Annotation batch was already accepted.' })
      expect(agent.followup).toHaveBeenCalledOnce()
      expect(nextTurn[0]).toMatchObject({
        id: 'dsh-inline-annotations:sub-test',
        source: { annotationSubmission: payload },
        content: [{ type: 'text' }, { type: 'file', attachment: file }, { type: 'image', attachment: image }],
      })
      expect(saveImages).toHaveBeenCalledWith([
        { data: Uint8Array.from([104, 101, 108, 108, 111]), mediaType: 'image/png', name: 'shot.png' },
      ])
      const events = session.snapshotEvents()
      expect(events.filter((event) => event.type === 'command/done')).toHaveLength(4)
      expect(JSON.stringify(events)).not.toContain('document-receipt')
      expect(JSON.stringify(events)).not.toContain('aGVsbG8=')
      expect(JSON.stringify(events)).not.toContain(line.split(' ')[1])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
