/** Browser-wide persisted feature-enabled preference. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_INLINE_COMMENTS_ENABLED, INLINE_COMMENTS_ENABLED_STORAGE_KEY } from '../shared/settings.ts'

/**
 * Create the persisted feature source shared by every Session view in one plugin lifecycle.
 * @returns the live feature-enabled store.
 */
export function createInlineCommentsFeatureToggle(): SnapshotStore<boolean> {
  return createSnapshotStore(DEFAULT_INLINE_COMMENTS_ENABLED, {
    persist: { name: INLINE_COMMENTS_ENABLED_STORAGE_KEY },
  })
}
