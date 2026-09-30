// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/dom'
import { act } from '@testing-library/react'
import { AnnotationController } from '../src/client/controller.ts'
import { installDocumentIntegration } from '../src/client/document-integration.tsx'
import { compactFileSource, fileSource } from '../src/client/official-adapters.ts'
import {
  createSource,
  readFileBytesDigest,
  type AnnotationCreationToggle,
} from '../src/client/components/FileWholeAnnotationAction.tsx'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { sha256Hex } from '../src/shared/snapshot-hash.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const sessionId = 'session-official-document' as SessionIdentity
const address = 'dsh-resource://file/session/session-official-document/%2Fworkspace%2Fnotes.md'
const hash = 'b'.repeat(64)

function controller(): AnnotationController {
  return new AnnotationController(
    sessionId,
    new AnnotationStorage(new MemoryStorage(), sessionId),
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
    DEFAULT_CONFIG,
    () => 1_700_000_000_000,
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

function source(wholeFile: boolean) {
  return fileSource(
    {
      sessionId,
      resourceAddress: address,
      path: '/workspace/notes.md',
      resourceVersion: 'file-v1',
      format: 'markdown',
      hash,
      bytes: 10,
      text: 'alpha beta',
    },
    'sidebar',
    wholeFile,
  )
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('official document integration', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-textpreview-url="${address}"><div data-textpreview-plain><span>alpha beta</span></div></div>`
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  it('registers a source endpoint and locates a saved range', async () => {
    const owner = controller()
    const savedSource = source(false)
    owner.beginSelection({
      source: savedSource,
      quote: { exact: 'beta', prefix: 'alpha ', suffix: '', start: 6, end: 10 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('note')
    const annotationId = owner.saveEditor()
    const endpoint = vi.fn()
    const dispose = vi.fn()
    vi.spyOn(owner, 'registerSourceEndpoint').mockImplementation((_anchor, value) => {
      if (value.revealSource !== undefined) endpoint.mockImplementation(value.revealSource)
      return dispose
    })
    const stop = installDocumentIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      (key) => (key === 'selection.annotateOfficial' ? 'Annotate' : 'Cancel'),
      () => source(true),
    )
    expect(endpoint).not.toHaveBeenCalled()
    await expect(endpoint(annotationId, owner.getSnapshot().navigationEpoch)).resolves.toBe('shown')
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    expect(document.querySelector('[data-dsh-official-file-located]')).not.toBeNull()
    stop()
    expect(dispose).toHaveBeenCalled()
    owner.dispose()
  })

  it('pins a complete file read to the observed resource version', async () => {
    const text = 'alpha beta'
    const data = new TextEncoder().encode(text)
    const read = vi.fn(async () => ({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.md',
        version: 'file-v1',
        bytes: data.length,
        data,
        offset: 0,
        eof: true,
      },
    }))
    const content = { kind: 'text' as const, text, pages: [{ offset: 1, text, lines: 1 }], eof: true }
    const signal = new AbortController().signal
    const captured = await createSource(content, address, 'file-v1', read, signal, 'sidebar')
    expect(captured).toMatchObject({
      resourceVersion: 'file-v1',
      snapshot: { hash: sha256Hex(text), bytes: data.length, text },
    })
    expect(await createSource(content, address, 'file-v2', read, signal, 'sidebar')).toBeUndefined()
    expect(
      await createSource({ ...content, eof: false }, address, 'file-v1', read, signal, 'sidebar'),
    ).toBeUndefined()
    const trailing = new TextEncoder().encode(`${text}\n`)
    read.mockResolvedValueOnce({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.md',
        version: 'file-v1',
        bytes: trailing.length,
        data: trailing,
        offset: 0,
        eof: true,
      },
    })
    expect(await createSource(content, address, 'file-v1', read, signal, 'sidebar')).toMatchObject({
      snapshot: { hash: sha256Hex(`${text}\n`), text: `${text}\n` },
    })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('retains a binary preview as a whole-file byte digest without text coordinates', async () => {
    document.querySelector<HTMLElement>('[data-textpreview-url]')!.dataset.documentPreview = 'document/image'
    const data = Uint8Array.of(0x89, 0x50, 0x4e, 0x47)
    const read = vi.fn(async () => ({
      ok: true,
      value: {
        absolutePath: '/workspace/notes.md',
        version: 'image-v1',
        bytes: data.length,
        data,
        offset: 0,
        eof: true,
      },
    }))
    const content = { kind: 'bytes' as const, data }
    const signal = new AbortController().signal
    const captured = await createSource(content, address, 'image-v1', read, signal, 'sidebar')
    expect(captured).toMatchObject({
      format: 'image',
      wholeFile: true,
      snapshot: { hash: sha256Hex(data), bytes: data.length, format: 'image' },
    })
    expect(captured?.snapshot.text).toBeUndefined()
    expect(captured?.startLine).toBeUndefined()
    expect(
      await createSource(
        { ...content, data: Uint8Array.of(0) },
        address,
        'image-v1',
        read,
        signal,
        'sidebar',
      ),
    ).toBeUndefined()
  })

  it('validates visible pages before EOF without reading the complete file', async () => {
    const page = { offset: 1, text: '重复\n中😀', lines: 2 }
    const readBytes = vi.fn(async () => {
      throw new Error('full read is not needed')
    })
    const readPage = vi.fn(async () => ({
      ok: true,
      value: {
        version: 'file-v1',
        bytes: 8_000_000,
        ...page,
        eof: false,
      },
    }))
    const result = await createSource(
      { kind: 'text', text: page.text, pages: [page], eof: false },
      address,
      'file-v1',
      readBytes,
      new AbortController().signal,
      'sidebar',
      readPage,
    )
    expect(result).toMatchObject({
      resourceVersion: 'file-v1',
      snapshot: { bytes: 8_000_000, pages: [page] },
    })
    expect(readBytes).not.toHaveBeenCalled()
    expect(readPage).toHaveBeenCalledWith(sessionId, '/workspace/notes.md', 1, 2, expect.any(AbortSignal))
  })

  it('hashes empty and large whole-file byte sources in bounded same-version chunks', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 3).fill(0x61)
    const read = vi.fn(
      async (
        _session: SessionIdentity,
        _path: string,
        _signal: AbortSignal,
        range?: { readonly offset: number; readonly length: number },
      ) => {
        const offset = range?.offset ?? 0
        const data = bytes.slice(offset, offset + (range?.length ?? bytes.length))
        return {
          ok: true,
          value: {
            absolutePath: '/workspace/notes.md',
            version: 'file-v1',
            bytes: bytes.length,
            data,
            offset,
            eof: offset + data.length === bytes.length,
          },
        }
      },
    )
    expect(
      await readFileBytesDigest(sessionId, '/workspace/notes.md', read, new AbortController().signal),
    ).toEqual({
      absolutePath: '/workspace/notes.md',
      version: 'file-v1',
      bytes: bytes.length,
      hash: sha256Hex(bytes),
    })
    expect(read).toHaveBeenCalledTimes(3)
    expect(read.mock.calls.every((call) => call[3]!.length <= 1024 * 1024)).toBe(true)
    const empty = vi.fn(async () => ({
      ok: true,
      value: {
        absolutePath: '/workspace/empty.txt',
        version: 'file-v1',
        bytes: 0,
        data: new Uint8Array(),
        offset: 0,
        eof: true,
      },
    }))
    expect(
      await readFileBytesDigest(sessionId, '/workspace/empty.txt', empty, new AbortController().signal),
    ).toEqual({ absolutePath: '/workspace/empty.txt', version: 'file-v1', bytes: 0, hash: sha256Hex('') })
    const changed = vi.fn(
      async (
        _session: SessionIdentity,
        _path: string,
        _signal: AbortSignal,
        range?: { readonly offset: number; readonly length: number },
      ) => ({
        ok: true,
        value: {
          absolutePath: '/workspace/notes.md',
          version: range!.offset === 0 ? 'file-v1' : 'file-v2',
          bytes: bytes.length,
          data: bytes.slice(range!.offset, range!.offset + range!.length),
          offset: range!.offset,
          eof: range!.offset + range!.length >= bytes.length,
        },
      }),
    )
    await expect(
      readFileBytesDigest(sessionId, '/workspace/notes.md', changed, new AbortController().signal),
    ).resolves.toBeUndefined()
  })

  it('keeps an outside release pending until the same-version page is ready and selects the second duplicate', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML =
      '<div data-textpreview-plain><div data-textpreview-line="1">重复\n</div><div data-textpreview-line="2">重复</div></div>'
    const current = fileSource(
      {
        sessionId,
        resourceAddress: address,
        path: '/workspace/notes.md',
        resourceVersion: 'file-v1',
        format: 'text',
        hash: sha256Hex('revision'),
        bytes: 8_000_000,
        text: '重复\n重复',
        pages: [{ offset: 1, text: '重复\n重复', lines: 2 }],
      },
      'sidebar',
      true,
    )
    let ready = false
    const owner = controller()
    const stop = installDocumentIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      (key) => String(key),
      () => (ready ? current : undefined),
    )
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 10, left: 20, right: 40, bottom: 30, width: 20, height: 20 }),
    })
    try {
      const text = root.querySelector<HTMLElement>('[data-textpreview-line="2"]')!.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 2)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await Promise.resolve()
      expect(document.querySelector('.dia-selection-bar')).toBeNull()
      ready = true
      root.setAttribute('disabled', '')
      const button = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>('.dia-selection-bar__action')
        expect(found).not.toBeNull()
        return found!
      })
      button.click()
      expect(owner.getSnapshot().editor).toMatchObject({
        capture: {
          source: { startLine: 2, endLine: 2, startColumn: 0, endColumn: 2, snapshot: { version: 2 } },
          quote: { exact: '重复' },
        },
      })
    } finally {
      stop()
      owner.dispose()
      window.getSelection()?.removeAllRanges()
    }
  })

  it('captures a multiline highlighted code selection with its real start and end columns', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.dataset.documentPreview = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'
    root.innerHTML =
      '<div data-code-preview><div data-code-block-content><pre><code><span class="line"><span>const</span> first = 1;</span>\n<span class="line"><span>const</span> second = 2;</span></code></pre></div></div>'
    const value = 'const first = 1;\nconst second = 2;'
    const current = fileSource(
      {
        sessionId,
        resourceAddress: address,
        path: '/workspace/notes.md',
        resourceVersion: 'file-v1',
        format: 'code',
        hash: sha256Hex(value),
        bytes: value.length,
        text: value,
        pages: [{ offset: 1, text: value, lines: 2 }],
      },
      'sidebar',
      true,
    )
    const owner = controller()
    const stop = installDocumentIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      (key) => String(key),
      () => current,
    )
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 10, left: 20, right: 40, bottom: 30, width: 20, height: 20 }),
    })
    try {
      const rows = root.querySelectorAll<HTMLElement>('code .line')
      const first = rows[0]!.querySelector('span')!.firstChild!
      const second = rows[1]!.querySelector('span')!.firstChild!
      const range = document.createRange()
      range.setStart(first, 0)
      range.setEnd(second, 5)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      const button = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>('.dia-selection-bar__action')
        expect(found).not.toBeNull()
        return found!
      })
      button.click()
      expect(owner.getSnapshot().editor).toMatchObject({
        capture: {
          source: { startLine: 1, endLine: 2, startColumn: 0, endColumn: 5 },
          quote: { exact: 'const first = 1;\nconst' },
        },
      })
      owner.updateEditorText('Review both lines.')
      const annotationId = owner.saveEditor()
      owner.setSourceNavigator(async () => true)
      await expect(owner.locateSource(annotationId)).resolves.toBe('shown')
      expect(root.querySelector('[data-dsh-official-file-located]')).not.toBeNull()
    } finally {
      stop()
      owner.dispose()
      window.getSelection()?.removeAllRanges()
    }
  })
  it('distinguishes pending pages, an unmatched range, and a closed preview', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML = '<div data-textpreview-plain><div data-textpreview-line="1">alpha\n</div></div>'
    const full = fileSource(
      {
        sessionId,
        resourceAddress: address,
        path: '/workspace/notes.md',
        resourceVersion: 'file-v1',
        format: 'text',
        hash: sha256Hex('alpha\nbeta'),
        bytes: 10,
        text: 'alpha\nbeta',
        pages: [{ offset: 1, text: 'alpha\nbeta', lines: 2 }],
      },
      'sidebar',
      false,
    )
    const owner = controller()
    const quote = { exact: 'pha\nbe', prefix: 'al', suffix: 'ta', start: 2, end: 8 }
    owner.beginSelection({
      source: compactFileSource({ ...full, startLine: 1, endLine: 2, startColumn: 2, endColumn: 2 }, quote),
      quote,
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('Both pages')
    const id = owner.saveEditor()
    owner.setSourceNavigator(async () => true)
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => full,
    )
    try {
      let complete = false
      const locating = owner.locateSource(id).then((result) => {
        complete = true
        return result
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(complete).toBe(false)
      const row = document.createElement('div')
      row.dataset.textpreviewLine = '2'
      row.textContent = 'beta\n'
      root.querySelector('[data-textpreview-plain]')!.append(row)
      await expect(locating).resolves.toBe('shown')
      row.textContent = 'gamma\n'
      await expect(owner.locateSource(id)).resolves.toBe('unmatched')
      row.remove()
      const unavailable = owner.locateSource(id)
      await Promise.resolve()
      root.remove()
      await expect(unavailable).resolves.toBe('unavailable')
    } finally {
      stop()
      owner.dispose()
    }
  })

  it('cancels an older file location without treating the pending page as a mismatch', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML = '<div data-textpreview-plain><div data-textpreview-line="1">alpha\n</div></div>'
    const full = fileSource(
      {
        sessionId,
        resourceAddress: address,
        path: '/workspace/notes.md',
        resourceVersion: 'file-v1',
        format: 'text',
        hash: sha256Hex('alpha\nbeta'),
        bytes: 10,
        text: 'alpha\nbeta',
        pages: [{ offset: 1, text: 'alpha\nbeta', lines: 2 }],
      },
      'sidebar',
      false,
    )
    const owner = controller()
    const quote = { exact: 'pha\nbe', prefix: 'al', suffix: 'ta', start: 2, end: 8 }
    owner.beginSelection({
      source: compactFileSource({ ...full, startLine: 1, endLine: 2, startColumn: 2, endColumn: 2 }, quote),
      quote,
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('Both pages')
    const id = owner.saveEditor()
    owner.setSourceNavigator(async () => true)
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => full,
    )
    try {
      const older = owner.locateSource(id)
      await Promise.resolve()
      const newer = owner.locateSource(id)
      await expect(older).resolves.toBe('cancelled')
      const row = document.createElement('div')
      row.dataset.textpreviewLine = '2'
      row.textContent = 'beta\n'
      root.querySelector('[data-textpreview-plain]')!.append(row)
      await expect(newer).resolves.toBe('shown')
    } finally {
      stop()
      owner.dispose()
    }
  })

  it('reports a different mounted file revision as unavailable', async () => {
    const owner = controller()
    const savedSource = source(false)
    owner.beginSelection({
      source: savedSource,
      quote: { exact: 'beta', prefix: 'alpha ', suffix: '', start: 6, end: 10 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('note')
    const annotationId = owner.saveEditor()
    const endpoint = vi.fn()
    vi.spyOn(owner, 'registerSourceEndpoint').mockImplementation((_anchor, value) => {
      if (value.revealSource !== undefined) endpoint.mockImplementation(value.revealSource)
      return vi.fn()
    })
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => ({ ...source(true), resourceVersion: 'file-v2' }),
    )
    try {
      await expect(endpoint(annotationId, owner.getSnapshot().navigationEpoch)).resolves.toBe('unavailable')
    } finally {
      stop()
      owner.dispose()
    }
  })

  it('restores a v1 Markdown quote with rendered line coordinates', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML = '<div data-document-markdown><p>alpha <strong>beta</strong></p></div>'
    const owner = controller()
    const legacy = {
      ...source(false),
      startLine: 1,
      endLine: 1,
      startColumn: 6,
      endColumn: 10,
      snapshot: {
        ...source(false).snapshot,
        renderedText: 'alpha beta',
        renderedHash: sha256Hex('alpha beta'),
      },
    }
    owner.beginSelection({
      source: legacy,
      quote: { exact: 'beta', prefix: 'alpha ', suffix: '', start: 6, end: 10 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('Legacy markup')
    const id = owner.saveEditor()
    owner.setSourceNavigator(async () => true)
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => source(true),
    )
    try {
      await expect(owner.locateSource(id)).resolves.toBe('shown')
    } finally {
      stop()
      owner.dispose()
    }
  })

  it('registers a historical Markdown source discovered after the preview was mounted', async () => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML = '<div data-document-markdown>alpha beta</div>'
    const owner = controller()
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => source(true),
    )
    try {
      const legacy = {
        ...source(false),
        snapshot: { ...source(false).snapshot, hash: 'c'.repeat(64) },
        startLine: 1,
        endLine: 1,
        startColumn: 6,
        endColumn: 10,
      }
      owner.beginSelection({
        source: legacy,
        quote: { exact: 'beta', prefix: 'alpha ', suffix: '', start: 6, end: 10 },
        rect: { top: 1, left: 2, right: 3, bottom: 4 },
      })
      owner.updateEditorText('Later history')
      const id = owner.saveEditor()
      owner.setSourceNavigator(async () => true)
      await expect(owner.locateSource(id)).resolves.toBe('shown')
    } finally {
      stop()
      owner.dispose()
    }
  })

  it('keeps file history mounted while the creation toggle changes', async () => {
    const owner = controller()
    const savedSource = source(false)
    owner.beginSelection({
      source: savedSource,
      quote: { exact: 'beta', prefix: 'alpha ', suffix: '', start: 6, end: 10 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    owner.updateEditorText('historical note')
    const annotationId = owner.saveEditor()
    owner.setSourceNavigator(async () => true)
    const registrations = vi.spyOn(owner, 'registerSourceEndpoint')
    const toggle = creationToggle(false)
    const stop = installDocumentIntegration(
      { get: (id) => (id === sessionId ? owner : undefined) },
      (key) => (key === 'selection.annotate' ? 'Annotate' : String(key)),
      () => source(true),
      undefined,
      toggle.value,
    )
    try {
      const markerLayer = document.querySelector('[data-dsh-official-markers]')
      expect(markerLayer).not.toBeNull()
      const registrationCount = registrations.mock.calls.length
      expect(registrationCount).toBeGreaterThan(0)
      await expect(owner.locateSource(annotationId)).resolves.toBe('shown')

      const text = document.querySelector('[data-textpreview-plain] span')!.firstChild!
      const range = document.createRange()
      range.setStart(text, 6)
      range.setEnd(text, 10)
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(20, 10, 40, 20),
      })
      window.getSelection()!.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await Promise.resolve()
      expect(document.querySelector('.dia-selection-bar')).toBeNull()

      act(() => toggle.set(true))
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await waitFor(() => expect(document.querySelector('.dia-selection-bar__action')).not.toBeNull())
      act(() => toggle.set(false))
      expect(document.querySelector('.dia-selection-bar')).toBeNull()
      expect(document.querySelector('[data-dsh-official-markers]')).toBe(markerLayer)
      expect(registrations).toHaveBeenCalledTimes(registrationCount)
      expect(toggle.listenerCount()).toBe(1)
      await expect(owner.locateSource(annotationId)).resolves.toBe('shown')
    } finally {
      stop()
      owner.dispose()
    }
    expect(toggle.listenerCount()).toBe(0)
  })

  it.each(['alpha\n', 'alpha\r\n'])('captures an entire line including its separator: %j', async (text) => {
    const root = document.querySelector<HTMLElement>('[data-textpreview-url]')!
    root.innerHTML = '<div data-textpreview-plain><div data-textpreview-line="1"></div></div>'
    const row = root.querySelector('[data-textpreview-line]')!
    row.textContent = text
    const raw = text.slice(0, -1)
    const full = fileSource(
      {
        sessionId,
        resourceAddress: address,
        path: '/workspace/notes.md',
        resourceVersion: 'file-v1',
        format: 'text',
        hash: sha256Hex(text),
        bytes: text.length,
        text: raw,
        pages: [{ offset: 1, text: raw, lines: 1 }],
      },
      'sidebar',
      true,
    )
    const owner = controller()
    const stop = installDocumentIntegration(
      { get: () => owner },
      (key) => key,
      () => full,
    )
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(20, 10, 20, 20),
    })
    try {
      const range = document.createRange()
      range.selectNodeContents(row.firstChild!)
      window.getSelection()!.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      const button = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>('.dia-selection-bar__action')
        expect(found).not.toBeNull()
        return found!
      })
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
      expect(document.querySelector('.dia-selection-bar')).toBeNull()
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await waitFor(() => expect(document.querySelector('.dia-selection-bar__action')).not.toBeNull())
      window.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
      expect(document.querySelector('.dia-selection-bar')).toBeNull()
      window.getSelection()!.addRange(range)
      document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      const savedButton = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>('.dia-selection-bar__action')
        expect(found).not.toBeNull()
        return found!
      })
      savedButton.click()
      expect(button.isConnected).toBe(false)
      expect(owner.getSnapshot().editor).toMatchObject({
        capture: { quote: { exact: text }, source: { startColumn: 0, endColumn: text.length } },
      })
      owner.updateEditorText('A whole line')
      const id = owner.saveEditor()
      owner.setSourceNavigator(async () => true)
      await expect(owner.locateSource(id)).resolves.toBe('shown')
    } finally {
      stop()
      owner.dispose()
      window.getSelection()?.removeAllRanges()
    }
  })
})
