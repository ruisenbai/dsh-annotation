import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore<T>(initial: T) {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set(next: T) {
        value = next
        for (const listener of listeners) listener()
      },
      update(mutator: (draft: T) => void) {
        mutator(value)
        for (const listener of listeners) listener()
      },
    }
  },
}))

import { AnnotationSettingsController } from '../src/client/feature-toggle.ts'
import {
  DEFAULT_TRANSCRIPT_VISIBILITY,
  LEGACY_ANNOTATION_ENABLED_STORAGE_KEY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'

function settingsScope(
  initial?: boolean,
  writable = true,
  initialAutoAttach?: boolean,
  initialCompactSummary?: boolean,
  retainedUser: Record<string, unknown> = {},
) {
  const listeners = new Set<() => void>()
  let user: Partial<AnnotationSettings> & Record<string, unknown> = {
    ...retainedUser,
    ...(initial === undefined ? {} : { enabled: initial }),
    ...(initialAutoAttach === undefined ? {} : { autoAttach: initialAutoAttach }),
    ...(initialCompactSummary === undefined ? {} : { compactSummary: initialCompactSummary }),
  }
  let revision = 0
  let writeMode: 'accept' | 'retain' | 'throw' = 'accept'
  let deferred = false
  let releaseWrite: (() => void) | undefined
  const snapshot = (): SettingsScopeSnapshot<AnnotationSettings> => ({
    status: 'ready',
    value: {
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      ...user,
      enabled: user.enabled ?? true,
      autoAttach: user.autoAttach ?? true,
      compactSummary: user.compactSummary ?? true,
    },
    base: undefined,
    user,
    revision,
    writable,
    mode: 'host',
  })
  const waitForRelease = async () => {
    if (!deferred) return
    await new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
  }
  const publish = () => {
    revision += 1
    for (const listener of listeners) listener()
  }
  const scope: SettingsScope<AnnotationSettings> = {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async mutate() {
      throw new Error('unexpected settings mutate')
    },
    async set(field, value) {
      await waitForRelease()
      if (writeMode === 'throw') throw new Error('settings transport failed')
      if (writeMode === 'accept' && writable) {
        if (
          (field === 'enabled' ||
            field === 'autoAttach' ||
            field === 'compactSummary' ||
            TRANSCRIPT_VISIBILITY_KEYS.some((key) => key === field)) &&
          typeof value === 'boolean'
        ) {
          user = { ...user, [field]: value }
        }
      }
      publish()
    },
    async unset(field) {
      await waitForRelease()
      if (writeMode === 'throw') throw new Error('settings transport failed')
      if (
        writeMode === 'accept' &&
        writable &&
        (field === 'enabled' ||
          field === 'autoAttach' ||
          field === 'compactSummary' ||
          TRANSCRIPT_VISIBILITY_KEYS.some((key) => key === field))
      ) {
        const next = { ...user }
        delete next[field]
        user = next
      }
      publish()
    },
  }
  return {
    scope,
    notify: publish,
    acceptWrites() {
      writeMode = 'accept'
    },
    rejectWrites() {
      writeMode = 'retain'
    },
    throwWrites() {
      writeMode = 'throw'
    },
    deferWrites() {
      deferred = true
    },
    releaseWrite() {
      deferred = false
      releaseWrite?.()
    },
    user: () => user,
    listenerCount: () => listeners.size,
  }
}

function legacyStorage(initial?: boolean) {
  const values = new Map<string, string>()
  if (initial !== undefined) {
    values.set(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY, String(initial))
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Host-backed feature setting', () => {
  it('stages changes without moving the feature and applies them after save', async () => {
    const fixture = settingsScope(false)
    const controller = new AnnotationSettingsController(fixture.scope)
    const face = controller.inject()

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      enabled: false,
      overridden: true,
      dirty: false,
    })

    face.setEnabled(true)
    expect(controller.feature().getSnapshot()).toBe(false)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ enabled: true, dirty: true })

    face.save()
    await settle()
    expect(controller.feature().getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      enabled: true,
      overridden: true,
      dirty: false,
      failed: false,
    })

    face.resetEnabled()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ overridden: false, dirty: true })
    face.save()
    await settle()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ overridden: false, dirty: false })

    await controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
  })

  it('defaults auto-attach on and applies its staged switch only after save', async () => {
    const fixture = settingsScope()
    const controller = new AnnotationSettingsController(fixture.scope)
    const face = controller.inject()

    expect(controller.autoAttach().getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      autoAttach: true,
      autoAttachOverridden: false,
    })

    face.setAutoAttach(false)
    expect(controller.autoAttach().getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ autoAttach: false, dirty: true })

    face.save()
    await settle()
    expect(controller.autoAttach().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({ autoAttach: false })

    face.resetAutoAttach()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      autoAttach: true,
      autoAttachOverridden: false,
      dirty: true,
    })
    face.save()
    await settle()
    expect(fixture.user()).toEqual({})
    expect(controller.autoAttach().getSnapshot()).toBe(true)

    await controller.dispose()
  })

  it('keeps a rejected draft for correction and allows discard', async () => {
    const fixture = settingsScope()
    fixture.rejectWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    const face = controller.inject()

    face.setEnabled(false)
    face.save()
    await settle()
    expect(controller.feature().getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: true, failed: true })

    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, failed: false })
    face.discard()
    await controller.dispose()
  })

  it('settles a rejected settings promise as a failed editable draft', async () => {
    const fixture = settingsScope()
    fixture.throwWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    const face = controller.inject()

    face.setEnabled(false)
    face.save()
    await settle()

    expect(controller.feature().getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      enabled: false,
      dirty: true,
      saving: false,
      failed: true,
    })
    await controller.dispose()
  })

  it('preserves and migrates the legacy browser preference before enabling integrations', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const storage = legacyStorage(false)
    const controller = new AnnotationSettingsController(fixture.scope, storage)

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
    expect(storage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBe('false')

    fixture.releaseWrite()
    await settle()

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({ enabled: false })
    expect(storage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBeNull()
    await controller.dispose()
  })

  it('keeps the legacy preference when the Host does not retain its migration', async () => {
    const fixture = settingsScope()
    fixture.rejectWrites()
    const storage = legacyStorage(false)
    const controller = new AnnotationSettingsController(fixture.scope, storage)
    await settle()

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
    expect(storage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBe('false')
    await controller.dispose()
  })

  it('waits for an in-flight migration without publishing after disposal', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const storage = legacyStorage(false)
    const controller = new AnnotationSettingsController(fixture.scope, storage)
    const changed = vi.fn()
    controller.feature().subscribe(changed)

    const disposal = controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal

    expect(changed).not.toHaveBeenCalled()
    expect(fixture.user()).toEqual({ enabled: false })
    expect(storage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBe('false')
  })

  it('lets an existing Host value supersede and remove a stale browser preference', async () => {
    const fixture = settingsScope(true)
    const storage = legacyStorage(false)
    const controller = new AnnotationSettingsController(fixture.scope, storage)

    expect(controller.feature().getSnapshot()).toBe(true)
    expect(storage.getItem(LEGACY_ANNOTATION_ENABLED_STORAGE_KEY)).toBeNull()
    await controller.dispose()
  })

  it('stops publication before awaiting an in-flight save during disposal', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    const face = controller.inject()
    const changed = vi.fn()
    face.hooks.settingsCard.subscribe(changed)

    face.setEnabled(false)
    face.save()
    const changesBeforeDispose = changed.mock.calls.length
    const disposal = controller.dispose()

    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal
    face.discard()

    expect(changed).toHaveBeenCalledTimes(changesBeforeDispose)
  })

  it('uses the safe enabled default while the namespace is unavailable', async () => {
    const fixture = settingsScope()
    const unavailable = {
      ...fixture.scope,
      getSnapshot: () => ({
        ...fixture.scope.getSnapshot(),
        status: 'unavailable' as const,
        value: undefined,
        writable: false,
      }),
    }
    const controller = new AnnotationSettingsController(unavailable)

    expect(controller.feature().getSnapshot()).toBe(true)
    expect(controller.inject().hooks.settingsCard.getSnapshot()).toMatchObject({
      available: false,
      writable: false,
      autoAttach: true,
      transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
      transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
    })
    expect(controller.transcriptVisibility().getSnapshot()).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    await controller.dispose()
  })

  it('stages compact summary until save and reset', async ({ onTestFinished }) => {
    const fixture = settingsScope()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const compactSummary = controller.compactSummary()
    const changed = vi.fn()
    onTestFinished(compactSummary.subscribe(changed))

    expect(compactSummary.getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      compactSummary: true,
      compactSummaryOverridden: false,
      dirty: false,
    })
    face.setCompactSummary(false)
    expect(compactSummary.getSnapshot()).toBe(true)
    expect(changed).not.toHaveBeenCalled()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      compactSummary: false,
      compactSummaryOverridden: true,
      dirty: true,
    })
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ compactSummary: true, dirty: false })

    face.setCompactSummary(false)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(compactSummary.getSnapshot()).toBe(false)
    expect(changed).toHaveBeenCalled()
    expect(fixture.user()).toEqual({ compactSummary: false })

    face.resetCompactSummary()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      compactSummary: true,
      compactSummaryOverridden: false,
      dirty: true,
    })
    expect(compactSummary.getSnapshot()).toBe(false)
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      compactSummary: false,
      compactSummaryOverridden: true,
      dirty: false,
    })
    face.resetCompactSummary()
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(compactSummary.getSnapshot()).toBe(true)
    expect(fixture.user()).toEqual({})
    face.resetCompactSummary()
    face.setCompactSummary(true)
    expect(face.hooks.settingsCard.getSnapshot().dirty).toBe(false)
  })

  it.each(['retain', 'throw'] as const)(
    'keeps rejected compact summary edits for correction when the Host response is %s',
    async (mode) => {
      const fixture = settingsScope()
      if (mode === 'retain') fixture.rejectWrites()
      else fixture.throwWrites()
      const controller = new AnnotationSettingsController(fixture.scope)
      onTestFinished(() => controller.dispose())
      const face = controller.inject()

      face.setCompactSummary(false)
      face.save()
      await vi.waitFor(() => {
        expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
          compactSummary: false,
          dirty: true,
          saving: false,
          failed: true,
        })
      })
      expect(controller.compactSummary().getSnapshot()).toBe(true)
      expect(fixture.user()).toEqual({})
      face.discard()
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        compactSummary: true,
        dirty: false,
        failed: false,
      })
    },
  )

  it.each([true, false])('loads a disabled compact summary with writable=%s', (writable) => {
    const fixture = settingsScope(undefined, writable, undefined, false)
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())

    expect(controller.compactSummary().getSnapshot()).toBe(false)
    expect(controller.inject().hooks.settingsCard.getSnapshot()).toMatchObject({
      compactSummary: false,
      compactSummaryOverridden: true,
      writable,
      dirty: false,
    })
  })

  it('settles compact summary saves after disposal without publishing', async ({ onTestFinished }) => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(async () => {
      fixture.releaseWrite()
      await controller.dispose()
    })
    const face = controller.inject()
    const changed = vi.fn()
    onTestFinished(controller.compactSummary().subscribe(changed))

    face.setCompactSummary(false)
    face.save()
    expect(face.hooks.settingsCard.getSnapshot().saving).toBe(true)
    const disposal = controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal
    expect(fixture.user()).toEqual({ compactSummary: false })
    expect(changed).not.toHaveBeenCalled()
    face.setCompactSummary(true)
    face.resetCompactSummary()
    face.discard()
    expect(changed).not.toHaveBeenCalled()
  })

  it('retains an obsolete localTools user key while saving and resetting supported settings', async () => {
    const fixture = settingsScope(false, true, false, false, { localTools: false })
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()

    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      enabled: false,
      autoAttach: false,
      compactSummary: false,
      dirty: false,
    })
    expect(face.hooks.settingsCard.getSnapshot()).not.toHaveProperty('localTools')

    face.setEnabled(true)
    face.setAutoAttach(true)
    face.setCompactSummary(true)
    face.save()
    await vi.waitFor(() => {
      expect(fixture.user()).toEqual({
        enabled: true,
        autoAttach: true,
        compactSummary: true,
        localTools: false,
      })
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, failed: false })
    })

    face.resetEnabled()
    face.resetAutoAttach()
    face.resetCompactSummary()
    face.save()
    await vi.waitFor(() => {
      expect(fixture.user()).toEqual({ localTools: false })
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        enabled: true,
        autoAttach: true,
        compactSummary: true,
        dirty: false,
        failed: false,
      })
    })
    expect(controller.feature().getSnapshot()).toBe(true)
    expect(controller.autoAttach().getSnapshot()).toBe(true)
    expect(controller.compactSummary().getSnapshot()).toBe(true)
  })
})

