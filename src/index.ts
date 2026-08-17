/** Host half: validates config and registers the idempotent annotation command. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import { createAnnotationCommand } from './host/command.ts'
import { DEFAULT_CONFIG, resolveConfig } from './shared/config.ts'
import type { AnnotationConfig } from './shared/types.ts'

export const name = 'inline-comments'
export const inject = ['commands']

export interface Config extends AnnotationConfig {}

export const Config: Schema<Config> = Schema.object({
  commandName: Schema.string().default(DEFAULT_CONFIG.commandName),
  maxPayloadBytes: Schema.number().default(DEFAULT_CONFIG.maxPayloadBytes),
  maxAnnotationsPerSubmission: Schema.number().default(DEFAULT_CONFIG.maxAnnotationsPerSubmission),
  warnSelectionChars: Schema.number().default(DEFAULT_CONFIG.warnSelectionChars),
  locateHistoryPages: Schema.number().default(DEFAULT_CONFIG.locateHistoryPages),
})

/** Register the Host command bridge under this plugin fiber. */
export function apply(ctx: Context, input: Config): void {
  const config = resolveConfig(input)
  ctx.effect(
    () => ctx.commands.register(createAnnotationCommand(config)),
    'inline-comments: internal submission command',
  )
}

export type {
  AnnotationDraft,
  AnnotationSubmissionPayload,
  SubmittedAnnotation,
  TextQuoteSelector,
} from './shared/types.ts'
