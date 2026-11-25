import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'
import { syncedDeployment } from './deployment-fixture.ts'
import { apply, Config } from '../src/index.ts'
import { DEFAULT_CONFIG, LEGACY_COMMAND_NAMES, deploymentConfig } from '../src/shared/config.ts'

describe('configuration', () => {
  it('resolves all defaults explicitly', () => {
    expect(deploymentConfig()).toEqual(DEFAULT_CONFIG)
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

  it('reads all five non-default fields identically on Host and Web and follows live changes', () => {
    const overrides = {
      commandName: 'review_submit',
      maxPayloadBytes: 4096,
      maxAnnotationsPerSubmission: 2,
      warnSelectionChars: 75,
      locateHistoryPages: 3,
    }
    const client = syncedDeployment(overrides)
    const browser = deploymentConfig(client.fields)
    expect({ ...browser }).toEqual(overrides)
    expect({ ...deploymentConfig(Config(overrides)) }).toEqual(overrides)
    client.update(DEFAULT_CONFIG)
    expect({ ...browser }).toEqual(DEFAULT_CONFIG)
  })

  it.each([
    [{ commandName: 'Bad Name' }, 'commandName'],
    [{ maxPayloadBytes: 0 }, 'maxPayloadBytes'],
    [{ maxAnnotationsPerSubmission: 1.5 }, 'maxAnnotationsPerSubmission'],
  ])('rejects invalid config %#', (value, message) => {
    expect(() => deploymentConfig(syncedDeployment(value).fields)).toThrow(message)
  })

  it('projects the five deployment fields and user preferences as live references', () => {
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
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof typeof DEFAULT_CONFIG)[]) {
      expect(Config.dict?.[key]?.meta.volatile).toBe(true)
      expect(resolved[key].get()).toEqual(DEFAULT_CONFIG[key])
    }
    expect(resolved.archivedPreferencesImported.get()).toBe(false)
    expect(Config.dict).not.toHaveProperty('localTools')
  })

  it('keeps the custom settings page scoped to the plugin fiber', async () => {
    const disposePresentation = vi.fn()
    const configure = vi.fn(() => disposePresentation)
    const register = vi.fn(() => () => undefined)
    const effects: Array<() => void> = []
    const fiber = {}
    const ctx = {
      fiber,
      on: () => () => {},
      commands: { register },
      plugin: vi.fn(),
      sessionProjections: { register: vi.fn(async () => ({ dispose: vi.fn() })) },
      effect(install: () => () => void) {
        effects.push(install())
      },
      inject(services: string[], install: (child: unknown) => void) {
        if (services.length !== 1 || services[0] !== 'settings') return
        install({ settings: { configure }, effect: ctx.effect })
      },
    } as unknown as Context
    await apply(ctx, Config({}))
    expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
    expect(register.mock.calls.map((call) => (call as unknown as [{ name: string }])[0].name)).toEqual([
      'annotation_submit',
      'inline_comments_submit',
      'inline_annotations_submit',
      'annotation_side_chat_promote',
      'annotation_side_chat_submit',
    ])
    for (const dispose of effects.reverse()) dispose()
    expect(disposePresentation).toHaveBeenCalledOnce()
  })

  it('keeps command registration available without optional settings services', async () => {
    const register = vi.fn(() => () => undefined)
    const ctx = {
      on: () => () => {},
      commands: { register },
      plugin: vi.fn(),
      sessionProjections: { register: vi.fn(async () => ({ dispose: vi.fn() })) },
      effect(install: () => unknown) {
        install()
      },
      inject: vi.fn(),
    } as unknown as Context
    await apply(ctx, Config({}))
    expect(register).toHaveBeenCalledTimes(5)
  })
})
