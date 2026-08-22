import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG, LEGACY_COMMAND_NAMES, resolveConfig } from '../src/shared/config.ts'

describe('configuration', () => {
  it('resolves all defaults explicitly', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  it('uses the dsh-annotation command identity by default', () => {
    expect(DEFAULT_CONFIG.commandName).toBe('annotation_submit')
    expect(LEGACY_COMMAND_NAMES).toEqual(['inline_comments_submit', 'inline_annotations_submit'])
  })

  it('accepts deployment overrides', () => {
    expect(resolveConfig({ commandName: 'review_submit', locateHistoryPages: 3 })).toMatchObject({
      commandName: 'review_submit',
      locateHistoryPages: 3,
    })
  })

  it.each([
    [{ commandName: 'Bad Name' }, 'commandName'],
    [{ maxPayloadBytes: 0 }, 'maxPayloadBytes'],
    [{ maxAnnotationsPerSubmission: 1.5 }, 'maxAnnotationsPerSubmission'],
  ])('rejects invalid config %#', (value, message) => {
    expect(() => resolveConfig(value)).toThrow(message)
  })

  it('registers the user-owned settings namespace when the Host provides settings', () => {
    const registerSettings = vi.fn()
    const registerCommand = vi.fn(() => () => undefined)
    const ctx = {
      commands: { register: registerCommand },
      effect(install: () => unknown) {
        install()
      },
      inject(_services: string[], install: (settingsCtx: unknown) => void) {
        install({
          settings: {
            register: registerSettings,
            describe: () => [],
            update: vi.fn().mockResolvedValue(undefined),
            replace: vi.fn().mockResolvedValue(undefined),
          },
        })
      },
    } as unknown as Context

    apply(ctx, DEFAULT_CONFIG)

    expect(registerCommand).toHaveBeenCalledTimes(3)
    expect(
      (registerCommand.mock.calls as unknown[][]).map(
        (call) => (call[0] as { name?: string } | undefined)?.name,
      ),
    ).toEqual(['annotation_submit', 'inline_comments_submit', 'inline_annotations_submit'])
    expect(registerSettings).toHaveBeenCalledTimes(2)
    expect((registerSettings.mock.calls[0] as unknown[])[0]).toBe('dsh-annotation')
    expect((registerSettings.mock.calls[1] as unknown[])[0]).toBe('inline-comments')
  })

  it('migrates a legacy settings namespace once and clears the legacy section', async () => {
    const registerSettings = vi.fn()
    const descriptors = [
      { ns: 'dsh-annotation', user: undefined },
      { ns: 'inline-comments', user: { enabled: false, autoAttach: true } },
    ]
    const update = vi.fn().mockResolvedValue(undefined)
    const replace = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      commands: { register: vi.fn(() => () => undefined) },
      effect(install: () => unknown) {
        install()
      },
      inject(_services: string[], install: (settingsCtx: unknown) => void) {
        install({
          settings: {
            register: registerSettings,
            describe: () => descriptors,
            update,
            replace,
          },
        })
      },
    } as unknown as Context

    apply(ctx, DEFAULT_CONFIG)
    await Promise.resolve()
    await Promise.resolve()

    expect(update).toHaveBeenCalledWith('dsh-annotation', { enabled: false, autoAttach: true })
    expect(replace).toHaveBeenCalledWith('inline-comments', {})
  })

  it('leaves legacy settings untouched when migration has nothing to copy', async () => {
    const registerSettings = vi.fn()
    const update = vi.fn().mockResolvedValue(undefined)
    const replace = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      commands: { register: vi.fn(() => () => undefined) },
      effect(install: () => unknown) {
        install()
      },
      inject(_services: string[], install: (settingsCtx: unknown) => void) {
        install({
          settings: {
            register: registerSettings,
            describe: () => [{ ns: 'inline-comments', user: undefined }],
            update,
            replace,
          },
        })
      },
    } as unknown as Context

    apply(ctx, DEFAULT_CONFIG)
    await Promise.resolve()
    await Promise.resolve()

    expect(update).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})
