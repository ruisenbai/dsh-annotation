import type { SyncedConfig } from '@deepseek-ai/dsh-client-config/types'
import type { DeploymentFields } from '../src/shared/config.ts'
import type { AnnotationConfig } from '../src/shared/types.ts'

/** Browser-style references whose values change before their listeners run. */
export function syncedDeployment(initial: Partial<AnnotationConfig> = {}) {
  const values = { ...initial }
  const ref = <K extends keyof AnnotationConfig>(key: K) => {
    const listeners = new Set<() => void>()
    const get = () => values[key]
    return {
      get,
      getSnapshot: get,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      notify() {
        for (const listener of listeners) listener()
      },
    }
  }
  const fields = {
    commandName: ref('commandName'),
    maxPayloadBytes: ref('maxPayloadBytes'),
    maxAnnotationsPerSubmission: ref('maxAnnotationsPerSubmission'),
    warnSelectionChars: ref('warnSelectionChars'),
    locateHistoryPages: ref('locateHistoryPages'),
  } satisfies SyncedConfig<DeploymentFields>
  return {
    fields,
    update(change: Partial<AnnotationConfig>) {
      Object.assign(values, change)
      for (const key of Object.keys(change) as (keyof AnnotationConfig)[]) fields[key].notify()
    },
  }
}
