/** User-owned settings registered by the Host plugin. */

/** Host settings namespace paired with the plugin-configuration card. */
export const INLINE_COMMENTS_SETTINGS_NAMESPACE = 'inline-comments'

/** Fresh installations expose the feature until the user disables it. */
export const DEFAULT_INLINE_COMMENTS_ENABLED = true

/** Browser key read only to migrate the pre-0.1.3 enabled preference. */
export const LEGACY_INLINE_COMMENTS_ENABLED_STORAGE_KEY = 'dsh.inline-comments.enabled'

/** Settings fields persisted in the active DSH profile. */
export interface InlineCommentsSettings {
  /** Whether the browser installs conversation-facing inline-comment integrations. */
  readonly enabled: boolean
}
