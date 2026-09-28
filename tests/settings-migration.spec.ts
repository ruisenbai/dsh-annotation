import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { join } from 'node:path'
import { installSettingsMigration, restoreArchivedSettings } from '../src/host/settings-migration.ts'
import { ARCHIVED_PREFERENCES_IMPORTED_FIELD } from '../src/shared/settings.ts'

function fixture(source = 'dsh-annotation:\n  enabled: false\n  hideTools: true\n') {
  const descriptor = {
    ns: 'dsh-annotation',
    value: {} as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    revision: 4,
  }
  const describeSettings = vi.fn(() => [descriptor])
  const read = vi.fn(async () => source)
  const resolve = vi.fn(async (path: string) => ({ path }))
  const mutate = vi.fn(async (_ns: string, ops: readonly SettingsPathOp[], _revision?: number) => {
    for (const op of ops) {
      if (op.op !== 'set') throw new Error('unexpected unset')
      descriptor.user[op.path[0]!] = op.value
      descriptor.value[op.path[0]!] = op.value
    }
    descriptor.revision += 1
  })
  const warn = vi.fn()
  let notify: (() => void) | undefined
  let dispose: (() => Promise<void>) | undefined
  const child = {
    fs: { resolve, readText: read },
    profileContext: { home: '/annotation-preferences-fixture' },
    settings: { describe: describeSettings, mutate },
    logger: { warn },
    on(_name: string, handler: () => void) {
      notify = handler
    },
    effect(install: () => () => Promise<void>) {
      dispose = install()
    },
  }
  const ctx = {
    ...child,
    inject(_services: string[], install: (value: unknown) => void) {
      install(child)
    },
  } as unknown as Context
  return {
    ctx,
    descriptor,
    describeSettings,
    read,
    resolve,
    mutate,
    warn,
    notify: () => notify!(),
    dispose: () => dispose!(),
  }
}

const run = (value: ReturnType<typeof fixture>) =>
  restoreArchivedSettings(value.ctx, new AbortController().signal)

