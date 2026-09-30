/** Official turn-Diff selection and annotation actions in the Host sidebar. */
import { IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionIdentity } from '../shared/types.ts'
import type { OfficialDiffAnnotationSource, OfficialDiffSnapshot } from '../shared/annotation-source.ts'
import { officialDiffLines, officialDiffQuote } from '../shared/official-source.ts'
import { officialDiffSource, parseOfficialDiffResponse, officialDiffUrl } from './official-adapters.ts'
import type { AnnotationController, AnnotationEndpoint } from './controller.ts'
import { compactOfficialDiffSource } from './official-adapters.ts'
import { showOfficialSelectionAction, selectionGesture } from './official-selection-action.tsx'
import { waitForSourceTarget } from './source-target.ts'
import { installOfficialMarkers } from './official-markers.tsx'
import { registerOfficialAnchor, rangeAnchor } from './floating.ts'
import { sourceKey } from '../shared/annotation-source.ts'
import type { AnnotationDraft } from '../shared/types.ts'
import type { HighlightManager } from './highlight.ts'
import { showSourceFlash, SOURCE_FLASH_MS } from './source-flash.ts'
import type { AnnotationCreationToggle } from './components/FileWholeAnnotationAction.tsx'
import type { InputAnnotationProps } from './contract.ts'
import type { SelectionCapture } from './selection.ts'

export interface OfficialDiffContext {
  readonly sessionId: SessionIdentity
  readonly seq: number
  readonly turn: number
  readonly fileIndex: number
}

interface OfficialDiffLabels {
  readonly annotate: string
  readonly title: string
  readonly annotation: string
  readonly save: string
  readonly cancel: string
  readonly edit: string
  readonly locate: string
  readonly wholeFile: string
  readonly failed: string
  readonly status: Readonly<Record<'draft' | 'queued' | 'sent' | 'processed', string>>
  readonly t?: InputAnnotationProps['t']
}

interface OfficialDiffRegistry {
  get(sessionId: SessionIdentity): AnnotationController | undefined
}

/** Read coordinates only from the Host's same-origin changed-file action or comparison URL. */
export function parseOfficialDiffContext(url: string): Omit<OfficialDiffContext, 'turn'> | undefined {
  try {
    const parsed = new URL(url, document.baseURI)
    const base = new URL(document.baseURI)
    if (parsed.origin !== base.origin || !/\/api\/changes\.(?:open|diff)$/u.test(parsed.pathname))
      return undefined
    const one = (key: string): string | undefined => {
      const values = parsed.searchParams.getAll(key)
      return values.length === 1 ? values[0] : undefined
    }
    const sessionId = one('sessionId')
    const rawSeq = one('seq')
    const rawIndex = one('index')
    if (sessionId === undefined || sessionId.length === 0 || rawSeq === undefined || rawIndex === undefined)
      return undefined
    if (!/^\d+$/u.test(rawSeq) || !/^\d+$/u.test(rawIndex)) return undefined
    const seq = Number(rawSeq)
    const fileIndex = Number(rawIndex)
    if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(fileIndex)) return undefined
    return { sessionId: sessionId as SessionIdentity, seq, fileIndex }
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`official Diff request failed with ${response.status}`)
  return response.json()
}

