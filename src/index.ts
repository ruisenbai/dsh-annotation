/** Host half: validates config and registers the idempotent annotation command. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { createAnnotationCommand, createLegacyAnnotationAliases } from './host/command.ts'
import { DEFAULT_CONFIG, resolveConfig } from './shared/config.ts'
import {
  ANNOTATION_SETTINGS_NAMESPACE,
  DEFAULT_ANNOTATION_AUTO_ATTACH,
  DEFAULT_ANNOTATION_ENABLED,
  DEFAULT_ANNOTATION_LOCAL_TOOLS,
  LEGACY_ANNOTATION_SETTINGS_NAMESPACES,
  type AnnotationSettings,
} from './shared/settings.ts'
import type { AnnotationConfig } from './shared/types.ts'

export const name = 'dsh-annotation'
export const inject = ['commands']

export interface Config extends AnnotationConfig {}

export const Config: Schema<Config> = Schema.object({
  commandName: Schema.string().default(DEFAULT_CONFIG.commandName),
  maxPayloadBytes: Schema.number().default(DEFAULT_CONFIG.maxPayloadBytes),
  maxAnnotationsPerSubmission: Schema.number().default(DEFAULT_CONFIG.maxAnnotationsPerSubmission),
  warnSelectionChars: Schema.number().default(DEFAULT_CONFIG.warnSelectionChars),
  locateHistoryPages: Schema.number().default(DEFAULT_CONFIG.locateHistoryPages),
})

const SettingsSchema: Schema<AnnotationSettings> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_ANNOTATION_ENABLED),
  autoAttach: Schema.boolean().default(DEFAULT_ANNOTATION_AUTO_ATTACH),
  localTools: Schema.boolean().default(DEFAULT_ANNOTATION_LOCAL_TOOLS),
})

/** Register the Host command bridge and optional user-settings section. */
export function apply(ctx: Context, input: Config): void {
  const config = resolveConfig(input)
  ctx.effect(
    () => ctx.commands.register(createAnnotationCommand(config)),
    'dsh-annotation: internal submission command',
  )
  for (const alias of createLegacyAnnotationAliases(config)) {
    ctx.effect(() => ctx.commands.register(alias), `dsh-annotation: legacy alias /${alias.name}`)
  }
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings as SettingsProvider
    settings.register(ANNOTATION_SETTINGS_NAMESPACE, SettingsSchema)
    // Legacy namespaces stay registered only to read and clear their stored
    // user sections; no plugin card is keyed to them, so they render nothing.
    for (const legacy of LEGACY_ANNOTATION_SETTINGS_NAMESPACES) {
      settings.register(legacy, SettingsSchema)
    }
    migrateLegacySettings(settings)
  })
}

/**
 * Copy pre-rename user settings into the new namespace once, then clear the
 * legacy section. Old data is never deleted before the new write succeeds; the
 * write is fire-and-forget because it must not block plugin load.
 */
function migrateLegacySettings(settings: SettingsProvider): void {
  void Promise.resolve().then(async () => {
    for (const legacy of LEGACY_ANNOTATION_SETTINGS_NAMESPACES) {
      const user = userSection(settings, legacy)
      if (user === null || Object.keys(user).length === 0) continue
      try {
        await settings.update(ANNOTATION_SETTINGS_NAMESPACE, user)
        await settings.replace(legacy, {})
      } catch {
        // Legacy values remain stored for a later load to retry.
      }
    }
  })
}

function userSection(settings: SettingsProvider, ns: string): Record<string, unknown> | null {
  const descriptor = settings.describe().find((item) => item.ns === ns)
  const user = descriptor?.user
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return null
  return user as Record<string, unknown>
}

export type {
  AnnotationDraft,
  AnnotationSubmissionPayload,
  SubmittedAnnotation,
  TextQuoteSelector,
} from './shared/types.ts'
