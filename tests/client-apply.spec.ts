// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandClaim, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply } from '../src/client/index.tsx'
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'
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
  const sessionListeners = new Set<() => void>()
  const inputListeners = new Set<() => void>()
  const inputNotice = vi.fn()
  let sessionSnapshot = emptySnapshot()
  let listed = true
  let claim: CommandClaim | null = null
  let inputState = {
    draft: '',
    imageIds: [] as string[],
    draftRev: 0,
    phase: 'plain' as 'plain' | 'claimed' | 'submitting',
    occurrences: [] as readonly {
      occurrenceId: number
      source: string
      ref: string
      offset: number
      label: string
      clipboardText: string
    }[],
    queue: [],
  }
  const publishInput = (next: typeof inputState) => {
    inputState = next
    for (const listener of inputListeners) listener()
  }
  const actx = {
    bail(_carrier: unknown, event: string, request: Record<string, unknown>) {
      if (event === 'slash/input-begin-command') {
        const nextClaim = request.claim as CommandClaim
        const span = request.span as { start: number; end: number; draftRev: number }
        if (inputState.phase !== 'plain' && inputState.phase !== 'claimed') return undefined
        if (span.draftRev !== inputState.draftRev) return undefined
        const draft = nextClaim.token + inputState.draft.slice(span.end)
        claim = nextClaim
        publishInput({
          ...inputState,
          draft,
          draftRev: inputState.draftRev + 1,
          phase: 'claimed',
        })
        return true
      }
      if (event === 'slash/input-consume-token') {
        const guard = request.guard as {
          kind: 'span'
          span: { start: number; end: number; draftRev: number }
        }
        if (guard.kind !== 'span' || guard.span.draftRev !== inputState.draftRev) return undefined
        const draft = inputState.draft.slice(0, guard.span.start) + inputState.draft.slice(guard.span.end)
        claim = null
        publishInput({
          ...inputState,
          draft,
          draftRev: inputState.draftRev + 1,
          phase: 'plain',
        })
        return true
      }
      return undefined
    },
  } as unknown as ClientContext
  const input = {
    state: {
      getSnapshot: () => inputState,
      subscribe(listener: () => void) {
        inputListeners.add(listener)
        return () => inputListeners.delete(listener)
      },
    },
    setDraft(draft: string) {
      const keepsClaim = claim !== null && draft.startsWith(claim.token)
      if (!keepsClaim) claim = null
      publishInput({
        ...inputState,
        draft,
        draftRev: inputState.draftRev + 1,
        phase: keepsClaim ? 'claimed' : 'plain',
      })
    },
    notify: inputNotice,
  }
  const session = {
    getSnapshot: () => sessionSnapshot,
    subscribe(listener: () => void) {
      sessionListeners.add(listener)
      return () => {
        sessionListeners.delete(listener)
        unsubscribeSession()
      }
    },
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
      binding: () => ({ sessionId: 'session-test', session, ctx: actx }),
      scopeOf: (candidate: unknown) => (candidate === actx ? ('session-test' as SessionId) : undefined),
    },
    conversation: { input: { for: () => input } },
    inputTriggers: {
      sessionOf: () => ({
        serializeReference: async (_source: string, ref: string) => `<reference>${ref}</reference>`,
      }),
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
    inputNotice,
    inputSnapshot: () => inputState,
    setPlainComposerText(text: string) {
      input.setDraft(text)
    },
    setComposerText(text: string) {
      input.setDraft(`${COMPOSER_ATTACHMENT_TOKEN}${text}`)
    },
    setImages(ids: string[]) {
      publishInput({ ...inputState, imageIds: ids })
    },
    async submitComposer(): Promise<SubmitOutcome> {
      if (claim === null) throw new Error('composer is not claimed')
      const current = claim
      publishInput({ ...inputState, phase: 'submitting' })
      const outcome = await current.submit('', actx)
      if (outcome.kind === 'success') {
        claim = null
        publishInput({ ...inputState, draft: '', draftRev: inputState.draftRev + 1, phase: 'plain' })
      } else {
        publishInput({ ...inputState, phase: 'claimed' })
      }
      return outcome
    },
    setSnapshot(snapshot: ConversationSnapshot, notify = true) {
      sessionSnapshot = snapshot
      if (notify) for (const listener of sessionListeners) listener()
    },
    session,
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

function saveAnnotation(face: AnnotationInjected, start = 0, exact = 'first', comment = 'Revise this.') {
  face.beginSelection(capture(start, exact))
  face.updateEditorText(comment)
  face.saveEditor()
}

beforeEach(() => localStorage.clear())

describe('Client plugin composer attachment lifecycle', () => {
  it('submits official composer text and retries the same immutable batch after transport failure', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    fixture.setComposerText('Rewrite the proposal.')
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'offline' })
    const failed = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })
    expect(failed.payload.overallRequirement).toBe('Rewrite the proposal.')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })

    command.mockResolvedValueOnce({ ok: true, value: { matched: true } })
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    const retried = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(retried.payload).toBe(failed.payload)
    expect(retried.payload.submissionId).toBe(failed.payload.submissionId)
    expect(retried.payload.delivery).toBe('queue')
    expect(retried).toMatchObject({ status: 'accepted', attempts: 2 })
    expect(command.mock.calls[1]?.[0]).toBe(command.mock.calls[0]?.[0])
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain' })
    fixture.dispose()
  })

  it('allows an attachment-only official composer submission', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    expect(fixture.inputSnapshot().draft).toBe(COMPOSER_ATTACHMENT_TOKEN)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.overallRequirement).toBeUndefined()
    expect(command).toHaveBeenCalledOnce()
    fixture.dispose()
  })

  it('freezes the live draft set only when the official composer submits', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face, 0, 'first', 'First note.')
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    saveAnnotation(face, 8, 'second', 'Second note.')

    await fixture.submitComposer()
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.annotations).toHaveLength(2)
    expect(
      face.hooks.annotations.getSnapshot().outbox[0]?.payload.annotations.map((item) => item.comment),
    ).toEqual(['First note.', 'Second note.'])
    fixture.dispose()
  })

  it('moves a legacy overall request into the official composer on first attachment', async () => {
    localStorage.setItem(
      'dsh-inline-annotations:v1:session-test',
      JSON.stringify({
        storageVersion: 2,
        annotations: [
          {
            annotationId: 'ann-legacy',
            ordinal: 1,
            messageId: 'assistant-test',
            messageSeq: 12,
            responseVersion: 'assistant-test',
            quote: { exact: 'source', prefix: '', suffix: '', start: 0, end: 6 },
            comment: 'Legacy note.',
            createdAt: 1,
            updatedAt: 1,
            status: 'draft',
          },
        ],
        outbox: [],
        overallRequirementDraft: 'Keep the original structure.',
      }),
    )
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    fixture.setPlainComposerText('Rewrite the introduction.')
    apply(fixture.ctx)
    const face = fixture.face()

    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    expect(fixture.inputSnapshot().draft).toBe(
      `${COMPOSER_ATTACHMENT_TOKEN}Rewrite the introduction.\n\nKeep the original structure.`,
    )
    expect(face.hooks.annotations.getSnapshot().overallRequirementDraft).toBe('')
    await fixture.submitComposer()
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.overallRequirement).toBe(
      'Rewrite the introduction.\n\nKeep the original structure.',
    )
    fixture.dispose()
  })

  it('retains attached annotations and images when a mixed submission is refused', async () => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    fixture.setImages(['image-1'])

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'remove images' })
    expect(command).not.toHaveBeenCalled()
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed', imageIds: ['image-1'] })
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    fixture.dispose()
  })

  it('converges a stale withdrawal to durable sent history without removing provenance', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    fixture.session.updateQueue.mockResolvedValue({
      ok: false,
      error: { code: 'queue-item-not-found', message: 'already claimed', details: {} },
    })
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    face.toggleComposerAttachment('remove images')
    await fixture.submitComposer()
    const accepted = face.hooks.annotations.getSnapshot().outbox[0]!

    fixture.setSnapshot({
      ...emptySnapshot(),
      queue: [{ messageId: accepted.messageId }],
    } as unknown as ConversationSnapshot)
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')

    fixture.setSnapshot(
      {
        ...emptySnapshot(),
        chat: {
          nodes: new Map([
            [
              'user',
              {
                kind: 'user',
                data: { source: { kind: 'user', inlineAnnotations: accepted.payload } },
              },
            ],
          ]),
        },
      } as unknown as ConversationSnapshot,
      false,
    )
    await face.withdraw(accepted.payload.submissionId)

    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      outbox: [{ status: 'sent' }],
      annotations: [{ status: 'sent', submissionId: accepted.payload.submissionId }],
    })
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

  it('rejects an oversized item count from the official composer before transport', async () => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    apply(fixture.ctx, { maxAnnotationsPerSubmission: 1 })
    const face = fixture.face()
    saveAnnotation(face, 0, 'first', 'First note.')
    saveAnnotation(face, 8, 'second', 'Second note.')
    face.toggleComposerAttachment('remove images')

    const outcome = await fixture.submitComposer()
    expect(outcome.kind).toBe('error')
    expect(command).not.toHaveBeenCalled()
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      notice: { level: 'error', text: 'items' },
      outbox: [],
    })
    expect(face.hooks.annotations.getSnapshot().annotations.map((item) => item.status)).toEqual([
      'draft',
      'draft',
    ])
    fixture.dispose()
  })
})