/** Load and validate one official summary-backed Diff snapshot; current disk is never read. */
export async function loadOfficialDiff(
  actionUrl: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ readonly context: OfficialDiffContext; readonly snapshot: OfficialDiffSnapshot }> {
  const base = parseOfficialDiffContext(actionUrl)
  if (base === undefined) throw new Error('official Diff action URL has incomplete coordinates')
  const summaryUrl = `api/changes.summary?${new URLSearchParams({ sessionId: base.sessionId, seq: String(base.seq) })}`
  const diffUrl = officialDiffUrl(base.sessionId, base.seq, base.fileIndex)
  const [summaryValue, diffValue] = await Promise.all([
    responseJson(await fetcher(summaryUrl, signal === undefined ? undefined : { signal })),
    responseJson(await fetcher(diffUrl, signal === undefined ? undefined : { signal })),
  ])
  if (!isRecord(summaryValue)) throw new Error('official changes summary is not an object')
  const turn = summaryValue.turn
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1)
    throw new Error('official changes summary has no turn')
  const files = summaryValue.files
  if (!Array.isArray(files) || !isRecord(files[base.fileIndex]))
    throw new Error('official changes summary does not list this file index')
  const listed = files[base.fileIndex]
  if (!isRecord(diffValue)) throw new Error('official changes Diff is not an object')
  if (listed.path !== diffValue.path || listed.display !== diffValue.display)
    throw new Error('official changes Diff does not match its announced file')
  if ((listed.binary === true || listed.oversized === true) && diffValue.kind === 'text')
    throw new Error('official changes Diff contradicts its announced file type')
  const snapshot = parseOfficialDiffResponse(diffValue, { ...base, turn })
  return { context: { ...base, turn }, snapshot }
}

function sourceFor(
  snapshot: OfficialDiffSnapshot,
  side: 'old' | 'new' | 'file',
  entry: 'sidebar',
  range?: {
    readonly startLine: number
    readonly endLine: number
    readonly startColumn?: number
    readonly endColumn?: number
  },
): OfficialDiffAnnotationSource {
  return officialDiffSource(snapshot, side, entry, range)
}

/** Load a whole-file Diff anchor and hand it to the owning Session controller. */
export async function beginWholeDiff(
  actionUrl: string,
  entry: 'sidebar',
  begin: (source: OfficialDiffAnnotationSource, rect: DOMRect) => void,
  rect: DOMRect,
  signal?: AbortSignal,
): Promise<void> {
  const loaded = await loadOfficialDiff(actionUrl, fetch, signal)
  if (signal?.aborted) return
  const side = loaded.snapshot.kind === 'text' ? (loaded.snapshot.after ? 'new' : 'old') : 'file'
  begin(sourceFor(loaded.snapshot, side, entry), rect)
}

interface VisualDiffLine {
  readonly side: 'old' | 'new'
  readonly line: number
  readonly code: HTMLElement
}

function visualDiffLines(root: HTMLElement, range: Range): VisualDiffLine[] {
  const values: VisualDiffLine[] = []
  for (const row of root.querySelectorAll<HTMLElement>('[data-diff-line]')) {
    const splitColumn = row.closest<HTMLElement>('[data-diff-side]')?.dataset.diffSide
    const splitRow =
      row.closest<HTMLElement>('[data-review-view="split"]') !== null && splitColumn === undefined
    const cells = splitRow ? [...row.children] : [row]
    for (const [index, cell] of cells.entries()) {
      if (!(cell instanceof HTMLElement)) continue
      const code = splitRow ? cell.lastElementChild : row.lastElementChild
      const number = splitRow
        ? cell.firstElementChild
        : row.children[splitColumn !== undefined || row.dataset.diffLine === 'del' ? 0 : 1]
      if (
        !(code instanceof HTMLElement) ||
        !(number instanceof HTMLElement) ||
        !/^\d+$/u.test(number.textContent ?? '')
      )
        continue
      if (!range.intersectsNode(code)) continue
      const side =
        splitColumn === 'left' ||
        (splitRow && index === 0) ||
        (!splitRow && splitColumn === undefined && row.dataset.diffLine === 'del')
          ? 'old'
          : 'new'
      values.push({ side, line: Number(number.textContent), code })
    }
  }
  return values
}

function columnAt(code: HTMLElement, node: Node, offset: number): number | undefined {
  if (!code.contains(node)) return undefined
  try {
    const prior = document.createRange()
    prior.selectNodeContents(code)
    prior.setEnd(node, offset)
    return prior.toString().length
  } catch {
    return undefined
  }
}

