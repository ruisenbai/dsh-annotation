/** Document-preview selection and whole-file integration owned by the annotation plugin. */
import type { AnnotationController, AnnotationEndpoint } from './controller.ts'
import { captureOfficialRange, compactFileSource, fileSource } from './official-adapters.ts'
import { buildTextIndex, uniqueRangeFromSelector } from './selection.ts'
import {
  sourceKey,
  type AnnotationCreationEntry,
  type FileAnnotationSource,
} from '../shared/annotation-source.ts'
import type { SessionIdentity } from '../shared/types.ts'
import { showOfficialSelectionAction, selectionGesture } from './official-selection-action.tsx'
import { waitForSourceTargetResult, type SourceTargetRead } from './source-target.ts'
import { registerOfficialAnchor, rangeAnchor } from './floating.ts'
import { installOfficialMarkers } from './official-markers.tsx'
import { sha256Hex } from '../shared/snapshot-hash.ts'
import type { AnnotationDraft } from '../shared/types.ts'
import type { TextQuoteSelector } from '../shared/types.ts'
import type { SelectionCapture } from './selection.ts'
import type { HighlightManager } from './highlight.ts'
import type { InputAnnotationProps } from './contract.ts'

interface ControllerRegistry {
  get(sessionId: SessionIdentity): AnnotationController | undefined
}

type FilePreviewSourceLookup = (resourceAddress: string) => FileAnnotationSource | undefined

/** Input fields needed to identify one file preview revision. */
export type WholeFileSourceInput = Parameters<typeof fileSource>[0]

export function parseResourceAddress(
  address: string,
): { sessionId: SessionIdentity; path: string } | undefined {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return undefined
  const slash = address.indexOf('/', prefix.length)
  if (slash < 0) return undefined
  try {
    return {
      sessionId: decodeURIComponent(address.slice(prefix.length, slash)) as SessionIdentity,
      path: decodeURIComponent(address.slice(slash + 1)) as string,
    }
  } catch {
    return undefined
  }
}

export async function digest(value: string | Uint8Array): Promise<string> {
  return sha256Hex(value)
}

function selectableBody(root: HTMLElement): HTMLElement | undefined {
  return (
    root.querySelector<HTMLElement>(
      '[data-code-preview] [data-code-block-content] code, [data-document-markdown], [data-textpreview-plain]',
    ) ?? undefined
  )
}

function fileRangeCapture(
  body: HTMLElement,
  range: Range,
  known: FileAnnotationSource,
): Parameters<AnnotationController['beginSelection']>[0] | undefined {
  const raw = known.snapshot.text
  if (raw === undefined) return undefined
  const visible = captureOfficialRange(body, range, known)
  const rendered = buildTextIndex(body).rendered
  const markdown = known.format === 'markdown'
  const text = rendered
  const rowAt = (node: Node): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement
    return element?.closest<HTMLElement>('[data-textpreview-line], [data-code-preview] pre .line') ?? null
  }
  const lineOf = (row: HTMLElement | null): number | undefined => {
    if (row === null) return undefined
    const value = row.dataset.textpreviewLine
    if (value !== undefined) return Number(value)
    const rows = [...body.querySelectorAll<HTMLElement>('.line')]
    const index = rows.indexOf(row)
    return index < 0 ? undefined : index + 1
  }
  const columnOf = (row: HTMLElement | null, node: Node, offset: number): number | undefined => {
    if (row === null || !row.contains(node)) return undefined
    const prior = document.createRange()
    prior.selectNodeContents(row)
    prior.setEnd(node, offset)
    return prior.toString().length
  }
  let start = visible.quote.start
  let end = visible.quote.end
  let startLine: number | undefined
  let endLine: number | undefined
  let startColumn: number | undefined
  let endColumn: number | undefined
  if (!markdown) {
    const first = rowAt(range.startContainer)
    const last = rowAt(range.endContainer)
    startLine = lineOf(first)
    endLine = lineOf(last)
    startColumn = columnOf(first, range.startContainer, range.startOffset)
    endColumn = columnOf(last, range.endContainer, range.endOffset)
    if (
      startLine === undefined ||
      endLine === undefined ||
      startColumn === undefined ||
      endColumn === undefined
    )
      return undefined
    const lines = new Map<number, string>()
    if (known.snapshot.pages !== undefined) {
      for (const page of known.snapshot.pages) {
        if (page.lines === 0) continue
        page.text.split('\n').forEach((value, index) => lines.set(page.offset + index, value))
      }
    } else {
      raw.split('\n').forEach((value, index) => lines.set(index + 1, value))
    }
    if (startLine < 1 || endLine < startLine) return undefined
    const pieces: string[] = []
    for (let number = startLine; number <= endLine; number += 1) {
      const rawLine = lines.get(number)
      if (rawLine === undefined) return undefined
      // Plain previews render a selectable line separator inside the final row.
      const finalText = last?.textContent ?? ''
      const line =
        number === endLine && endColumn > rawLine.length && finalText === `${rawLine}\n`
          ? `${rawLine}\n`
          : rawLine
      pieces.push(
        number === startLine && number === endLine
          ? line.slice(startColumn, endColumn)
          : number === startLine
            ? line.slice(startColumn)
            : number === endLine
              ? line.slice(0, endColumn)
              : line,
      )
    }
    if (pieces.join('\n') !== visible.quote.exact) return undefined
  }
  if (text.slice(start, end) !== visible.quote.exact || end <= start) return undefined
  const quote = Object.freeze({
    exact: visible.quote.exact,
    prefix: text.slice(Math.max(0, start - 32), start),
    suffix: text.slice(end, end + 32),
    start,
    end,
  })
  const source: FileAnnotationSource = Object.freeze({
    ...known,
    wholeFile: false,
    ...(markdown
      ? {}
      : { startLine: startLine!, endLine: endLine!, startColumn: startColumn!, endColumn: endColumn! }),
  })
  return Object.freeze({
    source: compactFileSource(source, quote, markdown ? 'rendered' : 'raw'),
    quote,
    rect: rangeAnchor(range).rect,
  })
}

