import type { Ref } from 'react'
import type { FloatingRect } from '../floating.ts'

/** The same selection action is used for reply, file, and official Diff text. */
export function SelectionAction({
  rect,
  label,
  toolbarLabel,
  onAnnotate,
  elementRef,
}: {
  readonly rect: FloatingRect
  readonly label: string
  readonly toolbarLabel?: string
  readonly onAnnotate: () => void
  readonly elementRef?: Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={elementRef}
      className="dia-selection-bar"
      role="toolbar"
      aria-label={toolbarLabel ?? label}
      style={{
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 212)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 44)),
      }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <button type="button" className="dia-selection-bar__action" onClick={onAnnotate}>
        {label}
      </button>
    </div>
  )
}