/** Capture a selected range from the official sidebar review. */
export async function captureOfficialDiffRange(
  root: HTMLElement,
  range: Range,
  actionUrl: string,
  entry: 'sidebar',
  begin: (
    source: OfficialDiffAnnotationSource,
    capture: Parameters<AnnotationController['beginSelection']>[0],
  ) => void,
  signal?: AbortSignal,
): Promise<void> {
  const lines = visualDiffLines(root, range)
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (first === undefined || last === undefined || lines.some((line) => line.side !== first.side)) return
  const loaded = await loadOfficialDiff(actionUrl, fetch, signal)
  if (signal?.aborted || !root.isConnected) return
  if (loaded.snapshot.kind !== 'text') return
  const snapshotLines = new Map(
    officialDiffLines(loaded.snapshot, first.side).map((line) => [line.line, line.text]),
  )
  if (lines.some((line) => snapshotLines.get(line.line) !== line.code.textContent)) return
  const normalizedStart = Math.min(...lines.map((line) => line.line))
  const normalizedEnd = Math.max(...lines.map((line) => line.line))
  const startColumn = columnAt(first.code, range.startContainer, range.startOffset)
  const endColumn = columnAt(last.code, range.endContainer, range.endOffset)
  if (startColumn === undefined || endColumn === undefined) return
  const side = first.side
  const source = sourceFor(loaded.snapshot, side, entry, {
    startLine: normalizedStart,
    endLine: normalizedEnd,
    startColumn,
    endColumn,
  })
  const quote = officialDiffQuote(source)
  const rect = rangeAnchor(range).rect
  begin(compactOfficialDiffSource(source, quote), {
    source: compactOfficialDiffSource(source, quote),
    quote,
    rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
  })
}

/** The review-slot props used by the action button. */
type ReviewActionProps = Pick<PropsRuntime<'deliverables.review.file.actions'>, 'actionUrl' | 'pending'> &
  PropsLocale<'dshAnnotation'>

/** Create a review-slot action that keeps the source inside the official Diff snapshot. */
export function createDiffReviewAction(
  begin: (source: OfficialDiffAnnotationSource, rect: DOMRect) => void,
  creationEnabled?: AnnotationCreationToggle,
): (props: ReviewActionProps) => ReactNode {
  return function DiffReviewAction({ actionUrl, pending, t }: ReviewActionProps): ReactNode {
    const enabled = useSyncExternalStore(
      creationEnabled?.subscribe ?? (() => () => undefined),
      creationEnabled?.getSnapshot ?? (() => true),
      creationEnabled?.getSnapshot ?? (() => true),
    )
    const label = t('selection.annotateOfficial')
    const request = useRef<AbortController | null>(null)
    const [loading, setLoading] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => {
      setLoading(false)
      setFailed(false)
      return () => request.current?.abort()
    }, [actionUrl])
    if (!enabled) return <span hidden data-dsh-official-diff-source="" data-action-url={actionUrl} />
    return (
      <button
        type="button"
        className="dia-official-diff-action"
        aria-label={failed ? t('source.unavailable') : label}
        title={failed ? t('source.unavailable') : label}
        aria-busy={loading}
        disabled={pending || loading}
        data-official-diff-annotate=""
        data-dsh-official-diff-source=""
        data-action-url={actionUrl}
        onClick={(event) => {
          request.current?.abort()
          const abort = new AbortController()
          request.current = abort
          setLoading(true)
          setFailed(false)
          const button = event.currentTarget
          void beginWholeDiff(
            actionUrl,
            'sidebar',
            (source, rect) => {
              if (
                button.isConnected &&
                button.dataset.actionUrl === actionUrl &&
                button.closest('[hidden], [inert], [aria-hidden="true"]') === null
              )
                begin(source, rect)
            },
            button.getBoundingClientRect(),
            abort.signal,
          )
            .catch(() => {
              if (!abort.signal.aborted) setFailed(true)
            })
            .finally(() => {
              if (!abort.signal.aborted) setLoading(false)
            })
        }}
      >
        <IconEditOutlineRegular size={15} />
      </button>
    )
  }
}

