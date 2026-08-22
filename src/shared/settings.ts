/** User-owned settings registered by the Host plugin. */

/** Host settings namespace paired with the plugin-configuration card. */
export const ANNOTATION_SETTINGS_NAMESPACE = 'dsh-annotation'

/** Pre-rename namespaces whose user sections migrate into the new namespace once. */
export const LEGACY_ANNOTATION_SETTINGS_NAMESPACES = ['inline-comments'] as const

/** Fresh installations expose the feature until the user disables it. */
export const DEFAULT_ANNOTATION_ENABLED = true

/** 新增注解后，默认把它附着到官方输入框。 */
export const DEFAULT_ANNOTATION_AUTO_ATTACH = true

/** Browser key read only to migrate the pre-0.1.3 enabled preference. */
export const LEGACY_ANNOTATION_ENABLED_STORAGE_KEY = 'dsh.inline-comments.enabled'

/** Settings fields persisted in the active DSH profile. */
export interface AnnotationSettings {
  /** Whether the browser installs conversation-facing annotation integrations. */
  readonly enabled: boolean
  /** Whether saving a new annotation arms the official composer automatically. */
  readonly autoAttach: boolean
}
