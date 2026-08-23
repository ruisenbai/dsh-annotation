import type { PropsLocale, PropsRuntime, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationEndpoint, AnnotationView } from './controller.ts'
import type { SelectionCapture } from './selection.ts'
import type { AnnotationId, MessageIdentity, SubmissionId } from '../shared/types.ts'

export interface AnnotationInjected {
  readonly hooks: {
    readonly annotations: HostObservable<AnnotationView>
    /** 本地数据控件显示开关（响应式，设置变化即时生效）。 */
    readonly localTools: HostObservable<boolean>
  }
  /** 注解界面的翻译函数，避免覆盖原消息渲染器自己的 t。 */
  readonly annotationT: PropsLocale<'dshAnnotation'>['t']
  readonly beginSelection: (capture: SelectionCapture) => void
  readonly openAnnotation: (annotationId: AnnotationId) => void
  readonly updateEditorText: (text: string) => void
  readonly confirmLongSelection: () => void
  readonly saveEditor: () => AnnotationId
  readonly closeEditor: (force?: boolean) => boolean
  readonly deleteDraft: (annotationId: AnnotationId) => void
  readonly undoDelete: () => void
  readonly dismissDeleteUndo: () => void
  readonly exportLocalData: () => string
  readonly clearLocalDrafts: () => void
  readonly setPanelOpen: (open: boolean) => void
  /** 当前是否需要在新增注解后自动附着。 */
  readonly autoAttachEnabled: () => boolean
  /** 只负责附加；已经附加时不会反向取消。 */
  readonly ensureComposerAttachment: () => boolean
  readonly toggleComposerAttachment: () => boolean
  /** 跟随输入状态修复附着：斜杠命令态放行、离开后重新附着、无可附着时移除令牌。 */
  readonly repairComposerAttachment: () => void
  readonly withdraw: (submissionId: SubmissionId) => Promise<void>
  /** 放弃一条从未入队的失败/待发送记录，注解回到草稿列表。 */
  readonly discardOutbox: (submissionId: SubmissionId) => void
  readonly navigate: (annotationId: AnnotationId) => Promise<boolean>
  readonly annotateMessage: (messageId: MessageIdentity) => boolean
  readonly registerEndpoint: (messageId: MessageIdentity, endpoint: AnnotationEndpoint) => () => void
  readonly updateHighlightRanges: (messageId: MessageIdentity, ranges: readonly Range[]) => void
  readonly activateHighlight: (messageId: MessageIdentity, range: Range | null) => void
  readonly removeHighlights: (messageId: MessageIdentity) => void
  readonly highlightsSupported: () => boolean
}

export type AnnotationBoundProps = InjectFace<AnnotationInjected>
export type AssistantAnnotationProps = PropsRuntime<'conversation.chat.node', 'assistant-step'> &
  PropsLocale<'dshAnnotation'> &
  AnnotationBoundProps
export type InputAnnotationProps = PropsRuntime<'conversation.input.dock'> &
  PropsLocale<'dshAnnotation'> &
  AnnotationBoundProps
export type UserAnnotationProps<Key extends 'user' | 'steering'> = PropsRuntime<
  'conversation.chat.node',
  Key
> &
  PropsLocale<'dshAnnotation'> &
  AnnotationBoundProps
export type AssistantActionAnnotationProps = PropsRuntime<'conversation.chat.assistant-actions'> &
  PropsLocale<'dshAnnotation'> &
  AnnotationBoundProps
export type CommandAnnotationProps = PropsRuntime<'conversation.chat.commandview'> & AnnotationBoundProps
