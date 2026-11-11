/** Typed side-chat requests shared by protocol, lifecycle, and real Host tests. */
import { Context } from '@deepseek-ai/cordis'
import type {
  AgentContext,
  ISessions,
  SessionBinding,
  SessionEventWindow,
  SessionFace,
  SessionReference,
  SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatController } from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import { parseSideChatSubmissionPayload } from '../src/shared/side-chat-protocol.ts'
import type { SideChatSubmissionPayload } from '../src/shared/side-chat-types.ts'
import type { SelectionCapture } from '../src/client/selection.ts'
import type { MessageIdentity } from '../src/shared/types.ts'

/** @param overrides - Request fields for the case. @returns A detached valid side-chat request. */
export function sideChatPayload(
  overrides: Partial<SideChatSubmissionPayload> = {},
): SideChatSubmissionPayload {
  return parseSideChatSubmissionPayload({
    protocolVersion: 1,
    source: 'dsh-annotation-side-chat',
    submissionId: 'sub-side-test',
    mainSessionId: 'main-test',
    sideSessionId: 'side-test',
    delivery: 'queue',
    protocolLocale: 'en',
    createdAt: 1_700_000_000_000,
    question: 'Explain this claim.',
    references: [
      {
        referenceId: 'side-ref-a',
        sourceSessionId: 'main-test',
        messageId: 'assistant-a',
        messageSeq: 42,
        responseVersion: 'assistant-a',
        quote: { exact: 'selected source', prefix: 'before ', suffix: ' after', start: 7, end: 22 },
        createdAt: 1_700_000_000_000,
      },
    ],
    attachmentIdentities: [],
    ...overrides,
  })
}

/** @param exact - Selected occurrence. @param offset - Its rendered-text offset. @param message - Finalized source identity. @returns Captured main-message selection. */
export function sideChatCapture(
  exact = 'selected source',
  offset = 7,
  message = 'assistant-a',
): SelectionCapture {
  const messageId = message as MessageIdentity
  return {
    messageId,
    messageSeq: 42,
    responseVersion: messageId,
    quote: { exact, prefix: 'before ', suffix: ' after', start: offset, end: offset + exact.length },
    rect: { top: 1, left: 2, right: 3, bottom: 4 },
  }
}

/** Storage available to Client owners without process-global Web Storage. */
export class SideChatMemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

/** @param mainId - Main association owner. @returns Complete Session faces for testing sender admission and lifecycle. */
export function sideChatSessionFixture(
  mainId = SessionId('main-test'),
  sideId = SessionId(`${mainId}-side`),
) {
  const ctx = new Context()
  const initial: SessionSnapshot = {
    sessionId: sideId,
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  }
  const snapshot = createSnapshotStore(initial)
  const projection = createSnapshotStore<unknown>(undefined)
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected Session operation')
  }
  const session: SessionFace = {
    sessionId: sideId,
    getSnapshot: snapshot.getSnapshot,
    subscribe: snapshot.subscribe,
    projections: { faceOf: () => projection },
    beginSubmission: () => {
      throw new Error('Unexpected model request')
    },
    prompt: unused,
    readAttachment: unused,
    updateQueue: unused,
    cancel: unused,
    rename: unused,
    loadOlder: unused,
    loadThrough: unused,
    command: unused,
  }
  const eventSource = createSnapshotStore<SessionEventWindow>({
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
  })
  const binding: SessionBinding = { sessionId: sideId, session, ctx: ctx as AgentContext, eventSource }
  const mainSnapshot = createSnapshotStore<SessionSnapshot>({ ...initial, sessionId: mainId })
  const mainSession: SessionFace = {
    ...session,
    sessionId: mainId,
    getSnapshot: mainSnapshot.getSnapshot,
    subscribe: mainSnapshot.subscribe,
  }
  const mainBinding: SessionBinding = { ...binding, sessionId: mainId, session: mainSession }
  const mainReference: SessionReference = {
    sessionId: mainId,
    binding: mainBinding,
    ready: Promise.resolve(mainBinding),
    release: () => {},
    [Symbol.dispose]: () => {},
  }
  const reference: SessionReference = {
    sessionId: sideId,
    binding,
    ready: Promise.resolve(binding),
    release: () => {},
    [Symbol.dispose]: () => {},
  }
  const sessions: Pick<ISessions, 'create' | 'retain'> = {
    create: async () => sideId,
    retain: (target) => (target === mainId ? mainReference : reference),
  }
  const memory = new SideChatMemoryStorage()
  let identity = 0
  const owner = new SideChatController(mainId, sessions, new SideChatStorage(memory, mainId), {
    now: () => 1_700_000_000_000,
    randomUUID: () => `send-${++identity}`,
  })
  const dispose = async (): Promise<void> => {
    owner.dispose()
    await ctx.fiber.dispose()
  }
  return {
    owner,
    sideId,
    sessions,
    binding,
    reference,
    mainBinding,
    mainReference,
    snapshot,
    mainSnapshot,
    memory,
    dispose,
  }
}

/** @param mainId - Main association owner. @returns Two distinct ordinary Session bindings and a shared parallel-chat owner. */
export function parallelSideChatFixture(mainId = SessionId('main-test')) {
  const first = sideChatSessionFixture(mainId, SessionId(`${mainId}-side-a`))
  const second = sideChatSessionFixture(mainId, SessionId(`${mainId}-side-b`))
  let created = 0
  const sessions: Pick<ISessions, 'create' | 'retain'> = {
    create: async () => {
      const session = [first, second][created++]
      if (session === undefined) throw new Error('Unexpected third side Session creation')
      return session.sideId
    },
    retain: (target) => {
      if (target === mainId) return first.mainReference
      const session = [first, second].find((fixture) => fixture.sideId === target)
      if (session === undefined) throw new Error(`Unexpected retained Session: ${target}`)
      return session.reference
    },
  }
  const memory = new SideChatMemoryStorage()
  let identity = 0
  const owner = new SideChatController(mainId, sessions, new SideChatStorage(memory, mainId), {
    now: () => 1_700_000_000_000,
    randomUUID: () => `parallel-${++identity}`,
  })
  return {
    owner,
    sessions,
    first,
    second,
    memory,
    async dispose(): Promise<void> {
      owner.dispose()
      await owner.whenStorageIdle()
      await first.dispose()
      await second.dispose()
    },
  }
}
