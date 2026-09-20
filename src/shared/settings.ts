/** User-owned settings registered by the Host plugin. */

/** Host settings namespace paired with the annotation section in main Settings. */
export const ANNOTATION_SETTINGS_NAMESPACE = 'dsh-annotation'

/** Pre-rename namespaces whose user sections migrate into the new namespace once. */
export const LEGACY_ANNOTATION_SETTINGS_NAMESPACES = ['inline-comments'] as const

/** Fresh installations expose the feature until the user disables it. */
export const DEFAULT_ANNOTATION_ENABLED = true

/** 新增注解后，默认把它附着到官方输入框。 */
export const DEFAULT_ANNOTATION_AUTO_ATTACH = true

/** 注解汇总条默认靠右显示，宽度随内容自适应。 */
export const DEFAULT_ANNOTATION_COMPACT_SUMMARY = true

/** Browser key read only to migrate the pre-0.1.3 enabled preference. */
export const LEGACY_ANNOTATION_ENABLED_STORAGE_KEY = 'dsh.inline-comments.enabled'

/** Display-only filters; hidden transcript details retain their full stored text. */
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

/** Fields accepted by the transcript-visibility controls. */
export type TranscriptVisibilityKey = keyof TranscriptVisibilitySettings

/** Transcript details remain visible until their individual filters are saved. */
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

/** Named tool filters shown after the all-tools master switch. */
export const TRANSCRIPT_TOOL_VISIBILITY_KEYS = [
  'hideToolRead',
  'hideToolGlob',
  'hideToolGrep',
  'hideToolBash',
  'hideToolEdit',
  'hideToolWrite',
  'hideToolOther',
] as const satisfies readonly TranscriptVisibilityKey[]

/** Main-Settings order for the transcript-visibility fields. */
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
  /** Whether saving a new annotation arms the official composer automatically. */
  readonly autoAttach: boolean
  /** 是否使用靠右、宽度自适应且隐藏最左图标的汇总条；关闭时显示完整长条。 */
  readonly compactSummary: boolean
}
