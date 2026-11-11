// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { AnnotationController } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import { SideChatController } from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import { submitSideChat, type SideChatSend } from '../src/client/side-chat-submit.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { sideChatSubmissionFingerprint } from '../src/shared/side-chat-protocol.ts'
import type { SideChatCommandReceipt, SideChatSubmissionPayload } from '../src/shared/side-chat-types.ts'
import type { AnnotationConfig, SessionIdentity, SubmittedAttachmentIdentity } from '../src/shared/types.ts'
import { sideChatCapture, sideChatSessionFixture } from './side-chat-fixtures.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function receipt(
  payload: SideChatSubmissionPayload,
  kind: SideChatCommandReceipt['kind'] = 'accepted',
  code?: SideChatCommandReceipt['code'],
): string {
  const result: SideChatCommandReceipt = {
    protocolVersion: 1,
    source: 'dsh-annotation-side-chat-result',
    kind,
    submissionId: payload.submissionId,
    ...(code === undefined ? {} : { code }),
  }
  return JSON.stringify(result)
}

async function harness(config: AnnotationConfig = DEFAULT_CONFIG) {
  const fixture = sideChatSessionFixture()
  await fixture.owner.prepare()
  const sideIdentity = String(fixture.sideId) as SessionIdentity
  const annotations = new AnnotationController(
    sideIdentity,
    new AnnotationStorage(fixture.memory, sideIdentity),
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => {} },
    config,
    () => 1_700_000_000_000,
  )
  const abort = new AbortController()
  const available = vi.fn(() => true)
  const prepareAttachments = vi.fn(async (): Promise<readonly SubmittedAttachmentIdentity[]> => [])
  const execute = vi.fn(async (payload: SideChatSubmissionPayload) => receipt(payload))
  const dictionary = new Map(Object.entries(en))
  const request = (changes: Partial<SideChatSend> = {}): SideChatSend => ({
    owner: fixture.owner,
    annotations,
    annotationSnapshot: annotations.getSnapshot(),
    references: fixture.owner.getSnapshot().references,
    outbox: fixture.owner.getSnapshot().outbox,
    question: 'Explain this claim.',
    attachments: [],
    protocolLocale: 'en',
    config,
    signal: abort.signal,
    available,
    prepareAttachments,
    execute,
    t: (key) => dictionary.get(key) ?? key,
    ...changes,
  })
  const addAnnotation = (): void => {
    annotations.beginSelection(sideChatCapture('side answer'))
    annotations.updateEditorText('Give an example.')
    annotations.saveEditor()
  }
  const dispose = async (): Promise<void> => {
    annotations.dispose()
    await fixture.dispose()
  }
  return {
    ...fixture,
    annotations,
    abort,
    available,
    prepareAttachments,
    execute,
    request,
    addAnnotation,
    dispose,
  }
}

