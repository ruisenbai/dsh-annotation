import { stripMachineMarkers } from '../shared/model-ack.ts'
import type { FileAnnotationSource, OfficialDiffAnnotationSource } from '../shared/annotation-source.ts'
import type {
  AnnotationSelectionCapture,
  MessageIdentity,
  StructuredSelection,
  TextQuoteSelector,
} from '../shared/types.ts'

export type SelectionCapture = AnnotationSelectionCapture

/** 文本块数组（data.blocks）中，位于指定渲染偏移之前的文本块下标（近似映射）。 */
export function textBlockIndexOf(
  blocks: readonly { kind: string; text?: unknown }[],
  offset: number,
): number | undefined {
  let cursor = 0
  let index = 0
  for (const block of blocks) {
    if (block.kind === 'text' && typeof block.text === 'string') {
      const length = stripMachineMarkers(block.text).length
      if (offset < cursor + length) return index
      cursor += length
    }
    index += 1
  }
  return undefined
}

function acceptedTextNode(node: Node, root: HTMLElement): node is Text {
  if (node.nodeType !== Node.TEXT_NODE || node.textContent === null) return false
  const text = node as Text
  const parent = text.parentElement
  if (parent === null || !root.contains(parent)) return false
  if (
    text.data.trim() === '' &&
    parent === root &&
    !(root.matches('code') && root.closest('[data-code-preview]') !== null)
  )
    return false
  if (
    parent.closest(
      'script, style, [aria-hidden="true"], [aria-live], [role="status"], [data-variant="think"], [data-dsh-annotation-ignore="true"]',
    ) !== null
  )
    return false
  const button = parent.closest('button')
  if (button === null) return true
  // Harness MarkdownFileLink uses both CSS Module locals; copy/action buttons use neither pair.
  // Match local names, not generated hashes, so a production CSS rebuild preserves quote offsets.
  const classes = [...button.classList]
  return (
    button.hasAttribute('title') &&
    classes.some((name) => /(?:^|_)fileMention(?:_|$)/.test(name)) &&
    classes.some((name) => /(?:^|_)fileLink(?:_|$)/.test(name))
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

/** Text and offsets for one mounted reply body; its owner invalidates it after DOM text changes. */
export class TextIndex {
  private valid = true

  constructor(
    readonly root: HTMLElement,
    readonly nodes: readonly Text[],
    readonly rendered: string,
    readonly ends: readonly number[],
  ) {}

  invalidate(): void {
    this.valid = false
  }

  isCurrent(root: HTMLElement): boolean {
    return this.valid && this.root === root && root.isConnected
  }
}

/** Build the text offset index once for all selectors in a reply measurement. */
export function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes = selectableTextNodes(root)
  const parts: string[] = []
  const ends: number[] = []
  let end = 0
  for (const node of nodes) {
    parts.push(node.data)
    end += node.data.length
    ends.push(end)
  }
  return new TextIndex(root, nodes, parts.join(''), ends)
}

function firstEnd(ends: readonly number[], offset: number, strict: boolean): number {
  let lower = 0
  let upper = ends.length
  while (lower < upper) {
    const middle = (lower + upper) >>> 1
    if (strict ? ends[middle]! <= offset : ends[middle]! < offset) lower = middle + 1
    else upper = middle
  }
  return lower
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

/** Capture a visible Range whose identity belongs to an official file or turn-Diff snapshot. */
export function captureOfficialSelection(
  root: HTMLElement,
  range: Range,
  source: FileAnnotationSource | OfficialDiffAnnotationSource,
): SelectionCapture {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    throw new Error('selection must stay inside one official preview')
  }
  if (range.toString().trim().length === 0) throw new Error('selection must contain text')
  const index = buildTextIndex(root)
  const start = boundaryOffset(index.nodes, range.startContainer, range.startOffset)
  const end = boundaryOffset(index.nodes, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start)
    throw new Error('selection boundaries are not addressable')
  const exact = index.rendered.slice(start, end)
  const rect = range.getBoundingClientRect()
  const structure = structuredSelection(range)
  return Object.freeze({
    source,
    quote: Object.freeze({
      exact,
      prefix: index.rendered.slice(Math.max(0, start - 32), start),
      suffix: index.rendered.slice(end, end + 32),
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

/** Rebuild a Range from the current reply text, optionally reusing its indexed text nodes. */
export function rangeFromSelector(
  root: HTMLElement,
  selector: TextQuoteSelector,
  textIndex?: TextIndex,
): Range | null {
  if (textIndex !== undefined && !root.isConnected) return null
  const index = textIndex?.isCurrent(root) ? textIndex : buildTextIndex(root)
  const offsets = resolveSelectorOffsets(index.rendered, selector)
  if (offsets === null) return null
  const startIndex = firstEnd(index.ends, offsets.start, true)
  const endIndex = firstEnd(index.ends, offsets.end, false)
  const startNode = index.nodes[startIndex]
  const endNode = index.nodes[endIndex]
  if (startNode === undefined || endNode === undefined) return null
  if (!root.contains(startNode) || !root.contains(endNode))
    return textIndex === undefined ? null : rangeFromSelector(root, selector)
  const startOffset = offsets.start - (index.ends[startIndex - 1] ?? 0)
  const endOffset = offsets.end - (index.ends[endIndex - 1] ?? 0)
  if (startOffset > startNode.length || endOffset > endNode.length)
    return textIndex === undefined ? null : rangeFromSelector(root, selector)
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range.toString() === selector.exact
    ? range
    : textIndex === undefined
      ? null
      : rangeFromSelector(root, selector)
}

/** Resolve a quote only when its saved offset or its surrounding context selects one occurrence. */
export function uniqueRangeFromSelector(root: HTMLElement, selector: TextQuoteSelector): Range | null {
  const rendered = buildTextIndex(root).rendered
  const contextMatches = (start: number): boolean => {
    const end = start + selector.exact.length
    return (
      rendered.slice(Math.max(0, start - selector.prefix.length), start) === selector.prefix &&
      rendered.slice(end, end + selector.suffix.length) === selector.suffix
    )
  }
  if (rendered.slice(selector.start, selector.end) === selector.exact && contextMatches(selector.start))
    return rangeFromSelector(root, selector)
  const candidates: number[] = []
  for (let at = rendered.indexOf(selector.exact); at >= 0; at = rendered.indexOf(selector.exact, at + 1)) {
    if (contextMatches(at)) candidates.push(at)
    if (candidates.length > 1) return null
  }
  if (candidates.length !== 1) return null
  const start = candidates[0]!
  return rangeFromSelector(root, { ...selector, start, end: start + selector.exact.length })
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
