// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/dom'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { compactOfficialDiffSource, officialDiffSource } from '../src/client/official-adapters.ts'
import {
  captureOfficialDiffRange,
  createDiffReviewAction,
  installDiffIntegration,
  loadOfficialDiff,
} from '../src/client/diff-integration.tsx'
import type { SessionIdentity } from '../src/shared/types.ts'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { AnnotationCreationToggle } from '../src/client/components/FileWholeAnnotationAction.tsx'
import { HighlightManager } from '../src/client/highlight.ts'

const sessionId = 'session-official-diff' as SessionIdentity
const actionUrl = 'api/changes.open?sessionId=session-official-diff&seq=7&index=0'

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function fetcher(url: string | URL | Request): Promise<Response> {
  const href = String(url)
  if (href.includes('changes.summary'))
    return Promise.resolve(
      response({ turn: 3, files: [{ path: '/workspace/notes.md', display: '/workspace/notes.md' }] }),
    )
  if (!href.includes('changes.diff')) throw new Error(`unexpected official route: ${href}`)
  return Promise.resolve(
    response({
      kind: 'text',
      path: '/workspace/notes.md',
      display: '/workspace/notes.md',
      before: true,
      after: true,
      coarse: false,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' context', '+new value'] }],
    }),
  )
}

