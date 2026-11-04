/** Quote and annotation actions inside the Host's single text-selection surface. */
import { useEffect } from 'react'
import { Button, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SelectionCapture } from '../selection.ts'

/** Session-scoped message selection callbacks injected by the plugin. */
export interface MessageSelectionInjected {
  readonly readAnnotationSelection: () => SelectionCapture | null
  readonly beginAnnotation: (capture: SelectionCapture) => boolean
}

type MessageSelectionProps = PropsRuntime<'conversation.chat.text-interaction'> &
  PropsLocale<'dshAnnotation'> &
  MessageSelectionInjected

/**
 * Render both actions without creating another floating surface.
 * @param props Host selection lifecycle, composer actions, and annotation callbacks.
 * @returns The shared toolbar for a writable conversation.
 */
export function MessageSelectionActions({
  dismiss,
  readText,
  clearSelection,
  inputActions,
  useSession,
  t,
  readAnnotationSelection,
  beginAnnotation,
}: MessageSelectionProps) {
  const enabled = useSession(
    (s) => !s.removed && (s.subagent === null || s.subagent.address.mode === 'continuable'),
  )
  useEffect(() => {
    if (!enabled) dismiss()
  }, [enabled, dismiss])
  if (!enabled) return null
  const capture = readAnnotationSelection()
  return (
    <MenuSurface
      compact
      className="dia-message-selection"
      role="toolbar"
      aria-label={t('selection.toolbar')}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Button
        size="sm"
        type="button"
        onClick={() => {
          const text = readText()
          if (text === null) {
            dismiss()
            return
          }
          if (!inputActions.insertQuote(text)) return
          clearSelection()
          dismiss()
        }}
      >
        {t('selection.quote')}
      </Button>
      {capture !== null && (
        <Button
          size="sm"
          type="button"
          onClick={() => {
            const current = readAnnotationSelection()
            if (readText() === null || current === null) {
              dismiss()
              return
            }
            if (!beginAnnotation(current)) return
            clearSelection()
            dismiss()
          }}
        >
          {t('selection.annotate')}
        </Button>
      )}
    </MenuSurface>
  )
}
