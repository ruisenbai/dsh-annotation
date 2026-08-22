import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG, resolveConfig } from '../src/shared/config.ts'

describe('configuration', () => {
  it('resolves all defaults explicitly', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
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
        install({ settings: { register: registerSettings } })
      },
    } as unknown as Context

    apply(ctx, DEFAULT_CONFIG)

    expect(registerCommand).toHaveBeenCalledOnce()
    expect(registerSettings).toHaveBeenCalledOnce()
    expect(registerSettings.mock.calls[0]?.[0]).toBe('inline-comments')
  })
})
