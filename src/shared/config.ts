import type { Volatile } from '@deepseek-ai/cordis'
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

/** Deployment fields projected by the Host into this plugin's Web activation. */
export type DeploymentFields = { [K in keyof AnnotationConfig]: Volatile<AnnotationConfig[K]> }
type DeploymentRefs = { [K in keyof AnnotationConfig]: Volatile<AnnotationConfig[K] | undefined> }

/** Read current values without remounting Session controllers or discarding in-progress edits.
 * @param fields - Host or Web references; a missing projected value uses its declared default.
 * @returns Read-only options whose getters follow configuration changes.
 */
export function deploymentConfig(fields?: DeploymentRefs): AnnotationConfig {
  if (!fields) return DEFAULT_CONFIG
  const config: AnnotationConfig = {
    get commandName() {
      return validName(fields.commandName.get() ?? DEFAULT_CONFIG.commandName)
    },
    get maxPayloadBytes() {
      return positiveSafeInteger(
        fields.maxPayloadBytes.get() ?? DEFAULT_CONFIG.maxPayloadBytes,
        'maxPayloadBytes',
      )
    },
    get maxAnnotationsPerSubmission() {
      return positiveSafeInteger(
        fields.maxAnnotationsPerSubmission.get() ?? DEFAULT_CONFIG.maxAnnotationsPerSubmission,
        'maxAnnotationsPerSubmission',
      )
    },
    get warnSelectionChars() {
      return positiveSafeInteger(
        fields.warnSelectionChars.get() ?? DEFAULT_CONFIG.warnSelectionChars,
        'warnSelectionChars',
      )
    },
    get locateHistoryPages() {
      return positiveSafeInteger(
        fields.locateHistoryPages.get() ?? DEFAULT_CONFIG.locateHistoryPages,
        'locateHistoryPages',
      )
    },
  }
  // Validate the initial deployment before either face registers contributions.
  Object.values(config)
  return Object.freeze(config)
}

/** Keep a name-keyed registration current without replacing other plugin contributions.
 * @param name - Current validated command name.
 * @param subscribe - Observe changes to the name until disposal.
 * @param register - Install one name and return its disposer.
 * @returns Releases the subscription and the last installed name.
 */
export function bindCommandName(
  name: () => string,
  subscribe: (changed: () => void) => () => void,
  register: (name: string) => () => void,
): () => void {
  let current = name()
  let release = register(current)
  const stop = subscribe(() => {
    const next = name()
    if (next === current) return
    const nextRelease = register(next)
    release()
    current = next
    release = nextRelease
  })
  return () => {
    stop()
    release()
  }
}

function validName(commandName: string): string {
  if (!COMMAND_NAME.test(commandName)) throw new TypeError(`commandName must match ${String(COMMAND_NAME)}`)
  return commandName
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
  return value as number
}
