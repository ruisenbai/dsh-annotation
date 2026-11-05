// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import {
  installLinkTextSelection,
  selectedFileLinkRange,
  selectedTextLink,
  textLinkAtTarget,
} from '../src/client/link-selection.ts'

let root: HTMLElement

function select(element: Element, start = 0, end = element.textContent!.length): Selection {
  const range = document.createRange()
  range.setStart(element.firstChild!, start)
  range.setEnd(element.firstChild!, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

beforeEach(() => {
  document.body.innerHTML = `<div id="root"><p>Before <a href="https://example.com/" id="web"><strong>web label</strong></a> after.</p><p>Before <button class="host_fileMention host_fileLink" id="file"><svg aria-hidden="true"><title>icon</title></svg><strong>file label</strong></button> after.</p><button id="copy" title="Copy">Copy</button><button class="host_fileMention" id="mention">inline mention</button><a href="https://example.com/image" id="image"><img alt="preview"></a></div><p id="outside">Elsewhere</p>`
  root = document.querySelector('#root')!
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('link text selection', () => {
  it('resolves nested link labels and leaves images and operation buttons alone', () => {
    const web = root.querySelector('#web')!
    expect(textLinkAtTarget(root, web.firstChild)).toBe(web)
    expect(textLinkAtTarget(root, root.querySelector('#file strong'))).toBe(root.querySelector('#file'))
    for (const selector of ['#copy', '#mention', 'svg', 'img'])
      expect(textLinkAtTarget(root, root.querySelector(selector))).toBeNull()
    expect(textLinkAtTarget(root, document.querySelector('#outside'))).toBeNull()
    web.setAttribute('data-dsh-annotation-ignore', 'true')
    expect(textLinkAtTarget(root, web.firstChild)).toBeNull()
  })

  it('finds file-link characters without requiring a title or matching hidden icons', () => {
    const label = root.querySelector('#file strong')!
    const selection = select(label, 1, 5)
    expect(selectedFileLinkRange(root, selection)?.toString()).toBe('ile ')
    expect(selectedTextLink(root, label, selection)).toBe(true)
    select(root.querySelector('svg title')!)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    select(root.querySelector('#copy')!)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    select(root.querySelector('#mention')!)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
  })

  it('recognizes a link within surrounding text and ignores adjacent boundary-only contact', () => {
    const paragraph = root.querySelector('#file')!.parentElement!
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = document.getSelection()!
    selection.addRange(range)
    expect(selectedFileLinkRange(root, selection)).toBe(range)
    const label = root.querySelector('#file strong')!.firstChild!
    range.setStart(paragraph.firstChild!, 0)
    range.setEnd(label, 0)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    expect(selectedTextLink(root, label, selection)).toBe(false)
  })

  it('guards selected web labels without claiming the Host file-link workaround', () => {
    const label = root.querySelector('#web strong')!
    const selection = select(label)
    expect(selectedTextLink(root, label, selection)).toBe(true)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    expect(selectedTextLink(root, root.querySelector('#file'), selection)).toBe(false)
    selection.collapseToEnd()
    expect(selectedTextLink(root, label, selection)).toBe(false)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    expect(selectedTextLink(root, label, null)).toBe(false)
  })

  it('rejects cross-body selections and whitespace-only label fragments', () => {
    const label = root.querySelector('#file strong')!
    const selection = select(label, 4, 5)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    const range = selection.getRangeAt(0)
    range.setStart(label.firstChild!, 0)
    range.setEnd(document.querySelector('#outside')!.firstChild!, 3)
    expect(selectedFileLinkRange(root, selection)).toBeNull()
    expect(selectedTextLink(root, label, selection)).toBe(false)
  })

  it('extends a file-label drag from its first character and stops updating after disposal', () => {
    const label = root.querySelector('#file strong')!
    const caretDescriptor = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: (x: number) => {
        const range = document.createRange()
        range.setStart(label.firstChild!, x)
        range.collapse(true)
        return range
      },
    })
    onTestFinished(() => {
      if (caretDescriptor === undefined) Reflect.deleteProperty(document, 'caretRangeFromPoint')
      else Object.defineProperty(document, 'caretRangeFromPoint', caretDescriptor)
    })
    const dispose = installLinkTextSelection(root)
    onTestFinished(dispose)
    const gesture = (type: string, x: number, extra: PointerEventInit = {}) =>
      label.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          clientX: x,
          ...extra,
        }),
      )
    for (const extra of [{ pointerType: 'touch' }, { ctrlKey: true }, { shiftKey: true }]) {
      gesture('pointerdown', 0, extra)
      gesture('pointermove', 4)
      gesture('pointerup', 4)
      expect(document.getSelection()!.toString()).toBe('')
    }
    gesture('pointerdown', 0)
    gesture('pointermove', 4)
    gesture('pointerup', 10)
    expect(document.getSelection()!.toString()).toBe('file label')
    gesture('pointerdown', 0)
    gesture('pointermove', 4)
    dispose()
    document.getSelection()!.removeAllRanges()
    gesture('pointerdown', 0)
    gesture('pointermove', 4)
    expect(document.getSelection()!.toString()).toBe('')
  })
})
