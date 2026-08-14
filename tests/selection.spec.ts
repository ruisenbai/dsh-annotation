// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
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
        <p>Hello <strong>world</strong>!</p>
        <button type="button">Copy chrome</button>
        <pre><code class="language-ts">one\ntwo\nthree</code></pre>
        <table><tbody><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></tbody></table>
      </div>`
  })

  it('stores stable text offsets while excluding interactive chrome', () => {
    const root = document.querySelector('#root') as HTMLElement
    const nodes = selectableTextNodes(root)
    expect(nodes.map((node) => node.data).join('')).not.toContain('Copy chrome')
    const hello = document.querySelector('p')!.firstChild!
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
    const paragraph = document.querySelector('p')!
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
    range.setStart(root.querySelector('p')!.firstChild!, 0)
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
