/** Host half: validates config and registers the idempotent annotation command. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import { installDiffHost } from './host/diff-storage.ts'
import { installSettingsMigration } from './host/settings-migration.ts'
import { createAnnotationCommand, createLegacyAnnotationAliases } from './host/command.ts'
import { DEFAULT_CONFIG, resolveConfig } from './shared/config.ts'
import {
  ARCHIVED_PREFERENCES_IMPORTED_FIELD,
  DEFAULT_ANNOTATION_AUTO_ATTACH,
  DEFAULT_ANNOTATION_COMPACT_SUMMARY,
  DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION,
  DEFAULT_ANNOTATION_ENABLED,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  type AnnotationSettings,
} from './shared/settings.ts'
import type { AnnotationConfig } from './shared/types.ts'

export const name = 'dsh-annotation'
export const inject = ['commands']

/** Command limits and live preferences exposed by the Host configuration form. */
export type Config = AnnotationConfig & {
  [Key in keyof AnnotationSettings]: Volatile<AnnotationSettings[Key]>
} & { archivedPreferencesImported: Volatile<boolean> }

export const Config = Schema.object({
  commandName: Schema.string().default(DEFAULT_CONFIG.commandName),
  maxPayloadBytes: Schema.number().default(DEFAULT_CONFIG.maxPayloadBytes),
  maxAnnotationsPerSubmission: Schema.number().default(DEFAULT_CONFIG.maxAnnotationsPerSubmission),
  warnSelectionChars: Schema.number().default(DEFAULT_CONFIG.warnSelectionChars),
  locateHistoryPages: Schema.number().default(DEFAULT_CONFIG.locateHistoryPages),
  maxDiffFileBytes: Schema.number().default(DEFAULT_CONFIG.maxDiffFileBytes),
  maxDiffLines: Schema.number().default(DEFAULT_CONFIG.maxDiffLines),
  diffTimeoutMs: Schema.number().default(DEFAULT_CONFIG.diffTimeoutMs),
  [ARCHIVED_PREFERENCES_IMPORTED_FIELD]: Schema.boolean().default(false).volatile(),
  enabled: Schema.boolean().default(DEFAULT_ANNOTATION_ENABLED).volatile(),
  autoAttach: Schema.boolean().default(DEFAULT_ANNOTATION_AUTO_ATTACH).volatile(),
  individualSelection: Schema.boolean().default(DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION).volatile(),
  compactSummary: Schema.boolean().default(DEFAULT_ANNOTATION_COMPACT_SUMMARY).volatile(),
  hideReasoning: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideReasoning).volatile(),
  hideTools: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideTools).volatile(),
  hideToolRead: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolRead).volatile(),
  hideToolGlob: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolGlob).volatile(),
  hideToolGrep: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolGrep).volatile(),
  hideToolBash: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolBash).volatile(),
  hideToolEdit: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolEdit).volatile(),
  hideToolWrite: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolWrite).volatile(),
  hideToolOther: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideToolOther).volatile(),
  hideContext: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideContext).volatile(),
  hideCommandResults: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideCommandResults).volatile(),
  hideCompaction: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideCompaction).volatile(),
  hideRetries: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideRetries).volatile(),
  hideErrors: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideErrors).volatile(),
  hideAttachments: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideAttachments).volatile(),
  hideAnnotationHistory: Schema.boolean()
    .default(DEFAULT_TRANSCRIPT_VISIBILITY.hideAnnotationHistory)
    .volatile(),
  hideTurnDetails: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideTurnDetails).volatile(),
  hideOther: Schema.boolean().default(DEFAULT_TRANSCRIPT_VISIBILITY.hideOther).volatile(),
})

/** Register the Host command bridge and optional user-settings section. */
export function apply(ctx: Context, input: AnnotationConfig): void {
  const config = resolveConfig(input)
  const diffHost = installDiffHost(ctx, config)
  installSettingsMigration(ctx)
  ctx.effect(
    () => ctx.commands.register(createAnnotationCommand(config, diffHost)),
    'dsh-annotation: internal submission command',
  )
  for (const alias of createLegacyAnnotationAliases(config, diffHost)) {
    ctx.effect(() => ctx.commands.register(alias), `dsh-annotation: legacy alias /${alias.name}`)
  }
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-annotation: settings page')
  })
}

export type {
  AnnotationDraft,
  AnnotationSubmissionPayload,
  SubmittedAnnotation,
  TextQuoteSelector,
} from './shared/types.ts'
