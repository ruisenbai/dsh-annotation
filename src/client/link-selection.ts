/** Link-label selection and activation guards scoped to one assistant body. */
import { isMarkdownFileLink, selectableTextNodes } from './selection.ts'

function selectedRange(root: HTMLElement, selection: Selection | null): Range | null {
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  return root.contains(range.startContainer) && root.contains(range.endContainer) ? range : null
}

function containsSelectedText(range: Range, node: Text): boolean {
  if (!range.intersectsNode(node)) return false
  const overlap = node.ownerDocument.createRange()
  overlap.selectNodeContents(node)
  if (range.compareBoundaryPoints(Range.START_TO_START, overlap) > 0)
    overlap.setStart(range.startContainer, range.startOffset)
  if (range.compareBoundaryPoints(Range.END_TO_END, overlap) < 0)
    overlap.setEnd(range.endContainer, range.endOffset)
  return overlap.toString().trim() !== ''
}

/**
 * Resolve a text link without treating linked images or annotation controls as labels.
 * @param root The mounted assistant body.
 * @param target The browser event target.
 * @returns Its enclosing web/file link, or null outside selectable link text.
 */
export function textLinkAtTarget(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (
    element === null ||
    !root.contains(element) ||
    element.closest('img, svg, [data-dsh-annotation-ignore="true"]') !== null
  )
    return null
  const link = element.closest('a[href], button')
  return link instanceof HTMLElement &&
    root.contains(link) &&
    (link.matches('a[href]') || isMarkdownFileLink(link))
    ? link
    : null
}

interface Caret {
  readonly node: Node
  readonly offset: number
}

function caretAtPoint(document: Document, x: number, y: number): Caret | null {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position != null) return { node: position.offsetNode, offset: position.offset }
  const range = document.caretRangeFromPoint?.(x, y)
  return range == null ? null : { node: range.startContainer, offset: range.startOffset }
}

/**
 * Select link labels from their first character without the browser's link/button drag default.
 * @param root The mounted assistant body; touch and modified pointer gestures remain native.
 * @returns A disposer releasing the body's gesture and document's drag listeners.
 */
export function installLinkTextSelection(root: HTMLElement): () => void {
  const document = root.ownerDocument
  const view = document.defaultView
  let drag: { readonly pointerId: number; readonly anchor: Caret; moved: boolean } | null = null
  const pointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return
    const link = textLinkAtTarget(root, event.target)
    const anchor = caretAtPoint(document, event.clientX, event.clientY)
    if (link === null || anchor === null || !root.contains(anchor.node)) return
    cancel()
    drag = { pointerId: event.pointerId, anchor, moved: false }
    document.addEventListener('pointermove', extend, true)
    document.addEventListener('pointerup', pointerUp, true)
    document.addEventListener('pointercancel', cancel, true)
    view?.addEventListener('blur', cancel)
  }
  const extend = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const caret = caretAtPoint(document, event.clientX, event.clientY)
    if (caret === null || !drag.anchor.node.isConnected) return
    if (!drag.moved && caret.node === drag.anchor.node && caret.offset === drag.anchor.offset) return
    drag.moved = true
    document.getSelection()?.setBaseAndExtent(drag.anchor.node, drag.anchor.offset, caret.node, caret.offset)
  }
  const pointerUp = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    if (drag?.moved === true) extend(event)
    cancel()
  }
  const cancel = (): void => {
    drag = null
    document.removeEventListener('pointermove', extend, true)
    document.removeEventListener('pointerup', pointerUp, true)
    document.removeEventListener('pointercancel', cancel, true)
    view?.removeEventListener('blur', cancel)
  }
  root.addEventListener('pointerdown', pointerDown, true)
  return () => {
    cancel()
    root.removeEventListener('pointerdown', pointerDown, true)
  }
}

/**
 * Detect selections whose file-link text the Host button filter omits.
 * @param root The mounted assistant body.
 * @param selection Its document's browser selection.
 * @returns A body-local range containing selected file-link characters, or null.
 */
export function selectedFileLinkRange(root: HTMLElement, selection: Selection | null): Range | null {
  const range = selectedRange(root, selection)
  if (range === null) return null
  return selectableTextNodes(root).some((node) => {
    const button = node.parentElement?.closest('button')
    return button != null && isMarkdownFileLink(button) && containsSelectedText(range, node)
  })
    ? range
    : null
}

/**
 * Suppress the pointer click emitted after dragging across a link's own label.
 * @param root The mounted assistant body.
 * @param target The click target.
 * @param selection Its current browser selection.
 * @returns Whether activating that link would discard a selected label.
 */
export function selectedTextLink(
  root: HTMLElement,
  target: EventTarget | null,
  selection: Selection | null,
): boolean {
  const link = textLinkAtTarget(root, target)
  const range = selectedRange(root, selection)
  return (
    link !== null &&
    range !== null &&
    selectableTextNodes(root).some((node) => link.contains(node) && containsSelectedText(range, node))
  )
}
