// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { installCodexUiCompatibility } from '../src/client/codex-ui-compatibility.ts'

const ATTRIBUTE = 'data-dsh-annotation-compatibility'
const sidebar: StoredEntry = { component: null, options: {}, registrant: 'michengai-codex-ui' }
const history: StoredEntry = { component: null, options: { id: 'codex-ui-input-history' } }

function fixture(initial: readonly StoredEntry[] = []) {
  const root = document.createElement('html')
  const entries = new Map<string, readonly StoredEntry[]>([['sidebar', initial]])
  const listeners = new Set<(name: string) => void>()
  const read = vi.fn((name: string) => entries.get(name) ?? [])
  return {
    root,
    read,
    listeners,
    slots: {
      entries: read,
      subscribe(listener: (name: string) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    set(name: string, values: readonly StoredEntry[]) {
      entries.set(name, values)
      for (const listener of listeners) listener(name)
    },
  }
}

describe('Codex UI automatic compatibility', () => {
  it('leaves the official interface unchanged and ignores unrelated slot changes', () => {
    const f = fixture([{ component: null, options: {}, registrant: 'another-sidebar' }])
    const dispose = installCodexUiCompatibility(f.slots, f.root)
    try {
      expect(f.root.hasAttribute(ATTRIBUTE)).toBe(false)
      f.read.mockClear()
      f.set('conversation.chat.node', [sidebar])
      expect(f.read).not.toHaveBeenCalled()
      expect(f.root.hasAttribute(ATTRIBUTE)).toBe(false)
    } finally {
      dispose()
    }
  })

  it('detects an already registered client and cleans up on annotation unload', () => {
    const f = fixture([sidebar])
    const dispose = installCodexUiCompatibility(f.slots, f.root)
    expect(f.root.getAttribute(ATTRIBUTE)).toBe('codex-ui')
    dispose()
    expect(f.root.hasAttribute(ATTRIBUTE)).toBe(false)
    expect(f.listeners.size).toBe(0)
    f.set('sidebar', [sidebar])
    expect(f.root.hasAttribute(ATTRIBUTE)).toBe(false)
  })

  it('follows late loading, partial registration, unload, and reactivation', () => {
    const f = fixture()
    const dispose = installCodexUiCompatibility(f.slots, f.root)
    try {
      f.set('conversation.input.dock', [history])
      expect(f.root.getAttribute(ATTRIBUTE)).toBe('codex-ui')
      f.set('sidebar', [sidebar])
      f.set('conversation.input.dock', [])
      expect(f.root.getAttribute(ATTRIBUTE)).toBe('codex-ui')
      f.set('sidebar', [])
      expect(f.root.hasAttribute(ATTRIBUTE)).toBe(false)
      f.set('sidebar', [sidebar])
      expect(f.root.getAttribute(ATTRIBUTE)).toBe('codex-ui')
    } finally {
      dispose()
    }
  })

  it('keeps compatibility state local to each client context and restores prior attributes', () => {
    const first = fixture([sidebar])
    const second = fixture()
    first.root.setAttribute(ATTRIBUTE, 'existing')
    const disposeFirst = installCodexUiCompatibility(first.slots, first.root)
    const disposeSecond = installCodexUiCompatibility(second.slots, second.root)
    try {
      expect(first.root.getAttribute(ATTRIBUTE)).toBe('codex-ui')
      expect(second.root.hasAttribute(ATTRIBUTE)).toBe(false)
    } finally {
      disposeSecond()
      disposeFirst()
    }
    expect(first.root.getAttribute(ATTRIBUTE)).toBe('existing')
  })
})
