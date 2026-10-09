import { createRoot, type Root } from 'react-dom/client'
import type { SelectionCapture } from './selection.ts'
import { SelectionAction } from './components/SelectionAction.tsx'

interface ActiveAction {
  readonly element: HTMLDivElement
  readonly root: Root
  readonly release: () => void
}

let active: ActiveAction | null = null

/** Only pointer releases and keyboard selection gestures can open a selection action. */
export function selectionGesture(event: Event): boolean {
  if (event.target instanceof Element && event.target.closest('[data-dsh-official-selection-action]'))
    return false
  if (!(event instanceof KeyboardEvent)) return true
  return (
    (event.shiftKey &&
      /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/u.test(event.key)) ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')
  )
}

/** Selection actions are transient; closing one never closes an already opened editor. */
export function dismissOfficialSelectionAction(): void {
  active?.release()
}

/** Show the reply's annotation action for a validated file or official Diff selection. */
export function showOfficialSelectionAction(
  capture: SelectionCapture,
  label: string,
  onAnnotate: () => void,
): () => void {
  dismissOfficialSelectionAction()
  const element = document.createElement('div')
  element.dataset.dshOfficialSelectionAction = ''
  document.body.append(element)
  const root = createRoot(element)
  const selection = window.getSelection()
  const selected = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
  const onSelectionChange = (): void => {
    const current = window.getSelection()
    if (selected === null || current === null || current.isCollapsed || current.rangeCount === 0) {
      release()
      return
    }
    const range = current.getRangeAt(0)
    if (
      !selected.startContainer.isConnected ||
      range.startContainer !== selected.startContainer ||
      range.startOffset !== selected.startOffset ||
      range.endContainer !== selected.endContainer ||
      range.endOffset !== selected.endOffset
    )
      release()
  }
  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && element.contains(event.target)) return
    release()
  }
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') release()
  }
  const release = (): void => {
    if (active?.element !== element) return
    active = null
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onEscape, true)
    document.removeEventListener('selectionchange', onSelectionChange)
    observer.disconnect()
    root.unmount()
    element.remove()
  }
  active = { element, root, release }
  const observer = new MutationObserver(() => {
    if (selected !== null && !selected.startContainer.isConnected) release()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  root.render(
    <SelectionAction
      rect={capture.rect}
      label={label}
      onAnnotate={() => {
        release()
        onAnnotate()
      }}
    />,
  )
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onEscape, true)
  document.addEventListener('selectionchange', onSelectionChange)
  return release
}
