import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { createAnnotationCommand } from '../src/host/command.ts'
import { encodeSubmissionCommand } from '../src/shared/codec.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function snapshot(nodes: unknown[], queue: unknown[] = []): ConversationSnapshot {
  return {
    chat: { nodes: new Map(nodes.map((node, index) => [String(index), node])) },
    queue,
    hasMore: false,
  } as unknown as ConversationSnapshot
}

describe('browser-to-Host submission flow', () => {
  it('moves one immutable batch from draft to queued, sent, and explicitly processed', () => {
    const sessionId = 'integration-session' as SessionIdentity
    const controller = new AnnotationController(
      sessionId,
      new AnnotationStorage(new MemoryStorage(), sessionId),
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
      () => 1_700_000_000_000,
    )
    const messageId = 'assistant-source' as MessageIdentity
    controller.beginSelection({
      messageId,
      messageSeq: 12,
      responseVersion: messageId,
      quote: { exact: 'critical claim', prefix: '', suffix: '', start: 0, end: 14 },
      rect: { top: 0, left: 0, right: 10, bottom: 10 },
    })
    controller.updateEditorText('Add evidence for this claim.')
    const annotationId = controller.saveEditor()
    const entry = controller.createOutbox('queue', sessionId)
    controller.markSending(entry.payload.submissionId)

    const nextTurn: UserMessage[] = []
    const agent = {
      id: sessionId,
      inbox: { nextTurn, nextStep: [] },
      session: { events: [] },
      followup: vi.fn((message: UserMessage) => nextTurn.push(message)),
      steer: vi.fn(),
    } as unknown as Agent
    const command = createAnnotationCommand(DEFAULT_CONFIG)
    const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, entry.payload)
    command.handler({
      commandId: 'command-integration',
      agent,
      rawInput: line.slice(line.indexOf(' ') + 1),
      signal: new AbortController().signal,
    } as unknown as CommandInvocation)

    controller.markAccepted(entry.payload.submissionId)
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('accepted')
    expect(nextTurn).toHaveLength(1)
    const durableUserNode = {
      kind: 'user',
      data: { source: nextTurn[0]?.source },
    }
    controller.reconcile(snapshot([durableUserNode]))
    expect(controller.getSnapshot().annotations[0]?.status).toBe('sent')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('sent')

    controller.reconcile(
      snapshot([
        durableUserNode,
        {
          kind: 'assistant-step',
          data: {
            finalNode: { messageId: 'assistant-result', seq: 20 },
            blocks: [
              {
                kind: 'text',
                text: `Handled. <!-- dsh-inline-annotations:{"submissionId":"${entry.payload.submissionId}","processed":["${annotationId}"]} -->`,
              },
            ],
          },
        },
      ]),
    )
    expect(controller.getSnapshot().annotations[0]?.status).toBe('processed')
  })
})
