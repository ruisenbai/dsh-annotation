import { IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageIdentity } from '../../shared/types.ts'
import type { AssistantActionAnnotationProps } from '../contract.ts'

/** Keyboard-reachable fallback that opens an editor for the complete reply text. */
export function AssistantAnnotationAction({ messageId, annotateMessage, t }: AssistantActionAnnotationProps) {
  return (
    <Tooltip label={t('action.annotate')} side="bottom">
      <button
        type="button"
        className="dia-action-icon"
        aria-label={t('action.annotate')}
        onClick={() => annotateMessage(messageId as unknown as MessageIdentity)}
      >
        <IconListPenOutline16 size={16} />
      </button>
    </Tooltip>
  )
}
