/** Annotation preferences exposed by the Host plugin configuration form. */

/** Host settings namespace paired with the annotation section in main Settings. */
export const ANNOTATION_SETTINGS_NAMESPACE = 'dsh-annotation'

/** Durable marker preventing an archived preference from returning after Reset. */
export const ARCHIVED_PREFERENCES_IMPORTED_FIELD = 'archivedPreferencesImported'

/** Fresh installations expose the feature until the user disables it. */
export const DEFAULT_ANNOTATION_ENABLED = true

/** 新增注解后，默认把它附着到官方输入框。 */
export const DEFAULT_ANNOTATION_AUTO_ATTACH = true

/** 发送时默认使用已附着的全部注解，而不是逐条选择。 */
export const DEFAULT_ANNOTATION_INDIVIDUAL_SELECTION = false

/** 注解汇总条默认靠右显示，宽度随内容自适应。 */
export const DEFAULT_ANNOTATION_COMPACT_SUMMARY = true

/** Official file-preview annotations are enabled on fresh installations. */
export const DEFAULT_OFFICIAL_FILE_ANNOTATIONS = true

/** Official turn-Diff annotations are enabled on fresh installations. */
export const DEFAULT_OFFICIAL_DIFF_ANNOTATIONS = true

/** Browser key read only to migrate the pre-0.1.3 enabled preference. */
export const LEGACY_ANNOTATION_ENABLED_STORAGE_KEY = 'dsh.inline-comments.enabled'

/** Historical transcript preferences retained only to read earlier profile documents. */
export interface TranscriptVisibilitySettings {
  /** Hide assistant reasoning text. */
  readonly hideReasoning: boolean
  /** Hide every tool call and result detail, regardless of tool name. */
  readonly hideTools: boolean
  /** Hide read and read_image calls and their results. */
  readonly hideToolRead: boolean
  /** Hide glob calls and their results. */
  readonly hideToolGlob: boolean
  /** Hide grep calls and their results. */
  readonly hideToolGrep: boolean
  /** Hide bash and pwsh calls and their results. */
  readonly hideToolBash: boolean
  /** Hide edit calls and their results. */
  readonly hideToolEdit: boolean
  /** Hide write calls and their results. */
  readonly hideToolWrite: boolean
  /** Hide calls and results for every tool not covered by a named tool filter. */
  readonly hideToolOther: boolean
  /** Hide system prompts, injected context, and context-source details. */
  readonly hideContext: boolean
  /** Hide command result details. */
  readonly hideCommandResults: boolean
  /** Hide context-compaction summaries and details. */
  readonly hideCompaction: boolean
  /** Hide retry notices and details. */
  readonly hideRetries: boolean
  /** Hide failure and token-limit notices. */
  readonly hideErrors: boolean
  /** Hide message image/file attachments; inline Markdown images remain part of the body. */
  readonly hideAttachments: boolean
  /** Hide collapsible submitted annotation details without changing stored drafts. */
  readonly hideAnnotationHistory: boolean
  /** Hide completed-reply statistics and standard footer actions. */
  readonly hideTurnDetails: boolean
  /** Hide unknown or opaque content and workflow details. */
  readonly hideOther: boolean
}

/** Historical transcript preference names. */
export type TranscriptVisibilityKey = keyof TranscriptVisibilitySettings

/** Historical transcript fields default to false and have no active UI effect. */
export const DEFAULT_TRANSCRIPT_VISIBILITY: TranscriptVisibilitySettings = {
  hideReasoning: false,
  hideTools: false,
  hideToolRead: false,
  hideToolGlob: false,
  hideToolGrep: false,
  hideToolBash: false,
  hideToolEdit: false,
  hideToolWrite: false,
  hideToolOther: false,
  hideContext: false,
  hideCommandResults: false,
  hideCompaction: false,
  hideRetries: false,
  hideErrors: false,
  hideAttachments: false,
  hideAnnotationHistory: false,
  hideTurnDetails: false,
  hideOther: false,
}

/** Historical tool-filter fields retained for profile migration. */
export const TRANSCRIPT_TOOL_VISIBILITY_KEYS = [
  'hideToolRead',
  'hideToolGlob',
  'hideToolGrep',
  'hideToolBash',
  'hideToolEdit',
  'hideToolWrite',
  'hideToolOther',
] as const satisfies readonly TranscriptVisibilityKey[]

/** Historical field order retained for profile migration. */
export const TRANSCRIPT_VISIBILITY_KEYS: readonly TranscriptVisibilityKey[] = [
  'hideReasoning',
  'hideTools',
  ...TRANSCRIPT_TOOL_VISIBILITY_KEYS,
  'hideContext',
  'hideCommandResults',
  'hideCompaction',
  'hideRetries',
  'hideErrors',
  'hideAttachments',
  'hideAnnotationHistory',
  'hideTurnDetails',
  'hideOther',
]

/** Settings fields persisted in the active DSH profile. */
export interface AnnotationSettings extends TranscriptVisibilitySettings {
  /** Whether the browser installs conversation-facing annotation integrations. */
  readonly enabled: boolean
  /** Whether file-preview annotation actions and captures are enabled; absent in pre-v4 profiles. */
  readonly officialFileAnnotations?: boolean
  /** Whether official turn-Diff annotation actions and captures are enabled; absent in pre-v4 profiles. */
  readonly officialDiffAnnotations?: boolean
  /** Whether saving a new annotation arms the official composer automatically. */
  readonly autoAttach: boolean
  /** Whether each send uses the annotations selected for that send. */
  readonly individualSelection: boolean
  /** 是否使用靠右、宽度自适应且隐藏最左图标的汇总条；关闭时显示完整长条。 */
  readonly compactSummary: boolean
}
