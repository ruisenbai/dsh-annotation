/** Live text geometry shared by source bubbles and selection-anchored cards. */
import type { MarkerRect } from './marker-layout.ts'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const invisible = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]*$/u

function textNodes(root: Node): Text[] {
  if (root instanceof Text) return [root]
  const nodes: Text[] = []
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

function visibleText(node: Text): HTMLElement | null {
  const element = node.parentElement
  if (
    element === null ||
    element.closest('[data-dsh-annotation-ignore], .dia-markers, script, style, [hidden], [inert]') !== null
  )
    return null
  const style = element.ownerDocument.defaultView!.getComputedStyle(element)
  return style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none'
    ? null
    : element
}

/**
 * Resolve the last painted grapheme in document order, independently of selection direction.
 * @param range - Normalized DOM selection, including any trailing whitespace.
 * @param nodes - Optional current text index, in document order.
 * @returns The character's own rectangle and typography owner; no container-rectangle fallback.
 */
export function sourceEndpoint(
  range: Range,
  nodes: readonly Text[] = textNodes(range.commonAncestorContainer),
): { readonly rect: DOMRect; readonly contextElement: HTMLElement } | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!
    if (!range.intersectsNode(node)) continue
    const element = visibleText(node)
    if (element === null) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    const segments = [...graphemes.segment(node.data.slice(start, end))]
    for (let offset = segments.length - 1; offset >= 0; offset -= 1) {
      const segment = segments[offset]!
      if (invisible.test(segment.segment)) continue
      const from = start + segment.index
      const to = from + segment.segment.length
      if (range.comparePoint(node, from) !== 0 || range.comparePoint(node, to) !== 0) continue
      const character = node.ownerDocument.createRange()
      character.setStart(node, from)
      character.setEnd(node, to)
      if (typeof character.getClientRects !== 'function') continue
      const rect = Array.from(character.getClientRects()).find((value) => value.width > 0 && value.height > 0)
      if (rect !== undefined) return { rect, contextElement: element }
    }
  }
  return null
}

/**
 * Measure painted text fragments and embedded content that source bubbles must leave readable.
 * @param root - Content and nearby siblings; marker nodes are excluded.
 * @returns Viewport rectangles, without inserting elements into the text flow.
 */
export function sourceObstacles(root: HTMLElement): readonly MarkerRect[] {
  const rects: MarkerRect[] = []
  for (const node of textNodes(root)) {
    if (invisible.test(node.data) || visibleText(node) === null) continue
    const range = node.ownerDocument.createRange()
    range.selectNodeContents(node)
    if (typeof range.getClientRects === 'function')
      rects.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0))
  }
  for (const element of root.querySelectorAll<HTMLElement>('img, video, canvas, svg, input, textarea')) {
    if (element.closest('.dia-markers, [data-dsh-annotation-ignore]') !== null) continue
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) rects.push(rect)
  }
  return rects
}
