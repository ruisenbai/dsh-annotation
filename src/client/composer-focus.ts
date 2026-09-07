import { COMPOSER_ATTACHMENT_TOKEN } from './composer-attachment.ts'

interface ComposerPoint {
  readonly node: Node
  readonly offset: number
  readonly text: string | null
}

/** 官方编辑器的一次焦点恢复请求；偏移不包含注解的隐藏令牌。 */
export interface ComposerFocusRequest {
  readonly root: HTMLElement
  readonly text: string
  readonly anchor: number | null
  readonly focus: number | null
  readonly anchorPoint: ComposerPoint | null
  readonly focusPoint: ComposerPoint | null
  readonly previousActive: Element | null
  readonly inputRevision: number
}

/** 从当前 Dock 所在输入区域定位官方编辑器，避免命中注解自己的文本框。 */
export function composerInput(anchor: HTMLElement | null): HTMLElement | null {
  const seat = anchor?.closest<HTMLElement>('[data-composer-seat], [data-composer-card]')
  return seat?.querySelector<HTMLElement>('[data-composer-input]') ?? null
}

function prefixLength(root: HTMLElement): number {
  return root.textContent?.startsWith(COMPOSER_ATTACHMENT_TOKEN) ? COMPOSER_ATTACHMENT_TOKEN.length : 0
}

function visibleText(root: HTMLElement): string {
  return (root.textContent ?? '').slice(prefixLength(root))
}

function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return Math.max(0, range.toString().length - prefixLength(root))
}

function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (remaining > length) {
      remaining -= length
      continue
    }
    // 引用芯片归官方编辑器管理，光标只能落在芯片外侧。
    const chip = node.parentElement?.closest<HTMLElement>('[contenteditable="false"]')
    if (chip !== null && chip !== undefined && root.contains(chip) && chip.parentNode !== null) {
      const index = Array.prototype.indexOf.call(chip.parentNode.childNodes, chip) as number
      return { node: chip.parentNode, offset: index + (remaining === 0 ? 0 : 1) }
    }
    return { node, offset: remaining }
  }
  return { node: root, offset: root.childNodes.length }
}

function restorePoint(root: HTMLElement, point: ComposerPoint | null, offset: number) {
  // 保留仍存活的段落、换行和文本端点；令牌导致节点拆分时再按文字偏移定位。
  if (point !== null && root.contains(point.node) && point.node.textContent === point.text) return point
  return pointAt(root, offset)
}

/**
 * 记录官方 contenteditable 离焦前的选区，只操作焦点和浏览器 Selection，不改编辑器内容。
 * @param resolveRoot - 当前会话的官方输入元素。
 * @returns 选区捕获、恢复和监听清理方法。
 */
export function createComposerFocus(resolveRoot: () => HTMLElement | null) {
  let remembered: ComposerFocusRequest | null = null
  let inputRevision = 0
  const invalidateInput = (event: Event) => {
    if (event.target instanceof Node && resolveRoot()?.contains(event.target)) inputRevision += 1
  }
  const remember = () => {
    const root = resolveRoot()
    const selection = root?.ownerDocument.getSelection()
    if (root === null || selection === null || selection === undefined) return
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
    if (anchorNode === null || focusNode === null || !root.contains(anchorNode) || !root.contains(focusNode))
      return
    remembered = {
      root,
      text: visibleText(root),
      anchor: offsetOf(root, anchorNode, anchorOffset),
      focus: offsetOf(root, focusNode, focusOffset),
      anchorPoint: { node: anchorNode, offset: anchorOffset, text: anchorNode.textContent },
      focusPoint: { node: focusNode, offset: focusOffset, text: focusNode.textContent },
      previousActive: root.ownerDocument.activeElement,
      inputRevision,
    }
  }
  document.addEventListener('selectionchange', remember)
  document.addEventListener('focusout', remember, true)
  document.addEventListener('input', invalidateInput, true)
  document.addEventListener('compositionstart', invalidateInput, true)
  return {
    capture(): ComposerFocusRequest | null {
      remember()
      const root = resolveRoot()
      if (root === null) return null
      const previous = remembered?.root === root && remembered.text === visibleText(root) ? remembered : null
      return {
        root,
        text: visibleText(root),
        anchor: previous?.anchor ?? null,
        focus: previous?.focus ?? null,
        anchorPoint: previous?.anchorPoint ?? null,
        focusPoint: previous?.focusPoint ?? null,
        previousActive: root.ownerDocument.activeElement,
        inputRevision,
      }
    },
    restore(request: ComposerFocusRequest): void {
      const { root } = request
      const active = root.ownerDocument.activeElement
      // 会话切换、后续输入和用户主动转移焦点均取消旧请求。
      if (!root.isConnected || resolveRoot() !== root || root.getAttribute('contenteditable') !== 'true')
        return
      if (visibleText(root) !== request.text) return
      if (inputRevision !== request.inputRevision) return
      if (active !== root && active !== request.previousActive && active !== root.ownerDocument.body) return
      const prefix = prefixLength(root)
      const anchor = restorePoint(
        root,
        request.anchorPoint,
        request.anchor === null ? (root.textContent?.length ?? 0) : request.anchor + prefix,
      )
      const focus = restorePoint(
        root,
        request.focusPoint,
        request.focus === null ? (root.textContent?.length ?? 0) : request.focus + prefix,
      )
      root.focus({ preventScroll: true })
      root.ownerDocument
        .getSelection()
        ?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
    },
    dispose(): void {
      document.removeEventListener('selectionchange', remember)
      document.removeEventListener('focusout', remember, true)
      document.removeEventListener('input', invalidateInput, true)
      document.removeEventListener('compositionstart', invalidateInput, true)
      remembered = null
    },
  }
}