function nearestDocumentRoot(selection: Selection): HTMLElement | undefined {
  const node = selection.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-textpreview-url]') ?? undefined
}

function rowBoundary(
  row: HTMLElement,
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue
    last = node
    if (remaining <= node.length) return { node, offset: remaining }
    remaining -= node.length
  }
  return remaining === 0 && last !== null ? { node: last, offset: last.length } : null
}

function fileRangeFrom(
  root: HTMLElement,
  source: FileAnnotationSource,
  quote: TextQuoteSelector,
): Range | HTMLElement | null {
  if (source.wholeFile) return root
  const body = selectableBody(root)
  if (body === undefined) return null
  if (
    (source.snapshot.version === 2 && source.snapshot.coordinateSpace === 'rendered') ||
    (source.snapshot.version === 1 && source.format === 'markdown')
  )
    return uniqueRangeFromSelector(body, quote)
  const line = (number: number): HTMLElement | null =>
    body.querySelector<HTMLElement>(`[data-textpreview-line="${number}"]`) ??
    body.querySelectorAll<HTMLElement>('.line').item(number - 1)
  if (
    source.startLine !== undefined &&
    source.endLine !== undefined &&
    source.startColumn !== undefined &&
    source.endColumn !== undefined
  ) {
    const first = line(source.startLine)
    const last = line(source.endLine)
    if (first !== null && last !== null) {
      const start = rowBoundary(first, source.startColumn)
      const end = rowBoundary(last, source.endColumn)
      if (start !== null && end !== null) {
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        if (range.toString() === quote.exact) return range
      }
    }
    return null
  }
  const fallback = uniqueRangeFromSelector(body, quote)
  return fallback?.toString() === quote.exact ? fallback : null
}

function fileRange(root: HTMLElement, item: AnnotationDraft): Range | HTMLElement | null {
  return item.source?.kind === 'file' ? fileRangeFrom(root, item.source, item.quote) : null
}

function fileTargetRead(root: HTMLElement, item: AnnotationDraft): SourceTargetRead<Range | HTMLElement> {
  const target = fileRange(root, item)
  if (target !== null) return { status: 'ready', value: target }
  const source = item.source
  if (source?.kind !== 'file') return { status: 'unmatched' }
  const body = selectableBody(root)
  if (body === undefined) return { status: 'pending' }
  if (
    source.startLine !== undefined &&
    source.endLine !== undefined &&
    source.startColumn !== undefined &&
    source.endColumn !== undefined &&
    source.snapshot.coordinateSpace !== 'rendered' &&
    !(source.snapshot.version === 1 && source.format === 'markdown')
  ) {
    const line = (number: number): HTMLElement | null =>
      body.querySelector<HTMLElement>(`[data-textpreview-line="${number}"]`) ??
      body.querySelectorAll<HTMLElement>('.line').item(number - 1)
    return line(source.startLine) === null || line(source.endLine) === null
      ? { status: 'pending' }
      : { status: 'unmatched' }
  }
  const rendered = buildTextIndex(body).rendered
  return rendered.length < item.quote.end + item.quote.suffix.length
    ? { status: 'pending' }
    : { status: 'unmatched' }
}

