import type { AnnotationConfig } from './types.ts'

/** Command names emitted before the rename; legacy aliases forward old submissions to the new handler. */
export const LEGACY_COMMAND_NAMES = ['inline_comments_submit', 'inline_annotations_submit'] as const

export const DEFAULT_CONFIG: AnnotationConfig = Object.freeze({
  commandName: 'annotation_submit',
  maxPayloadBytes: 512 * 1024,
  maxAnnotationsPerSubmission: 100,
  warnSelectionChars: 12_000,
  locateHistoryPages: 20,
})

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
  return value as number
}

/** Resolve and validate deployment configuration at the plugin boundary. */
export function resolveConfig(value: Partial<AnnotationConfig> | undefined): AnnotationConfig {
  const commandName = value?.commandName ?? DEFAULT_CONFIG.commandName
  if (!COMMAND_NAME.test(commandName)) {
    throw new TypeError(`commandName must match ${String(COMMAND_NAME)}`)
  }
  return Object.freeze({
    commandName,
    maxPayloadBytes: positiveSafeInteger(
      value?.maxPayloadBytes ?? DEFAULT_CONFIG.maxPayloadBytes,
      'maxPayloadBytes',
    ),
    maxAnnotationsPerSubmission: positiveSafeInteger(
      value?.maxAnnotationsPerSubmission ?? DEFAULT_CONFIG.maxAnnotationsPerSubmission,
      'maxAnnotationsPerSubmission',
    ),
    warnSelectionChars: positiveSafeInteger(
      value?.warnSelectionChars ?? DEFAULT_CONFIG.warnSelectionChars,
      'warnSelectionChars',
    ),
    locateHistoryPages: positiveSafeInteger(
      value?.locateHistoryPages ?? DEFAULT_CONFIG.locateHistoryPages,
      'locateHistoryPages',
    ),
  })
}
