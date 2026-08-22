// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore<T>(initial: T, options?: { persist?: { name: string } }) {
    const key = options?.persist?.name
    let value = initial
    if (key !== undefined) {
      const stored = localStorage.getItem(key)
      if (stored !== null) value = JSON.parse(stored) as T
    }
    const listeners = new Set<() => void>()
    const publish = (next: T) => {
      value = next
      if (key !== undefined) localStorage.setItem(key, JSON.stringify(next))
      for (const listener of listeners) listener()
    }
    return {
      getSnapshot: () => value,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: publish,
      update(mutator: (draft: T) => void) {
        mutator(value)
        publish(value)
      },
    }
  },
}))
import type { CommandClaim, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply } from '../src/client/index.tsx'
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'
import type { AnnotationInjected } from '../src/client/contract.ts'
import { LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY } from '../src/shared/settings.ts'
import type { MessageIdentity } from '../src/shared/types.ts'

function emptySnapshot(): ConversationSnapshot {
  return {
    chat: { nodes: new Map() },
    queue: [],
    hasMore: false,
  } as unknown as ConversationSnapshot
}

function fixtureContext(command: ReturnType<typeof vi.fn>, initialEnabled = true) {
  const registrations: { options: Record<string, unknown> }[] = []
  const disposers: (() => void | Promise<void>)[] = []
  const listListeners = new Set<() => void>()
  const unsubscribeSession = vi.fn()
  const sessionListeners = new Set<() => void>()
  const inputListeners = new Set<() => void>()
  const inputNotice = vi.fn()
  const settingsListeners = new Set<() => void>()
  let settingsUser: { enabled?: boolean } = initialEnabled ? {} : { enabled: false }
  let settingsRevision = 0
  const settingsSnapshot = () => ({
    status: 'ready' as const,
    value: { enabled: settingsUser.enabled ?? true },
    base: undefined,
    user: settingsUser,
    revision: settingsRevision,
    writable: true,
    mode: 'host' as const,
  })
  const publishSettings = () => {
    settingsRevision += 1
    for (const listener of settingsListeners) listener()
  }
  const settingsScope = {
    getSnapshot: settingsSnapshot,
    subscribe(listener: () => void) {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    },
    async set(field: string, value: unknown) {
      if (field === 'enabled' && typeof value === 'boolean') settingsUser = { enabled: value }
      publishSettings()
    },
    async unset(field: string) {
      if (field === 'enabled') settingsUser = {}
      publishSettings()
    },
  }
  let sessionSnapshot = emptySnapshot()
  let listed = true
  let claim: CommandClaim | null = null
  let inputState = {
    draft: '',
    imageIds: [] as string[],
    draftRev: 0,
    phase: 'plain' as 'plain' | 'claimed' | 'submitting',
    claim: null as CommandClaim | null,
    occurrences: [] as readonly {
      occurrenceId: number
      source: string
      ref: string
      offset: number
      length: number
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
          claim: nextClaim,
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
          claim: null,
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
        claim: keepsClaim ? claim : null,
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
    settingsScope: {
      bind: () => settingsScope,
    },
    slots: {
      register(options: Record<string, unknown>) {
        const registration = { options }
        registrations.push(registration)
        return () => {
          const index = registrations.indexOf(registration)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
      inject(_name: string, install: () => (() => void) | readonly (() => void)[]) {
        const installed = install()
        return () => {
          if (typeof installed === 'function') installed()
          else for (const dispose of [...installed].reverse()) dispose()
        }
      },
    },
    effect(install: () => void | (() => void | Promise<void>)) {
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
    async setPluginEnabled(enabled: boolean) {
      const setting = registrations.find((entry) => entry.options.name === 'settings.plugin.item')
      if (setting === undefined || typeof setting.options.inject !== 'function')
        throw new Error('plugin settings card was not registered')
      const face = setting.options.inject() as {
        setEnabled: (value: boolean) => void
        save: () => void
      }
      face.setEnabled(enabled)
      face.save()
      await Promise.resolve()
      await Promise.resolve()
    },
    settingsUser: () => settingsUser,
    hasRegistration(name: string) {
      return registrations.some((entry) => entry.options.name === name)
    },
    inputNotice,
    inputSnapshot: () => inputState,
    setPlainComposerText(text: string) {
      input.setDraft(text)
    },
    setComposerText(text: string) {
      input.setDraft(`${COMPOSER_ATTACHMENT_TOKEN}${text}`)
    },
    setComposerReferences(
      text: string,
      references: readonly { display: string; source: string; ref: string }[],
    ) {
      const draft = `${COMPOSER_ATTACHMENT_TOKEN}${text}`
      const occurrences = references.map((reference, index) => {
        const offset = draft.indexOf(reference.display)
        if (offset < 0) throw new Error(`reference display is absent from draft: ${reference.display}`)
        return {
          occurrenceId: index + 1,
          source: reference.source,
          ref: reference.ref,
          offset,
          length: reference.display.length,
          label: reference.display.slice(1),
          clipboardText: reference.display,
        }
      })
      publishInput({ ...inputState, draft, draftRev: inputState.draftRev + 1, occurrences })
    },
    setImages(ids: string[]) {
      publishInput({ ...inputState, imageIds: ids })
    },
    async submitComposer(): Promise<SubmitOutcome> {
      if (claim === null) throw new Error('composer is not claimed')
      const current = claim
      publishInput({ ...inputState, phase: 'submitting' })
      const outcome = await current.submit('', actx, [])
      if (outcome.kind === 'success') {
        claim = null
        publishInput({
          ...inputState,
          draft: '',
          draftRev: inputState.draftRev + 1,
          phase: 'plain',
          claim: null,
        })
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
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose()
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
  it('disables conversation integrations without discarding drafts and restores them when enabled', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    fixture.setComposerText('Keep this visible draft.')

    await fixture.setPluginEnabled(false)

    expect(fixture.hasRegistration('settings.plugin.item')).toBe(true)
    expect(fixture.hasRegistration('conversation.chat.node')).toBe(false)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(fixture.hasRegistration('conversation.chat.assistant-actions')).toBe(false)
    expect(fixture.inputSnapshot()).toMatchObject({ draft: 'Keep this visible draft.', phase: 'plain' })
    expect(face.hooks.annotations.getSnapshot().annotations).toHaveLength(1)
    expect(fixture.settingsUser()).toEqual({ enabled: false })

    await fixture.setPluginEnabled(true)

    expect(fixture.hasRegistration('conversation.chat.node')).toBe(true)
    expect(fixture.face().hooks.annotations.getSnapshot().annotations).toHaveLength(1)
    await fixture.dispose()
  })

  it('releases a submitting attachment when the feature is disabled mid-send', async () => {
    let rejectCommand!: (cause: Error) => void
    const command = vi
      .fn()
      .mockImplementation(() => new Promise<never>((_resolve, reject) => (rejectCommand = reject)))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    fixture.setComposerText('Keep this draft while sending.')

    const pending = fixture.submitComposer()
    await Promise.resolve()
    await Promise.resolve()
    expect(command).toHaveBeenCalledOnce()
    await fixture.setPluginEnabled(false)

    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(fixture.inputSnapshot().draft.startsWith(COMPOSER_ATTACHMENT_TOKEN)).toBe(true)
    expect(fixture.inputSnapshot().phase).toBe('submitting')

    rejectCommand(new Error('offline'))
    await expect(pending).resolves.toEqual({ kind: 'error', text: 'offline' })

    expect(fixture.inputSnapshot()).toMatchObject({
      draft: 'Keep this draft while sending.',
      phase: 'plain',
      claim: null,
    })
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ status: 'failed' })
    await fixture.dispose()
  })

  it('reads a disabled Host setting while leaving its plugin card available', async () => {
    const fixture = fixtureContext(vi.fn(), false)
    apply(fixture.ctx)

    expect(fixture.hasRegistration('settings.plugin.item')).toBe(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(() => fixture.face()).toThrow('dock was not registered')

    await fixture.setPluginEnabled(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(true)
    await fixture.dispose()
  })

  it('migrates the legacy disabled preference before mounting conversation integrations', async () => {
    localStorage.setItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY, 'false')
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.hasRegistration('settings.plugin.item')).toBe(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(fixture.settingsUser()).toEqual({ enabled: false })
    expect(localStorage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBeNull()
    await fixture.dispose()
  })

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
    await fixture.dispose()
  })

  it('serializes complete reference display ranges without leaking their labels', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    fixture.setComposerReferences('Compare @current-session with @docs/guide.md.', [
      { display: '@current-session', source: 'session', ref: 'session-current' },
      { display: '@docs/guide.md', source: 'file', ref: 'file-guide' },
    ])

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.overallRequirement).toBe(
      'Compare <reference>session-current</reference> with <reference>file-guide</reference>.',
    )
    await fixture.dispose()
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
    await fixture.dispose()
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
    await fixture.dispose()
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

    expect(localStorage.getItem('dsh-inline-annotations:v1:session-test')).toBeNull()
    expect(localStorage.getItem('dsh-inline-comments:v1:session-test')).not.toBeNull()
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    expect(fixture.inputSnapshot().draft).toBe(
      `${COMPOSER_ATTACHMENT_TOKEN}Rewrite the introduction.\n\nKeep the original structure.`,
    )
    expect(face.hooks.annotations.getSnapshot().overallRequirementDraft).toBe('')
    await fixture.submitComposer()
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.overallRequirement).toBe(
      'Rewrite the introduction.\n\nKeep the original structure.',
    )
    await fixture.dispose()
  })

  it('leaves image capability disabled and defensively refuses a mixed submit', async () => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment('remove images')).toBe(true)
    expect(fixture.inputSnapshot().claim).not.toHaveProperty('images')
    fixture.setImages(['image-1'])

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'remove images' })
    expect(command).not.toHaveBeenCalled()
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed', imageIds: ['image-1'] })
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    await fixture.dispose()
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
                data: { source: { kind: 'user', inlineComments: accepted.payload } },
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
    await fixture.dispose()
  })

  it('disposes a Session controller when the authoritative list removes that Session', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    fixture.face()
    fixture.removeSession()
    expect(fixture.unsubscribeSession).toHaveBeenCalledOnce()
    await fixture.dispose()
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
    await fixture.dispose()
  })
})
