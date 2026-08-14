import type { PropsLocale, PropsRuntime, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationEndpoint, AnnotationView } from './controller.ts'
import type { SelectionCapture } from './selection.ts'
import type { AnnotationId, DeliveryMode, MessageIdentity, SubmissionId } from '../shared/types.ts'

export interface AnnotationInjected {
  readonly hooks: { readonly annotations: HostObservable<AnnotationView> }
  readonly beginSelection: (capture: SelectionCapture) => void
  readonly openAnnotation: (annotationId: AnnotationId) => void
  readonly updateEditorText: (text: string) => void
  readonly confirmLongSelection: () => void
  readonly saveEditor: () => AnnotationId
  readonly closeEditor: (force?: boolean) => boolean
  readonly deleteDraft: (annotationId: AnnotationId) => void
  readonly setPanelOpen: (open: boolean) => void
  readonly setOverallRequirementDraft: (value: string) => void
  readonly submit: (archived: boolean, delivery: DeliveryMode) => Promise<void>
  readonly withdraw: (submissionId: SubmissionId) => Promise<void>
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
  PropsLocale<'inlineAnnotations'> &
  AnnotationBoundProps
export type InputAnnotationProps = PropsRuntime<'conversation.input.dock'> &
  PropsLocale<'inlineAnnotations'> &
  AnnotationBoundProps
export type UserAnnotationProps<Key extends 'user' | 'steering'> = PropsRuntime<
  'conversation.chat.node',
  Key
> &
  PropsLocale<'inlineAnnotations'> &
  AnnotationBoundProps
export type AssistantActionAnnotationProps = PropsRuntime<'conversation.chat.assistant-actions'> &
  PropsLocale<'inlineAnnotations'> &
  AnnotationBoundProps
export type CommandAnnotationProps = PropsRuntime<'conversation.chat.commandview'> & AnnotationBoundProps
