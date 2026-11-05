/** Shared quote and annotation toolbar, including the Host's file-link selection adapter. */
import { useEffect, useRef, type RefObject } from 'react'
import { Button, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SelectionCapture } from '../selection.ts'
import { useAnnotationFloating, type AnnotationFloatingAnchor } from '../floating.ts'

/** Session-scoped message selection callbacks injected by the plugin. */
export interface MessageSelectionInjected {
  readonly readAnnotationSelection: () => SelectionCapture | null
  readonly beginAnnotation: (capture: SelectionCapture) => boolean
}

type MessageSelectionProps = Pick<
  PropsRuntime<'conversation.chat.text-interaction'>,
  'dismiss' | 'readText' | 'clearSelection' | 'useSession' | 'useInput'
> &
  PropsLocale<'dshAnnotation'> &
  MessageSelectionInjected & {
    readonly inputActions: Pick<
      PropsRuntime<'conversation.chat.text-interaction'>['inputActions'],
      'insertQuote'
    >
    /** A live range anchor for file-link selections omitted by the Host. */
    readonly floatingAnchor?: () => AnnotationFloatingAnchor | null
    readonly elementRef?: RefObject<HTMLDivElement>
  }

/**
 * Render both actions in the Host surface or at a live file-link range.
 * @param props Selection lifecycle, composer actions, annotation callbacks, and optional range anchor.
 * @returns The shared toolbar for a writable conversation.
 */
export function MessageSelectionActions({
  dismiss,
  readText,
  clearSelection,
  inputActions,
  useSession,
  useInput,
  t,
  readAnnotationSelection,
  beginAnnotation,
  floatingAnchor,
  elementRef,
}: MessageSelectionProps) {
  const enabled = useSession(
    (s) => !s.removed && (s.subagent === null || s.subagent.address.mode === 'continuable'),
  )
  const phase = useInput((state) => state.phase)
  const localRef = useRef<HTMLDivElement>(null)
  const menuRef = elementRef ?? localRef
  const floating = useAnnotationFloating({
    floatingRef: menuRef,
    enabled: enabled && floatingAnchor !== undefined,
    anchor: () => floatingAnchor?.() ?? null,
    preferBelow: true,
  })
  useEffect(() => {
    if (!enabled) dismiss()
  }, [enabled, dismiss])
  if (!enabled) return null
  const capture = readAnnotationSelection()
  return (
    <MenuSurface
      compact
      ref={menuRef}
      className={`dia-message-selection${floatingAnchor === undefined ? '' : ' dia-link-selection'}`}
      style={floatingAnchor === undefined ? undefined : floating.style}
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
            if (phase !== 'plain' && phase !== 'claimed') return
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
