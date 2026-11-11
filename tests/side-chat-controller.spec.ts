// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import type {
  AgentContext,
  ISessions,
  SessionBinding,
  SessionFace,
  SessionReference,
  SessionSnapshot,
  SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import {
  SideChatController,
  SideChatFailure,
  type SideChatControllerOptions,
} from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import { sideChatSubmissionFingerprint } from '../src/shared/side-chat-protocol.ts'
import { sideChatCapture } from './side-chat-fixtures.ts'

class MemoryStorage {
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function lifecycle(sessionId: ReturnType<typeof SessionId>): SessionSnapshot {
  return {
    sessionId,
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
}

function harness(
  memory = new MemoryStorage(),
  mainId = SessionId('main-test'),
  options: SideChatControllerOptions = {},
) {
  const ctx = new Context()
  const sideId = SessionId(`${mainId}-side`)
  const snapshot = createSnapshotStore(lifecycle(sideId))
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
      throw new Error('No model request during reference collection')
    },
    prompt: vi.fn(unused),
    readAttachment: unused,
    updateQueue: unused,
    cancel: unused,
    rename: unused,
    loadOlder: unused,
    loadThrough: unused,
    command: vi.fn(unused),
  }
  const eventSource = createSnapshotStore<SessionEventWindow>({
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
  })
  const binding: SessionBinding = { sessionId: sideId, session, ctx: ctx as AgentContext, eventSource }
  const mainSnapshot = createSnapshotStore(lifecycle(mainId))
  const mainSession: SessionFace = {
    ...session,
    sessionId: mainId,
    getSnapshot: mainSnapshot.getSnapshot,
    subscribe: mainSnapshot.subscribe,
  }
  const mainBinding: SessionBinding = { ...binding, sessionId: mainId, session: mainSession }
  const mainRelease = vi.fn()
  const mainReference: SessionReference = {
    sessionId: mainId,
    binding: mainBinding,
    ready: Promise.resolve(mainBinding),
    release: mainRelease,
    [Symbol.dispose]: mainRelease,
  }
  const creation = deferred<ReturnType<typeof SessionId>>()
  const opening = deferred<SessionBinding>()
  const createStarted = deferred<void>()
  const retainStarted = deferred<void>()
  const release = vi.fn()
  const reference: SessionReference = {
    sessionId: sideId,
    binding,
    ready: opening.promise,
    release,
    [Symbol.dispose]: release,
  }
  const sessions: Pick<ISessions, 'create' | 'retain'> = {
    create: vi.fn(() => {
      createStarted.resolve()
      return creation.promise
    }),
    retain: vi.fn((target) => {
      if (target === mainId) return mainReference
      retainStarted.resolve()
      return reference
    }),
  }
  let nextId = 0
  const onReady = vi.fn()
  const controller = new SideChatController(mainId, sessions, new SideChatStorage(memory, mainId), {
    now: () => 1_700_000_000_000,
    randomUUID: () => `${++nextId}`,
    onReady,
    ...options,
  })
  const ready = async () => {
    const promise = controller.prepare()
    await createStarted.promise
    creation.resolve(sideId)
    await retainStarted.promise
    opening.resolve(binding)
    await promise
    return binding
  }
  const dispose = async () => {
    controller.dispose()
    await ctx.fiber.dispose()
  }
  return {
    ctx,
    sideId,
    memory,
    controller,
    sessions,
    creation,
    opening,
    createStarted,
    retainStarted,
    release,
    reference,
    mainReference,
    mainBinding,
    mainSnapshot,
    mainRelease,
    snapshot,
    session,
    binding,
    onReady,
    ready,
    dispose,
  }
}