function creationToggle(initial: boolean) {
  let enabled = initial
  const listeners = new Set<() => void>()
  const value: AnnotationCreationToggle = {
    getSnapshot: () => enabled,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    value,
    set(next: boolean) {
      enabled = next
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('official Diff integration', () => {
  it('rejects contradictory comparison data before creating a source', async () => {
    const invalidHunks = (url: string | URL | Request): Promise<Response> =>
      String(url).includes('changes.summary')
        ? fetcher(url)
        : Promise.resolve(
            response({
              kind: 'text',
              path: '/workspace/notes.md',
              display: '/workspace/notes.md',
              before: true,
              after: true,
              coarse: false,
              hunks: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 1, lines: [' context'] }],
            }),
          )
    await expect(loadOfficialDiff(actionUrl, invalidHunks)).rejects.toThrow('line counts')

    const inventedTextSide = (url: string | URL | Request): Promise<Response> =>
      String(url).includes('changes.summary')
        ? fetcher(url)
        : Promise.resolve(
            response({
              kind: 'binary',
              path: '/workspace/notes.md',
              display: '/workspace/notes.md',
              before: true,
            }),
          )
    await expect(loadOfficialDiff(actionUrl, inventedTextSide)).rejects.toThrow('text fields')
  })

  it('loads a public snapshot and captures an inline range from its visible code line', async () => {
    const loaded = await loadOfficialDiff(actionUrl, fetcher)
    expect(loaded.context).toMatchObject({ sessionId, seq: 7, turn: 3, fileIndex: 0 })
    expect(loaded.snapshot).toMatchObject({
      path: '/workspace/notes.md',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })

    const root = document.createElement('div')
    root.dataset.changesReview = ''
    root.innerHTML =
      '<div data-diff-side="right"><div data-diff-line="add"><span>2</span><span data-diff-code>new value</span></div></div>'
    document.body.append(root)
    const code = root.querySelector<HTMLElement>('[data-diff-code]')!
    const text = code.firstChild!
    const range = document.createRange()
    range.setStart(text, 4)
    range.setEnd(text, 9)
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 1, left: 2, right: 3, bottom: 4 }),
    })
    const begin = vi.fn()
    vi.stubGlobal('fetch', fetcher)

    await captureOfficialDiffRange(root, range, actionUrl, 'sidebar', begin)

    expect(begin).toHaveBeenCalledOnce()
    expect(begin.mock.calls[0]?.[0]).toMatchObject({
      kind: 'official-diff',
      side: 'new',
      startLine: 2,
      endLine: 2,
      startColumn: 4,
      endColumn: 9,
    })
    expect(begin.mock.calls[0]?.[1]).toMatchObject({
      quote: { exact: 'value', prefix: 'new ', suffix: '', start: 0, end: 5 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
  })

  it('keeps the real first and last columns of a multiline selection', async () => {
    vi.stubGlobal('fetch', fetcher)
    const root = document.createElement('div')
    root.dataset.changesReview = ''
    root.innerHTML =
      '<div data-diff-side="right"><div data-diff-line="context"><span>1</span><span data-diff-code>context</span></div><div data-diff-line="add"><span>2</span><span data-diff-code>new value</span></div></div>'
    document.body.append(root)
    const codes = root.querySelectorAll<HTMLElement>('[data-diff-code]')
    const range = document.createRange()
    range.setStart(codes[0]!.firstChild!, 3)
    range.setEnd(codes[1]!.firstChild!, 3)
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 1, left: 2, right: 3, bottom: 4, width: 1, height: 3 }),
    })
    const begin = vi.fn()
    await captureOfficialDiffRange(root, range, actionUrl, 'sidebar', begin)
    expect(begin).toHaveBeenCalledOnce()
    expect(begin.mock.calls[0]?.[1]).toMatchObject({
      source: { startLine: 1, endLine: 2, startColumn: 3, endColumn: 3, snapshot: { version: 2, hunks: [] } },
      quote: { exact: 'text\nnew', prefix: 'con', suffix: ' value' },
    })
  })

  it('drops an aborted snapshot callback before showing a selection', async () => {
    const summary = Promise.withResolvers<Response>()
    const diff = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', (url: string | URL | Request) =>
      String(url).includes('changes.summary') ? summary.promise : diff.promise,
    )
    const root = document.createElement('div')
    root.dataset.changesReview = ''
    root.innerHTML =
      '<div data-diff-side="right"><div data-diff-line="add"><span>2</span><span data-diff-code>new value</span></div></div>'
    document.body.append(root)
    const node = root.querySelector<HTMLElement>('[data-diff-code]')!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 3)
    const abort = new AbortController()
    const begin = vi.fn()
    const pending = captureOfficialDiffRange(root, range, actionUrl, 'sidebar', begin, abort.signal)
    abort.abort()
    summary.resolve(
      response({ turn: 3, files: [{ path: '/workspace/notes.md', display: '/workspace/notes.md' }] }),
    )
    diff.resolve(await fetcher('api/changes.diff'))
    await pending
    expect(begin).not.toHaveBeenCalled()
  })

  it('ignores hover previews while retaining sidebar location of historical hover records', async () => {
    vi.stubGlobal('fetch', fetcher)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const values = new Map<string, string>()
    const memory = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    const owner = new AnnotationController(
      sessionId,
      new AnnotationStorage(memory, sessionId),
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
    )
    const navigate = vi.fn(async () => true)
    owner.setSourceNavigator(navigate)
    const stop = installDiffIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      {
        annotate: 'Annotate',
        title: 'Annotation',
        annotation: 'Comment',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        locate: 'Locate',
        wholeFile: 'Whole file',
        failed: 'Save failed',
        status: { draft: 'Draft', queued: 'Queued', sent: 'Sent', processed: 'Processed' },
      },
    )
    try {
      const card = document.createElement('div')
      card.dataset.changedFiles = ''
      card.dataset.dshOfficialDiffSession = sessionId
      card.dataset.dshOfficialDiffSeq = '7'
      card.dataset.dshOfficialDiffTurn = '3'
      card.innerHTML = '<ul><li>notes.md</li></ul>'
      document.body.append(card)
      card.querySelector('li')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      const hover = document.createElement('div')
      hover.dataset.changesHoverPreview = ''
      document.body.append(hover)
      const loaded = await loadOfficialDiff(actionUrl, fetcher)
      expect(hover.querySelector('[data-official-diff-annotate]')).toBeNull()
      expect(owner.getSnapshot().editor).toBeNull()
      owner.beginSelection({
        source: compactOfficialDiffSource(officialDiffSource(loaded.snapshot, 'new', 'hover')),
        quote: { exact: '', prefix: '', suffix: '', start: 0, end: 0 },
        rect: { top: 1, left: 2, right: 3, bottom: 4 },
      })

      owner.updateEditorText('Keep this change.')
      const savedId = owner.saveEditor()
      expect(owner.getSnapshot().annotations[0]).toMatchObject({
        annotationId: savedId,
        annotation: 'Keep this change.',
        source: { snapshot: { version: 2, hunks: [] } },
      })

      const review = document.createElement('div')
      review.dataset.changesReview = ''
      review.innerHTML = `<button data-official-diff-annotate data-action-url="${actionUrl}"></button>`
      document.body.append(review)
      const register = vi.spyOn(owner, 'registerSourceEndpoint')
      await waitFor(() => expect(register).toHaveBeenCalled())
      await expect(owner.locateSource(savedId)).resolves.toBe('shown')
      expect(navigate).toHaveBeenCalledOnce()
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
      expect(review.hasAttribute('data-dsh-official-diff-located')).toBe(true)
    } finally {
      stop()
      owner.dispose()
    }
  })
  it('keeps Diff history mounted while its creation entry toggles', async () => {
    const countedFetch = vi.fn(fetcher)
    vi.stubGlobal('fetch', countedFetch)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(20, 10, 40, 20),
    })
    const values = new Map<string, string>()
    const owner = new AnnotationController(
      sessionId,
      new AnnotationStorage(
        {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => {
            values.set(key, value)
          },
          removeItem: (key) => {
            values.delete(key)
          },
        },
        sessionId,
      ),
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
    )
    owner.setSourceNavigator(async () => true)
    const loaded = await loadOfficialDiff(actionUrl, fetcher)
    const selectedSource = officialDiffSource(loaded.snapshot, 'new', 'sidebar', {
      startLine: 2,
      endLine: 2,
      startColumn: 4,
      endColumn: 9,
    })
    const quote = { exact: 'value', prefix: 'new ', suffix: '', start: 0, end: 5 }
    owner.beginSelection({
      source: compactOfficialDiffSource(selectedSource, quote),
      quote,
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('Keep this selected change.')
    const savedId = owner.saveEditor()

    const review = document.createElement('div')
    review.dataset.changesReview = ''
    review.innerHTML =
      '<div data-diff-side="right"><div data-diff-line="add"><span>2</span><span data-diff-code>new value</span></div></div><div data-action-host></div>'
    document.body.append(review)
    const toggle = creationToggle(false)
    const begin = vi.fn()
    const Action = createDiffReviewAction(begin, toggle.value)
    const action = render(createElement(Action, { actionUrl, pending: false, t: (key) => key }), {
      container: review.querySelector<HTMLElement>('[data-action-host]')!,
    })
    const registrations = vi.spyOn(owner, 'registerSourceEndpoint')
    const highlights = new HighlightManager()
    const activate = vi.spyOn(highlights, 'activate')
    const stop = installDiffIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      {
        t: (key) => key,
        annotate: 'Annotate',
        title: 'Annotation',
        annotation: 'Comment',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        locate: 'Locate',
        wholeFile: 'Whole file',
        failed: 'Save failed',
        status: { draft: 'Draft', queued: 'Queued', sent: 'Sent', processed: 'Processed' },
      },
      highlights,
      toggle.value,
    )
    try {
      expect(review.querySelector('[data-official-diff-annotate]')).toBeNull()
      expect(review.querySelector('[data-dsh-official-diff-source]')).not.toBeNull()
      const markerLayer = await waitFor(() => {
        expect(registrations).toHaveBeenCalled()
        const found = document.querySelector<HTMLElement>('[data-dsh-official-markers]')
        expect(found).not.toBeNull()
        return found!
      })
      const registrationCount = registrations.mock.calls.length
      const fetchCount = countedFetch.mock.calls.length
      await expect(owner.locateSource(savedId)).resolves.toBe('shown')
      expect(activate).toHaveBeenCalledWith(expect.stringContaining('diff-navigation:'), expect.any(Array))

      const text = review.querySelector<HTMLElement>('[data-diff-code]')!.firstChild!
      const range = document.createRange()
      range.setStart(text, 4)
      range.setEnd(text, 9)
      window.getSelection()!.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await Promise.resolve()
      expect(document.querySelector('.dia-selection-bar')).toBeNull()

      act(() => toggle.set(true))
      await waitFor(() => expect(review.querySelector('[data-official-diff-annotate]')).not.toBeNull())
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await waitFor(() => expect(document.querySelector('.dia-selection-bar__action')).not.toBeNull())
      act(() => toggle.set(false))
      expect(document.querySelector('.dia-selection-bar')).toBeNull()
      expect(review.querySelector('[data-official-diff-annotate]')).toBeNull()
      expect(review.querySelector('[data-dsh-official-diff-source]')).not.toBeNull()
      expect(document.querySelector('[data-dsh-official-markers]')).toBe(markerLayer)
      expect(registrations).toHaveBeenCalledTimes(registrationCount)
      expect(countedFetch).toHaveBeenCalledTimes(fetchCount + 2)
      expect(toggle.listenerCount()).toBe(2)
      await expect(owner.locateSource(savedId)).resolves.toBe('shown')
    } finally {
      stop()
      action.unmount()
      highlights.dispose()
      owner.dispose()
    }
    expect(toggle.listenerCount()).toBe(0)

    const hover = document.createElement('div')
    hover.dataset.changesHoverPreview = ''
    document.body.append(hover)
    expect(hover.querySelector('[data-official-diff-annotate]')).toBeNull()
  })

  it('cancels a whole-file load when its sidebar action unmounts', async () => {
    const summary = Promise.withResolvers<Response>()
    const diff = Promise.withResolvers<Response>()
    const requests: AbortSignal[] = []
    vi.stubGlobal('fetch', (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal != null) requests.push(init.signal)
      return String(_url).includes('changes.summary') ? summary.promise : diff.promise
    })
    const begin = vi.fn()
    const Action = createDiffReviewAction(begin)
    const mounted = render(
      createElement(Action, {
        actionUrl,
        pending: false,
        t: (key) => key,
      }),
    )
    fireEvent.click(mounted.getByRole('button'))
    mounted.unmount()
    await act(async () => {
      summary.resolve(await fetcher('api/changes.summary'))
      diff.resolve(await fetcher('api/changes.diff'))
    })
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((signal) => signal.aborted)).toBe(true)
    expect(begin).not.toHaveBeenCalled()
  })
})
