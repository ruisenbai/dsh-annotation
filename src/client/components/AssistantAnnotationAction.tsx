import type { MessageIdentity } from '../../shared/types.ts'
import type { AssistantActionAnnotationProps } from '../contract.ts'

/** Keyboard-reachable fallback that opens an editor for the complete reply text. */
export function AssistantAnnotationAction({ messageId, annotateMessage, t }: AssistantActionAnnotationProps) {
  return (
    <button
      type="button"
      className="dia-action-icon"
      title={t('action.annotate')}
      aria-label={t('action.annotate')}
      onClick={() => annotateMessage(messageId as unknown as MessageIdentity)}
    >
      <span aria-hidden="true">✎</span>
    </button>
  )
}
