import type {
  AnnotationSelectionCapture,
  MessageIdentity,
  StructuredSelection,
  TextQuoteSelector,
} from '../shared/types.ts'

export type SelectionCapture = AnnotationSelectionCapture

function acceptedTextNode(node: Node, root: HTMLElement): node is Text {
  if (node.nodeType !== Node.TEXT_NODE || node.textContent === null) return false
  const text = node as Text
  const parent = text.parentElement
  if (parent === null || !root.contains(parent)) return false
  if (text.data.trim() === '' && parent === root) return false
  return (
    parent.closest('button, script, style, [aria-hidden="true"], [data-dsh-inline-comment-ignore="true"]') ===
    null
  )
}

/** Text nodes that define persistent offsets; interactive chrome is deliberately excluded. */
export function selectableTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current: Node | null = walker.nextNode()
  while (current !== null) {
    if (acceptedTextNode(current, root)) nodes.push(current)
    current = walker.nextNode()
  }
  return nodes
}

function boundaryOffset(nodes: readonly Text[], container: Node, offset: number): number | null {
  let total = 0
  for (const node of nodes) {
    if (node === container) return total + Math.min(offset, node.data.length)
    total += node.data.length
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const element = container as Element
    const atEnd = offset === element.childNodes.length
    const boundaryNode = atEnd ? element : (element.childNodes[offset] ?? null)
    if (boundaryNode === null) return null
    let preceding = 0
    for (const node of nodes) {
      if (boundaryNode === node || boundaryNode.contains(node)) {
        if (!atEnd) return preceding
        preceding += node.data.length
        continue
      }
      const position = boundaryNode.compareDocumentPosition(node)
      if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
        preceding += node.data.length
        continue
      }
      if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return preceding
    }
    return preceding
  }
  return null
}

function languageOf(code: Element): string | null {
  const dataLanguage =
    code.getAttribute('data-language') ?? code.parentElement?.getAttribute('data-language') ?? null
  if (dataLanguage !== null && dataLanguage.trim() !== '') return dataLanguage
  const token = [
    ...code.classList,
    ...(code.parentElement === null ? [] : [...code.parentElement.classList]),
  ].find((name) => name.startsWith('language-'))
  return token === undefined ? null : token.slice('language-'.length)
}

function lineNumber(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

function structuredSelection(range: Range): StructuredSelection | undefined {
  const start = range.startContainer.parentElement
  const end = range.endContainer.parentElement
  const startCode = start?.closest('code')
  const endCode = end?.closest('code')
  if (startCode !== null && startCode !== undefined && startCode === endCode) {
    const codeRange = document.createRange()
    codeRange.selectNodeContents(startCode)
    codeRange.setEnd(range.startContainer, range.startOffset)
    const startOffset = codeRange.toString().length
    codeRange.setEnd(range.endContainer, range.endOffset)
    const endOffset = codeRange.toString().length
    const text = startCode.textContent ?? ''
    return Object.freeze({
      kind: 'code',
      language: languageOf(startCode),
      startLine: lineNumber(text, startOffset),
      endLine: lineNumber(text, endOffset),
    })
  }
  const startCell = start?.closest('td, th') as HTMLTableCellElement | null | undefined
  const endCell = end?.closest('td, th') as HTMLTableCellElement | null | undefined
  if (startCell !== null && startCell !== undefined && endCell !== null && endCell !== undefined) {
    const startRow = startCell.parentElement as HTMLTableRowElement | null
    const endRow = endCell.parentElement as HTMLTableRowElement | null
    if (startRow?.closest('table') === endRow?.closest('table')) {
      return Object.freeze({
        kind: 'table',
        startRow: startRow?.rowIndex ?? 0,
        startColumn: startCell.cellIndex,
        endRow: endRow?.rowIndex ?? 0,
        endColumn: endCell.cellIndex,
      })
    }
  }
  return undefined
}

/** Capture a single-message browser Range into a durable text-quote selector. */
export function captureSelection(
  root: HTMLElement,
  range: Range,
  messageId: MessageIdentity,
  messageSeq: number,
): SelectionCapture {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    throw new Error('selection must stay inside one assistant reply')
  }
  if (range.toString().trim().length === 0) throw new Error('selection must contain text')
  const nodes = selectableTextNodes(root)
  const start = boundaryOffset(nodes, range.startContainer, range.startOffset)
  const end = boundaryOffset(nodes, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start)
    throw new Error('selection boundaries are not addressable')
  const rendered = nodes.map((node) => node.data).join('')
  const exact = rendered.slice(start, end)
  const rect = range.getBoundingClientRect()
  const structure = structuredSelection(range)
  return Object.freeze({
    messageId,
    messageSeq,
    responseVersion: messageId,
    quote: Object.freeze({
      exact,
      prefix: rendered.slice(Math.max(0, start - 32), start),
      suffix: rendered.slice(end, end + 32),
      start,
      end,
    }),
    ...(structure === undefined ? {} : { structure }),
    rect: Object.freeze({ top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }),
  })
}