describe('archived annotation settings', () => {
  it('imports only annotation fields, preserves newer user overrides, and records completion atomically', async () => {
    const value = fixture(
      'inline-comments:\n  enabled: true\n  autoAttach: false\ndsh-annotation:\n  enabled: false\n  hideTools: true\n  localTools: false\nother-plugin:\n  token: private-content\n',
    )
    value.descriptor.user.hideTools = false
    await run(value)
    expect(value.resolve).toHaveBeenCalledWith(
      join('/annotation-preferences-fixture', 'settings.yaml.imported'),
      { signal: expect.any(AbortSignal) },
    )
    expect(value.mutate).toHaveBeenCalledOnce()
    expect(value.mutate).toHaveBeenCalledWith(
      'dsh-annotation',
      [
        { op: 'set', path: ['enabled'], value: false },
        { op: 'set', path: ['autoAttach'], value: false },
        { op: 'set', path: [ARCHIVED_PREFERENCES_IMPORTED_FIELD], value: true },
      ],
      4,
    )
    expect(value.descriptor.user.hideTools).toBe(false)
    expect(JSON.stringify(value.mutate.mock.calls)).not.toContain('private-content')
    expect(value.descriptor.user).not.toHaveProperty('localTools')
  })

  it('does not resurrect an archived value after a later reset', async () => {
    const value = fixture()
    await run(value)
    delete value.descriptor.user.enabled
    value.read.mockClear()
    await run(value)
    expect(value.read).not.toHaveBeenCalled()
    expect(value.mutate).toHaveBeenCalledOnce()
    expect(value.descriptor.user).not.toHaveProperty('enabled')
  })

  it('uses the latest overrides if a user saves while the archive is read', async () => {
    const value = fixture()
    value.read.mockImplementationOnce(async () => {
      value.descriptor.user.enabled = true
      value.descriptor.revision = 9
      return 'dsh-annotation:\n  enabled: false\n'
    })
    await run(value)
    expect(value.mutate).toHaveBeenCalledWith(
      'dsh-annotation',
      [{ op: 'set', path: [ARCHIVED_PREFERENCES_IMPORTED_FIELD], value: true }],
      9,
    )
    expect(value.descriptor.user.enabled).toBe(true)
  })

  it.each(['null', '[]', 'dsh-annotation: []', 'dsh-annotation:\n  enabled: "false"'])(
    'refuses malformed owned preferences without a write: %s',
    async (source) => {
      const value = fixture(source)
      await expect(run(value)).rejects.toThrow()
      expect(value.mutate).not.toHaveBeenCalled()
    },
  )

  it('leaves an archive without this plugin untouched', async () => {
    const value = fixture('other-plugin:\n  enabled: false\n')
    await run(value)
    expect(value.mutate).not.toHaveBeenCalled()
  })

  it('treats a missing archive as a fresh installation', async () => {
    const value = fixture()
    value.read.mockRejectedValueOnce(new FsError('missing', 'FS_NOT_FOUND'))
    await run(value)
    expect(value.mutate).not.toHaveBeenCalled()
  })

  it('preserves retry eligibility when the Host refuses a stale revision', async () => {
    const value = fixture()
    value.mutate.mockRejectedValueOnce(new Error('settings revision changed'))
    await expect(run(value)).rejects.toThrow('settings revision changed')
    expect(value.descriptor.user).not.toHaveProperty(ARCHIVED_PREFERENCES_IMPORTED_FIELD)
  })

  it('reports a failure without logging archived values', async () => {
    const value = fixture('dsh-annotation:\n  enabled: private-content\n')
    installSettingsMigration(value.ctx)
    await vi.waitFor(() => expect(value.warn).toHaveBeenCalledOnce())
    await value.dispose()
    expect(JSON.stringify(value.warn.mock.calls)).not.toContain('private-content')
  })

  it('waits for a configuration form and imports when the Host announces it', async () => {
    const value = fixture()
    value.describeSettings.mockReturnValueOnce([])
    installSettingsMigration(value.ctx)
    try {
      await vi.waitFor(() => expect(value.describeSettings).toHaveBeenCalledOnce())
      expect(value.read).not.toHaveBeenCalled()
      value.notify()
      await vi.waitFor(() => expect(value.mutate).toHaveBeenCalledOnce())
      expect(value.descriptor.user[ARCHIVED_PREFERENCES_IMPORTED_FIELD]).toBe(true)
    } finally {
      await value.dispose()
    }
    expect(value.warn).not.toHaveBeenCalled()
  })

  it('coalesces Host updates during an archive read without importing twice', async () => {
    const value = fixture()
    let entered!: () => void
    let release!: (source: string) => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pending = new Promise<string>((resolve) => {
      release = resolve
    })
    value.read.mockImplementationOnce(() => {
      entered()
      return pending
    })
    installSettingsMigration(value.ctx)
    try {
      await started
      value.notify()
      value.notify()
      expect(value.read).toHaveBeenCalledOnce()
      expect(value.mutate).not.toHaveBeenCalled()
      release('dsh-annotation:\n  enabled: false\n')
      await vi.waitFor(() => expect(value.describeSettings).toHaveBeenCalledTimes(3))
      expect(value.mutate).toHaveBeenCalledOnce()
      expect(value.read).toHaveBeenCalledOnce()
      expect(value.warn).not.toHaveBeenCalled()
    } finally {
      release('dsh-annotation:\n  enabled: false\n')
      await value.dispose()
    }
  })

  it('does not write if the configuration form disappears during the read', async () => {
    const value = fixture()
    value.describeSettings.mockReturnValueOnce([value.descriptor]).mockReturnValueOnce([])
    await expect(run(value)).rejects.toThrow('Annotation configuration form is unavailable')
    expect(value.mutate).not.toHaveBeenCalled()
  })

  it('aborts before starting when disposed', async () => {
    const value = fixture()
    const abort = new AbortController()
    abort.abort()
    await expect(restoreArchivedSettings(value.ctx, abort.signal)).rejects.toThrow()
    expect(value.read).not.toHaveBeenCalled()
    expect(value.mutate).not.toHaveBeenCalled()
  })

  it('joins a pending read and prevents a late settings mutation during disposal', async () => {
    const value = fixture()
    let entered!: () => void
    let release!: (source: string) => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pending = new Promise<string>((resolve) => {
      release = resolve
    })
    value.read.mockImplementationOnce(() => {
      entered()
      return pending
    })
    installSettingsMigration(value.ctx)
    await started
    let disposed = false
    const closing = value.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release('dsh-annotation:\n  enabled: false\n')
    await closing
    expect(disposed).toBe(true)
    expect(value.mutate).not.toHaveBeenCalled()
    expect(value.warn).not.toHaveBeenCalled()
  })
})
