import { expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  PendingSubmission,
  SessionEventLikeEntry,
  SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ChatSubmissionHandoff } from '../src/client/chat-submission-handoff.ts'
import { sideChatSessionFixture } from './side-chat-fixtures.ts'

function echo(id: string, placement: PendingSubmission['placement'] = 'transcript'): PendingSubmission {
  return {
    requestId: id as PendingSubmission['requestId'],
    placement,
    text: '相同的文字',
    time: 100,
    attachments: [],
  }
}
function message(input: PendingSubmission): UserMessage {
  return {
    id: MessageId(input.requestId),
    role: 'user',
    content: [{ type: 'text', text: input.text }],
    source: { kind: 'user', rpcId: input.requestId },
  }
}
function splice(
  seq: number,
  inserted: UserMessage[],
  start = 0,
  removedCount = 0,
  outcome?: 'canceled',
): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      type: 'agent/inbox/spliced',
      seq: SessionSeq(seq),
      time: seq,
      data: { target: 'next-turn', start, removedCount, inserted, ...(outcome ? { outcome } : {}) },
    },
  }
}
function harness() {
  const fixture = sideChatSessionFixture()
  const events = createSnapshotStore<SessionEventWindow>({
    revision: 0,
    hasMore: false,
    entries: [],
    change: { kind: 'replace', entries: [] },
  })
  const rendered = createSnapshotStore<
    | {
        order: readonly string[]
        nodes: { get: (id: string) => { kind: string; data: unknown } | undefined }
      }
    | undefined
  >(undefined)
  const lifetime = new AbortController()
  const store = new ChatSubmissionHandoff(
    { ...fixture.binding, eventSource: events },
    rendered,
    lifetime.signal,
  )
  const unsubscribe = store.subscribe(() => {})
  function update(kind: 'append' | 'replace', patch: SessionEventLikeEntry[], hasMore = false) {
    const old = events.getSnapshot()
    events.set({
      revision: old.revision + 1,
      hasMore,
      entries: kind === 'replace' ? patch : [...old.entries, ...patch],
      change: { kind, entries: patch },
    })
  }
  function pending(...rows: PendingSubmission[]) {
    fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), pendingSubmissions: rows })
  }
  return {
    store,
    update,
    pending,
    rendered,
    unsubscribe,
    lifetime,
    dispose: () => {
      unsubscribe()
      lifetime.abort()
      return fixture.dispose()
    },
  }
}

it('keeps equal-text requests independent through a reconnect, cancellation and durable rendering', async ({
  onTestFinished,
}) => {
  const h = harness()
  onTestFinished(h.dispose)
  const first = echo('first'),
    second = echo('second')
  const receipt = splice(0, [message(first), message(second)])
  h.update('append', [receipt])
  h.pending(first, second)
  h.update('replace', [receipt])
  h.pending()
  expect(h.store.getSnapshot()).toEqual([first, second])
  h.update('append', [splice(1, [], 1, 1, 'canceled')])
  expect(h.store.getSnapshot()).toEqual([first])
  h.update('append', [splice(2, [], 0, 1)])
  const durable: SessionEventLikeEntry = {
    type: 'event',
    event: { type: 'user/message', surfaceOp: 'append', seq: SessionSeq(3), time: 3, data: message(first) },
  }
  h.update('append', [durable])
  expect(h.store.getSnapshot()).toEqual([first])
  h.rendered.set({ order: ['first'], nodes: { get: () => ({ kind: 'user', data: message(first) }) } })
  expect(h.store.getSnapshot()).toEqual([])
})
it('leaves a rejected send, queued input and a canceled pre-step without a retained bubble', async ({
  onTestFinished,
}) => {
  const h = harness()
  onTestFinished(h.dispose)
  const rejected = echo('rejected'),
    queued = echo('queued', 'queued'),
    stopped = echo('stopped')
  h.pending(rejected, queued)
  h.pending(queued)
  h.update('replace', [])
  h.pending()
  expect(h.store.getSnapshot()).toEqual([])
  const receipt = splice(2, [message(stopped)])
  h.update('append', [receipt])
  h.pending(stopped)
  h.update('replace', [receipt, splice(3, [], 0, 1)])
  h.pending()
  expect(h.store.getSnapshot()).toEqual([stopped])
  h.update('append', [
    {
      type: 'event',
      event: {
        type: 'turn/end',
        seq: SessionSeq(4),
        time: 4,
        data: { turn: 0, reason: { kind: 'aborted', reason: { kind: 'legacy' } } },
      },
    },
  ])
  expect(h.store.getSnapshot()).toEqual([])
})
it('drops an admitted echo older than a new history page and releases pending state on unload', async ({
  onTestFinished,
}) => {
  const h = harness()
  onTestFinished(h.dispose)
  const first = echo('one'),
    second = echo('two')
  const receipt = splice(0, [message(first), message(second)])
  h.update('append', [receipt])
  h.pending(first, second)
  h.update('replace', [receipt])
  h.pending()
  h.update('append', [
    {
      type: 'event',
      event: { type: 'user/message', surfaceOp: 'append', seq: SessionSeq(1), time: 1, data: message(first) },
    },
  ])
  h.update('replace', [splice(100, [])], true)
  expect(h.store.getSnapshot()).toEqual([second])
  h.lifetime.abort()
  expect(h.store.getSnapshot()).toEqual([])
})