function findReviewCode(root: HTMLElement, side: 'old' | 'new', number: number): HTMLElement | null {
  for (const row of root.querySelectorAll<HTMLElement>('[data-diff-line]')) {
    const column = row.closest<HTMLElement>('[data-diff-side]')?.dataset.diffSide
    if (column !== undefined && column !== (side === 'old' ? 'left' : 'right')) continue
    const split = row.closest<HTMLElement>('[data-review-view="split"]') !== null && column === undefined
    if (split) {
      const cell = row.children[side === 'old' ? 0 : 1]
      if (cell instanceof HTMLElement && Number(cell.firstElementChild?.textContent) === number)
        return cell.lastElementChild instanceof HTMLElement ? cell.lastElementChild : null
      continue
    }
    if (
      column === undefined &&
      ((row.dataset.diffLine === 'del' && side !== 'old') ||
        (row.dataset.diffLine === 'add' && side !== 'new'))
    )
      continue
    const index = column !== undefined || side === 'old' ? 0 : 1
    if (Number(row.children[index]?.textContent) === number)
      return row.lastElementChild instanceof HTMLElement ? row.lastElementChild : null
  }
  return null
}

function codeBoundary(
  code: HTMLElement,
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
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

function diffRanges(
  root: HTMLElement,
  item: Pick<AnnotationDraft, 'source' | 'quote'>,
  snapshot: OfficialDiffSnapshot,
): readonly Range[] | null {
  const source = item.source
  if (
    source?.kind !== 'official-diff' ||
    source.wholeFile ||
    source.side === 'file' ||
    source.startLine === undefined ||
    source.endLine === undefined ||
    source.snapshot.hash !== snapshot.hash
  )
    return null
  const expected = new Map(officialDiffLines(snapshot, source.side).map((line) => [line.line, line.text]))
  const ranges: Range[] = []
  const selected: string[] = []
  for (let line = source.startLine; line <= source.endLine; line += 1) {
    const code = findReviewCode(root, source.side, line)
    const text = code?.textContent
    if (code === null || text === undefined || text !== expected.get(line)) return null
    const start = line === source.startLine ? (source.startColumn ?? 0) : 0
    const end = line === source.endLine ? (source.endColumn ?? text.length) : text.length
    if (end < start || end > text.length) return null
    selected.push(text.slice(start, end))
    if (end === start) continue
    const first = codeBoundary(code, start)
    const last = codeBoundary(code, end)
    if (first === null || last === null) return null
    const range = document.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset)
    if (range.toString() !== text.slice(start, end)) return null
    ranges.push(range)
  }
  return selected.join('\n') === item.quote.exact && ranges.length > 0 ? ranges : null
}

async function revealDiff(
  root: HTMLElement,
  item: AnnotationDraft,
  snapshot: OfficialDiffSnapshot,
  controller: AnnotationController,
  navigationEpoch: number,
  signal: AbortSignal,
  pulse: (target: HTMLElement, ranges: readonly Range[]) => void,
): Promise<'shown' | 'unmatched' | 'unavailable' | 'cancelled'> {
  const source = item.source
  if (source?.kind !== 'official-diff' || source.snapshot.hash !== snapshot.hash) return 'unmatched'
  const ranges = source.wholeFile
    ? []
    : await waitForSourceTarget(
        root,
        () => diffRanges(root, item, snapshot),
        controller,
        navigationEpoch,
        signal,
      )
  if (controller.getSnapshot().navigationEpoch !== navigationEpoch || signal.aborted) return 'cancelled'
  if (!root.isConnected) return 'unavailable'
  if (ranges === null) return 'unmatched'
  const target = ranges.at(0)?.startContainer.parentElement ?? root
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  pulse(target, ranges)
  return 'shown'
}

interface MountedDiff {
  readonly url: string
  readonly dispose: () => void
}