it('persists distinct unnamed titles through archive, deletion and reload without renumbering survivors', async () => {
  const h = harness(undefined, undefined, { untitled: (ordinal) => `Side chat ${ordinal}` })
  try {
    const a = h.controller.createChat()
    const b = h.controller.createChat()
    expect([a.title, b.title]).toEqual(['Side chat 1', 'Side chat 2'])
    h.controller.setArchived(a.sideChatId, true)
    expect(h.controller.chatView(b.sideChatId)?.title).toBe('Side chat 2')
    h.controller.removeChat(a.sideChatId)
    const c = h.controller.createChat()
    expect(c.title).toBe('Side chat 3')
    h.controller.suspend()
    const restored = new SideChatController(
      h.controller.mainSessionId,
      h.sessions,
      new SideChatStorage(h.memory, h.controller.mainSessionId),
      { untitled: (ordinal) => `Side chat ${ordinal}` },
    )
    try {
      expect(restored.getSnapshot().chats.map((chat) => chat.title)).toEqual(['Side chat 2', 'Side chat 3'])
    } finally {
      restored.dispose()
    }
  } finally {
    await h.dispose()
  }
})

describe('side-chat lifecycle and immutable collection', () => {
  it('collects references while Workspace options load and resolves options only before initial creation', async ({
    onTestFinished,
  }) => {
    const resolution = deferred<Parameters<ISessions['create']>[0]>()
    const started = deferred<void>()
    const resolveCreateOptions = vi.fn((_signal: AbortSignal) => {
      started.resolve()
      return resolution.promise
    })
    const fixture = harness(new MemoryStorage(), SessionId('main-test'), {
      createOptions: { cwd: '/static-default' },
      resolveCreateOptions,
    })
    onTestFinished(fixture.dispose)
    fixture.controller.collect(sideChatCapture('A'))
    const preparation = fixture.controller.prepare()
    expect(fixture.sessions.retain).toHaveBeenCalledOnce()
    expect(fixture.sessions.retain).toHaveBeenCalledWith(
      fixture.controller.mainSessionId,
      expect.objectContaining({ source: 'annotationSideChatMain' }),
    )
    await started.promise
    const allocatedId = fixture.controller.getSnapshot().sideSessionId
    fixture.controller.collect(sideChatCapture('B', 20))
    fixture.controller.collect(sideChatCapture('C', 40))
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    resolution.resolve({ workspaceId: 'workspace-test' as WorkspaceId })
    await fixture.createStarted.promise
    expect(fixture.sessions.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-test',
      sessionId: allocatedId,
    })
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await preparation
    fixture.controller.suspend()
    await fixture.controller.prepare()
    expect(resolveCreateOptions).toHaveBeenCalledOnce()
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.controller.getSnapshot().references.map((item) => item.quote.exact)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('retains its allocated identity and references when Workspace resolution fails, then resolves again on retry', async ({
    onTestFinished,
  }) => {
    const resolveCreateOptions = vi
      .fn<NonNullable<SideChatControllerOptions['resolveCreateOptions']>>()
      .mockRejectedValueOnce(new SideChatFailure('workspace'))
      .mockResolvedValue({ workspaceId: 'recovered-workspace' as WorkspaceId })
    const fixture = harness(new MemoryStorage(), SessionId('main-test'), { resolveCreateOptions })
    onTestFinished(fixture.dispose)
    fixture.controller.collect(sideChatCapture())
    await expect(fixture.controller.prepare()).rejects.toMatchObject({ code: 'workspace' })
    const allocatedId = fixture.controller.getSnapshot().sideSessionId
    expect(fixture.controller.getSnapshot()).toMatchObject({
      status: 'error',
      failure: { code: 'workspace' },
    })
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
    expect(fixture.mainRelease).not.toHaveBeenCalled()
    const preparation = fixture.controller.prepare()
    await fixture.createStarted.promise
    expect(fixture.sessions.create).toHaveBeenCalledWith({
      workspaceId: 'recovered-workspace',
      sessionId: allocatedId,
    })
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await preparation
    expect(resolveCreateOptions).toHaveBeenCalledTimes(2)
    expect(
      vi
        .mocked(fixture.sessions.retain)
        .mock.calls.filter(([, options]) => options.source === 'annotationSideChatMain'),
    ).toHaveLength(1)
  })

  it('releases a failed main opening and never creates or retains a side Session', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    const mainOpening = deferred<SessionBinding>()
    vi.mocked(fixture.sessions.retain).mockImplementationOnce(() => ({
      ...fixture.mainReference,
      ready: mainOpening.promise,
    }))
    const preparation = fixture.controller.prepare()
    const refusal = expect(preparation).rejects.toMatchObject({ code: 'unavailable' })
    mainOpening.reject(new Error('Main scope could not open'))
    await refusal
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    expect(fixture.sessions.retain).toHaveBeenCalledOnce()
    expect(fixture.mainRelease).toHaveBeenCalledOnce()
    expect(fixture.release).not.toHaveBeenCalled()
  })

  it('contains a synchronous main retain failure before side preparation', async ({ onTestFinished }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    vi.mocked(fixture.sessions.retain).mockImplementationOnce(() => {
      throw new Error('Main removed before acquisition')
    })
    await expect(fixture.controller.prepare()).rejects.toMatchObject({ code: 'unavailable' })
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    expect(fixture.mainRelease).not.toHaveBeenCalled()
    expect(fixture.release).not.toHaveBeenCalled()
  })

  for (const stop of ['suspend', 'dispose'] as const) {
    it(`releases its synchronously acquired main when ${stop} happens before a late main opening`, async ({
      onTestFinished,
    }) => {
      const fixture = harness()
      onTestFinished(fixture.dispose)
      const mainOpening = deferred<SessionBinding>()
      vi.mocked(fixture.sessions.retain).mockImplementationOnce(() => ({
        ...fixture.mainReference,
        ready: mainOpening.promise,
      }))
      const preparation = fixture.controller.prepare()
      const refusal = expect(preparation).rejects.toMatchObject({ code: 'disposed' })
      fixture.controller[stop]()
      const stopped = fixture.controller.getSnapshot()
      expect(fixture.mainRelease).toHaveBeenCalledOnce()
      mainOpening.resolve(fixture.mainBinding)
      await refusal
      expect(fixture.sessions.create).not.toHaveBeenCalled()
      expect(fixture.sessions.retain).toHaveBeenCalledOnce()
      expect(fixture.controller.getSnapshot()).toBe(stopped)
    })
  }

  it('rejects an already-deleted main without creating a side and releases the main reference', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    fixture.mainSnapshot.set({ ...fixture.mainSnapshot.getSnapshot(), removed: true })
    await expect(fixture.controller.prepare()).rejects.toMatchObject({ code: 'unavailable' })
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    expect(fixture.mainRelease).toHaveBeenCalledOnce()
    await expect(fixture.controller.prepare()).rejects.toMatchObject({ code: 'unavailable' })
    expect(fixture.sessions.retain).toHaveBeenCalledOnce()
  })

  it('cancels environment preparation when its main is deleted and refuses a late location without dropping references', async ({
    onTestFinished,
  }) => {
    const resolution = deferred<Parameters<ISessions['create']>[0]>()
    const started = deferred<void>()
    let signal: AbortSignal | undefined
    const fixture = harness(new MemoryStorage(), SessionId('main-deleted-preparing'), {
      resolveCreateOptions: (input) => {
        signal = input
        started.resolve()
        return resolution.promise
      },
    })
    onTestFinished(fixture.dispose)
    fixture.controller.collect(sideChatCapture())
    const preparation = fixture.controller.prepare()
    const refusal = expect(preparation).rejects.toMatchObject({ code: 'unavailable' })
    await started.promise
    fixture.mainSnapshot.set({ ...fixture.mainSnapshot.getSnapshot(), removed: true })
    expect(signal?.aborted).toBe(true)
    expect(fixture.mainRelease).toHaveBeenCalledOnce()
    resolution.resolve({ cwd: '/late/main-directory' })
    await refusal
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    expect(fixture.release).not.toHaveBeenCalled()
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('keeps the side reference available for resource drainage after main deletion, then releases both lifetimes once', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    fixture.mainSnapshot.set({ ...fixture.mainSnapshot.getSnapshot(), removed: true })
    expect(fixture.controller.getSnapshot()).toMatchObject({
      status: 'error',
      failure: { code: 'unavailable' },
    })
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
    expect(fixture.mainRelease).toHaveBeenCalledOnce()
    expect(fixture.release).not.toHaveBeenCalled()
    fixture.controller.suspend()
    fixture.controller.dispose()
    expect(fixture.mainRelease).toHaveBeenCalledOnce()
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('preserves an in-flight side creation when a resumed main cannot open, and later reuses its identity', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    const first = fixture.controller.prepare()
    const stopped = expect(first).rejects.toMatchObject({ code: 'disposed' })
    await fixture.createStarted.promise
    fixture.controller.suspend()
    const mainOpening = deferred<SessionBinding>()
    vi.mocked(fixture.sessions.retain).mockImplementationOnce(() => ({
      ...fixture.mainReference,
      ready: mainOpening.promise,
    }))
    const failedResume = fixture.controller.prepare()
    const failure = expect(failedResume).rejects.toMatchObject({ code: 'unavailable' })
    mainOpening.reject(new Error('Main opening failed during reconnection'))
    await failure
    fixture.creation.resolve(fixture.sideId)
    await stopped
    const restored = fixture.controller.prepare()
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await restored
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.controller.getSnapshot().sideSessionId).toBe(fixture.sideId)
  })

  for (const lifecycle of ['suspend', 'dispose'] as const) {
    it(`prevents a late Workspace resolution from creating a Session after ${lifecycle}`, async ({
      onTestFinished,
    }) => {
      const resolution = deferred<Parameters<ISessions['create']>[0]>()
      const started = deferred<void>()
      let signal: AbortSignal | undefined
      const fixture = harness(new MemoryStorage(), SessionId('main-test'), {
        resolveCreateOptions: (input) => {
          signal = input
          started.resolve()
          return resolution.promise
        },
      })
      onTestFinished(fixture.dispose)
      fixture.controller.collect(sideChatCapture())
      const preparation = fixture.controller.prepare()
      const refusal = expect(preparation).rejects.toMatchObject({ code: 'disposed' })
      await started.promise
      fixture.controller[lifecycle]()
      const stopped = fixture.controller.getSnapshot()
      expect(signal?.aborted).toBe(true)
      resolution.resolve({ workspaceId: 'late-workspace' as WorkspaceId })
      await refusal
      expect(fixture.sessions.create).not.toHaveBeenCalled()
      expect(fixture.sessions.retain).toHaveBeenCalledOnce()
      expect(fixture.sessions.retain).toHaveBeenCalledWith(
        fixture.controller.mainSessionId,
        expect.objectContaining({ source: 'annotationSideChatMain' }),
      )
      expect(fixture.mainRelease).toHaveBeenCalledOnce()
      expect(fixture.controller.getSnapshot()).toBe(stopped)
    })
  }

  it('resolves a new Workspace attempt after suspension without a late old attempt creating a duplicate', async ({
    onTestFinished,
  }) => {
    const first = deferred<Parameters<ISessions['create']>[0]>()
    const second = deferred<Parameters<ISessions['create']>[0]>()
    const started = deferred<void>()
    const resolveCreateOptions = vi
      .fn<NonNullable<SideChatControllerOptions['resolveCreateOptions']>>()
      .mockImplementationOnce(() => {
        started.resolve()
        return first.promise
      })
      .mockReturnValueOnce(second.promise)
    const fixture = harness(new MemoryStorage(), SessionId('main-test'), { resolveCreateOptions })
    onTestFinished(fixture.dispose)
    const abandoned = fixture.controller.prepare()
    const refusal = expect(abandoned).rejects.toMatchObject({ code: 'disposed' })
    await started.promise
    const allocatedId = fixture.controller.getSnapshot().sideSessionId
    fixture.controller.suspend()
    const resumed = fixture.controller.prepare()
    first.resolve({ workspaceId: 'abandoned-workspace' as WorkspaceId })
    await refusal
    expect(fixture.sessions.create).not.toHaveBeenCalled()
    second.resolve({ workspaceId: 'current-workspace' as WorkspaceId })
    await fixture.createStarted.promise
    expect(fixture.sessions.create).toHaveBeenCalledWith({
      workspaceId: 'current-workspace',
      sessionId: allocatedId,
    })
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await resumed
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
  })

  it('reuses in-flight Session creation after suspension without resolving Workspace options again', async ({
    onTestFinished,
  }) => {
    const resolveCreateOptions = vi
      .fn<NonNullable<SideChatControllerOptions['resolveCreateOptions']>>()
      .mockResolvedValue({ workspaceId: 'workspace-test' as WorkspaceId })
    const fixture = harness(new MemoryStorage(), SessionId('main-test'), { resolveCreateOptions })
    onTestFinished(fixture.dispose)
    const first = fixture.controller.prepare()
    const refusal = expect(first).rejects.toMatchObject({ code: 'disposed' })
    await fixture.createStarted.promise
    fixture.controller.suspend()
    const resumed = fixture.controller.prepare()
    fixture.creation.resolve(fixture.sideId)
    await refusal
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await resumed
    expect(resolveCreateOptions).toHaveBeenCalledOnce()
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
  })

  it('collects A/B/C synchronously while one ordinary Session creation is pending, without a model request', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    const { controller } = fixture
    controller.collect(sideChatCapture('A'))
    const preparation = controller.prepare()
    expect(controller.prepare()).toBe(preparation)
    await fixture.createStarted.promise
    controller.collect(sideChatCapture('B', 20))
    controller.collect(sideChatCapture('C', 40, 'assistant-c'))
    expect(controller.getSnapshot().references.map((item) => item.quote.exact)).toEqual(['A', 'B', 'C'])
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.session.prompt).not.toHaveBeenCalled()
    expect(fixture.session.command).not.toHaveBeenCalled()
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await preparation
    expect(controller.getReference()).toBe(fixture.reference)
    expect(fixture.onReady).toHaveBeenCalledOnce()
  })

  it('hides and reopens without releasing the retained Session or replacing pending references', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    fixture.controller.show()
    fixture.controller.hide()
    fixture.controller.show()
    await fixture.controller.prepare()
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.sessions.retain).toHaveBeenCalledTimes(2)
    expect(fixture.mainRelease).not.toHaveBeenCalled()
    expect(fixture.release).not.toHaveBeenCalled()
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('keeps different main associations and late preparation completions isolated', async ({
    onTestFinished,
  }) => {
    const memory = new MemoryStorage()
    const first = harness(memory, SessionId('main-a'))
    const second = harness(memory, SessionId('main-b'))
    onTestFinished(first.dispose)
    onTestFinished(second.dispose)
    first.controller.collect(sideChatCapture('A'))
    const delayed = first.controller.prepare()
    await first.createStarted.promise
    second.controller.collect(sideChatCapture('B'))
    await second.ready()
    first.creation.resolve(first.sideId)
    await first.retainStarted.promise
    first.opening.resolve(first.binding)
    await delayed
    expect(first.controller.getSnapshot().references[0]?.sourceSessionId).toBe('main-a')
    expect(second.controller.getSnapshot().references[0]?.sourceSessionId).toBe('main-b')
    expect(second.controller.getSnapshot().references[0]?.quote.exact).toBe('B')
  })

  it('freezes sent references and question while subsequent collection/removal changes only the next send', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    const first = fixture.controller.collect(sideChatCapture('A'))
    const payload = fixture.controller.snapshotSubmission({
      question: 'Frozen question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.markSending(payload.submissionId)
    const next = fixture.controller.collect(sideChatCapture('B', 30))
    fixture.controller.removeReference(first.referenceId)
    expect(payload.question).toBe('Frozen question')
    expect(payload.references.map((item) => item.quote.exact)).toEqual(['A'])
    expect(fixture.controller.getSnapshot().references.map((item) => item.referenceId)).toEqual([
      next.referenceId,
    ])
    fixture.controller.markAccepted(payload.submissionId)
    expect(fixture.controller.getSnapshot().references.map((item) => item.quote.exact)).toEqual(['B'])
    expect(fixture.controller.getSnapshot().outbox).toBeNull()
  })

  it('preserves an unknown send across reload, requires explicit frozen retry, and reconciles the Host receipt', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    const payload = fixture.controller.snapshotSubmission({
      question: 'Question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.markSending(payload.submissionId)
    const recovered = new SideChatController(
      fixture.controller.mainSessionId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, fixture.controller.mainSessionId),
    )
    onTestFinished(() => recovered.dispose())
    expect(recovered.getSnapshot().outbox?.status).toBe('unknown')
    expect(recovered.getSnapshot().failure?.code).toBe('send-unknown')
    await recovered.prepare()
    expect(() =>
      recovered.snapshotSubmission({
        question: 'Changed question',
        protocolLocale: 'zh',
        attachmentIdentities: [],
      }),
    ).toThrow(SideChatFailure)
    expect(
      recovered.snapshotSubmission({
        question: 'Changed question',
        protocolLocale: 'zh',
        attachmentIdentities: [],
        retry: true,
      }),
    ).toEqual(payload)
    recovered.reconcileReceipts({
      receipts: { [payload.submissionId]: sideChatSubmissionFingerprint(payload) },
    })
    expect(recovered.getSnapshot().references).toEqual([])
    expect(recovered.getSnapshot().outbox).toBeNull()
  })

  it('reuses a creation that finishes during suspension and releases each retention on disable', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    fixture.controller.collect(sideChatCapture())
    const first = fixture.controller.prepare()
    const refused = expect(first).rejects.toMatchObject({ code: 'disposed' })
    await fixture.createStarted.promise
    fixture.controller.suspend()
    fixture.creation.resolve(fixture.sideId)
    await refused
    const resumed = fixture.controller.prepare()
    await fixture.retainStarted.promise
    fixture.opening.resolve(fixture.binding)
    await resumed
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.controller.getSnapshot().sideSessionId).toBe(fixture.sideId)
    fixture.controller.suspend()
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.controller.getReference()).toBeUndefined()
  })

  it('retains the created identity after opening fails and retries loading without a second creation', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    const first = fixture.controller.prepare()
    const refused = expect(first).rejects.toMatchObject({ code: 'load' })
    await fixture.createStarted.promise
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.opening.reject(new Error('Network failure'))
    await refused
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'error', sideSessionId: fixture.sideId })
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(fixture.mainRelease).not.toHaveBeenCalled()
    vi.mocked(fixture.sessions.retain).mockImplementation((target) =>
      target === fixture.controller.mainSessionId
        ? fixture.mainReference
        : { ...fixture.reference, ready: Promise.resolve(fixture.binding) },
    )
    await fixture.controller.prepare()
    expect(fixture.controller.getSnapshot().status).toBe('ready')
    expect(fixture.sessions.create).toHaveBeenCalledOnce()
    expect(
      vi
        .mocked(fixture.sessions.retain)
        .mock.calls.filter(([, options]) => options.source === 'annotationSideChatMain'),
    ).toHaveLength(1)
  })

  it('rejects an unknown retry after side removal and preserves its frozen content and references', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    const payload = fixture.controller.snapshotSubmission({
      question: 'Question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.markUnknown(payload.submissionId)
    fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), removed: true })
    expect(() =>
      fixture.controller.snapshotSubmission({
        question: 'Question',
        protocolLocale: 'en',
        attachmentIdentities: [],
        retry: true,
      }),
    ).toThrow('unavailable')
    expect(fixture.controller.getSnapshot().outbox?.payload).toBe(payload)
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('publishes no frozen outbox when composite admission validation rejects the request', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    expect(() =>
      fixture.controller.snapshotSubmission({
        question: 'Question',
        protocolLocale: 'en',
        attachmentIdentities: [],
        validate: () => {
          throw new Error('Configured payload limit')
        },
      }),
    ).toThrow('payload limit')
    expect(fixture.controller.getSnapshot().outbox).toBeNull()
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('keeps conflicting receipt state visibly unknown and never consumes pending references', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    const payload = fixture.controller.snapshotSubmission({
      question: 'Question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.reconcileReceipts({ receipts: { [payload.submissionId]: '0'.repeat(64) } })
    expect(fixture.controller.getSnapshot()).toMatchObject({
      outbox: { status: 'unknown' },
      failure: { code: 'receipt-conflict' },
    })
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('restores an identity conflict after reload and rejects explicit retry of its frozen request', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    const payload = fixture.controller.snapshotSubmission({
      question: 'Question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.markConflict(payload.submissionId, 'identity-conflict')
    const recovered = new SideChatController(
      fixture.controller.mainSessionId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, fixture.controller.mainSessionId),
    )
    onTestFinished(() => recovered.dispose())
    expect(recovered.getSnapshot()).toMatchObject({
      outbox: { status: 'unknown', failureCode: 'receipt-conflict' },
      failure: { code: 'receipt-conflict' },
    })
    await recovered.prepare()
    expect(() =>
      recovered.snapshotSubmission({
        question: 'Question',
        protocolLocale: 'en',
        attachmentIdentities: [],
        retry: true,
      }),
    ).toThrow('receipt-conflict')
    expect(recovered.getSnapshot().outbox?.payload).toEqual(payload)
    expect(recovered.getSnapshot().references).toHaveLength(1)
  })

  it('retains an observed identity conflict despite later transport status and matching receipts', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    const payload = fixture.controller.snapshotSubmission({
      question: 'Question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.controller.markConflict(payload.submissionId)
    const conflicted = fixture.controller.getSnapshot()
    fixture.controller.markUnknown(payload.submissionId)
    fixture.controller.markFailed(payload.submissionId)
    fixture.controller.markSending(payload.submissionId)
    fixture.controller.markAccepted(payload.submissionId)
    fixture.controller.reconcileReceipts({
      receipts: { [payload.submissionId]: sideChatSubmissionFingerprint(payload) },
    })
    expect(fixture.controller.getSnapshot()).toBe(conflicted)
    expect(fixture.controller.getSnapshot().references).toHaveLength(1)
  })

  it('releases a pending opening and prevents late completion from publishing after disposal', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    const pending = fixture.controller.prepare()
    const refused = expect(pending).rejects.toMatchObject({ code: 'disposed' })
    await fixture.createStarted.promise
    fixture.creation.resolve(fixture.sideId)
    await fixture.retainStarted.promise
    fixture.controller.dispose()
    const disposed = fixture.controller.getSnapshot()
    fixture.opening.resolve(fixture.binding)
    await refused
    expect(fixture.controller.getSnapshot()).toBe(disposed)
    expect(fixture.onReady).not.toHaveBeenCalled()
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('blocks a removed side Session and stops lifecycle observers at disposal', async ({
    onTestFinished,
  }) => {
    const fixture = harness()
    onTestFinished(fixture.dispose)
    await fixture.ready()
    fixture.controller.collect(sideChatCapture())
    fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), removed: true })
    expect(fixture.controller.getSnapshot()).toMatchObject({
      status: 'error',
      failure: { code: 'unavailable' },
    })
    await expect(fixture.controller.prepare()).rejects.toMatchObject({ code: 'unavailable' })
    expect(() =>
      fixture.controller.snapshotSubmission({
        question: 'Question',
        protocolLocale: 'en',
        attachmentIdentities: [],
      }),
    ).toThrow(SideChatFailure)
    fixture.controller.dispose()
    const disposed = fixture.controller.getSnapshot()
    fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), removed: false })
    expect(fixture.controller.getSnapshot()).toBe(disposed)
    expect(fixture.release).toHaveBeenCalledOnce()
  })

  it('keeps corrupt browser data unchanged and advertises unavailable refresh recovery', ({
    onTestFinished,
  }) => {
    const memory = new MemoryStorage()
    memory.setItem('dsh-annotation:side-chat:v1:main-test', '{broken')
    const fixture = harness(memory)
    onTestFinished(fixture.dispose)
    expect(() => fixture.controller.collect(sideChatCapture())).toThrow(SideChatFailure)
    expect(fixture.controller.getSnapshot()).toMatchObject({
      storageAvailable: false,
      failure: { code: 'storage' },
    })
    expect(memory.getItem('dsh-annotation:side-chat:v1:main-test')).toBe('{broken')
  })

  it('recovers retained records after temporarily denied initial reads and clears the storage failure', ({
    onTestFinished,
  }) => {
    const memory = new MemoryStorage()
    const first = harness(memory)
    onTestFinished(first.dispose)
    first.controller.collect(sideChatCapture('Saved before denial'))
    const denied = vi.spyOn(memory, 'getItem').mockImplementation(() => {
      throw new Error('Site storage denied')
    })
    const recovered = harness(memory)
    onTestFinished(recovered.dispose)
    expect(recovered.controller.getSnapshot()).toMatchObject({
      active: null,
      saveState: 'unavailable',
      failure: { code: 'storage' },
    })
    denied.mockRestore()
    expect(recovered.controller.retryStorage()).toBe(true)
    expect(recovered.controller.getSnapshot()).toMatchObject({
      saveState: 'merged',
      failure: null,
      references: [{ quote: { exact: 'Saved before denial' } }],
    })
    expect(() => recovered.controller.collect(sideChatCapture('After recovery'))).not.toThrow()
  })
})