/** Install native file selection and whole-file button behavior for one enabled plugin lifetime. */
export function installDocumentIntegration(
  registry: ControllerRegistry,
  translate: InputAnnotationProps['t'],
  getPreviewSource?: FilePreviewSourceLookup,
  highlights?: HighlightManager,
): () => void {
  let disposeBar: (() => void) | undefined
  let pendingSelection: {
    readonly root: HTMLElement
    readonly range: Range
    readonly text: string
    readonly epoch: number
  } | null = null
  let selectionEpoch = 0
  const endpointDisposers = new Map<HTMLElement, { readonly key: string; readonly dispose: () => void }>()

  const locateTarget = async (
    root: HTMLElement,
    annotationId: Parameters<AnnotationController['navigate']>[0],
    controller: AnnotationController,
    navigationEpoch: number,
    current: FileAnnotationSource,
    signal: AbortSignal,
    pulse: (element: HTMLElement, range: Range | null) => void,
  ): Promise<'shown' | 'unmatched' | 'unavailable' | 'cancelled'> => {
    const item = controller
      .getSnapshot()
      .annotations.find((candidate) => candidate.annotationId === annotationId)
    if (controller.getSnapshot().navigationEpoch !== navigationEpoch) return 'cancelled'
    if (
      !root.isConnected ||
      signal.aborted ||
      item?.source?.kind !== 'file' ||
      item.source.expired === true ||
      item.source.resourceVersion !== current.resourceVersion
    )
      return 'unavailable'
    const target = await waitForSourceTargetResult(
      root,
      () => fileTargetRead(root, item),
      controller,
      navigationEpoch,
      signal,
    )
    if (controller.getSnapshot().navigationEpoch !== navigationEpoch) return 'cancelled'
    if (signal.aborted || !root.isConnected) return 'unavailable'
    if (target.status !== 'ready') return target.status
    const element =
      target.value instanceof Range ? (target.value.startContainer.parentElement ?? root) : target.value
    if (controller.getSnapshot().navigationEpoch !== navigationEpoch) return 'cancelled'
    root.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    pulse(element, target.value instanceof Range ? target.value : null)
    return 'shown'
  }
  const registerEndpoint = (root: HTMLElement, source: FileAnnotationSource): void => {
    const controller = registry.get(source.sessionId)
    if (controller === undefined) return
    const key = sourceKey({ source })
    const existing = endpointDisposers.get(root)
    if (existing?.key === key) return
    existing?.dispose()
    const abort = new AbortController()
    let clearPulse: (() => void) | undefined
    const pulse = (element: HTMLElement, range: Range | null): void => {
      clearPulse?.()
      const owner = `file-navigation:${key}`
      if (range !== null) highlights?.activate(owner, range)
      element.dataset.dshOfficialFileLocated = ''
      const timer = window.setTimeout(() => clearPulse?.(), 1200)
      clearPulse = () => {
        window.clearTimeout(timer)
        delete element.dataset.dshOfficialFileLocated
        highlights?.activate(owner, null)
        clearPulse = undefined
      }
    }
    const endpoint: AnnotationEndpoint = {
      reveal: () => undefined,
      annotateAll: () => undefined,
      revealSource: (annotationId, navigationEpoch) =>
        locateTarget(root, annotationId, controller, navigationEpoch, source, abort.signal, pulse),
    }
    const compact = compactFileSource(source)
    const stopLegacy = controller.registerSourceEndpoint({ source }, endpoint)
    const stopCompact = controller.registerSourceEndpoint({ source: compact }, endpoint)
    const resolve = (capture: SelectionCapture): Range | HTMLElement | null => {
      const found =
        capture.source?.kind === 'file' && capture.source.resourceVersion === source.resourceVersion
          ? fileRangeFrom(root, capture.source, capture.quote)
          : null
      return found instanceof HTMLElement
        ? (root.querySelector<HTMLElement>('[data-official-file-annotate]') ?? found)
        : found
    }
    const stopAnchor = registerOfficialAnchor(sourceKey({ source: compact }), resolve)
    const stopLegacyAnchor = registerOfficialAnchor(key, resolve)
    const extraKeys = new Set([key, sourceKey({ source: compact })])
    const legacyStops: (() => void)[] = []
    const registerHistorical = (): void => {
      for (const item of controller.getSnapshot().annotations) {
        if (
          item.source?.kind !== 'file' ||
          item.source.snapshot.version !== 1 ||
          item.source.path !== source.path ||
          item.source.resourceVersion !== source.resourceVersion
        )
          continue
        const historicalKey = sourceKey(item)
        if (extraKeys.has(historicalKey)) continue
        extraKeys.add(historicalKey)
        legacyStops.push(
          controller.registerSourceEndpoint(item, endpoint),
          registerOfficialAnchor(historicalKey, resolve),
        )
      }
    }
    const stopHistorical = controller.subscribe(registerHistorical)
    registerHistorical()
    const stopMarkers = installOfficialMarkers(
      root,
      controller,
      (item) =>
        item.source?.kind === 'file' &&
        item.source.path === source.path &&
        item.source.resourceVersion === source.resourceVersion,
      (item) =>
        item.source?.kind === 'file' && item.source.wholeFile
          ? (root.querySelector<HTMLElement>('[data-official-file-annotate]') ?? root)
          : fileRange(root, item),
      translate,
      highlights,
    )
    endpointDisposers.set(root, {
      key,
      dispose: () => {
        abort.abort()
        clearPulse?.()
        stopLegacy()
        stopCompact()
        legacyStops.forEach((stop) => stop())
        stopAnchor()
        stopLegacyAnchor()
        stopHistorical()
        stopMarkers()
      },
    })
  }
  const tryPendingSelection = (): void => {
    const pending = pendingSelection
    if (pending === null || !pending.root.isConnected || pending.epoch !== selectionEpoch) return
    const selection = window.getSelection()
    if (selection === null || selection.isCollapsed || selection.toString() !== pending.text) {
      pendingSelection = null
      return
    }
    const address = pending.root.dataset.textpreviewUrl
    const known = address === undefined ? undefined : getPreviewSource?.(address)
    const body = selectableBody(pending.root)
    if (known === undefined || body === undefined) return
    if (!body.contains(pending.range.startContainer) || !body.contains(pending.range.endContainer)) {
      pendingSelection = null
      return
    }
    try {
      const capture = fileRangeCapture(body, pending.range, known)
      if (capture === undefined || capture.source?.kind !== 'file') return
      pendingSelection = null
      registerEndpoint(pending.root, known)
      showBar(capture)
    } catch {
      pendingSelection = null
    }
  }
  const syncEndpoints = (): void => {
    const roots = new Set(document.querySelectorAll<HTMLElement>('[data-textpreview-url]'))
    for (const [root, entry] of endpointDisposers) {
      if (!roots.has(root)) {
        entry.dispose()
        endpointDisposers.delete(root)
      }
    }
    for (const root of roots) {
      const address = root.dataset.textpreviewUrl
      const source = address === undefined ? undefined : getPreviewSource?.(address)
      if (source !== undefined) registerEndpoint(root, source)
    }
    tryPendingSelection()
  }

  const closeBar = (): void => {
    disposeBar?.()
    disposeBar = undefined
  }
  const showBar = (capture: Parameters<AnnotationController['beginSelection']>[0]): void => {
    closeBar()
    disposeBar = showOfficialSelectionAction(capture, translate('selection.annotate'), () => {
      if (capture.source?.kind === 'file') registry.get(capture.source.sessionId)?.beginSelection(capture)
    })
  }

  const captureSelection = (event: Event): void => {
    if (!selectionGesture(event)) return
    queueMicrotask(() => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const root = nearestDocumentRoot(selection)
      if (root === undefined) return
      const address = root.dataset.textpreviewUrl
      if (address === undefined) return
      const parsed = parseResourceAddress(address)
      if (parsed === undefined) return
      if (registry.get(parsed.sessionId) === undefined) return
      const range = selection.getRangeAt(0).cloneRange()
      const body = selectableBody(root)
      if (body === undefined || !body.contains(range.startContainer) || !body.contains(range.endContainer))
        return
      selectionEpoch += 1
      pendingSelection = { root, range, text: selection.toString(), epoch: selectionEpoch }
      closeBar()
      tryPendingSelection()
    })
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      pendingSelection = null
      selectionEpoch += 1
      closeBar()
    }
  }
  const onSelectionChange = (): void => {
    if (window.getSelection()?.isCollapsed !== false) closeBar()
    if (pendingSelection !== null && window.getSelection()?.toString() !== pendingSelection.text) {
      pendingSelection = null
      selectionEpoch += 1
    }
  }
  document.addEventListener('pointerup', captureSelection, true)
  document.addEventListener('keyup', captureSelection, true)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onKeyDown, true)
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(syncEndpoints)
  const observed = document.body ?? document.documentElement
  observer?.observe(observed, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-textpreview-url', 'disabled'],
  })
  syncEndpoints()
  return () => {
    document.removeEventListener('pointerup', captureSelection, true)
    document.removeEventListener('keyup', captureSelection, true)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('keydown', onKeyDown, true)
    observer?.disconnect()
    for (const entry of endpointDisposers.values()) entry.dispose()
    endpointDisposers.clear()
    pendingSelection = null
    closeBar()
  }
}

/** Keep the creation-entry type available to action adapters without a controller dependency. */
export type OfficialDocumentEntry = AnnotationCreationEntry
