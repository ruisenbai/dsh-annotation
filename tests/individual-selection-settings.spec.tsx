import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

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
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  type AnnotationSettings,
} from '../src/shared/settings.ts'

type ScopeMode = 'accept' | 'retain' | 'throw'

function settingsForm({
  ready = true,
  writable = true,
  hasIndividualSelection = true,
  individualSelection = DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
}: {
  readonly ready?: boolean
  readonly writable?: boolean
  readonly hasIndividualSelection?: boolean
  readonly individualSelection?: boolean
} = {}) {
  const listeners = new Set<() => void>()
  let isReady = ready
  let hasSavedIndividualSelection = hasIndividualSelection
  let resolvedIndividualSelection = individualSelection
  let user: Partial<AnnotationSettings> = {}
  let revision = 0
  let mode: ScopeMode = 'accept'
  let deferred = false
  let releaseWrite: (() => void) | undefined

  const publish = () => {
    revision += 1
    for (const listener of listeners) listener()
  }
  const waitForRelease = async () => {
    if (!deferred) return
    await new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
  }
  const snapshot = (): ConfigFormSnapshot<AnnotationSettings> => {
    if (!isReady) {
      return {
        status: 'unavailable',
        value: undefined,
        base: undefined,
        user,
        revision,
        writable: false,
        mode: 'host',
      }
    }
    const value = {
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
      enabled: true,
      autoAttach: true,
      compactSummary: true,
      ...(hasSavedIndividualSelection
        ? { individualSelection: user.individualSelection ?? resolvedIndividualSelection }
        : {}),
    } as AnnotationSettings
    return {
      status: 'ready',
      value,
      base: undefined,
      user,
      revision,
      writable,
      mode: 'host',
    }
  }
  const scope: ConfigForm<AnnotationSettings> = {
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
      if (mode === 'throw') throw new Error('settings transport failed')
      if (mode === 'accept' && writable && field === 'individualSelection' && typeof value === 'boolean') {
        hasSavedIndividualSelection = true
        user = { ...user, individualSelection: value }
      }
      publish()
      return mode === 'accept' && writable
    },
    async unset(field) {
      await waitForRelease()
      if (mode === 'throw') throw new Error('settings transport failed')
      if (mode === 'accept' && writable && field === 'individualSelection') {
        const next = { ...user }
        delete next.individualSelection
        user = next
      }
      publish()
      return mode === 'accept' && writable
    },
  }

  return {
    scope,
    becomeReady(selection: boolean, fieldPresent = true) {
      isReady = true
      resolvedIndividualSelection = selection
      hasSavedIndividualSelection = fieldPresent
      publish()
      return mode === 'accept' && writable
    },
    deferWrites() {
      deferred = true
    },
    releaseWrite() {
      deferred = false
      releaseWrite?.()
    },
    retainWrites() {
      mode = 'retain'
    },
    throwWrites() {
      mode = 'throw'
    },
    user: () => user,
    listenerCount: () => listeners.size,
  }
}

describe('individual-selection Host setting', () => {
  it('stays nullable until the Host is ready and defaults missing legacy data to false', async ({
    onTestFinished,
  }) => {
    const lateHost = settingsForm({ ready: false })
    const controller = new AnnotationSettingsController(lateHost.scope)
    onTestFinished(() => controller.dispose())
    const mode = controller.individualSelection()
    const changed = vi.fn()
    onTestFinished(mode.subscribe(changed))

    expect(mode.getSnapshot()).toBeNull()
    lateHost.becomeReady(true)
    expect(mode.getSnapshot()).toBe(true)
    expect(changed).toHaveBeenCalledOnce()

    const legacyHost = settingsForm({ hasIndividualSelection: false })
    const legacyController = new AnnotationSettingsController(legacyHost.scope)
    onTestFinished(() => legacyController.dispose())

    expect(legacyController.individualSelection().getSnapshot()).toBe(DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION)
    expect(legacyController.autoAttach().getSnapshot()).toBe(true)
    expect(legacyController.inject().hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: false,
      individualSelectionOverridden: false,
      autoAttach: true,
    })
  })

  it('stages individual selection until save, then resets or discards independently', async ({
    onTestFinished,
  }) => {
    const fixture = settingsForm()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    const mode = controller.individualSelection()

    expect(mode.getSnapshot()).toBe(false)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: false,
      individualSelectionOverridden: false,
      autoAttach: true,
      dirty: false,
    })

    face.setIndividualSelection(true)
    expect(mode.getSnapshot()).toBe(false)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: true,
      individualSelectionOverridden: true,
      dirty: true,
    })
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: false,
      individualSelectionOverridden: false,
      dirty: false,
    })

    face.setIndividualSelection(true)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(mode.getSnapshot()).toBe(true)
    expect(fixture.user()).toEqual({ individualSelection: true })

    face.resetIndividualSelection()
    expect(mode.getSnapshot()).toBe(true)
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: false,
      individualSelectionOverridden: false,
      dirty: true,
    })
    face.discard()
    expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
      individualSelection: true,
      individualSelectionOverridden: true,
      dirty: false,
    })

    face.resetIndividualSelection()
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({ dirty: false, saving: false })
    })
    expect(mode.getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
  })

  it.each(['retain', 'throw'] as const)(
    'keeps an unaccepted individual-selection draft editable after a %s response',
    async (response) => {
      const fixture = settingsForm()
      if (response === 'retain') fixture.retainWrites()
      else fixture.throwWrites()
      const controller = new AnnotationSettingsController(fixture.scope)
      onTestFinished(() => controller.dispose())
      const face = controller.inject()

      face.setIndividualSelection(true)
      face.save()
      await vi.waitFor(() => {
        expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
          individualSelection: true,
          dirty: true,
          saving: false,
          failed: true,
        })
      })
      expect(controller.individualSelection().getSnapshot()).toBe(false)
      expect(fixture.user()).toEqual({})
      face.discard()
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        individualSelection: false,
        dirty: false,
        failed: false,
      })
    },
  )

  it('keeps a read-only Host edit staged without changing the accepted mode', async ({ onTestFinished }) => {
    const fixture = settingsForm({ writable: false })
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(() => controller.dispose())
    const face = controller.inject()

    face.setIndividualSelection(true)
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.settingsCard.getSnapshot()).toMatchObject({
        writable: false,
        individualSelection: true,
        dirty: true,
        saving: false,
        failed: true,
      })
    })
    expect(controller.individualSelection().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
  })

  it('awaits an in-flight write during disposal without publishing a late setting', async ({
    onTestFinished,
  }) => {
    const fixture = settingsForm({ individualSelection: true })
    fixture.deferWrites()
    const controller = new AnnotationSettingsController(fixture.scope)
    onTestFinished(async () => {
      fixture.releaseWrite()
      await controller.dispose()
    })
    const face = controller.inject()
    const mode = controller.individualSelection()
    const changed = vi.fn()
    onTestFinished(mode.subscribe(changed))

    expect(mode.getSnapshot()).toBe(true)
    face.setIndividualSelection(false)
    face.save()
    expect(face.hooks.settingsCard.getSnapshot().saving).toBe(true)
    const disposal = controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal

    expect(fixture.user()).toEqual({ individualSelection: false })
    expect(mode.getSnapshot()).toBe(true)
    expect(changed).not.toHaveBeenCalled()
  })
})