describe('Host-backed transcript visibility settings', () => {
  it('retains saved snapshot identity across unrelated settings changes', async () => {
    const fixture = settingsScope()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const visibility = controller.transcriptVisibility()
    const initial = visibility.getSnapshot()
    const changed = vi.fn()
    onTestFinished(visibility.subscribe(changed))

    expect(visibility).toBe(controller.transcriptVisibility())
    expect(initial).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
      transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
      dirty: false,
    })
    fixture.notify()
    face.setTranscriptVisibility('hideReasoning', true)
    face.setEnabled(false)
    face.discard()
    await fixture.scope.set('autoAttach', false)
    expect(visibility.getSnapshot()).toBe(initial)
    expect(changed).not.toHaveBeenCalled()

    await fixture.scope.set('hideTools', true)
    const hiddenTools = visibility.getSnapshot()
    expect(hiddenTools).not.toBe(initial)
    expect(hiddenTools).toEqual({ ...DEFAULT_TRANSCRIPT_VISIBILITY, hideTools: true })
    expect(changed).toHaveBeenCalledOnce()
    await fixture.scope.set('hideTools', true)
    await fixture.scope.set('enabled', false)
    fixture.notify()
    expect(visibility.getSnapshot()).toBe(hiddenTools)
    expect(changed).toHaveBeenCalledOnce()
  })

  it.each(TRANSCRIPT_VISIBILITY_KEYS)('stages saves discards and resets %s independently', async (field) => {
    const retained = { enabled: false, autoAttach: false, compactSummary: false, localTools: false }
    const fixture = settingsScope(undefined, true, undefined, undefined, retained)
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const visibility = controller.transcriptVisibility()
    const initial = visibility.getSnapshot()
    const hidden = { ...DEFAULT_TRANSCRIPT_VISIBILITY, [field]: true }

    face.setTranscriptVisibility(field, true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: hidden,
      transcriptVisibilityOverridden: hidden,
      dirty: true,
    })
    expect(visibility.getSnapshot()).toBe(initial)
    expect(fixture.user()).toEqual(retained)
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
      transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
      dirty: false,
    })

    face.setTranscriptVisibility(field, true)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(visibility.getSnapshot()).toEqual(hidden)
    expect(fixture.user()).toEqual({ ...retained, [field]: true })
    expect(controller.feature().getSnapshot()).toBe(false)
    expect(controller.autoAttach().getSnapshot()).toBe(false)
    expect(controller.compactSummary().getSnapshot()).toBe(false)

    face.resetTranscriptVisibility(field)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
      transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
      dirty: true,
    })
    expect(visibility.getSnapshot()).toEqual(hidden)
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: hidden,
      transcriptVisibilityOverridden: hidden,
      dirty: false,
    })
    face.resetTranscriptVisibility(field)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(visibility.getSnapshot()).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    expect(fixture.user()).toEqual(retained)
    face.setTranscriptVisibility(field, true)
    face.setTranscriptVisibility(field, false)
    expect(face.hooks.settingsCard.getSnapshot().dirty).toBe(false)
    face.setTranscriptVisibility(field, true)
    face.resetTranscriptVisibility(field)
    expect(face.hooks.settingsCard.getSnapshot().dirty).toBe(false)
  })

  it('removes an explicit false override without changing the saved snapshot reference', async () => {
    const fixture = settingsScope(undefined, true, undefined, undefined, { hideErrors: false })
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const visibility = controller.transcriptVisibility()
    const initial = visibility.getSnapshot()
    const changed = vi.fn()
    onTestFinished(visibility.subscribe(changed))

    expect(face.hooks.settingsCard.getSnapshot().transcriptVisibilityOverridden.hideErrors).toBe(true)
    face.resetTranscriptVisibility('hideErrors')
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
      transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
      dirty: true,
    })
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(fixture.user()).toEqual({})
    expect(visibility.getSnapshot()).toBe(initial)
    expect(changed).not.toHaveBeenCalled()
  })

  it.each(['retain', 'throw'] as const)('retains drafts after a %s response', async (mode) => {
    const fixture = settingsScope(undefined, true, undefined, undefined, { hideErrors: true })
    if (mode === 'retain') fixture.rejectWrites()
    else fixture.throwWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const visibility = controller.transcriptVisibility()
    const initial = visibility.getSnapshot()

    face.setTranscriptVisibility('hideReasoning', true)
    face.resetTranscriptVisibility('hideErrors')
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        transcriptVisibility: { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideReasoning: true },
        transcriptVisibilityOverridden: { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideReasoning: true },
        dirty: true,
        saving: false,
        failed: true,
      })
    })
    expect(visibility.getSnapshot()).toBe(initial)
    expect(fixture.user()).toEqual({ hideErrors: true })
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      transcriptVisibility: initial,
      transcriptVisibilityOverridden: { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideErrors: true },
      dirty: false,
      failed: false,
    })

    fixture.acceptWrites()
    face.setTranscriptVisibility('hideReasoning', true)
    face.resetTranscriptVisibility('hideErrors')
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        dirty: false,
        saving: false,
        failed: false,
      })
    })
    expect(fixture.user()).toEqual({ hideReasoning: true })
    expect(visibility.getSnapshot()).toEqual({ ...DEFAULT_TRANSCRIPT_VISIBILITY, hideReasoning: true })
  })

  it('keeps only the rejected field staged when a save partially succeeds', async () => {
    const fixture = settingsScope(undefined, true, undefined, undefined, { localTools: false })
    const scope: SettingsScope<AnnotationSettings> = {
      ...fixture.scope,
      async set(field, value) {
        if (field !== 'hideTools') await fixture.scope.set(field, value)
      },
    }
    const controller = new AnnotationSettingsController(scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()

    face.setEnabled(false)
    face.setTranscriptVisibility('hideReasoning', true)
    face.setTranscriptVisibility('hideTools', true)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        dirty: true,
        saving: false,
        failed: true,
      })
    })
    expect(fixture.user()).toEqual({ localTools: false, enabled: false, hideReasoning: true })
    expect(controller.transcriptVisibility().getSnapshot()).toEqual({
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      hideReasoning: true,
    })
    face.setTranscriptVisibility('hideTools', false)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, failed: false })
  })

  it('loads read-only Host filters and keeps an unaccepted edit staged', async () => {
    const allHidden = { ...DEFAULT_TRANSCRIPT_VISIBILITY }
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) allHidden[field] = true
    const fixture = settingsScope(undefined, false, undefined, undefined, allHidden)
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const initial = controller.transcriptVisibility().getSnapshot()

    expect(initial).toEqual(allHidden)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      writable: false,
      transcriptVisibility: allHidden,
      transcriptVisibilityOverridden: allHidden,
    })
    face.setTranscriptVisibility('hideOther', false)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        dirty: true,
        saving: false,
        failed: true,
      })
    })
    expect(fixture.user()).toEqual(allHidden)
    expect(controller.transcriptVisibility().getSnapshot()).toBe(initial)
  })

  it('retains a different field staged while an earlier save is in flight', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(async () => {
      fixture.releaseWrite()
      await controller.dispose()
    })
    const face = controller.inject()

    face.setTranscriptVisibility('hideReasoning', true)
    face.save()
    expect(face.hooks.settingsCard.getSnapshot().saving).toBe(true)
    expect(controller.transcriptVisibility().getSnapshot()).toEqual(DEFAULT_TRANSCRIPT_VISIBILITY)
    face.setTranscriptVisibility('hideTools', true)
    fixture.releaseWrite()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        dirty: true,
        saving: false,
        failed: false,
      })
    })
    expect(fixture.user()).toEqual({ hideReasoning: true })
    expect(controller.transcriptVisibility().getSnapshot()).toEqual({
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      hideReasoning: true,
    })
    expect(face.hooks.settingsCard.getSnapshot().transcriptVisibility.hideTools).toBe(true)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(fixture.user()).toEqual({ hideReasoning: true, hideTools: true })
  })

  it('settles captured visibility writes after disposal without publishing', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(async () => {
      fixture.releaseWrite()
      await controller.dispose()
    })
    const face = controller.inject()
    const visibility = controller.transcriptVisibility()
    const initial = visibility.getSnapshot()
    const changed = vi.fn()
    onTestFinished(visibility.subscribe(changed))

    face.setTranscriptVisibility('hideReasoning', true)
    face.setTranscriptVisibility('hideTools', true)
    face.save()
    const disposal = controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal
    expect(fixture.user()).toEqual({ hideReasoning: true, hideTools: true })
    face.setTranscriptVisibility('hideOther', true)
    face.resetTranscriptVisibility('hideReasoning')
    face.discard()
    expect(visibility.getSnapshot()).toBe(initial)
    expect(changed).not.toHaveBeenCalled()
  })
})
