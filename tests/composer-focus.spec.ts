// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { composerInput, createComposerFocus } from '../src/client/composer-focus.ts'
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.getSelection()?.removeAllRanges()
})

function fixture(text = 'draft text') {
  const seat = document.createElement('div')
  seat.dataset.composerSeat = ''
  const anchor = document.createElement('span')
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const root = document.createElement('div')
  root.dataset.composerInput = ''
  root.setAttribute('contenteditable', 'true')
  root.textContent = text
  card.append(root)
  seat.append(anchor, card)
  document.body.append(seat)
  cleanups.push(() => seat.remove())
  const focus = createComposerFocus(() => composerInput(anchor))
  cleanups.push(() => focus.dispose())
  const select = (start: number, end = start) => {
    root.focus()
    document.getSelection()!.setBaseAndExtent(root.firstChild!, start, root.firstChild!, end)
    document.dispatchEvent(new Event('selectionchange'))
  }
  return { seat, root, focus, select }
}

describe('official composer focus', () => {
  it('remembers a backward selection after focus moves to the annotation editor', () => {
    const { seat, root, focus, select } = fixture()
    select(7, 2)
    const annotation = document.createElement('textarea')
    seat.append(annotation)
    annotation.focus()
    document.getSelection()?.removeAllRanges()
    const request = focus.capture()!
    focus.restore(request)
    expect(document.activeElement).toBe(root)
    expect(document.getSelection()?.anchorOffset).toBe(7)
    expect(document.getSelection()?.focusOffset).toBe(2)
    expect(root.textContent).toBe('draft text')
  })

  it('preserves the visible caret when a claim token is inserted or removed', () => {
    const { root, focus, select } = fixture()
    select(3)
    const attaching = focus.capture()!
    root.textContent = COMPOSER_ATTACHMENT_TOKEN + 'draft text'
    focus.restore(attaching)
    expect(document.getSelection()?.focusOffset).toBe(4)
    const detaching = focus.capture()!
    root.textContent = 'draft text'
    focus.restore(detaching)
    expect(document.getSelection()?.focusOffset).toBe(3)
  })

  it('restores a caret beside a reference chip without entering or replacing the chip', () => {
    const { root, focus } = fixture('')
    const before = document.createTextNode('See ')
    const chip = document.createElement('span')
    chip.setAttribute('contenteditable', 'false')
    chip.textContent = '@guide'
    const after = document.createTextNode(' next')
    root.append(before, chip, after)
    root.focus()
    document.getSelection()!.setBaseAndExtent(root, 2, root, 2)
    const request = focus.capture()!
    root.prepend(document.createTextNode(COMPOSER_ATTACHMENT_TOKEN))
    focus.restore(request)
    expect(document.getSelection()?.anchorNode).toBe(root)
    expect(document.getSelection()?.anchorOffset).toBe(3)
    expect(root.querySelector('[contenteditable="false"]')).toBe(chip)
    expect(chip.textContent).toBe('@guide')
  })

  it('ignores a queued request after the user focuses another control', () => {
    const { seat, root, focus, select } = fixture()
    select(2)
    const request = focus.capture()!
    const another = document.createElement('input')
    seat.append(another)
    another.focus()
    focus.restore(request)
    expect(document.activeElement).toBe(another)
    expect(root.textContent).toBe('draft text')
  })

  it('retains the beginning of a later paragraph when a token is added to the first paragraph', () => {
    const { root, focus } = fixture('')
    const first = document.createElement('p')
    first.textContent = 'first line'
    const second = document.createElement('p')
    second.textContent = 'second line'
    root.append(first, second)
    root.focus()
    document.getSelection()!.setBaseAndExtent(second.firstChild!, 0, second.firstChild!, 0)
    const request = focus.capture()!
    first.textContent = COMPOSER_ATTACHMENT_TOKEN + first.textContent
    focus.restore(request)
    expect(document.getSelection()?.anchorNode).toBe(second.firstChild)
    expect(document.getSelection()?.anchorOffset).toBe(0)
  })

  it('ignores a stale request when the composer draft changes', () => {
    const { root, focus, select } = fixture()
    select(2)
    const request = focus.capture()!
    root.textContent = 'new draft'
    root.blur()
    focus.restore(request)
    expect(document.activeElement).not.toBe(root)
    expect(root.textContent).toBe('new draft')
  })

  it('keeps the active IME selection when composition starts before focus restoration', () => {
    const { root, focus, select } = fixture()
    select(2)
    const request = focus.capture()!
    select(5)
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    focus.restore(request)
    expect(document.getSelection()?.anchorOffset).toBe(5)
    expect(document.getSelection()?.focusOffset).toBe(5)
  })

  it('does not transfer a request to a replacement session editor', () => {
    const { seat, root, focus, select } = fixture()
    select(2)
    const request = focus.capture()!
    const replacement = root.cloneNode(true)
    root.replaceWith(replacement)
    focus.restore(request)
    expect(document.activeElement).not.toBe(replacement)
    expect(seat.querySelector('[data-composer-input]')).toBe(replacement)
  })
})
