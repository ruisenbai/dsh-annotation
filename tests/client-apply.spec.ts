// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'
import { AnnotationController, type AnnotationReconciliationSnapshot } from '../src/client/controller.ts'
import type { AnnotationInjected } from '../src/client/contract.ts'
import type { AnnotationSettingsInjected } from '../src/client/feature-toggle.ts'
import type { TranscriptVisibilityInjected } from '../src/client/transcript-renderer.tsx'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  DEFAULT_TRANSCRIPT_VISIBILITY,
  LEGACY_ANNOTATION_ENABLED_STORAGE_KEY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

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
  type TranscriptRootSources = {
    hooks: TranscriptVisibilityInjected['hooks']
    props: Pick<TranscriptVisibilityInjected, 'annotationTranscriptT'>
  }
  const rootSources: TranscriptRootSources[] = []
  const settingsFields = new Set(['enabled', 'autoAttach', 'compactSummary', ...TRANSCRIPT_VISIBILITY_KEYS])
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
  const ctx = {
    get(name: string) {
      if (name === 'remote.commands' && remoteCommandsAvailable) return { execute: command }
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
        serializeReference: async (_source: string, ref: string) => `<reference>${ref}</reference>`,
      }),
    },
    settingsScope: {
      bind: () => settingsScope,
    },
    slots: {
      provideRoot(sources: TranscriptRootSources) {
        rootSources.push(sources)
        return () => {
          const index = rootSources.indexOf(sources)
          if (index >= 0) rootSources.splice(index, 1)
        }
      },
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
    rootSourceCount: () => rootSources.length,
    transcriptFace(): TranscriptVisibilityInjected {
      const source = rootSources.at(-1)
      if (source === undefined) throw new Error('transcript root sources were not registered')
      return { hooks: source.hooks, ...source.props }
    },
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
    setAttachments(ids: string[]) {
      publishInput({ ...inputState, attachmentIds: ids })
    },
    async submitComposer(images: readonly SubmitAttachment[] = []): Promise<SubmitOutcome> {
      if (claim === null) throw new Error('composer is not claimed')
      const current = claim
      const args = inputState.draft.startsWith(COMPOSER_ATTACHMENT_TOKEN)
        ? inputState.draft.slice(COMPOSER_ATTACHMENT_TOKEN.length)
        : inputState.draft
      publishInput({ ...inputState, phase: 'submitting' })
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

beforeEach(() => localStorage.clear())

describe('Client plugin composer attachment lifecycle', () => {
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

  it('installs root transcript sources and decorates only supported Chat entries while enabled', async ({
    onTestFinished,
  }) => {
    const fixture = fixtureContext(vi.fn(), false)
    const HostChat = () => null
    const HostTrajectory = () => null
    const HostTool = () => null
    const HostUnknownExtension = () => null
    const viewInject = vi.fn(() => ({ hostView: true }))
    const toolInject = vi.fn(() => ({ hostTool: true }))
    const chat = fixture.addHostEntry({ name: 'conversation.view', id: 'chat' }, HostChat, viewInject)
    const trajectory = fixture.addHostEntry({ name: 'conversation.view', id: 'trajectory' }, HostTrajectory)
    const tool = fixture.addHostEntry(
      { name: 'conversation.chat.node', key: 'tool-call' },
      HostTool,
      toolInject,
    )
    const extension = fixture.addHostEntry(
      { name: 'conversation.chat.node', key: 'future-extension' },
      HostUnknownExtension,
    )
    onTestFinished(async () => {
      await fixture.dispose()
      expect(fixture.rootSourceCount()).toBe(0)
      expect(chat.component).toBe(HostChat)
      expect(tool.component).toBe(HostTool)
    })
    apply(fixture.ctx)
    expect(fixture.rootSourceCount()).toBe(0)
    expect(chat.component).toBe(HostChat)
    expect(tool.component).toBe(HostTool)

    await fixture.setPluginEnabled(true)
    const first = fixture.transcriptFace()
    expect(fixture.rootSourceCount()).toBe(1)
    expect(first.hooks.annotationTranscriptVisibility.getSnapshot()).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    expect(first.hooks.annotationNormalTranscriptView.getSnapshot()).toBe('normal')
    expect(first.annotationTranscriptT('transcript.summary')).toBe('transcript.summary')
    expect(chat.component).not.toBe(HostChat)
    expect(chat.inject).toBe(viewInject)
    expect(trajectory.component).toBe(HostTrajectory)
    expect(tool.component).not.toBe(HostTool)
    expect(tool.inject).toBe(toolInject)
    expect(extension.component).toBe(HostUnknownExtension)
    expect(viewInject).not.toHaveBeenCalled()
    expect(toolInject).not.toHaveBeenCalled()

    const LateContext = () => null
    const late = fixture.addHostEntry({ name: 'conversation.chat.node', key: 'context' }, LateContext)
    expect(late.component).not.toBe(LateContext)
    await fixture.setPluginEnabled(false)
    expect(fixture.rootSourceCount()).toBe(0)
    expect(chat.component).toBe(HostChat)
    expect(tool.component).toBe(HostTool)
    expect(late.component).toBe(LateContext)
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'user')).toBe(false)

    await fixture.setPluginEnabled(true)
    expect(fixture.rootSourceCount()).toBe(1)
    expect(fixture.transcriptFace().hooks).toBe(first.hooks)
    expect(chat.component).not.toBe(HostChat)
    expect(tool.component).not.toBe(HostTool)
    expect(late.component).not.toBe(LateContext)
  })

  it('publishes saved transcript filters through stable root sources without changing annotation drafts', async ({
    onTestFinished,
  }) => {
    const command = vi.fn()
    const fixture = fixtureContext(command)
    onTestFinished(() => fixture.dispose())
    apply(fixture.ctx)
    const source = fixture.transcriptFace().hooks.annotationTranscriptVisibility
    const face = fixture.face()
    const settings = fixture.settingsFace()
    saveAnnotation(face)
    expect(face.ensureComposerAttachment()).toBe(true)
    fixture.setComposerText('Keep the attached draft.')
    const annotations = face.hooks.annotations.getSnapshot()
    const input = fixture.inputSnapshot()

    settings.setTranscriptVisibility('hideTools', true)
    expect(source.getSnapshot().hideTools).toBe(false)
    expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: { hideTools: true, hideReasoning: false },
      dirty: true,
    })
    settings.discard()
    expect(source.getSnapshot()).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    settings.setTranscriptVisibility('hideTools', true)
    settings.save()
    await vi.waitFor(() => {
      expect(settings.hooks.settingsCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
    })
    expect(source.getSnapshot()).toEqual({ ...DEFAULT_TRANSCRIPT_VISIBILITY, hideTools: true })
    expect(fixture.transcriptFace().hooks.annotationTranscriptVisibility).toBe(source)
    expect(fixture.settingsUser()).toEqual({ hideTools: true })
    expect(fixture.rootSourceCount()).toBe(1)
    expect(face.hooks.annotations.getSnapshot()).toEqual(annotations)
    expect(fixture.inputSnapshot()).toEqual(input)
    expect(command).not.toHaveBeenCalled()
  })

  it('disables conversation integrations without discarding drafts and restores them when enabled', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'assistant-step')).toBe(false)
    expect(fixture.hasRegistrationKey('conversation.chat.node', 'user')).toBe(true)
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
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
    expect(face.toggleComposerAttachment()).toBe(true)
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

    expect(face.toggleComposerAttachment()).toBe(true)
    fixture.setComposerText('Rewrite the proposal.')
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'offline' })
    const failed = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })
    expect(failed.payload.overallRequirement).toBe('Rewrite the proposal.')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })

    command.mockResolvedValueOnce(remoteSuccess())
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    const retried = face.hooks.annotations.getSnapshot().outbox[0]!
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

    expect(face.toggleComposerAttachment()).toBe(true)
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
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.toggleComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().draft).toBe(COMPOSER_ATTACHMENT_TOKEN)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.overallRequirement).toBeUndefined()
    expect(command).toHaveBeenCalledOnce()
    await fixture.dispose()
  })

  it('addresses the target Session through the root command Remote', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)

    expect(face.toggleComposerAttachment()).toBe(true)
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

    expect(face.toggleComposerAttachment()).toBe(true)
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

      expect(face.toggleComposerAttachment()).toBe(true)
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
    expect(face.toggleComposerAttachment()).toBe(true)
    saveAnnotation(face, 8, 'second', 'Second note.')

    await fixture.submitComposer()
    expect(face.hooks.annotations.getSnapshot().outbox[0]?.payload.annotations).toHaveLength(2)
    expect(
      face.hooks.annotations.getSnapshot().outbox[0]?.payload.annotations.map((item) => item.annotation),
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

    expect(localStorage.getItem('dsh-inline-annotations:v1:session-test')).toBeNull()
    expect(localStorage.getItem('dsh-annotation:v1:session-test')).not.toBeNull()
    expect(face.toggleComposerAttachment()).toBe(true)
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

  it('declares attachment capability and sends composer text, annotations, and images in one submission', async () => {
    const command = vi.fn().mockResolvedValue(remoteSuccess())
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
    expect(fixture.inputSnapshot().claim).toMatchObject({ attachments: true })
    fixture.setComposerText('Rewrite with this screenshot.')
    fixture.setAttachments(['image-1'])
    const image = imageAttachment()

    await expect(fixture.submitComposer([image])).resolves.toEqual({ kind: 'success' })

    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0]?.[0]).toBe('session-test')
    expect(String(command.mock.calls[0]?.[1])).toContain('annotation_submit')
    expect(command.mock.calls[0]?.[2]).toEqual([image])
    const outbox = face.hooks.annotations.getSnapshot().outbox[0]!
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

  it('retains text, images, and annotations when the image batch fails to send', async () => {
    const command = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { result: { kind: 'error', text: 'boom' } } })
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
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
    expect(face.toggleComposerAttachment()).toBe(true)
    fixture.setComposerText('Use this screenshot and document.')
    const attachments = [imageAttachment(), fileAttachment()]

    await expect(fixture.submitComposer(attachments)).resolves.toEqual({ kind: 'success' })

    expect(command.mock.calls[0]?.[2]).toEqual(attachments)
    const outbox = face.hooks.annotations.getSnapshot().outbox[0]!
    expect(outbox.attachments).toEqual({
      count: 2,
      kinds: ['image', 'file'],
      mediaTypes: ['image/png'],
      names: ['shot.png'],
    })
    expect(outbox).not.toHaveProperty('images')
    const persisted = localStorage.getItem('dsh-annotation:v1:session-test')!
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
    expect(first.face().toggleComposerAttachment()).toBe(true)
    await expect(first.submitComposer([imageAttachment(), fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'offline',
    })
    const submissionId = first.face().hooks.annotations.getSnapshot().outbox[0]!.payload.submissionId
    await first.dispose()

    const refreshed = fixtureContext(command)
    apply(refreshed.ctx)
    const face = refreshed.face()
    expect(face.toggleComposerAttachment()).toBe(true)
    for (const attachments of [[], [imageAttachment()], [fileAttachment(), imageAttachment()]]) {
      await expect(refreshed.submitComposer(attachments)).resolves.toEqual({
        kind: 'error',
        text: 'error.attachmentsRequired',
      })
    }
    expect(command).toHaveBeenCalledOnce()
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ attempts: 1, status: 'failed' })

    command.mockResolvedValueOnce(remoteSuccess())
    const replacements = [imageAttachment(), fileAttachment('fresh-upload-receipt')]
    await expect(refreshed.submitComposer(replacements)).resolves.toEqual({ kind: 'success' })
    expect(command.mock.calls[1]?.[2]).toEqual(replacements)
    expect(face.hooks.annotations.getSnapshot().outbox[0]!.payload.submissionId).toBe(submissionId)
    expect(localStorage.getItem('dsh-annotation:v1:session-test')).not.toContain('fresh-upload-receipt')
    await refreshed.dispose()
  })

  it('retains the attachment guard for pending image batches written before 0.6.0', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const first = fixtureContext(command)
    apply(first.ctx)
    saveAnnotation(first.face())
    expect(first.face().toggleComposerAttachment()).toBe(true)
    await first.submitComposer([imageAttachment()])
    await first.dispose()
    const key = 'dsh-annotation:v1:session-test'
    const stored = JSON.parse(localStorage.getItem(key)!)
    stored.outbox[0].images = { count: 1, mediaTypes: ['image/png'], names: ['shot.png'] }
    delete stored.outbox[0].attachments
    localStorage.setItem(key, JSON.stringify(stored))

    const refreshed = fixtureContext(command)
    apply(refreshed.ctx)
    expect(refreshed.face().toggleComposerAttachment()).toBe(true)
    await expect(refreshed.submitComposer([fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'error.attachmentsRequired',
    })
    expect(command).toHaveBeenCalledOnce()
    command.mockResolvedValueOnce(remoteSuccess())
    await expect(refreshed.submitComposer([imageAttachment()])).resolves.toEqual({ kind: 'success' })
    await refreshed.dispose()
  })

  it('rejects new attachments added to an immutable retry that originally had none', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'error', text: 'offline' })
    const submissionId = face.hooks.annotations.getSnapshot().outbox[0]!.payload.submissionId

    await expect(fixture.submitComposer([fileAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'error.retryAttachmentsAdded',
    })
    expect(command).toHaveBeenCalledOnce()
    expect(face.hooks.annotations.getSnapshot().outbox[0]).toMatchObject({ attempts: 1, status: 'failed' })

    command.mockResolvedValueOnce(remoteSuccess())
    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    expect(face.hooks.annotations.getSnapshot().outbox[0]!.payload.submissionId).toBe(submissionId)
    await fixture.dispose()
  })

  it('never silently resubmits a recorded image batch without images after a refresh', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline'))
    const fixture = fixtureContext(command)
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
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
      notice: { level: 'error', text: 'error.attachmentsRequired' },
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
    expect(face.toggleComposerAttachment()).toBe(true)
    await expect(fixture.submitComposer([imageAttachment()])).resolves.toEqual({
      kind: 'error',
      text: 'offline',
    })

    const submissionId = face.hooks.annotations.getSnapshot().outbox[0]!.payload.submissionId
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
    expect(face.toggleComposerAttachment()).toBe(true)
    fixture.setComposerText('/goal finish the report')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })

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
    expect(face.toggleComposerAttachment()).toBe(true)
    // Enter lands before the command-release watcher runs: the claim is still armed.
    fixture.setComposerText('/goal finish the report')

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
    expect(face.toggleComposerAttachment()).toBe(true)
    fixture.setComposerText('/goal finish the report')
    const image = imageAttachment()

    await expect(fixture.submitComposer([image])).resolves.toEqual({
      kind: 'error',
      text: 'command was not matched',
    })

    expect(command).toHaveBeenCalledWith('session-test', '/goal finish the report', [image])
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    expect(face.hooks.annotations.getSnapshot().annotations[0]?.status).toBe('draft')
    expect(fixture.inputSnapshot()).toMatchObject({ phase: 'claimed' })
    await fixture.dispose()
  })

  it('keeps a manual detach detached until the user re-attaches', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
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
    expect(face.toggleComposerAttachment()).toBe(true)
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
    expect(face.toggleComposerAttachment()).toBe(true)
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

  it('routes a cleared-batch Enter through the claim release instead of a raw error', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
    for (const annotation of face.hooks.annotations.getSnapshot().annotations) {
      if (annotation.status === 'draft') face.deleteDraft(annotation.annotationId)
    }

    const outcome = await fixture.submitComposer()
    expect(outcome).toEqual({ kind: 'error', text: 'error.emptySubmit' })
    expect(face.hooks.annotations.getSnapshot().outbox).toHaveLength(0)
    // 结算后 claim 自动释放，下一次 Enter 走官方普通消息通道。
    expect(fixture.inputSnapshot()).toMatchObject({ draft: '', phase: 'plain', claim: null })
    await fixture.dispose()
  })

  it('keeps the typed text when a cleared-batch Enter releases the claim', async () => {
    const fixture = fixtureContext(vi.fn())
    apply(fixture.ctx)
    const face = fixture.face()
    saveAnnotation(face)
    expect(face.toggleComposerAttachment()).toBe(true)
    for (const annotation of face.hooks.annotations.getSnapshot().annotations) {
      if (annotation.status === 'draft') face.deleteDraft(annotation.annotationId)
    }
    fixture.setComposerText('plain message after clearing')

    const outcome = await fixture.submitComposer()
    expect(outcome).toEqual({ kind: 'error', text: 'error.emptySubmit' })
    expect(fixture.inputSnapshot()).toMatchObject({
      draft: 'plain message after clearing',
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
    expect(face.toggleComposerAttachment()).toBe(true)

    await expect(fixture.submitComposer()).resolves.toEqual({ kind: 'success' })
    const outbox = face.hooks.annotations.getSnapshot().outbox[0]!
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
    face.toggleComposerAttachment()
    await fixture.submitComposer()
    const accepted = face.hooks.annotations.getSnapshot().outbox[0]!

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
    face.toggleComposerAttachment()
    expect(fixture.inputSnapshot().claim).toMatchObject({ name: DEFAULT_CONFIG.commandName })
    await fixture.submitComposer()
    const entry = face.hooks.annotations.getSnapshot().outbox[0]!
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
          source: { kind: 'plugin', plugin: 'test', form: 'notice', summary: 'Context' },
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
    face.toggleComposerAttachment()
    await fixture.submitComposer()
    const entry = face.hooks.annotations.getSnapshot().outbox[0]!
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
    face.toggleComposerAttachment()
    await fixture.submitComposer()
    const accepted = face.hooks.annotations.getSnapshot().outbox[0]!

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
    face.toggleComposerAttachment()

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