function resolveSelectorOffsets(
  rendered: string,
  selector: TextQuoteSelector,
): { readonly start: number; readonly end: number } | null {
  if (selector.exact.length === 0) return null
  if (
    selector.start >= 0 &&
    selector.end <= rendered.length &&
    selector.end > selector.start &&
    rendered.slice(selector.start, selector.end) === selector.exact
  ) {
    return { start: selector.start, end: selector.end }
  }
  const candidates: { readonly start: number; readonly context: number; readonly distance: number }[] = []
  let cursor = rendered.indexOf(selector.exact)
  while (cursor >= 0) {
    const end = cursor + selector.exact.length
    const prefixMatches =
      selector.prefix.length === 0 ||
      rendered.slice(Math.max(0, cursor - selector.prefix.length), cursor) === selector.prefix
    const suffixMatches =
      selector.suffix.length === 0 || rendered.slice(end, end + selector.suffix.length) === selector.suffix
    candidates.push({
      start: cursor,
      context: Number(prefixMatches) + Number(suffixMatches),
      distance: Math.abs(cursor - selector.start),
    })
    cursor = rendered.indexOf(selector.exact, cursor + 1)
  }
  candidates.sort((left, right) => right.context - left.context || left.distance - right.distance)
  const best = candidates[0]
  return best === undefined ? null : { start: best.start, end: best.start + selector.exact.length }
}

/** Rebuild a Range when the same finalized reply is mounted again. */
export function rangeFromSelector(root: HTMLElement, selector: TextQuoteSelector): Range | null {
  const nodes = selectableTextNodes(root)
  const rendered = nodes.map((node) => node.data).join('')
  const offsets = resolveSelectorOffsets(rendered, selector)
  if (offsets === null) return null
  let cursor = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  for (const node of nodes) {
    const next = cursor + node.data.length
    if (startNode === undefined && offsets.start >= cursor && offsets.start <= next) {
      startNode = node
      startOffset = offsets.start - cursor
    }
    if (offsets.end >= cursor && offsets.end <= next) {
      endNode = node
      endOffset = offsets.end - cursor
      break
    }
    cursor = next
  }
  if (startNode === undefined || endNode === undefined) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

export function textOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const position = documentWithCaret.caretPositionFromPoint?.(x, y)
  const range =
    position === undefined || position === null ? documentWithCaret.caretRangeFromPoint?.(x, y) : undefined
  const node = position?.offsetNode ?? range?.startContainer
  const offset = position?.offset ?? range?.startOffset
  if (node === undefined || offset === undefined || !root.contains(node)) return null
  return boundaryOffset(selectableTextNodes(root), node, offset)
}

export function rangesOverlap(left: TextQuoteSelector, right: TextQuoteSelector): boolean {
  return left.start < right.end && right.start < left.end
}
