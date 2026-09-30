// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ATTACHMENT_PREPARE_INPUT } from '../src/shared/types.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'

vi.mock('@deepseek-ai/dsh-client-store', () => ({
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
import type {
  CommandClaim,
  SubmitAttachment,
  SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client/index.tsx'
import { COMPOSER_ATTACHMENT_TOKEN, COMPOSER_TEXT_SEAT } from '../src/client/composer-attachment.ts'
import {
  AnnotationController,
  selectedAnnotations,
  type AnnotationReconciliationSnapshot,
} from '../src/client/controller.ts'
import type { AnnotationInjected } from '../src/client/contract.ts'
import type { AnnotationSettingsInjected } from '../src/client/feature-toggle.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { SourceSnapshotStore } from '../src/client/source-snapshots.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  DEFAULT_TRANSCRIPT_VISIBILITY,
  LEGACY_ANNOTATION_ENABLED_STORAGE_KEY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'
import { expectOutboxPayload } from './outbox-test-helpers.ts'

function emptySnapshot(): AnnotationReconciliationSnapshot {
  return {
    chat: { nodes: new Map() },
    queue: [],
    hasMore: false,
  } as unknown as AnnotationReconciliationSnapshot
}

function inboxSnapshot(nextTurn: readonly string[] = [], nextStep: readonly string[] = []): InboxState {
  const messages = (ids: readonly string[]): InboxState['next-turn'] =>
    ids.map((id) => ({
      id: id as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'Pending input' }],
      source: { kind: 'user' },
    }))
  return { 'next-turn': messages(nextTurn), 'next-step': messages(nextStep) }
}

function imageAttachment(name = 'shot.png'): SubmitAttachment {
  return { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name }
}

function fileAttachment(receiptId = 'upload-receipt-1'): SubmitAttachment {
  return { type: 'file', receiptId }
}

function remoteSuccess() {
  return { ok: true, value: { result: { kind: 'success' as const } } }
}

function fixtureContext(command: ReturnType<typeof vi.fn>, initialEnabled = true) {
  type HostSettings = Partial<AnnotationSettings>
  let referenceSerializer = async (_source: string, ref: string): Promise<string> =>
    `<reference>${ref}</reference>`
  const settingsFields = new Set([
    'enabled',
    'autoAttach',
    'individualSelection',
    'compactSummary',
    ...TRANSCRIPT_VISIBILITY_KEYS,
  ])
  const registrations: {
    options: Record<string, unknown>
    component: unknown
    inject?: (...args: unknown[]) => Record<string, unknown>
  }[] = []
  const disposers: (() => void | Promise<void>)[] = []
  const slotListeners = new Set<(key: string) => void>()
  const listListeners = new Set<() => void>()
  const unsubscribeSession = vi.fn()
  const unsubscribeChat = vi.fn()
  const unsubscribeInbox = vi.fn()
  const inboxListeners = new Set<() => void>()
  const sessionListeners = new Set<() => void>()
  const chatListeners = new Set<() => void>()
  const inputListeners = new Set<() => void>()
  const inputNotice = vi.fn()
  const settingsListeners = new Set<() => void>()
  let settingsUser: HostSettings = initialEnabled ? {} : { enabled: false }
  let settingsRevision = 0
  const settingsSnapshot = () => ({
    status: 'ready' as const,
    value: {
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      ...settingsUser,
      enabled: settingsUser.enabled ?? true,
      autoAttach: settingsUser.autoAttach ?? true,
      compactSummary: settingsUser.compactSummary ?? true,
    },
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
      if (settingsFields.has(field) && typeof value === 'boolean') {
        settingsUser = { ...settingsUser, [field]: value }
      }
      publishSettings()
    },
    async unset(field: string) {
      if (settingsFields.has(field)) {
        const next = { ...settingsUser }
        delete next[field as keyof AnnotationSettings]
        settingsUser = next
      }
      publishSettings()
    },
  }
  const initialSnapshot = emptySnapshot()
  let sessionSnapshot: Pick<SessionSnapshot, 'hasMore'> = {
    hasMore: initialSnapshot.hasMore,
  }
  let inbox: InboxState | undefined
  let chatSnapshot = initialSnapshot.chat
  let listed = true
  let remoteCommandsAvailable = true
  let claim: CommandClaim | null = null
  let inputState = {
    draft: '',
    attachmentIds: [] as string[],
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
  const inboxFace = {
    getSnapshot: () => inbox,
    subscribe(listener: () => void) {
      inboxListeners.add(listener)
      return () => {
        inboxListeners.delete(listener)
        unsubscribeInbox()
      }
    },
  }
  const session = {
    projections: {
      faceOf(key: string) {
        if (key !== 'inbox') throw new Error(`Unexpected projection: ${key}`)
        return inboxFace
      },
    },
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
  const fileContents = new Map<string, string>()
  const prepareAttachments = vi.fn(
    async (_sessionId: SessionId, _line: string, attachments: readonly SubmitAttachment[]) => ({
      ok: true,
      value: {
        result: {
          kind: 'success' as const,
          text: JSON.stringify(
            attachments.map((attachment) => {
              const data =
                attachment.type === 'image'
                  ? Buffer.from(attachment.data, 'base64')
                  : Buffer.from(fileContents.get(attachment.receiptId) ?? 'original file')
              const identity = {
                type: attachment.type,
                attachmentId: `sha256:${createHash('sha256').update(data).digest('hex')}`,
                bytes: data.length,
              }
              return attachment.type === 'image'
                ? {
                    ...identity,
                    mediaType: attachment.mediaType,
                    ...(attachment.name === undefined ? {} : { name: attachment.name }),
                  }
                : { ...identity, name: 'notes.txt' }
            }),
          ),
        },
      },
    }),
  )
  const execute = (sessionId: SessionId, line: string, attachments: readonly SubmitAttachment[]) =>
    line.endsWith(` ${ATTACHMENT_PREPARE_INPUT}`)
      ? prepareAttachments(sessionId, line, attachments)
      : Reflect.apply(command, undefined, [sessionId, line, attachments])
  const ctx = {
    get(name: string) {
      if (name === 'remote.commands' && remoteCommandsAvailable) return { execute }
      return undefined
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh' as const, locales: [], revision: 0 }),
    },
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
    uiConversation: {
      binding: () => ({
        target: () => ({
          getSnapshot: () => chatSnapshot,
          subscribe(listener: () => void) {
            chatListeners.add(listener)
            return () => {
              chatListeners.delete(listener)
              unsubscribeChat()
            }
          },
        }),
      }),
    },
    conversation: { input: { for: () => input } },
    inputTriggers: {
      sessionOf: () => ({
        serializeReference: (source: string, ref: string) => referenceSerializer(source, ref),
      }),
    },
    configForms: {
      get: () => settingsScope,
    },
    slots: {
      register(options: Record<string, unknown>, component: unknown) {
        const registration = {
          options,
          component,
          ...(typeof options.inject === 'function'
            ? { inject: options.inject as (...args: unknown[]) => Record<string, unknown> }
            : {}),
        }
        registrations.push(registration)
        for (const listener of slotListeners) listener(String(options.name))
        return () => {
          const index = registrations.indexOf(registration)
          if (index >= 0) registrations.splice(index, 1)
          for (const listener of slotListeners) listener(String(options.name))
        }
      },
      entries(name: string) {
        return registrations.filter((entry) => entry.options.name === name)
      },
      inject(_name: string, install: () => (() => void) | readonly (() => void)[]) {
        const installed = install()
        let active = true
        const dispose = () => {
          if (!active) return
          active = false
          if (typeof installed === 'function') installed()
          else for (const disposeEntry of [...installed].reverse()) disposeEntry()
        }
        disposers.push(dispose)
        return dispose
      },
    },
    on(event: string, listener: (key: string) => void) {
      if (event !== 'slots/changed') return () => undefined
      slotListeners.add(listener)
      return () => slotListeners.delete(listener)
    },
    effect(install: () => void | (() => void | Promise<void>)) {
      const dispose = install()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  } as unknown as ClientContext
  return {
    ctx,
    prepareAttachments,
    fileContents,
    face(sessionId = 'session-test' as SessionId) {
      const dock = registrations.find((entry) => entry.options.name === 'conversation.input.dock')
      if (dock === undefined || typeof dock.options.inject !== 'function')
        throw new Error('dock was not registered')
      return dock.options.inject(sessionId) as AnnotationInjected
    },
    async setPluginEnabled(enabled: boolean) {
      const setting = registrations.find((entry) => entry.options.name === 'settings.section')
      if (setting === undefined || typeof setting.options.inject !== 'function')
        throw new Error('annotation Settings tab was not registered')
      const face = setting.options.inject() as AnnotationSettingsInjected
      face.setEnabled(enabled)
      face.save()
      await vi.waitFor(() => {
        expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
      })
    },
    async setAutoAttach(enabled: boolean) {
      const setting = registrations.find((entry) => entry.options.name === 'settings.section')
      if (setting === undefined || typeof setting.options.inject !== 'function') {
        throw new Error('annotation Settings tab was not registered')
      }
      const face = setting.options.inject() as AnnotationSettingsInjected
      face.setAutoAttach(enabled)
      face.save()
      await vi.waitFor(() => {
        expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
      })
    },
    settingsFace(): AnnotationSettingsInjected {
      const setting = registrations.find((entry) => entry.options.name === 'settings.section')
      if (setting === undefined || typeof setting.options.inject !== 'function') {
        throw new Error('annotation Settings tab was not registered')
      }
      return setting.options.inject() as AnnotationSettingsInjected
    },
    settingsUser: () => settingsUser,
    addHostEntry(
      options: Record<string, unknown>,
      component: unknown,
      injected?: (...args: unknown[]) => Record<string, unknown>,
    ) {
      const registration = {
        options,
        component,
        ...(injected === undefined ? {} : { inject: injected }),
      }
      registrations.push(registration)
      for (const listener of slotListeners) listener(String(options.name))
      return registration
    },
    addHostAssistant(
      component: unknown,
      injected?: (...args: unknown[]) => Record<string, unknown>,
      priority = 0,
    ) {
      const registration = {
        options: {
          name: 'conversation.chat.node',
          key: 'assistant-step',
          priority,
        },
        component,
        ...(injected === undefined ? {} : { inject: injected }),
      }
      registrations.push(registration)
      for (const listener of slotListeners) listener('conversation.chat.node')
      return registration
    },
    hasRegistration(name: string) {
      return registrations.some((entry) => entry.options.name === name)
    },
    registrationOptions(name: string) {
      return registrations.find((entry) => entry.options.name === name)?.options
    },
    hasRegistrationKey(name: string, key: string) {
      return registrations.some((entry) => entry.options.name === name && entry.options.key === key)
    },
    countRegistrationKey(name: string, key: string) {
      return registrations.filter((entry) => entry.options.name === name && entry.options.key === key).length
    },
    inputNotice,
    inputSnapshot: () => inputState,
    setPlainComposerText(text: string) {
      input.setDraft(text)
    },
    setComposerText(text: string, notify = true) {
      if (notify) {
        const prefix = inputState.draft.startsWith(`${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`)
          ? `${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`
          : COMPOSER_ATTACHMENT_TOKEN
        input.setDraft(`${prefix}${text}`)
        return
      }
      // A captured submit callback can observe text before the input observers run.
      const prefix = inputState.draft.startsWith(`${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`)
        ? `${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`
        : COMPOSER_ATTACHMENT_TOKEN
      inputState = {
        ...inputState,
        draft: `${prefix}${text}`,
        draftRev: inputState.draftRev + 1,
      }
    },
    setComposerReferences(
      text: string,
      references: readonly { display: string; source: string; ref: string }[],
    ) {
      const prefix = inputState.draft.startsWith(`${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`)
        ? `${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`
        : COMPOSER_ATTACHMENT_TOKEN
      const draft = `${prefix}${text}`
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
    setAttachments(ids: string[]) {
      publishInput({ ...inputState, attachmentIds: ids })
    },
    async submitComposer(
      images: readonly SubmitAttachment[] = [],
      prepareAttachments?: () => Promise<void>,
    ): Promise<SubmitOutcome> {
      if (claim === null) throw new Error('composer is not claimed')
      const current = claim
      const args = inputState.draft.startsWith(COMPOSER_ATTACHMENT_TOKEN)
        ? inputState.draft.slice(COMPOSER_ATTACHMENT_TOKEN.length)
        : inputState.draft
      publishInput({ ...inputState, phase: 'submitting' })
      if (prepareAttachments !== undefined) await prepareAttachments()
      const outcome = await current.submit(args, actx, images)
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
    setReferenceSerializer(serialize: (source: string, ref: string) => Promise<string>) {
      referenceSerializer = serialize
    },
    setSessionSnapshot(snapshot: Pick<SessionSnapshot, 'hasMore'>, notify = true) {
      sessionSnapshot = snapshot
      if (notify) for (const listener of sessionListeners) listener()
    },
    setInbox(snapshot: InboxState | undefined, notify = true) {
      inbox = snapshot
      if (notify) for (const listener of inboxListeners) listener()
    },
    setChatSnapshot(snapshot: AnnotationReconciliationSnapshot['chat'], notify = true) {
      chatSnapshot = snapshot
      if (notify) for (const listener of chatListeners) listener()
    },
    disableRemoteCommands() {
      remoteCommandsAvailable = false
    },
    session,
    removeSession() {
      listed = false
      for (const listener of listListeners) listener()
    },
    unsubscribeSession,
    unsubscribeChat,
    unsubscribeInbox,
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}

function deferredReference(fixture: ReturnType<typeof fixtureContext>) {
  let release!: (text: string) => void
  const waiting = new Promise<string>((resolve) => {
    release = resolve
  })
  const serialize = vi.fn(() => waiting)
  fixture.setReferenceSerializer(serialize)
  return { release, serialize }
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

function saveAnnotation(face: AnnotationInjected, start = 0, exact = 'first', annotation = 'Revise this.') {
  face.beginSelection(capture(start, exact))
  face.updateEditorText(annotation)
  face.saveEditor()
}

function seedCrossSessionOutbox() {
  const navigation = {
    getSnapshot: () => ({ hasMore: false }),
    loadOlder: async () => undefined,
  }
  const originId = 'session-test' as SessionIdentity
  const targetId = 'session-other' as SessionIdentity
  const origin = new AnnotationController(
    originId,
    new AnnotationStorage(localStorage, originId),
    navigation,
    DEFAULT_CONFIG,
  )
  origin.beginSelection(capture(0, 'first'))
  origin.updateEditorText('Revise this.')
  origin.saveEditor()
  const entry = origin.createOutbox('queue', targetId, '', undefined, 'zh')
  const queued = {
    ...emptySnapshot(),
    queue: [{ messageId: entry.messageId }],
  } as unknown as AnnotationReconciliationSnapshot
  origin.reconcile(queued)
  const target = new AnnotationController(
    targetId,
    new AnnotationStorage(localStorage, targetId),
    navigation,
    DEFAULT_CONFIG,
  )
  target.adoptOutbox(entry)
  target.reconcile(queued)
  origin.dispose()
  target.dispose()
  return entry
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(SourceSnapshotStore.prototype, 'capture').mockResolvedValue()
  vi.spyOn(SourceSnapshotStore.prototype, 'read').mockResolvedValue({ state: 'fragment' })
  vi.spyOn(SourceSnapshotStore.prototype, 'release').mockResolvedValue()
})

function persistedAnnotationValues(sessionId = 'session-test'): string {
  const prefix = `dsh-annotation:v1:${sessionId}`
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key !== null && (key === prefix || key.startsWith(`${prefix}:journal:`)))
    .map((key) => localStorage.getItem(key) ?? '')
    .join('\n')
}

describe('Client plugin composer attachment lifecycle', () => {
  it("reloads another page's journal event and removes its listener on unload", async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const fixture = fixtureContext(vi.fn())
    let external: AnnotationStorage | undefined
    let disposed = false
    try {
      apply(fixture.ctx)
      const face = fixture.face()
      external = new AnnotationStorage(localStorage, 'session-test' as SessionIdentity)
      const base = external.load()
      const payload = fixturePayload()
      const annotation = {
        ...payload.annotations[0]!,
        status: 'draft' as const,
        updatedAt: payload.createdAt,
      }
      expect(external.save({ ...base, annotations: [annotation] })).toBe(true)
      const journalKey = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).find((key) => key?.startsWith('dsh-annotation:v1:session-test:journal:'))
      if (journalKey === undefined) throw new Error('external page did not save a journal')
      window.dispatchEvent(new StorageEvent('storage', { key: journalKey, storageArea: localStorage }))
      expect(face.hooks.annotations.getSnapshot().annotations[0]?.annotation).toBe(annotation.annotation)

      const listener = add.mock.calls.find(([type]) => type === 'storage')?.[1]
      expect(listener).toBeDefined()
      await fixture.dispose()
      disposed = true
      expect(remove).toHaveBeenCalledWith('storage', listener)
    } finally {
      if (!disposed) await fixture.dispose()
      external?.dispose()
      add.mockRestore()
      remove.mockRestore()
    }
  })

  it('registers one dedicated annotation section in main Settings', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)

    const options = fixture.registrationOptions('settings.section')
    expect(options).toMatchObject({ id: 'dsh-annotation', order: 22, locale: 'dshAnnotation' })
    expect((options?.label as (() => string) | undefined)?.()).toBe('settings.title')
    expect(fixture.hasRegistration('plugins.bundle.config')).toBe(false)
    expect(fixture.hasRegistration('settings.plugins.tab')).toBe(false)

    await fixture.dispose()
    expect(fixture.hasRegistration('settings.section')).toBe(false)
  })

  it('decorates the existing assistant renderer without registering another assistant-step entry', async () => {
    const fixture = fixtureContext(vi.fn())
    const HostAssistant = () => null
    const originalInject = vi.fn(() => ({ hostValue: 'kept', hooks: { hostHook: 'kept' } }))
    const hostEntry = fixture.addHostAssistant(HostAssistant, originalInject)

    apply(fixture.ctx)

    expect(fixture.countRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(1)
    expect(hostEntry.component).not.toBe(HostAssistant)
    expect(hostEntry.inject).not.toBe(originalInject)
    expect(hostEntry.inject?.('session-test')).toMatchObject({
      hostValue: 'kept',
      annotationT: expect.any(Function),
      hooks: { hostHook: 'kept', annotations: expect.any(Object) },
    })

    const LateAssistant = () => null
    const lateEntry = fixture.addHostAssistant(LateAssistant, undefined, -100)
    expect(fixture.countRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(2)
    expect(lateEntry.component).not.toBe(LateAssistant)
    expect(lateEntry.inject).toEqual(expect.any(Function))

    await fixture.setPluginEnabled(false)
    expect(hostEntry.component).toBe(HostAssistant)
    expect(hostEntry.inject).toBe(originalInject)
    expect(lateEntry.component).toBe(LateAssistant)
    expect(lateEntry).not.toHaveProperty('inject')

    await fixture.setPluginEnabled(true)
    expect(fixture.countRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(2)
    expect(hostEntry.component).not.toBe(HostAssistant)
    expect(lateEntry.component).not.toBe(LateAssistant)
    await fixture.dispose()
  })

  it('disables conversation integrations without discarding drafts and restores them when enabled', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(false)
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'user')).toBe(true)
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Keep this visible draft.')

    await fixture.setPluginEnabled(false)

    expect(fixture.hasRegistration('settings.section')).toBe(true)
    expect(fixture.hasRegistration('conversation.chat.node')).toBe(false)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(fixture.hasRegistration('conversation.chat.assistant-actions')).toBe(false)
    expect(fixture.inputSnapshot()).toMatchObject({ draft: 'Keep this visible draft.', phase: 'plain' })
    expect(face.hooks.annotations.getSnapshot().annotations).toHaveLength(1)
    expect(fixture.settingsUser()).toEqual({ enabled: false })

    await fixture.setPluginEnabled(true)

    expect(fixture.hasRegistration('conversation.chat.node')).toBe(true)
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(false)
    expect(fixture.face().hooks.annotations.getSnapshot().annotations).toHaveLength(1)
    await fixture.dispose()
  })

  it.for(['', 'Keep this composer text.'])(
    'arms explicit paperclip selection with automatic attachment disabled and draft %j',
    async (draft, { onTestFinished }) => {
      const command = vi.fn().mockResolvedValue(remoteSuccess())
      const fixture = fixtureContext(command)
      onTestFinished(() => fixture.dispose())
      apply(fixture.ctx)
      await fixture.setAutoAttach(false)
      const face = fixture.face()
      saveAnnotation(face)
      const id = face.hooks.annotations.getSnapshot().annotations[0]!.annotationId
      face.toggleSelected(id)
      fixture.setPlainComposerText(draft)
      expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null, draft })

      face.toggleSelected(id)
      expect(fixture.inputSnapshot()).toMatchObject({
        phase: 'claimed',
        claim: { token: COMPOSER_ATTACHMENT_TOKEN },
      })
      face.toggleSelected(id)
      expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null, draft })
      face.repairComposerAttachment()
      expect(fixture.inputSnapshot().phase).toBe('plain')
      face.toggleSelected(id)
      await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
      const payload = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload
      expect(payload.overallRequirement).toBe(draft || undefined)
      expect(payload.annotations.map((item) => item.annotationId)).toEqual([id])
      expect(command).toHaveBeenCalledOnce()
    },
  )

  it('projects the auto-attach switch and keeps attach-only arming idempotent', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.autoAttachEnabled()).toBe(true)
    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().draft.startsWith(COMPOSER_ATTACHMENT_TOKEN)).toBe(true)
    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().draft.startsWith(COMPOSER_ATTACHMENT_TOKEN)).toBe(true)

    await fixture.setAutoAttach(false)

    expect(face.autoAttachEnabled()).toBe(false)
    expect(fixture.settingsUser()).toEqual({ autoAttach: false })
    await fixture.dispose()
  })

  it('saves compact layout settings without changing attached drafts', async ({ onTestFinished }) => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    onTestFinished(() => fixture.dispose())
    apply(fixture.ctx)
    const face = fixture.face()
    const settings = fixture.settingsFace()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Keep the attached draft.')
    const annotations = face.hooks.annotations.getSnapshot()
    const input = fixture.inputSnapshot()

    expect(face.hooks.compactSummary.getSnapshot()).toBe(true)
    settings.setCompactSummary(false)
    expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({ compactSummary: false, dirty: true })
    expect(face.hooks.compactSummary.getSnapshot()).toBe(true)
    settings.discard()
    expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({ compactSummary: true, dirty: false })

    settings.setCompactSummary(false)
    settings.save()
    await vi.waitFor(() => {
      expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
    })
    expect(face.hooks.compactSummary.getSnapshot()).toBe(false)
    expect(fixture.face().hooks.compactSummary).toBe(face.hooks.compactSummary)
    expect(fixture.settingsUser()).toEqual({ compactSummary: false })

    settings.resetCompactSummary()
    expect(face.hooks.compactSummary.getSnapshot()).toBe(false)
    settings.save()
    await vi.waitFor(() => {
      expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
    })
    expect(face.hooks.compactSummary.getSnapshot()).toBe(true)
    expect(fixture.settingsUser()).toEqual({})
    expect(face.hooks.annotations.getSnapshot()).toEqual(annotations)
    expect(fixture.inputSnapshot()).toEqual(input)
    expect(command).not.toHaveBeenCalled()
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
    expect(face.ensureComposerAttachment()).toBe(true)
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

    expect(fixture.hasRegistration('settings.section')).toBe(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(() => fixture.face()).toThrow('dock was not registered')

    await fixture.setPluginEnabled(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(true)
    await fixture.dispose()
  })

  it('migrates the legacy disabled preference before mounting conversation integrations', async () => {
    localStorage.setItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY, 'false')
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.hasRegistration('settings.section')).toBe(true)
    expect(fixture.hasRegistration('conversation.input.dock')).toBe(false)
    expect(fixture.settingsUser()).toEqual({ enabled: false })
    expect(localStorage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBeNull()
    await fixture.dispose()
  })

  it('submits official composer text and retries the same immutable batch after transport failure', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Rewrite the proposal.')
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'offline' })
    const failed = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })
    expect(failed.payload.overallRequirement).toBe('Rewrite the proposal.')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })

    command.mockResolvedValueOnce(remoteSuccess())
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    const retried = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    expect(retried.payload).toBe(failed.payload)
    expect(retried.payload.submissionId).toBe(failed.payload.submissionId)
    expect(retried.payload.delivery).toBe('queue')
    expect(retried).toMatchObject({ status: 'accepted', attempts: 2 })
    expect(command.mock.calls[1]?.[1]).toBe(command.mock.calls[0]?.[1])
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain' })
    await fixture.dispose()
  })

  it('serializes complete reference display ranges without leaking their labels', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerReferences('Compare @current-session with @docs/guide.md.', [
      { display: '@current-session', source: 'session', ref: 'session-current' },
      { display: '@docs/guide.md', source: 'file', ref: 'file-guide' },
    ])

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(
      expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.overallRequirement,
    ).toBe('Compare <reference>session-current</reference> with <reference>file-guide</reference>.')
    await fixture.dispose()
  })

  it('allows an attachment-only official composer submission', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().draft).toBe(`${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}`)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(
      expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.overallRequirement,
    ).toBeUndefined()
    expect(command).toHaveBeenCalledOnce()
    await fixture.dispose()
  })

  it('addresses the target Session through the root command Remote', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.ensureComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(command.mock.calls[0]?.[0]).toBe('session-test')
    expect(String(command.mock.calls[0]?.[1])).toContain('annotation_submit')
    expect(command.mock.calls[0]?.[2]).toEqual([])
    await fixture.dispose()
  })

  it('keeps the root command Remote optional and falls back for image-free submissions', async () => {
    expect(inject).not.toContain('remote')
    expect(inject).not.toContain('remote.commands')
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const fixture = fixtureContext(command)
    fixture.disableRemoteCommands()
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.ensureComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(command).toHaveBeenCalledOnce()
    expect(String(command.mock.calls[0]?.[0])).toContain('annotation_submit')
    expect(command.mock.calls[0]).toHaveLength(1)
    await fixture.dispose()
  })

  it.each([imageAttachment(), fileAttachment()])(
    'rejects $type attachments when only the text-only Session command fallback is available',
    async (attachment) => {
      const command = vi.fn()
      const fixture = fixtureContext(command)
      fixture.disableRemoteCommands()
      apply(fixture.ctx)
      const face = fixture.face()
      saveAnnotation(face)

      expect(face.ensureComposerAttachment()).toBe(true)
      await expect(fixture.submitComposer([attachment])).resolves.toEqual({
        kind: 'error',
        text: 'attachments are unavailable',
      })
      expect(command).not.toHaveBeenCalled()
      await fixture.dispose()
    },
  )

  it('freezes the live draft set only when the official composer submits', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face, 0, 'first', 'First note.')
    expect(face.ensureComposerAttachment()).toBe(true)
    saveAnnotation(face, 8, 'second', 'Second note.')

    await fixture.submitComposer()
    expect(
      expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.annotations,
    ).toHaveLength(2)
    expect(
      expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.annotations.map(
        (item) => item.annotation,
      ),
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
            annotation: 'Legacy note.',
            createdAt: 1,
            updatedAt: 1,
            status: 'draft',
          },
        ],
        outbox: [],
        overallRequirementDraft: 'Keep the original structure.',
      }),
    )
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    fixture.setPlainComposerText('Rewrite the introduction.')
    apply(fixture.ctx)
    const face = fixture.face()

    expect(
      new AnnotationStorage(localStorage, 'session-test' as SessionIdentity).load().overallRequirementDraft,
    ).toBe('')
    expect(fixture.inputSnapshot().draft).toBe(
      `${COMPOSER_ATTACHMENT_TOKEN}Rewrite the introduction.\n\nKeep the original structure.`,
    )
    expect(face.hooks.annotations.getSnapshot().overallRequirementDraft).toBe('')
    await fixture.submitComposer()
    expect(
      expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.overallRequirement,
    ).toBe('Rewrite the introduction.\n\nKeep the original structure.')
    await fixture.dispose()
  })

  it('declares attachment capability and sends composer text, annotations, and images in one submission', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().claim).toMatchObject({ attachments: true })
    fixture.setComposerText('Rewrite with this screenshot.')
    fixture.setAttachments(['image-1'])
    const image = imageAttachment()

    await expect(fixture.submitComposer([image])).resolves.toEqual({ kind: 'success' })

    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0]?.[0]).toBe('session-test')
    expect(String(command.mock.calls[0]?.[1])).toContain('annotation_submit')
    expect(command.mock.calls[0]?.[2]).toEqual([image])
    const outbox = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    expect(outbox.attachments).toEqual({
      count: 1,
      kinds: ['image'],
      mediaTypes: ['image/png'],
      names: ['shot.png'],
    })
    expect(JSON.stringify(outbox)).not.toContain('aGVsbG8=')
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('queued')
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain' })
    await fixture.dispose()
  })

  it.each(['offline', 'invalid', 'wrong-count'] as const)(
    'keeps the composer and annotations when attachment preflight is %s',
    async (failure) => {
      const command = vi.fn().mockResolvedValue(remoteSuccess())
      const fixture = fixtureContext(command)
      try {
        apply(fixture.ctx)
        saveAnnotation(fixture.face())
        fixture.face().ensureComposerAttachment()
        fixture.setComposerText('Keep this requirement')
        if (failure === 'offline') fixture.prepareAttachments.mockRejectedValueOnce(new Error('offline'))
        else
          fixture.prepareAttachments.mockResolvedValueOnce({
            ok: true,
            value: { result: { kind: 'success', text: failure === 'invalid' ? 'not JSON' : '[]' } },
          })
        expect(await fixture.submitComposer([imageAttachment()])).toEqual({
          kind: 'error',
          text: failure === 'offline' ? 'offline' : 'error.prepareAttachments',
        })
        expect(command).not.toHaveBeenCalled()
        expect(fixture.face().hooks.annotations.getSnapshot()).toMatchObject({
          outbox: [],
          annotations: [expect.objectContaining({ status: 'draft' })],
        })
        expect(fixture.inputSnapshot().draft).toContain('Keep this requirement')
        expect(await fixture.submitComposer([imageAttachment()])).toEqual({ kind: 'success' })
        expect(fixture.prepareAttachments).toHaveBeenCalledTimes(2)
        expect(command).toHaveBeenCalledOnce()
        expect(
          expectOutboxPayload(fixture.face().hooks.annotations.getSnapshot().outbox[0]).payload
            .attachmentIdentities,
        ).toHaveLength(1)
      } finally {
        await fixture.dispose()
      }
    },
  )

  it('does not resend a retry confirmed by the queue during attachment preflight', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    try {
      apply(fixture.ctx)
      saveAnnotation(fixture.face())
      fixture.face().ensureComposerAttachment()
      await fixture.submitComposer([imageAttachment()])
      const original = fixture.face().hooks.annotations.getSnapshot().outbox[0]!
      const prepared = await fixture.prepareAttachments.mock.results[0]!.value
      let finish!: (result: typeof prepared) => void
      fixture.prepareAttachments.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const submitting = fixture.submitComposer([imageAttachment()])
      await vi.waitFor(() => expect(fixture.prepareAttachments).toHaveBeenCalledTimes(2))
      fixture.setInbox(inboxSnapshot([original.messageId]))
      finish(prepared)
      await expect(submitting).resolves.toEqual({ kind: 'success' })
      expect(command).toHaveBeenCalledOnce()
      expect(fixture.face().hooks.annotations.getSnapshot().outbox[0]).toMatchObject({
        payload: original.payload,
        status: 'queued',
        attempts: 1,
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('retains text, images, and annotations when the image batch fails to send', async () => {
    const command = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { result: { kind: 'error', text: 'boom' } } })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Keep everything on failure.')
    const image = imageAttachment()

    await expect(fixture.submitComposer([image])).resolves.toEqual({ kind: 'error', text: 'boom' })

    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ status: 'failed', attempts: 1 })
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })
    await fixture.dispose()
  })

  it('forwards ordered image and file attachments without persisting bytes or upload receipts', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Use this screenshot and document.')
    const attachments = [imageAttachment(), fileAttachment()]

    await expect(fixture.submitComposer(attachments)).resolves.toEqual({ kind: 'success' })

    expect(command.mock.calls[0]?.[2]).toEqual(attachments)
    const outbox = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    expect(outbox.attachments).toEqual({
      count: 2,
      kinds: ['image', 'file'],
      mediaTypes: ['image/png'],
      names: ['shot.png'],
    })
    expect(outbox).not.toHaveProperty('images')
    const persisted = persistedAnnotationValues()
    expect(persisted).not.toContain('aGVsbG8=')
    expect(persisted).not.toContain('receiptId')
    expect(persisted).not.toContain('upload-receipt-1')
    await fixture.dispose()
  })

  it('requires all original attachment kinds after refresh and accepts a newly uploaded file receipt', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const first = fixtureContext(command)
    apply(first.ctx)
    saveAnnotation(first.face())
    expect(first.face().ensureComposerAttachment()).toBe(true)
    await expect(first.submitComposer([imageAttachment(), fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'offline',
    })
    const submissionId = expectOutboxPayload(first.face().hooks.annotations.getSnapshot().outbox[0]).payload
      .submissionId
    await first.dispose()
    const recoveredStorage = new AnnotationStorage(localStorage, 'session-test' as SessionIdentity)
    const recovered = recoveredStorage.load()
    expect(recoveredStorage.lastError()).toBeNull()
    expect(recovered.outbox[0]?.status).toBe('failed')
    expect(recovered.retrySubmissionId).toBe(submissionId)

    const refreshed = fixtureContext(command)
    apply(refreshed.ctx)
    const face = refreshed.face()
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      outbox: [{ status: 'failed' }],
      retrySubmissionId: submissionId,
      storageAvailable: true,
    })
    expect(face.ensureComposerAttachment()).toBe(true)
    for (const attachments of [[], [imageAttachment()], [fileAttachment(), imageAttachment()]]) {
      await expect(refreshed.submitComposer(attachments)).resolves.toEqual({
        kind: 'error',
        text: 'error.attachmentsRequired',
      })
    }
    expect(command).toHaveBeenCalledOnce()
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ attempts: 1, status: 'failed' })
    const frozen = JSON.stringify(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload)
    refreshed.fileContents.set('replacement-file', 'different content')
    for (const replacements of [
      [imageAttachment('renamed.png'), fileAttachment()],
      [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'b3RoZXI=', name: 'shot.png' },
        fileAttachment(),
      ],
      [imageAttachment(), fileAttachment('replacement-file')],
    ]) {
      await expect(refreshed.submitComposer(replacements)).resolves.toEqual({
        kind: 'error',
        text: 'error.retryAttachmentsChanged',
      })
      expect(
        JSON.stringify(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload),
      ).toBe(frozen)
    }
    expect(command).toHaveBeenCalledOnce()
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ attempts: 1, status: 'failed' })

    command.mockResolvedValueOnce(remoteSuccess())
    const replacements = [imageAttachment(), fileAttachment('fresh-upload-receipt')]
    await expect(refreshed.submitComposer(replacements)).resolves.toEqual({ kind: 'success' })
    expect(command.mock.calls[1]?.[2]).toEqual(replacements)
    expect(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.submissionId).toBe(
      submissionId,
    )
    expect(persistedAnnotationValues()).not.toContain('fresh-upload-receipt')
    await refreshed.dispose()
  })

  it('retains the attachment guard for pending image batches written before 0.6.0', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const first = fixtureContext(command)
    apply(first.ctx)
    saveAnnotation(first.face())
    expect(first.face().ensureComposerAttachment()).toBe(true)
    await first.submitComposer([imageAttachment()])
    await first.dispose()
    const key = 'dsh-annotation:v1:session-test'
    const storage = new AnnotationStorage(localStorage, 'session-test' as SessionIdentity)
    const stored = JSON.parse(JSON.stringify(storage.load()))
    storage.clear()
    stored.outbox[0].images = { count: 1, mediaTypes: ['image/png'], names: ['shot.png'] }
    delete stored.outbox[0].attachments
    delete stored.outbox[0].payload.attachmentIdentities
    localStorage.setItem(key, JSON.stringify(stored))

    const refreshed = fixtureContext(command)
    apply(refreshed.ctx)
    expect(refreshed.face().ensureComposerAttachment()).toBe(true)
    await expect(refreshed.submitComposer([fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'error.attachmentsRequired',
    })
    expect(command).toHaveBeenCalledOnce()
    command.mockResolvedValueOnce(remoteSuccess())
    await expect(refreshed.submitComposer([imageAttachment()])).resolves.toEqual({ kind: 'success' })
    expect(refreshed.prepareAttachments).not.toHaveBeenCalled()
    await refreshed.dispose()
  })

  it('rejects new attachments added to an immutable retry that originally had none', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'offline' })
    const submissionId = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload
      .submissionId

    await expect(fixture.submitComposer([fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'error.retryAttachmentsAdded',
    })
    expect(command).toHaveBeenCalledOnce()
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ attempts: 1, status: 'failed' })

    command.mockResolvedValueOnce(remoteSuccess())
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload.submissionId).toBe(
      submissionId,
    )
    await fixture.dispose()
  })

  it('never silently resubmits a recorded image batch without images after a refresh', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('With image.')

    await expect(fixture.submitComposer([imageAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'offline',
    })
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({
      status: 'failed',
      attachments: { count: 1, kinds: ['image'] },
    })

    // The page refresh cleared draft images; retrying without them must refuse.
    fixture.setComposerText('Retry without image.')
    await expect(fixture.submitComposer()).resolves.toEqual({
      kind: 'error',
      text: 'error.attachmentsRequired',
    })
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      notice: { level: 'error', messageKey: 'error.attachmentsRequired' },
      outbox: [{ status: 'failed', attempts: 1 }],
    })

    // Re-selecting the image allows the same submission id to retry.
    command.mockResolvedValueOnce(remoteSuccess())
    await expect(fixture.submitComposer([imageAttachment()])).resolves.toEqual({ kind: 'success' })
    expect(command).toHaveBeenCalledTimes(2)
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
    await fixture.dispose()
  })

  it('discards a pending failed record with its annotations back to draft', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer([imageAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'offline',
    })

    const submissionId = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload
      .submissionId
    face.discardOutbox(submissionId)

    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('withdrawn')
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('draft')
    await fixture.dispose()
  })

  it('releases the claim while a slash command occupies the composer and re-attaches afterwards', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('/goal finish the report')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null })

    face.repairComposerAttachment()

    expect(fixture.inputSnapshot()).toMatchObject({
      draft: '/goal finish the report',
      phase: 'plain',
      claim: null,
    })
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('draft')

    // Still inside command state: no re-attach.
    face.repairComposerAttachment()
    expect(fixture.inputSnapshot().draft).toBe('/goal finish the report')

    // Leaving command state restores the attachment.
    fixture.setComposerText('Back to normal text.')
    face.repairComposerAttachment()
    expect(fixture.inputSnapshot()).toMatchObject({
      draft: `${COMPOSER_ATTACHMENT_TOKEN}Back to normal text.`,
      phase: 'claimed',
    })
    await fixture.dispose()
  })

  it('does not arm the composer while it carries an official slash command', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    fixture.setPlainComposerText('/model deepseek-v4-pro')

    expect(face.ensureComposerAttachment()).toBe(false)
    expect(fixture.inputSnapshot().draft).toBe('/model deepseek-v4-pro')
    await fixture.dispose()
  })

  it('routes an Enter race through the official command interface without touching annotations', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    // The captured claim still delegates slash commands if observers have not run.
    fixture.setComposerText('/goal finish the report', false)

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })

    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0]?.[0]).toBe('session-test')
    expect(command.mock.calls[0]?.[1]).toBe('/goal finish the report')
    expect(command.mock.calls[0]?.[2]).toEqual([])
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    expect(face.hooks.annotations.getSnapshot().annotations[0]).toMatchObject({ status: 'draft' })
    await fixture.dispose()
  })

  it('keeps command text, images, and annotations when a raced slash command fails', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('/goal finish the report', false)
    const image = imageAttachment()

    await expect(fixture.submitComposer([image])).resolves.toEqual({
      kind: 'error',
      text: 'command was not matched',
    })

    expect(command).toHaveBeenCalledWith('session-test', '/goal finish the report', [image])
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('draft')
    expect(fixture.inputSnapshot()).toMatchObject({
      phase: 'plain',
      draft: '/goal finish the report',
      claim: null,
    })
    await fixture.dispose()
  })

  it('keeps a manual detach detached until the user re-attaches', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(fixture.inputSnapshot().phase).toBe('claimed')

    // 手动取消附着：claim 与占位符都被移除。
    expect(face.toggleComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain', claim: null })

    // 修复器不得把手动取消的附着重新拉回。
    face.repairComposerAttachment()
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain', claim: null })
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('draft')

    // 手动重新附着仍然可用。
    fixture.setPlainComposerText('type something')
    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot()).toMatchObject({
      draft: `${COMPOSER_ATTACHMENT_TOKEN}type something`,
      phase: 'claimed',
    })
    await fixture.dispose()
  })

  it('releases the armed claim when the last draft annotation is cleared', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().phase).toBe('claimed')

    for (const annotation of face.hooks.annotations.getSnapshot().annotations) {
      if (annotation.status === 'draft') face.deleteDraft(annotation.annotationId)
    }
    expect(face.hooks.annotations.getSnapshot().annotations).toHaveLength(0)

    // 已附着（claimed）状态下清空草稿也要解除附着，普通文本才能正常发送。
    face.repairComposerAttachment()
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain', claim: null })
    await fixture.dispose()
  })

  it('releases a cleared batch before Enter reaches the ordinary composer path', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    for (const annotation of face.hooks.annotations.getSnapshot().annotations) {
      if (annotation.status === 'draft') face.deleteDraft(annotation.annotationId)
    }

    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    expect(fixture.inputNotice).not.toHaveBeenCalled()
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain', claim: null })
    await fixture.dispose()
  })

  it('keeps text and attachments in the ordinary composer when the batch is cleared', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    for (const annotation of face.hooks.annotations.getSnapshot().annotations) {
      if (annotation.status === 'draft') face.deleteDraft(annotation.annotationId)
    }
    fixture.setPlainComposerText('plain message after clearing')
    fixture.setAttachments(['image-draft', 'file-draft'])

    expect(fixture.inputNotice).not.toHaveBeenCalled()
    expect(fixture.inputSnapshot()).toMatchObject({
      draft: 'plain message after clearing',
      attachmentIds: ['image-draft', 'file-draft'],
      phase: 'plain',
      claim: null,
    })
    await fixture.dispose()
  })

  it('sends an empty-content annotation as highlight-only with the DSH locale protocol', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    // 空内容注解：仅标记原文。
    face.beginSelection(capture(0, 'first'))
    face.updateEditorText('   \n  ')
    face.saveEditor()
    expect(face.hooks.annotations.getSnapshot().annotations[0]).toMatchObject({
      annotation: '',
      kind: 'highlight-only',
    })
    expect(face.ensureComposerAttachment()).toBe(true)

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    const outbox = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    expect(outbox.payload.protocolLocale).toBe('zh')
    expect(outbox.payload.annotations[0]).toMatchObject({ kind: 'highlight-only', annotation: '' })
    await fixture.dispose()
  })

  it('reconciles Inbox and Chat history notifications without a Session queue field', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    face.ensureComposerAttachment()
    await fixture.submitComposer()
    const accepted = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])

    fixture.setInbox(inboxSnapshot([accepted.messageId]))
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')
    fixture.setInbox(undefined)

    fixture.setChatSnapshot({
      nodes: new Map([
        [
          'user',
          {
            kind: 'user',
            data: { source: { kind: 'user', annotationSubmission: accepted.payload } },
          },
        ],
      ]),
    })
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      outbox: [{ status: 'sent' }],
      annotations: [{ status: 'sent' }],
    })
    await fixture.dispose()
  })

  it('keeps queued status while Inbox is unavailable and hides withdrawal after steering', async () => {
    const fixture = fixtureContext(vi.fn().mockResolvedValue(remoteSuccess()))
    apply(fixture.ctx)
    const face = fixture.face()
    expect(fixture.session.getSnapshot()).not.toHaveProperty('queue')
    saveAnnotation(face)
    face.ensureComposerAttachment()
    expect(fixture.inputSnapshot().claim).toMatchObject({ name: DEFAULT_CONFIG.commandName })
    await fixture.submitComposer()
    const entry = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    fixture.setInbox(inboxSnapshot([entry.messageId]))
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')

    fixture.setInbox(undefined)
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')
    await face.withdraw(entry.payload.submissionId)
    expect(fixture.session.updateQueue).not.toHaveBeenCalled()

    fixture.setInbox(inboxSnapshot([], [entry.messageId]))
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('queued')
    await face.withdraw(entry.payload.submissionId)
    expect(fixture.session.updateQueue).not.toHaveBeenCalled()

    fixture.setInbox(inboxSnapshot([entry.messageId]))
    fixture.setInbox({
      'next-turn': [],
      'next-step': [
        {
          id: entry.messageId as unknown as MessageId,
          role: 'user',
          content: [{ type: 'text', text: 'Injected context' }],
          source: { kind: 'user' },
        },
      ],
    })
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
    await fixture.dispose()
    expect(fixture.unsubscribeInbox).toHaveBeenCalledOnce()
  })

  it('does not withdraw a row moved to next-step before its projection notification', async () => {
    const fixture = fixtureContext(vi.fn().mockResolvedValue(remoteSuccess()))
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    face.ensureComposerAttachment()
    await fixture.submitComposer()
    const entry = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
    fixture.setInbox(inboxSnapshot([entry.messageId]))
    fixture.setInbox(inboxSnapshot([], [entry.messageId]), false)
    await face.withdraw(entry.payload.submissionId)
    expect(fixture.session.updateQueue).not.toHaveBeenCalled()
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('accepted')
    await fixture.dispose()
  })

  it('converges a stale withdrawal to durable sent history without removing provenance', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    fixture.session.updateQueue.mockResolvedValue({
      ok: false,
      error: { code: 'session/queue-item-not-found', message: 'already claimed', details: {} },
    })
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    face.ensureComposerAttachment()
    await fixture.submitComposer()
    const accepted = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])

    fixture.setInbox(inboxSnapshot([accepted.messageId]))
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')

    fixture.setChatSnapshot(
      {
        nodes: new Map([
          [
            'user',
            {
              kind: 'user',
              data: { source: { kind: 'user', annotationSubmission: accepted.payload } },
            },
          ],
        ]),
      },
      false,
    )
    await face.withdraw(accepted.payload.submissionId)

    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      outbox: [{ status: 'sent' }],
      annotations: [{ status: 'sent', submissionId: accepted.payload.submissionId }],
    })
    await fixture.dispose()
  })

  it('persists a cross-Session withdrawal before the target controller is opened', async () => {
    const entry = seedCrossSessionOutbox()
    const fixture = fixtureContext(vi.fn())
    fixture.setInbox(inboxSnapshot([entry.messageId]), false)
    fixture.session.updateQueue.mockImplementation(async () => {
      fixture.setInbox(inboxSnapshot(), false)
      return { ok: true, value: undefined }
    })
    apply(fixture.ctx)
    const origin = fixture.face()

    await origin.withdraw(entry.payload.submissionId)
    const target = fixture.face('session-other' as SessionId)

    const originSnapshot = origin.hooks.annotations.getSnapshot()
    const targetSnapshot = target.hooks.annotations.getSnapshot()
    expect(originSnapshot).toMatchObject({
      outbox: [{ status: 'withdrawn' }],
      annotations: [{ status: 'draft' }],
    })
    expect(targetSnapshot).toMatchObject({
      outbox: [{ status: 'withdrawn' }],
      annotations: [{ status: 'draft' }],
    })
    expect(originSnapshot.annotations[0]).not.toHaveProperty('submissionId')
    expect(targetSnapshot.annotations[0]).not.toHaveProperty('submissionId')
    await fixture.dispose()
  })

  it('disposes both Session sources when the authoritative list removes that Session', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    const before = face.hooks.annotations.getSnapshot()
    fixture.removeSession()

    expect(fixture.unsubscribeSession).toHaveBeenCalledOnce()
    expect(fixture.unsubscribeChat).toHaveBeenCalledOnce()
    expect(fixture.unsubscribeInbox).toHaveBeenCalledOnce()
    fixture.setInbox(inboxSnapshot(['late']))
    fixture.setSessionSnapshot({ hasMore: false })
    fixture.setChatSnapshot({ nodes: new Map() })
    expect(face.hooks.annotations.getSnapshot()).toBe(before)
    await fixture.dispose()
  })

  it('rejects an oversized item count from the official composer before transport', async () => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    apply(fixture.ctx, { maxAnnotationsPerSubmission: 1 })
    const face = fixture.face()
    saveAnnotation(face, 0, 'first', 'First note.')
    saveAnnotation(face, 8, 'second', 'Second note.')
    face.ensureComposerAttachment()

    const outcome = await fixture.submitComposer()
    expect(outcome.kind).toBe('error')
    expect(command).not.toHaveBeenCalled()
    expect(face.hooks.annotations.getSnapshot()).toMatchObject({
      notice: { level: 'error', messageKey: 'error.items' },
      outbox: [],
    })
    expect(face.hooks.annotations.getSnapshot().annotations.map((item) => item.status)).toEqual([
      'draft',
      'draft',
    ])
    await fixture.dispose()
  })

  it('sends the selected first and third annotations with ordered attachments', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx, { maxAnnotationsPerSubmission: 2 })
    try {
      const face = fixture.face()
      saveAnnotation(face, 0, 'first', 'First opinion')
      saveAnnotation(face, 20, 'second', 'Second opinion')
      saveAnnotation(face, 40, 'third', 'Third opinion')
      const ids = face.hooks.annotations.getSnapshot().annotations.map((item) => item.annotationId)
      face.toggleSelected(ids[1]!)
      fixture.setComposerText('Rewrite the result')
      fixture.setAttachments(['image-draft', 'file-draft'])
      expect(fixture.inputSnapshot()).toMatchObject({
        phase: 'claimed',
        attachmentIds: ['image-draft', 'file-draft'],
      })
      const attachments = [imageAttachment(), fileAttachment()]
      expect(await fixture.submitComposer(attachments)).toEqual({ kind: 'success' })
      const [, line, transported] = command.mock.calls[0]!
      const payload = JSON.parse(
        Buffer.from((line as string).split(' ')[1]!, 'base64url').toString('utf8'),
      ) as { processingMode: string; annotations: Array<{ annotationId: string; ordinal: number }> }
      expect(payload.processingMode).toBe('answer')
      expect(payload.annotations.map((item) => [item.annotationId, item.ordinal])).toEqual([
        [ids[0], 1],
        [ids[2], 2],
      ])
      expect(transported).toEqual(attachments)
      expect(
        face.hooks.annotations
          .getSnapshot()
          .annotations.filter((item) => item.status === 'draft')
          .map((item) => item.annotationId),
      ).toEqual([ids[1]])
      expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null })
    } finally {
      await fixture.dispose()
    }
  })

  it('excludes an unfinished edit immediately and flushes its latest text on pagehide', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    try {
      const settings = fixture.settingsFace()
      settings.setIndividualSelection(true)
      settings.save()
      await vi.waitFor(() => expect(settings.hooks.settingsCard.getSnapshot().saving).toBe(false))
      const face = fixture.face()
      saveAnnotation(face)
      const id = face.hooks.annotations.getSnapshot().annotations[0]!.annotationId
      expect(fixture.inputSnapshot().phase).toBe('claimed')
      face.openAnnotation(id)
      face.updateEditorText('Latest unsaved edit')
      expect(selectedAnnotations(face.hooks.annotations.getSnapshot())).toEqual([])
      expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null })
      window.dispatchEvent(new Event('pagehide'))
      const restored = new AnnotationStorage(localStorage, 'session-test' as SessionIdentity).load()
      expect(restored.editorDraft).toMatchObject({
        kind: 'edit',
        annotationId: id,
        text: 'Latest unsaved edit',
      })
      expect(restored.annotations[0]?.annotation).toBe('Revise this.')
      expect(restored.selectedAnnotationIds).toEqual([id])
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps explicit retries frozen while allowing deselection to restore ordinary messages', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    try {
      const settings = fixture.settingsFace()
      settings.setIndividualSelection(true)
      settings.save()
      await vi.waitFor(() => expect(settings.hooks.settingsCard.getSnapshot().saving).toBe(false))
      const face = fixture.face()
      saveAnnotation(face)
      face.setProcessingMode('rewrite')
      const attachments = [imageAttachment(), fileAttachment()]
      expect(await fixture.submitComposer(attachments)).toEqual({ kind: 'error', text: 'offline' })
      const original = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
      const firstLine = command.mock.calls[0]?.[1]
      face.selectRetry(original.payload.submissionId)
      expect(fixture.inputSnapshot()).toMatchObject({ phase: 'plain', claim: null })
      saveAnnotation(face, 20, 'later', 'Later opinion')
      face.setProcessingMode('modify')
      face.toggleSelected(
        face.hooks.annotations.getSnapshot().annotations.find((item) => item.status === 'draft')!
          .annotationId,
      )
      face.selectRetry(original.payload.submissionId)
      expect((await fixture.submitComposer([imageAttachment()])).kind).toBe('error')
      expect(command).toHaveBeenCalledTimes(1)
      expect(await fixture.submitComposer(attachments)).toEqual({ kind: 'success' })
      expect(command.mock.calls[1]?.[1]).toBe(firstLine)
      expect(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload).toEqual(
        original.payload,
      )
      expect(
        face.hooks.annotations.getSnapshot().annotations.filter((item) => item.status === 'draft'),
      ).toHaveLength(1)
    } finally {
      await fixture.dispose()
    }
  })

  it('locks annotation mutations while reference preparation is pending and keeps the frozen content', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    const gate = deferredReference(fixture)
    let pending: Promise<SubmitOutcome> | undefined
    apply(fixture.ctx)
    try {
      const face = fixture.face()
      saveAnnotation(face)
      const id = face.hooks.annotations.getSnapshot().annotations[0]!.annotationId
      face.openAnnotation(id)
      face.ensureComposerAttachment()
      fixture.setComposerReferences('Use @notes', [{ display: '@notes', source: 'files', ref: 'notes.md' }])
      pending = fixture.submitComposer([imageAttachment(), fileAttachment()])
      await vi.waitFor(() => expect(gate.serialize).toHaveBeenCalledOnce())
      expect(fixture.inputSnapshot().phase).toBe('submitting')
      face.updateEditorText('Blocked modification')
      face.deleteDraft(id)
      face.beginSelection(capture(100, 'later'))
      face.setProcessingMode('modify')
      expect(() => face.saveEditor()).toThrow('error.submitting')
      expect(face.closeEditor(true)).toBe(false)
      expect(face.hooks.annotations.getSnapshot().editor?.text).toBe('Revise this.')
      expect(face.hooks.annotations.getSnapshot().annotations[0]?.annotationId).toBe(id)
      face.suspendEditor()
      gate.release('<reference>notes.md</reference>')
      expect(await pending).toEqual({ kind: 'success' })
      expect(expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0]).payload).toMatchObject({
        processingMode: 'answer',
        annotations: [{ annotationId: id, annotation: 'Revise this.' }],
      })
      expect(command).toHaveBeenCalledOnce()
    } finally {
      gate.release('<reference>notes.md</reference>')
      try {
        await pending
      } finally {
        await fixture.dispose()
      }
    }
  })

  it('retains later external edits and official attachments when a prepared snapshot is no longer current', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    const gate = deferredReference(fixture)
    let pending: Promise<SubmitOutcome> | undefined
    apply(fixture.ctx)
    try {
      const face = fixture.face()
      saveAnnotation(face)
      const id = face.hooks.annotations.getSnapshot().annotations[0]!.annotationId
      face.ensureComposerAttachment()
      fixture.setComposerReferences('Use @notes', [{ display: '@notes', source: 'files', ref: 'notes.md' }])
      fixture.setAttachments(['image-draft', 'file-draft'])
      pending = fixture.submitComposer([imageAttachment(), fileAttachment()])
      await vi.waitFor(() => expect(gate.serialize).toHaveBeenCalledOnce())
      const controller = face.hooks.annotations as AnnotationController
      controller.openAnnotation(id)
      controller.updateEditorText('A later owner update')
      gate.release('<reference>notes.md</reference>')
      expect(await pending).toEqual({ kind: 'error', text: 'error.submissionChanged' })
      controller.flush()
      expect(command).not.toHaveBeenCalled()
      expect(new AnnotationStorage(localStorage, 'session-test' as SessionIdentity).load()).toMatchObject({
        outbox: [],
        editorDraft: { text: 'A later owner update' },
      })
      expect(fixture.inputSnapshot()).toMatchObject({
        draft: 'Use @notes',
        attachmentIds: ['image-draft', 'file-draft'],
        phase: 'plain',
        claim: null,
      })
    } finally {
      gate.release('<reference>notes.md</reference>')
      try {
        await pending
      } finally {
        await fixture.dispose()
      }
    }
  })

  it('keeps queued authority when a failed retry is confirmed during asynchronous reference preparation', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    let gate: ReturnType<typeof deferredReference> | undefined
    let pending: Promise<SubmitOutcome> | undefined
    try {
      const face = fixture.face()
      saveAnnotation(face)
      face.ensureComposerAttachment()
      fixture.setComposerReferences('Use @notes', [{ display: '@notes', source: 'files', ref: 'notes.md' }])
      expect(await fixture.submitComposer()).toEqual({ kind: 'error', text: 'offline' })
      const original = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
      gate = deferredReference(fixture)
      pending = fixture.submitComposer()
      await vi.waitFor(() => expect(gate!.serialize).toHaveBeenCalledOnce())
      face.discardOutbox(original.payload.submissionId)
      expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('failed')
      fixture.setInbox(inboxSnapshot([String(original.messageId)]))
      expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')
      gate.release('<reference>notes.md</reference>')
      expect(await pending).toEqual({ kind: 'success' })
      expect(command).toHaveBeenCalledTimes(1)
      expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ status: 'queued', attempts: 1 })
      expect(face.hooks.annotations.getSnapshot().annotations[0]).toMatchObject({
        status: 'queued',
        submissionId: original.payload.submissionId,
      })
    } finally {
      gate?.release('<reference>notes.md</reference>')
      try {
        await pending
      } finally {
        await fixture.dispose()
      }
    }
  })

  it('rechecks an unnotified Inbox update before discarding a failed record', async () => {
    const command = vi.fn().mockRejectedValue(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    try {
      const face = fixture.face()
      saveAnnotation(face)
      face.ensureComposerAttachment()
      await fixture.submitComposer()
      const original = expectOutboxPayload(face.hooks.annotations.getSnapshot().outbox[0])
      fixture.setInbox(inboxSnapshot([String(original.messageId)]), false)
      expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('failed')
      face.discardOutbox(original.payload.submissionId)
      expect(face.hooks.annotations.getSnapshot().outbox[0]?.status).toBe('queued')
      expect(face.hooks.annotations.getSnapshot().annotations[0]).toMatchObject({
        status: 'queued',
        submissionId: original.payload.submissionId,
      })
      expect(fixture.session.updateQueue).not.toHaveBeenCalled()
    } finally {
      await fixture.dispose()
    }
  })

  it('registers hidden command rows for the new command and both legacy aliases', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    expect(fixture.hasRegistrationKey('conversation.chat.commandview', 'annotation_submit')).toBe(true)
    expect(fixture.hasRegistrationKey('conversation.chat.commandview', 'inline_comments_submit')).toBe(true)
    expect(fixture.hasRegistrationKey('conversation.chat.commandview', 'inline_annotations_submit')).toBe(
      true,
    )
    await fixture.dispose()
  })
})
