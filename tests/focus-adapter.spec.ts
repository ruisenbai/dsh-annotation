// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFocusChatAdapter,
  FOCUS_CHANGED_EVENT,
  isDuplicatedByFocusView,
  isFocusViewHidden,
} from '../src/client/focus-adapter.ts'

function focusRoot(): HTMLElement {
  const root = document.createElement('div')
  root.dataset.focusFlow = 'true'
  document.body.append(root)
  return root
}

function message(sessionId = 'main-session', messageId = 'reply-1'): HTMLElement {
  const node = document.createElement('section')
  node.dataset.dshAnnotationSessionId = sessionId
  node.dataset.dshAnnotationMessageId = messageId
  return node
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('dsh-focus-chat optional adapter', () => {
  it('stays passive when no focus view root exists', () => {
    const node = document.createElement('div')
    document.body.append(node)
    expect(isFocusViewHidden(node)).toBe(false)
    expect(isDuplicatedByFocusView(node)).toBe(false)
  })

  it('pauses measurement for hidden nodes only while the focus view is active', () => {
    const node = message()
    document.body.append(node)
    const root = focusRoot()
    root.append(message())
    Object.defineProperty(node, 'offsetParent', { configurable: true, value: null })
    expect(isFocusViewHidden(node)).toBe(true)
    expect(isDuplicatedByFocusView(node)).toBe(true)
    document.body.innerHTML = ''
    document.body.append(node)
    expect(isFocusViewHidden(node)).toBe(false)
  })

  it('marks only the same Session and message as a normal-view duplicate', () => {
    const root = focusRoot()
    root.append(message())
    const node = message()
    document.body.append(node)
    expect(isDuplicatedByFocusView(node)).toBe(true)
    const side = message('side-session')
    const anotherReply = message('main-session', 'reply-2')
    document.body.append(side, anotherReply)
    expect(isDuplicatedByFocusView(side)).toBe(false)
    expect(isFocusViewHidden(side)).toBe(false)
    expect(isDuplicatedByFocusView(anotherReply)).toBe(false)
    const inside = message()
    root.append(inside)
    expect(isDuplicatedByFocusView(inside)).toBe(false)
  })

  it('reads Session identity from a containing Conversation when the reply has no own Session marker', () => {
    const root = focusRoot()
    root.dataset.conversationSession = 'main-session'
    const focused = message()
    delete focused.dataset.dshAnnotationSessionId
    root.append(focused)
    const conversation = document.createElement('div')
    conversation.dataset.conversationSession = 'main-session'
    const normal = message()
    delete normal.dataset.dshAnnotationSessionId
    conversation.append(normal)
    document.body.append(conversation)
    expect(isDuplicatedByFocusView(normal)).toBe(true)
    conversation.dataset.conversationSession = 'side-session'
    expect(isDuplicatedByFocusView(normal)).toBe(false)
  })

  it('emits the focus-changed event only when focus activity flips', async () => {
    const listener = vi.fn()
    window.addEventListener(FOCUS_CHANGED_EVENT, listener)
    const adapter = createFocusChatAdapter()
    adapter.start()
    expect(listener).not.toHaveBeenCalled()
    focusRoot().append(document.createElement('section'))
    await tick()
    expect(listener).toHaveBeenCalledTimes(1)
    // 根节点内容变化但激活状态不变时不再通知。
    focusRoot().append(document.createElement('section'))
    await tick()
    expect(listener).toHaveBeenCalledTimes(1)
    document.body.innerHTML = ''
    await tick()
    expect(listener).toHaveBeenCalledTimes(2)
    adapter.dispose()
    window.removeEventListener(FOCUS_CHANGED_EVENT, listener)
  })

  it('notifies mounted replies when focused Session or message identities change', async () => {
    const listener = vi.fn()
    window.addEventListener(FOCUS_CHANGED_EVENT, listener)
    const adapter = createFocusChatAdapter()
    adapter.start()
    const root = focusRoot()
    const focused = message()
    root.append(focused)
    await tick()
    expect(listener).toHaveBeenCalledTimes(1)
    focused.dataset.dshAnnotationSessionId = 'side-session'
    await tick()
    expect(listener).toHaveBeenCalledTimes(2)
    focused.dataset.dshAnnotationMessageId = 'reply-2'
    await tick()
    expect(listener).toHaveBeenCalledTimes(3)
    root.append(document.createElement('p'))
    await tick()
    expect(listener).toHaveBeenCalledTimes(3)
    adapter.dispose()
    window.removeEventListener(FOCUS_CHANGED_EVENT, listener)
  })
})
