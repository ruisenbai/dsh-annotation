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
    const node = document.createElement('div')
    document.body.append(node)
    const root = focusRoot()
    root.append(document.createElement('section'))
    Object.defineProperty(node, 'offsetParent', { configurable: true, value: null })
    expect(isFocusViewHidden(node)).toBe(true)
    // 聚焦视图外的普通视图节点会被判定为重复节点（由下一测试覆盖）……
    expect(isDuplicatedByFocusView(node)).toBe(true)
    // ……但隐藏判断只针对聚焦激活期间，非聚焦时不做干预。
    document.body.innerHTML = ''
    document.body.append(node)
    expect(isFocusViewHidden(node)).toBe(false)
  })

  it('marks normal-view nodes as duplicates while the focus view is active', () => {
    const root = focusRoot()
    root.append(document.createElement('section'))
    const node = document.createElement('div')
    document.body.append(node)
    expect(isDuplicatedByFocusView(node)).toBe(true)
    const inside = document.createElement('div')
    root.append(inside)
    expect(isDuplicatedByFocusView(inside)).toBe(false)
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
})
