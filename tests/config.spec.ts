import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'
import { apply, Config } from '../src/index.ts'
import { DEFAULT_CONFIG, LEGACY_COMMAND_NAMES, resolveConfig } from '../src/shared/config.ts'

describe('configuration', () => {
  it('resolves all defaults explicitly', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  it('keeps all transcript filters off by default', () => {
    expect(DEFAULT_TRANSCRIPT_VISIBILITY).toEqual({
      hideReasoning: false,
      hideTools: false,
      hideToolRead: false,
      hideToolGlob: false,
      hideToolGrep: false,
      hideToolBash: false,
      hideToolEdit: false,
      hideToolWrite: false,
      hideToolOther: false,
      hideContext: false,
      hideCommandResults: false,
      hideCompaction: false,
      hideRetries: false,
      hideErrors: false,
      hideAttachments: false,
      hideAnnotationHistory: false,
      hideTurnDetails: false,
      hideOther: false,
    })
    expect(TRANSCRIPT_VISIBILITY_KEYS).toEqual(Object.keys(DEFAULT_TRANSCRIPT_VISIBILITY))
  })

  it('uses the dsh-annotation command identity by default', () => {
    expect(DEFAULT_CONFIG.commandName).toBe('annotation_submit')
    expect(LEGACY_COMMAND_NAMES).toEqual(['inline_comments_submit', 'inline_annotations_submit'])
  })

  it('accepts deployment overrides', () => {
    expect(
      resolveConfig({
        commandName: 'review_submit',
        locateHistoryPages: 3,
      }),
    ).toMatchObject({
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

  it('exposes only preferences as volatile form fields', () => {
    const defaults: AnnotationSettings = {
      enabled: true,
      autoAttach: true,
      individualSelection: DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
      compactSummary: true,
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
    }
    const resolved = Config({})
    for (const field of Object.keys(defaults) as (keyof AnnotationSettings)[]) {
      expect(Config.dict?.[field]?.meta.volatile).toBe(true)
      expect(resolved[field].get()).toBe(defaults[field])
      expect(Config({ [field]: true })[field].get()).toBe(true)
      expect(Config({ [field]: false })[field].get()).toBe(false)
      expect(() => Config({ [field]: 'true' })).toThrow()
    }
    expect(Config.dict?.commandName?.meta.volatile).not.toBe(true)
    expect(resolved.archivedPreferencesImported.get()).toBe(false)
    expect(Config.dict).not.toHaveProperty('localTools')
  })

  it('keeps the custom settings page scoped to the plugin fiber', () => {
    const disposePresentation = vi.fn()
    const configure = vi.fn(() => disposePresentation)
    const register = vi.fn(() => () => undefined)
    const effects: Array<() => void> = []
    const fiber = {}
    const ctx = {
      fiber,
      commands: { register },
      effect(install: () => () => void) {
        effects.push(install())
      },
      inject(services: string[], install: (child: unknown) => void) {
        if (services.length !== 1 || services[0] !== 'settings') return
        install({ settings: { configure }, effect: ctx.effect })
      },
    } as unknown as Context
    apply(ctx, DEFAULT_CONFIG)
    expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
    expect(register.mock.calls.map((call) => (call as unknown as [{ name: string }])[0].name)).toEqual([
      'annotation_submit',
      'inline_comments_submit',
      'inline_annotations_submit',
    ])
    for (const dispose of effects.reverse()) dispose()
    expect(disposePresentation).toHaveBeenCalledOnce()
  })

  it('keeps command registration available without optional settings services', () => {
    const register = vi.fn(() => () => undefined)
    const ctx = {
      commands: { register },
      effect(install: () => unknown) {
        install()
      },
      inject: vi.fn(),
    } as unknown as Context
    apply(ctx, DEFAULT_CONFIG)
    expect(register).toHaveBeenCalledTimes(3)
  })
})