describe('side-chat frozen composer admission', () => {
  it('sends captured main references and side annotations in one side-session request', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    fixture.addAnnotation()
    await submitSideChat(fixture.request())
    expect(fixture.execute).toHaveBeenCalledOnce()
    const payload = fixture.execute.mock.calls[0]![0]
    expect(payload).toMatchObject({
      mainSessionId: 'main-test',
      sideSessionId: fixture.sideId,
      question: 'Explain this claim.',
      references: [{ sourceSessionId: 'main-test', quote: { exact: 'selected source' } }],
      annotationSubmission: {
        sessionId: fixture.sideId,
        annotations: [{ quote: { exact: 'side answer' }, annotation: 'Give an example.' }],
      },
    })
    expect(payload.annotationSubmission?.submissionId).toBe(payload.submissionId)
    expect(fixture.owner.getSnapshot().references).toEqual([])
    expect(fixture.owner.getSnapshot().outbox).toBeNull()
    expect(fixture.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
  })

  it('retains the frozen request and stops transport when the sending-state write fails', async () => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    const write = fixture.memory.setItem.bind(fixture.memory)
    const failedWrite = vi.spyOn(fixture.memory, 'setItem').mockImplementation((key, text) => {
      if (
        key.startsWith('dsh-annotation:side-chat:') &&
        JSON.parse(text).chats.some(
          (chat: { outbox: { status: string } | null }) => chat.outbox?.status === 'sending',
        )
      )
        throw new Error('Quota exceeded before transport')
      write(key, text)
    })
    await expect(submitSideChat(fixture.request())).rejects.toMatchObject({ code: 'storage' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.owner.getSnapshot()).toMatchObject({
      saveState: 'unavailable',
      outbox: { status: 'failed', payload: { question: 'Explain this claim.' } },
    })
    expect(fixture.owner.exportStorageRecovery()).toContain('selected source')
    expect(fixture.owner.getSnapshot().references).toHaveLength(1)
    failedWrite.mockRestore()
    expect(fixture.owner.retryStorage()).toBe(true)
    await submitSideChat(fixture.request())
    expect(fixture.execute).toHaveBeenCalledOnce()
    expect(fixture.owner.getSnapshot().outbox).toBeNull()
  })

  it('observes a receipt arriving during attachment preflight and avoids duplicate execution', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    fixture.addAnnotation()
    fixture.execute.mockRejectedValueOnce(new Error('Connection closed before receipt'))
    await expect(submitSideChat(fixture.request())).rejects.toMatchObject({ code: 'send-unknown' })
    const frozen = fixture.owner.getSnapshot().outbox!.payload
    fixture.execute.mockClear()
    const preparation = deferred<readonly SubmittedAttachmentIdentity[]>()
    const sending = submitSideChat(fixture.request({ prepareAttachments: () => preparation.promise }))
    fixture.owner.reconcileReceipts({
      receipts: { [frozen.submissionId]: sideChatSubmissionFingerprint(frozen) },
    })
    preparation.resolve([])
    await sending
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.owner.getSnapshot().outbox).toBeNull()
    expect(fixture.owner.getSnapshot().references).toEqual([])
    expect(fixture.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
  })

  it('rejects changed question text before preflight and retains the frozen request', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    const frozen = fixture.owner.snapshotSubmission({
      question: 'Explain this claim.',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.owner.markUnknown(frozen.submissionId)
    await expect(submitSideChat(fixture.request({ question: 'A changed question.' }))).rejects.toMatchObject({
      code: 'frozen',
    })
    expect(fixture.prepareAttachments).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.owner.getSnapshot().outbox?.payload).toBe(frozen)
    expect(fixture.owner.getSnapshot().references).toHaveLength(1)
  })

  it.each([
    {
      limit: 'count',
      config: { ...DEFAULT_CONFIG, maxAnnotationsPerSubmission: 1 },
      quote: 'selected source',
      error: en['error.items'],
    },
    {
      limit: 'bytes',
      config: { ...DEFAULT_CONFIG, maxPayloadBytes: 1_800 },
      quote: 'selected source '.repeat(80),
      error: en['error.payload'],
    },
  ])(
    'rejects the combined $limit limit without publishing either outbox',
    async ({ config, quote, error }) => {
      const fixture = await harness(config)
      onTestFinished(fixture.dispose)
      fixture.owner.collect(sideChatCapture(quote))
      fixture.addAnnotation()
      await expect(submitSideChat(fixture.request())).rejects.toThrow(error)
      expect(fixture.owner.getSnapshot().outbox).toBeNull()
      expect(fixture.owner.getSnapshot().references).toHaveLength(1)
      expect(fixture.annotations.getSnapshot().outbox).toEqual([])
      expect(fixture.annotations.getSnapshot().annotations[0]?.status).toBe('draft')
      expect(fixture.execute).not.toHaveBeenCalled()
    },
  )

  it('keeps uncertain admission frozen and retries only its original references after explicit send', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture('A'))
    fixture.execute.mockRejectedValueOnce(new Error('Connection closed before receipt'))
    await expect(submitSideChat(fixture.request())).rejects.toMatchObject({ code: 'send-unknown' })
    const frozen = fixture.owner.getSnapshot().outbox!.payload
    fixture.owner.collect(sideChatCapture('B', 30))
    await submitSideChat(fixture.request())
    expect(fixture.execute.mock.calls[1]![0]).toBe(frozen)
    expect(fixture.owner.getSnapshot().references.map((item) => item.quote.exact)).toEqual(['B'])
  })

  it.each(['removed', 'aborted'] as const)(
    'stops before execution when attachment preflight completes after the Session is %s',
    async (state) => {
      const fixture = await harness()
      onTestFinished(fixture.dispose)
      fixture.owner.collect(sideChatCapture())
      const preparation = deferred<readonly SubmittedAttachmentIdentity[]>()
      const sending = submitSideChat(fixture.request({ prepareAttachments: () => preparation.promise }))
      const refusal = expect(sending).rejects.toMatchObject({
        code: state === 'removed' ? 'unavailable' : 'disposed',
      })
      if (state === 'removed') fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), removed: true })
      else fixture.abort.abort()
      preparation.resolve([])
      await refusal
      expect(fixture.execute).not.toHaveBeenCalled()
      expect(fixture.owner.getSnapshot().outbox).toBeNull()
      expect(fixture.owner.getSnapshot().references).toHaveLength(1)
    },
  )

  it('leaves a suspended send unknown when a late accepted result arrives after disable', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    const result = deferred<string>()
    const executing = deferred<SideChatSubmissionPayload>()
    const sending = submitSideChat(
      fixture.request({
        execute: (payload) => {
          executing.resolve(payload)
          return result.promise
        },
      }),
    )
    const payload = await executing.promise
    const refusal = expect(sending).rejects.toMatchObject({ code: 'disposed' })
    fixture.abort.abort()
    fixture.owner.suspend()
    result.resolve(receipt(payload))
    await refusal
    expect(fixture.owner.getSnapshot()).toMatchObject({ status: 'idle', outbox: { status: 'unknown' } })
    expect(fixture.owner.getSnapshot().references).toHaveLength(1)
  })

  it('retains the composer draft when the Session is deleted before a late accepted result', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    let draft = 'Explain this claim.'
    const clearDraft = vi.fn(() => {
      draft = ''
    })
    const result = deferred<string>()
    const executing = deferred<SideChatSubmissionPayload>()
    const sending = submitSideChat(
      fixture.request({
        execute: (payload) => {
          executing.resolve(payload)
          return result.promise
        },
      }),
    ).then(clearDraft)
    const payload = await executing.promise
    const refusal = expect(sending).rejects.toMatchObject({ code: 'unavailable' })
    fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), removed: true })
    result.resolve(receipt(payload))
    await refusal
    expect(clearDraft).not.toHaveBeenCalled()
    expect(draft).toBe('Explain this claim.')
    expect(fixture.owner.getSnapshot().outbox?.payload).toBe(payload)
    expect(fixture.owner.getSnapshot().references).toHaveLength(1)
  })

  it('persists rejected identity conflicts and blocks another send after recovery', async ({
    onTestFinished,
  }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    fixture.execute.mockImplementationOnce(async (payload) =>
      receipt(payload, 'rejected', 'identity-conflict'),
    )
    await expect(submitSideChat(fixture.request())).rejects.toMatchObject({ code: 'receipt-conflict' })
    const recovered = new SideChatController(
      fixture.owner.mainSessionId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, fixture.owner.mainSessionId),
    )
    onTestFinished(() => recovered.dispose())
    await recovered.prepare()
    await expect(
      submitSideChat(fixture.request({ owner: recovered, outbox: recovered.getSnapshot().outbox })),
    ).rejects.toMatchObject({ code: 'receipt-conflict' })
    expect(fixture.execute).toHaveBeenCalledOnce()
    expect(recovered.getSnapshot().outbox?.failureCode).toBe('receipt-conflict')
    expect(recovered.getSnapshot().references).toHaveLength(1)
  })

  it.each([
    { kind: 'rejected', code: 'admission' },
    { kind: 'rejected', code: 'identity-conflict' },
    { kind: 'unknown', code: 'identity-conflict' },
    { kind: 'accepted', code: undefined },
  ])('retains unknown outcome when a $kind/$code result names another submission', async ({ kind, code }) => {
    const fixture = await harness()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    fixture.execute.mockResolvedValueOnce(
      JSON.stringify({
        protocolVersion: 1,
        source: 'dsh-annotation-side-chat-result',
        kind,
        code,
        submissionId: 'another-submission',
      }),
    )
    await expect(submitSideChat(fixture.request())).rejects.toMatchObject({ code: 'send-unknown' })
    expect(fixture.owner.getSnapshot()).toMatchObject({
      outbox: { status: 'unknown' },
      failure: { code: 'send-unknown' },
    })
    expect(fixture.owner.getSnapshot().outbox?.failureCode).toBeUndefined()
    expect(fixture.owner.getSnapshot().references).toHaveLength(1)
  })

  it.each(['accepted', 'transport-failure'] as const)(
    'retains a receipt conflict that precedes a late %s command result',
    async (outcome) => {
      const fixture = await harness()
      onTestFinished(fixture.dispose)
      fixture.owner.collect(sideChatCapture())
      const result = deferred<string>()
      const executing = deferred<SideChatSubmissionPayload>()
      const sending = submitSideChat(
        fixture.request({
          execute: async (payload) => {
            executing.resolve(payload)
            const response = await result.promise
            if (outcome === 'transport-failure')
              throw new Error('Transport failed after the Projection receipt')
            return response
          },
        }),
      )
      const payload = await executing.promise
      const refusal = expect(sending).rejects.toMatchObject({ code: 'receipt-conflict' })
      fixture.owner.reconcileReceipts({ receipts: { [payload.submissionId]: '0'.repeat(64) } })
      result.resolve(receipt(payload))
      await refusal
      expect(fixture.owner.getSnapshot()).toMatchObject({
        outbox: { status: 'unknown', failureCode: 'receipt-conflict' },
        failure: { code: 'receipt-conflict' },
      })
      expect(fixture.owner.getSnapshot().references).toHaveLength(1)
    },
  )
})