it('retains accepted source bubbles without returning them to the next send and honors deletion during recovery', async ({
  onTestFinished,
}) => {
  const h = harness()
  onTestFinished(h.dispose)
  await h.ready()
  const first = h.controller.collect(sideChatCapture('Same selection'))
  const second = h.controller.collect(sideChatCapture('Same selection'))
  const chatId = h.controller.getSnapshot().activeSideChatId!
  const payload = h.controller.snapshotSubmission({
    question: 'Freeze both',
    protocolLocale: 'en',
    attachmentIdentities: [],
  })
  h.controller.markSending(payload.submissionId)
  h.controller.markAccepted(payload.submissionId)
  expect(h.controller.getSnapshot().references).toEqual([])
  expect(h.controller.chatView(chatId)!.referenceRecords.map((item) => item.referenceId)).toEqual([
    first.referenceId,
    second.referenceId,
  ])
  h.controller.removeReference(first.referenceId, chatId)
  const count = h.memory.values.size
  h.controller.recoverReferenceRecords(payload.references, chatId)
  expect(h.memory.values.size).toBe(count)
  expect(h.controller.chatView(chatId)!.referenceRecords).toEqual([second])
  expect(h.controller.chatView(chatId)!.referenceRecordIds).toEqual([first.referenceId, second.referenceId])
  h.controller.suspend()
  const restored = new SideChatController(
    h.controller.mainSessionId,
    h.sessions,
    new SideChatStorage(h.memory, h.controller.mainSessionId),
  )
  onTestFinished(() => restored.dispose())
  restored.recoverReferenceRecords(payload.references, chatId)
  expect(restored.chatView(chatId)!.referenceRecords).toEqual([second])
  expect(restored.getSnapshot().references).toEqual([])
})

it('recovers old accepted reference occurrences once and keeps pending references separate', async ({
  onTestFinished,
}) => {
  const h = harness()
  onTestFinished(h.dispose)
  const chat = h.controller.createChat()
  const legacy = {
    ...sideChatCapture('Historical'),
    referenceId: 'historical-ref' as import('../src/shared/side-chat-types.ts').SideChatReferenceId,
    sourceSessionId: h.controller.mainSessionId,
    messageId: sideChatCapture().messageId!,
    messageSeq: sideChatCapture().messageSeq!,
    responseVersion: sideChatCapture().responseVersion!,
    createdAt: 1,
  }
  h.controller.recoverReferenceRecords([legacy, legacy], chat.sideChatId)
  expect(h.controller.chatView(chat.sideChatId)!.referenceRecords).toEqual([legacy])
  expect(h.controller.chatView(chat.sideChatId)!.references).toEqual([])
  const save = vi.spyOn(h.memory, 'setItem')
  h.controller.recoverReferenceRecords([legacy], chat.sideChatId)
  expect(save).not.toHaveBeenCalled()
})
