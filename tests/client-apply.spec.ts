// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.tsx'
import type { AnnotationInjected } from '../src/client/contract.ts'
import type { MessageIdentity } from '../src/shared/types.ts'

function emptySnapshot(): ConversationSnapshot {
  return {
    chat: { nodes: new Map() },
    queue: [],
    hasMore: false,
  } as unknown as ConversationSnapshot
}

function fixtureContext(command: ReturnType<typeof vi.fn>) {
  const registrations: { options: Record<string, unknown> }[] = []
  const disposers: (() => void)[] = []
  const listListeners = new Set<() => void>()
  const unsubscribeSession = vi.fn()
  let listed = true
  const session = {
    getSnapshot: () => emptySnapshot(),
    subscribe: () => unsubscribeSession,
    loadOlder: async () => undefined,
    command,
    updateQueue: vi.fn(),
  }
  const ctx = {
    locale: { register: () => () => undefined },
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', byId: listed ? { 'session-test': {} } : {} }),
        subscribe(listener: () => void) {
          listListeners.add(listener)
          return () => listListeners.delete(listener)
        },
      },
      binding: () => ({ session }),
      fork: vi.fn(),
      open: vi.fn(),
    },
    slots: {
      register(options: Record<string, unknown>) {
        registrations.push({ options })
        return () => undefined
      },
      inject(_name: string, install: () => (() => void) | readonly (() => void)[]) {
        install()
      },
    },
    effect(install: () => void | (() => void)) {
      const dispose = install()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  } as unknown as ClientContext
  return {
    ctx,
    face() {
      const dock = registrations.find((entry) => entry.options.name === 'conversation.input.dock')
      if (dock === undefined || typeof dock.options.inject !== 'function')
        throw new Error('dock was not registered')
      return dock.options.inject('session-test' as SessionId) as AnnotationInjected
    },
    removeSession() {
      listed = false
      for (const listener of listListeners) listener()
    },
    unsubscribeSession,
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

function capture(start: number, exact: string) {
  const messageId = 'assistant-test' as MessageIdentity
  return {
    messageId,
    messageSeq: 12,
    responseVersion: messageId,
    quote: { exact, prefix: '', suffix: '', start, end: start + exact.length },
    rect: { top: 0, left: 0, right: 10, bottom: 10 },
  }
}

beforeEach(() => localStorage.clear())

describe('Client plugin submission lifecycle', () => {
  it('turns a rejected transport into a retry with the same immutable submission id', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    face.beginSelection(capture(0, 'first'))
    face.updateEditorText('Revise this.')
    face.saveEditor()

    await expect(face.submit(false, 'queue')).rejects.toThrow('offline')
    const failed = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })

    command.mockResolvedValueOnce({ ok: true, value: { matched: true } })
    await face.submit(false, 'steer')
    const retried = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(retried.payload).toBe(failed.payload)
    expect(retried.payload.submissionId).toBe(failed.payload.submissionId)
    expect(retried.payload.delivery).toBe('queue')
    expect(retried).toMatchObject({ status: 'queued', attempts: 2 })
    fixture.dispose()
  })

  it('disposes a Session controller when the authoritative list removes that Session', () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    fixture.face()
    fixture.removeSession()
    expect(fixture.unsubscribeSession).toHaveBeenCalledOnce()
    fixture.dispose()
  })

  it('rejects an oversized item count locally before creating or sending a batch', async () => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    apply(fixture.ctx, { maxAnnotationsPerSubmission: 1 })
    const face = fixture.face()
    face.beginSelection(capture(0, 'first'))
    face.updateEditorText('First note.')
    face.saveEditor()
    face.beginSelection(capture(8, 'second'))
    face.updateEditorText('Second note.')
    face.saveEditor()

    await expect(face.submit(false, 'queue')).rejects.toThrow('exceeds 1 annotations')
    expect(command).not.toHaveBeenCalled()
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      notice: { level: 'error', text: 'items' },
    })
    expect(face.hooks.annotations.getSnapshot().annotations.map((item) => item.status)).toEqual([
      'draft',
      'draft',
    ])
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    fixture.dispose()
  })
})
