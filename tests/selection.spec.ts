// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)
import {
  captureSelection,
  rangeFromSelector,
  rangesOverlap,
  selectableTextNodes,
  textOffsetAtPoint,
} from '../src/client/selection.ts'
import type { MessageIdentity } from '../src/shared/types.ts'

function rect() {
  return { top: 10, left: 20, right: 80, bottom: 30, width: 60, height: 20, x: 20, y: 10, toJSON() {} }
}

function withRect(range: Range): Range {
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => rect() })
  return range
}

describe('DOM selection capture', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <details data-dsh-annotation-ignore="true"><summary>Reasoning</summary><p>hidden analysis</p></details>
        <p>Hello <strong>world</strong>!</p>
        <button type="button">Copy chrome</button>
        <span aria-live="polite">stream announcement</span>
        <span role="status">stream status</span>
        <div data-variant="think">private think text</div>
        <pre><code class="language-ts">one\ntwo\nthree</code></pre>
        <table><tbody><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></tbody></table>
      </div>`
  })

  it('stores stable text offsets while excluding interactive chrome', () => {
    const root = document.querySelector('#root') as HTMLElement
    const nodes = selectableTextNodes(root)
    expect(nodes.map((node) => node.data).join('')).not.toContain('Copy chrome')
    expect(nodes.map((node) => node.data).join('')).not.toContain('hidden analysis')
    expect(nodes.map((node) => node.data).join('')).not.toContain('stream announcement')
    expect(nodes.map((node) => node.data).join('')).not.toContain('stream status')
    expect(nodes.map((node) => node.data).join('')).not.toContain('private think text')
    const hello = document.querySelector('#root > p')!.firstChild!
    const world = document.querySelector('strong')!.firstChild!
    const range = withRect(document.createRange())
    range.setStart(hello, 1)
    range.setEnd(world, 5)
    const capture = captureSelection(root, range, 'message-1' as MessageIdentity, 7)
    expect(capture.quote).toMatchObject({ exact: 'ello world', start: 1, end: 11 })
    expect(capture.rect).toMatchObject({ top: 10, bottom: 30 })
    expect(rangeFromSelector(root, capture.quote)?.toString()).toBe('ello world')
  })

  it('maps nested element boundaries without extending into later reply blocks', () => {
    const root = document.querySelector('#root') as HTMLElement
    const paragraph = document.querySelector('#root > p')!
    const full = withRect(document.createRange())
    full.setStart(paragraph, 0)
    full.setEnd(paragraph, paragraph.childNodes.length)
    expect(captureSelection(root, full, 'message-1' as MessageIdentity, 7).quote).toMatchObject({
      exact: 'Hello world!',
      start: 0,
      end: 12,
    })

    const prefix = withRect(document.createRange())
    prefix.setStart(paragraph, 0)
    prefix.setEnd(paragraph, 1)
    expect(captureSelection(root, prefix, 'message-1' as MessageIdentity, 7).quote.exact).toBe('Hello ')
  })

  it('relocates an exact quote with context when rendered offsets move', () => {
    const root = document.querySelector('#root') as HTMLElement
    const selector = {
      exact: 'world',
      prefix: 'Hello ',
      suffix: '!',
      start: 100,
      end: 105,
    }
    expect(rangeFromSelector(root, selector)?.toString()).toBe('world')
    expect(rangeFromSelector(root, { ...selector, exact: 'missing' })).toBeNull()
  })

  it('captures and restores local Markdown link labels without including operation buttons', () => {
    const root = document.querySelector('#root') as HTMLElement
    root.innerHTML =
      '<p>Before <button type="button" class="_fileMention_abc _fileLink_abc" title="src/a.ts"><svg aria-hidden="true"><title>icon</title></svg><strong>source</strong></button> after.</p><button title="Copy" class="_copyButton_abc">Copy</button><button title="src/b.ts" class="_fileMention_abc">inline code link</button>'
    const label = root.querySelector('strong')!.firstChild!
    const onlyLink = withRect(document.createRange())
    onlyLink.setStart(label, 0)
    onlyLink.setEnd(label, 6)
    const quote = captureSelection(root, onlyLink, 'message-1' as MessageIdentity, 7).quote
    expect(quote).toMatchObject({ exact: 'source', start: 7, end: 13 })
    expect(rangeFromSelector(root, quote)?.toString()).toBe('source')
    expect(
      selectableTextNodes(root)
        .map((node) => node.data)
        .join(''),
    ).toBe('Before source after.')

    const paragraph = root.querySelector('p')!
    const across = withRect(document.createRange())
    across.selectNodeContents(paragraph)
    expect(captureSelection(root, across, 'message-1' as MessageIdentity, 7).quote.exact).toBe(
      'Before source after.',
    )
    const legacyQuote = { exact: 'source after.', prefix: 'Before ', suffix: '', start: 7, end: 20 }
    expect(rangeFromSelector(root, legacyQuote)?.toString()).toBe('source after.')

    root.querySelector('strong')!.setAttribute('data-dsh-annotation-ignore', 'true')
    expect(
      selectableTextNodes(root)
        .map((node) => node.data)
        .join(''),
    ).not.toContain('source')
  })

  it('keeps baseline quotes when Harness replaces local-link text with its file-link button', () => {
    const text = 'Before [source](src/a.ts#L24) after.'
    const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
    const { container, rerender } = render(createElement(MarkdownText, { text, labels }))
    const paragraph = container.querySelector('p')!
    const baseline = withRect(document.createRange())
    baseline.selectNodeContents(paragraph)
    const quote = captureSelection(container, baseline, 'message-1' as MessageIdentity, 7).quote
    expect(quote.exact).toBe('Before source after.')

    rerender(
      createElement(MarkdownDelegateProvider, {
        openFile: () => undefined,
        children: createElement(MarkdownText, { text, labels }),
      }),
    )
    const link = container.querySelector('button[title="src/a.ts"]')!
    expect(link).not.toBeNull()
    const label = [...selectableTextNodes(container)].find((node) => node.data === 'source')!
    const selected = withRect(document.createRange())
    selected.setStart(label, 0)
    selected.setEnd(label, label.length)
    expect(captureSelection(container, selected, 'message-1' as MessageIdentity, 7).quote.exact).toBe(
      'source',
    )
    expect(rangeFromSelector(container, quote)?.toString()).toBe('Before source after.')
  })

  it('captures code language and line coordinates', () => {
    const root = document.querySelector('#root') as HTMLElement
    const code = document.querySelector('code')!.firstChild!
    const range = withRect(document.createRange())
    range.setStart(code, 4)
    range.setEnd(code, 11)
    const capture = captureSelection(root, range, 'message-1' as MessageIdentity, 7)
    expect(capture.quote.exact).toBe('two\nthr')
    expect(capture.structure).toEqual({ kind: 'code', language: 'ts', startLine: 2, endLine: 3 })
  })

  it('captures start and end table coordinates', () => {
    const root = document.querySelector('#root') as HTMLElement
    const cells = document.querySelectorAll('td')
    const range = withRect(document.createRange())
    range.setStart(cells[1]!.firstChild!, 0)
    range.setEnd(cells[2]!.firstChild!, 5)
    const capture = captureSelection(root, range, 'message-1' as MessageIdentity, 7)
    expect(capture.structure).toEqual({ kind: 'table', startRow: 0, startColumn: 1, endRow: 1, endColumn: 0 })
  })

  it('rejects selections crossing assistant roots', () => {
    const root = document.querySelector('#root') as HTMLElement
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.append(outside)
    const range = withRect(document.createRange())
    range.setStart(root.querySelector(':scope > p')!.firstChild!, 0)
    range.setEnd(outside.firstChild!, 3)
    expect(() => captureSelection(root, range, 'message-1' as MessageIdentity, 7)).toThrow(
      'one assistant reply',
    )
  })

  it('maps pointer caret positions to rendered offsets', () => {
    const root = document.querySelector('#root') as HTMLElement
    const world = document.querySelector('strong')!.firstChild!
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: world, offset: 2 }),
    })
    expect(textOffsetAtPoint(root, 1, 1)).toBe(8)
  })

  it('detects half-open interval overlap', () => {
    const base = { exact: 'x', prefix: '', suffix: '', start: 5, end: 10 }
    expect(rangesOverlap(base, { ...base, start: 9, end: 12 })).toBe(true)
    expect(rangesOverlap(base, { ...base, start: 10, end: 12 })).toBe(false)
  })
})
