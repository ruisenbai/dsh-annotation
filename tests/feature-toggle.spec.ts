import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
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

import { InlineCommentsSettingsController } from '../src/client/feature-toggle.ts'
import {
  LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY,
  type InlineCommentsSettings,
} from '../src/shared/settings.ts'

function settingsScope(initial?: boolean, writable = true) {
  const listeners = new Set<() => void>()
  let user: { enabled?: boolean } = initial === undefined ? {} : { enabled: initial }
  let revision = 0
  let writeMode: 'accept' | 'retain' | 'throw' = 'accept'
  let deferred = false
  let releaseWrite: (() => void) | undefined
  const snapshot = (): SettingsScopeSnapshot<InlineCommentsSettings> => ({
    status: 'ready',
    value: { enabled: user.enabled ?? true },
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
  const scope: SettingsScope<InlineCommentsSettings> = {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set(field, value) {
      await waitForRelease()
      if (writeMode === 'throw') throw new Error('settings transport failed')
      if (writeMode === 'accept' && field === 'enabled' && typeof value === 'boolean') {
        user = { enabled: value }
      }
      publish()
    },
    async unset(field) {
      await waitForRelease()
      if (writeMode === 'throw') throw new Error('settings transport failed')
      if (writeMode === 'accept' && field === 'enabled') user = {}
      publish()
    },
  }
  return {
    scope,
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
    values.set(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY, String(initial))
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
    const controller = new InlineCommentsSettingsController(fixture.scope)
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

  it('keeps a rejected draft for correction and allows discard', async () => {
    const fixture = settingsScope()
    fixture.rejectWrites()
    const controller = new InlineCommentsSettingsController(fixture.scope)
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
    const controller = new InlineCommentsSettingsController(fixture.scope)
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
    const controller = new InlineCommentsSettingsController(fixture.scope, storage)

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
    expect(storage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBe('false')

    fixture.releaseWrite()
    await settle()

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({ enabled: false })
    expect(storage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBeNull()
    await controller.dispose()
  })

  it('keeps the legacy preference when the Host does not retain its migration', async () => {
    const fixture = settingsScope()
    fixture.rejectWrites()
    const storage = legacyStorage(false)
    const controller = new InlineCommentsSettingsController(fixture.scope, storage)
    await settle()

    expect(controller.feature().getSnapshot()).toBe(false)
    expect(fixture.user()).toEqual({})
    expect(storage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBe('false')
    await controller.dispose()
  })

  it('waits for an in-flight migration without publishing after disposal', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const storage = legacyStorage(false)
    const controller = new InlineCommentsSettingsController(fixture.scope, storage)
    const changed = vi.fn()
    controller.feature().subscribe(changed)

    const disposal = controller.dispose()
    expect(fixture.listenerCount()).toBe(0)
    fixture.releaseWrite()
    await disposal

    expect(changed).not.toHaveBeenCalled()
    expect(fixture.user()).toEqual({ enabled: false })
    expect(storage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBe('false')
  })

  it('lets an existing Host value supersede and remove a stale browser preference', async () => {
    const fixture = settingsScope(true)
    const storage = legacyStorage(false)
    const controller = new InlineCommentsSettingsController(fixture.scope, storage)

    expect(controller.feature().getSnapshot()).toBe(true)
    expect(storage.getItem(LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY)).toBeNull()
    await controller.dispose()
  })

  it('stops publication before awaiting an in-flight save during disposal', async () => {
    const fixture = settingsScope()
    fixture.deferWrites()
    const controller = new InlineCommentsSettingsController(fixture.scope)
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
    const controller = new InlineCommentsSettingsController(unavailable)

    expect(controller.feature().getSnapshot()).toBe(true)
    expect(controller.inject().hooks.settingsCard.getSnapshot()).toMatchObject({
      available: false,
      writable: false,
    })
    await controller.dispose()
  })
})
