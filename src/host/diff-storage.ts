/** Host-private signing identity; snapshot contents travel in frozen annotation records. */
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { AnnotationConfig } from '../shared/types.ts'
import { AnnotationDiffHost } from './diff.ts'

const signingDomain = defineDomain({
  name: 'dsh_annotation_diff_key',
  version: 1,
  global: { schema: z.object({ secret: z.string().regex(/^(?:[a-f0-9]{64})?$/) }), initial: { secret: '' } },
  tables: {},
})

/** Install when public Host capabilities are present; text annotations do not depend on them.
 * @param ctx - Plugin scope that owns injection and disposal.
 * @param config - Validated read limits.
 * @returns The available reader, or undefined while its providers are absent or initializing.
 */
export function installDiffHost(
  ctx: Context,
  config: AnnotationConfig,
): () => AnnotationDiffHost | undefined {
  let host: AnnotationDiffHost | undefined
  ctx.inject(['fs', 'subprocess', 'storageDomain'], (scope) => {
    scope.effect(async () => {
      const domain = await scope.storageDomain.open(signingDomain)
      try {
        if (domain.global.get().secret === '')
          await domain.global.set({ secret: randomBytes(32).toString('hex') })
        const active = new AnnotationDiffHost(scope.fs, scope.subprocess, config, domain.global.get().secret)
        host = active
        return async () => {
          if (host === active) host = undefined
          await active.dispose()
          await domain.close()
        }
      } catch (error) {
        await domain.close()
        throw error
      }
    }, 'dsh-annotation: Git snapshot signing identity')
  })
  return () => host
}
