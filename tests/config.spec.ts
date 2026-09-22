import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  TRANSCRIPT_VISIBILITY_KEYS,
  type AnnotationSettings,
} from '../src/shared/settings.ts'
import { apply } from '../src/index.ts'
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
        maxDiffFileBytes: 2048,
        maxDiffLines: 30,
        diffTimeoutMs: 5000,
      }),
    ).toMatchObject({
      commandName: 'review_submit',
      locateHistoryPages: 3,
      maxDiffFileBytes: 2048,
      maxDiffLines: 30,
      diffTimeoutMs: 5000,
    })
  })

  it.each([
    [{ commandName: 'Bad Name' }, 'commandName'],
    [{ maxPayloadBytes: 0 }, 'maxPayloadBytes'],
    [{ maxDiffFileBytes: 0 }, 'maxDiffFileBytes'],
    [{ maxDiffLines: 1.5 }, 'maxDiffLines'],
    [{ diffTimeoutMs: Number.POSITIVE_INFINITY }, 'diffTimeoutMs'],
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
      inject(services: string[], install: (settingsCtx: unknown) => void) {
        if (!services.includes('settings')) return
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
    const schema = (registerSettings.mock.calls[0] as unknown[])[1] as Schema<unknown, AnnotationSettings>
    expect(DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION).toBe(false)
    const defaults: AnnotationSettings = {
      enabled: true,
      autoAttach: true,
      individualSelection: DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
      compactSummary: true,
      ...DEFAULT_TRANSCRIPT_VISIBILITY,
    }
    expect(schema({})).toEqual(defaults)
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
      expect(schema({ [field]: true })).toEqual({ ...defaults, [field]: true })
      expect(schema({ [field]: false })).toEqual(defaults)
      expect(() => schema({ [field]: 'true' })).toThrow()
    }
    expect(schema({ individualSelection: true }).individualSelection).toBe(true)
    expect(schema({ individualSelection: false }).individualSelection).toBe(
      DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
    )
    expect(() => schema({ individualSelection: 'false' })).toThrow()
    expect(schema({ compactSummary: false }).compactSummary).toBe(false)
    expect(() => schema({ compactSummary: 'false' })).toThrow()
    expect(schema.dict).not.toHaveProperty('localTools')
    const legacyUser = { enabled: false, autoAttach: false, compactSummary: false, localTools: false }
    expect(schema(legacyUser)).toMatchObject({
      enabled: false,
      autoAttach: false,
      individualSelection: DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
      compactSummary: false,
    })
    expect(legacyUser).toEqual({
      enabled: false,
      autoAttach: false,
      compactSummary: false,
      localTools: false,
    })
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
      inject(services: string[], install: (settingsCtx: unknown) => void) {
        if (!services.includes('settings')) return
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
      inject(services: string[], install: (settingsCtx: unknown) => void) {
        if (!services.includes('settings')) return
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