function registerDiffView(
  root: HTMLElement,
  actionUrl: string,
  registry: OfficialDiffRegistry,
  labels: OfficialDiffLabels,
  highlights: HighlightManager | undefined,
  mounted: Map<HTMLElement, MountedDiff>,
): void {
  const existing = mounted.get(root)
  if (existing?.url === actionUrl) return
  existing?.dispose()
  const abort = new AbortController()
  const releases: (() => void)[] = []
  let clearPulse: (() => void) | undefined
  const pulse = (target: HTMLElement, ranges: readonly Range[]): void => {
    clearPulse?.()
    target.dataset.dshOfficialDiffLocated = ''
    const owner = `diff-navigation:${actionUrl}`
    const flash = showSourceFlash(root, ranges)
    if (flash === null) highlights?.activate(owner, ranges)
    const timer = window.setTimeout(() => clearPulse?.(), SOURCE_FLASH_MS)
    clearPulse = () => {
      window.clearTimeout(timer)
      flash?.()
      delete target.dataset.dshOfficialDiffLocated
      if (flash === null) highlights?.activate(owner, null)
      clearPulse = undefined
    }
  }
  const dispose = (): void => {
    abort.abort()
    clearPulse?.()
    for (const release of releases) release()
    if (mounted.get(root)?.dispose === dispose) mounted.delete(root)
  }
  mounted.set(root, { url: actionUrl, dispose })
  void loadOfficialDiff(actionUrl, fetch, abort.signal)
    .then(({ snapshot }) => {
      if (abort.signal.aborted || !root.isConnected || mounted.get(root)?.dispose !== dispose) return
      const controller = registry.get(snapshot.sessionId)
      if (controller === undefined) return
      const sides: readonly ('old' | 'new' | 'file')[] =
        snapshot.kind === 'text'
          ? [snapshot.before ? 'old' : null, snapshot.after ? 'new' : null].filter(
              (side): side is 'old' | 'new' => side !== null,
            )
          : ['file']
      for (const side of sides) {
        const source = sourceFor(snapshot, side, 'sidebar')
        const compact = compactOfficialDiffSource(source)
        const matches = (item: AnnotationDraft): boolean =>
          item.source?.kind === 'official-diff' &&
          item.source.side === side &&
          item.source.snapshot.sessionId === snapshot.sessionId &&
          item.source.snapshot.seq === snapshot.seq &&
          item.source.snapshot.fileIndex === snapshot.fileIndex &&
          item.source.snapshot.hash === snapshot.hash
        const endpoint: AnnotationEndpoint = {
          reveal: () => undefined,
          annotateAll: () => undefined,
          revealSource: async (annotationId, navigationEpoch) => {
            const item = controller
              .getSnapshot()
              .annotations.find((candidate) => candidate.annotationId === annotationId)
            return item === undefined || !matches(item)
              ? 'unmatched'
              : revealDiff(root, item, snapshot, controller, navigationEpoch, abort.signal, pulse)
          },
        }
        if (root.matches('[data-changes-review]')) {
          releases.push(controller.registerSourceEndpoint({ source }, endpoint))
          releases.push(controller.registerSourceEndpoint({ source: compact }, endpoint))
        }
        const anchor = (capture: SelectionCapture): Range | HTMLElement | null => {
          if (
            capture.source?.kind === 'official-diff' &&
            capture.source.wholeFile &&
            capture.source.snapshot.hash === snapshot.hash
          )
            return root.querySelector<HTMLElement>('[data-official-diff-annotate]') ?? root
          if (capture.source?.kind !== 'official-diff' || capture.source.snapshot.hash !== snapshot.hash)
            return null
          const ranges = diffRanges(root, { source: capture.source, quote: capture.quote }, snapshot)
          const first = ranges?.at(0)
          const last = ranges?.at(-1)
          if (first === undefined || last === undefined) return null
          const combined = first.cloneRange()
          combined.setEnd(last.endContainer, last.endOffset)
          return combined
        }
        releases.push(registerOfficialAnchor(sourceKey({ source }), anchor))
        releases.push(registerOfficialAnchor(sourceKey({ source: compact }), anchor))
        releases.push(
          installOfficialMarkers(
            root,
            controller,
            matches,
            (item) =>
              item.source?.kind === 'official-diff' && item.source.wholeFile
                ? (root.querySelector<HTMLElement>('[data-official-diff-annotate]') ?? root)
                : diffRanges(root, item, snapshot),
            labels.t ?? (((key: string) => key) as InputAnnotationProps['t']),
            highlights,
          ),
        )
      }
    })
    .catch(() => {
      if (!abort.signal.aborted) dispose()
    })
}

