import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { type CommandSubmitAttachment } from '@deepseek-ai/dsh-commands'
import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createAnnotationCommand } from '../src/host/command.ts'
import { encodeSubmissionCommand } from '../src/shared/codec.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { fixturePayload } from './fixtures.ts'

describe('official Host command attachment admission', () => {
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
      ctx.commands.registerFileReceiptResolver((receivingAgent, receiptId) =>
        receivingAgent === agent && receiptId === 'document-receipt' ? file : undefined,
      )
      ctx.commands.register(createAnnotationCommand(DEFAULT_CONFIG))
      const payload = fixturePayload()
      const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, payload)
      const attachments: readonly CommandSubmitAttachment[] = [
        { type: 'file', receiptId: 'document-receipt' },
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'shot.png' },
      ]

      const first = await ctx.commands.execute(agent, line, attachments, new AbortController().signal)
      const retry = await ctx.commands.execute(agent, line, attachments, new AbortController().signal)

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
      expect(events.filter((event) => event.type === 'command/done')).toHaveLength(2)
      expect(JSON.stringify(events)).not.toContain('document-receipt')
      expect(JSON.stringify(events)).not.toContain('aGVsbG8=')
      expect(JSON.stringify(events)).not.toContain(line.split(' ')[1])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