/** Install selection and saved bubbles only inside official sidebar review views. */
export function installDiffIntegration(
  registry: OfficialDiffRegistry,
  labels: OfficialDiffLabels,
  highlights?: HighlightManager,
  creationEnabled?: AnnotationCreationToggle,
): () => void {
  let selectionEpoch = 0
  let selectionAbort: AbortController | null = null
  let disposeAction: (() => void) | undefined
  const mounted = new Map<HTMLElement, MountedDiff>()
  const actionUrlFor = (root: HTMLElement): string | undefined =>
    root.querySelector<HTMLElement>('[data-dsh-official-diff-source], [data-official-diff-annotate]')?.dataset
      .actionUrl
  const closeSelection = (): void => {
    selectionEpoch += 1
    selectionAbort?.abort()
    disposeAction?.()
    disposeAction = undefined
  }
  const capture = (event: Event): void => {
    if (creationEnabled?.getSnapshot() === false || !selectionGesture(event)) return
    queueMicrotask(() => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0).cloneRange()
      const node =
        range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const root = node?.closest<HTMLElement>('[data-changes-review]')
      if (root == null || !root.contains(range.endContainer)) return
      const actionUrl = actionUrlFor(root)
      if (actionUrl === undefined) return
      closeSelection()
      const epoch = selectionEpoch
      selectionAbort = new AbortController()
      const selectedText = selection.toString()
      void captureOfficialDiffRange(
        root,
        range,
        actionUrl,
        'sidebar',
        (source, selected) => {
          if (
            epoch !== selectionEpoch ||
            !root.isConnected ||
            actionUrlFor(root) !== actionUrl ||
            window.getSelection()?.toString() !== selectedText
          )
            return
          const controller = registry.get(source.snapshot.sessionId)
          if (controller === undefined) return
          disposeAction = showOfficialSelectionAction(selected, labels.annotate, () =>
            controller.beginSelection(selected),
          )
        },
        selectionAbort.signal,
      ).catch(() => undefined)
    })
  }
  const onSelectionChange = (): void => {
    if (window.getSelection()?.isCollapsed !== false) closeSelection()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeSelection()
  }
  const sync = (): void => {
    for (const [root, entry] of mounted) if (!root.isConnected) entry.dispose()
    for (const root of document.querySelectorAll<HTMLElement>('[data-changes-review]')) {
      const actionUrl = actionUrlFor(root)
      if (actionUrl !== undefined) registerDiffView(root, actionUrl, registry, labels, highlights, mounted)
    }
  }
  const observer = new MutationObserver(sync)
  document.addEventListener('pointerup', capture, true)
  document.addEventListener('keyup', capture, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('selectionchange', onSelectionChange)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-action-url'],
  })
  const unsubscribeCreation = creationEnabled?.subscribe(() => {
    if (creationEnabled.getSnapshot()) return
    closeSelection()
  })
  sync()
  return () => {
    unsubscribeCreation?.()
    closeSelection()
    document.removeEventListener('pointerup', capture, true)
    document.removeEventListener('keyup', capture, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('selectionchange', onSelectionChange)
    observer.disconnect()
    for (const entry of mounted.values()) entry.dispose()
    mounted.clear()
  }
}
