// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { MessageSelectionActions } from '../src/client/components/MessageSelectionActions.tsx'
import type { SelectionCapture } from '../src/client/selection.ts'
import type { MessageIdentity } from '../src/shared/types.ts'

afterEach(cleanup)

const capture: SelectionCapture = {
  messageId: 'reply' as MessageIdentity,
  messageSeq: 3,
  responseVersion: 'reply' as MessageIdentity,
  quote: { exact: 'selected text', prefix: '', suffix: '', start: 0, end: 13 },
  rect: { left: 10, right: 120, top: 20, bottom: 40 },
}

function fixture(
  selected: SelectionCapture | null = capture,
  overrides: Partial<Pick<SessionSnapshot, 'removed' | 'subagent'>> = {},
) {
  const session = { removed: false, subagent: null, ...overrides } as SessionSnapshot
  const props = {
    trigger: 'selection' as const,
    dismiss: vi.fn(),
    clearSelection: vi.fn(),
    readText: vi.fn<() => string | null>(() => 'selected text'),
    readAnnotationSelection: vi.fn<() => SelectionCapture | null>(() => selected),
    beginAnnotation: vi.fn(() => true),
    inputActions: { insertQuote: vi.fn(() => true) },
    useSession: (select: (state: SessionSnapshot) => unknown) => select(session),
    t: (key: string) =>
      ({
        'selection.toolbar': 'Selection actions',
        'selection.quote': 'Quote text',
        'selection.annotate': 'Add annotation',
      })[key] ?? key,
  }
  const mount = () =>
    render(<MessageSelectionActions {...(props as ComponentProps<typeof MessageSelectionActions>)} />)
  return { props, session, mount }
}

describe('shared message selection actions', () => {
  it('offers quote and annotation in one toolbar and preserves the selection on pointer down', () => {
    const { mount } = fixture()
    mount()
    const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
    expect(screen.getAllByRole('toolbar')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Quote text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument()
    expect(fireEvent.pointerDown(toolbar)).toBe(false)
  })

  it('uses the Host quote action and closes only after the composer accepts the quote', () => {
    const { props, mount } = fixture()
    mount()
    props.inputActions.insertQuote.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Quote text' }))
    expect(props.dismiss).not.toHaveBeenCalled()
    expect(props.clearSelection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Quote text' }))
    expect(props.inputActions.insertQuote).toHaveBeenLastCalledWith('selected text')
    expect(props.clearSelection).toHaveBeenCalledOnce()
    expect(props.dismiss).toHaveBeenCalledOnce()
    expect(props.beginAnnotation).not.toHaveBeenCalled()
  })

  it('opens the current annotation range and closes only when it is accepted', () => {
    const { props, mount } = fixture()
    mount()
    props.beginAnnotation.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
    expect(props.dismiss).not.toHaveBeenCalled()
    const next = { ...capture, messageSeq: 5 }
    props.readAnnotationSelection.mockReturnValue(next)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
    expect(props.beginAnnotation).toHaveBeenLastCalledWith(next)
    expect(props.clearSelection).toHaveBeenCalledOnce()
    expect(props.dismiss).toHaveBeenCalledOnce()
    expect(props.inputActions.insertQuote).not.toHaveBeenCalled()
  })

  it('keeps quotation available for text outside an annotatable assistant message', () => {
    const { props, mount } = fixture(null)
    mount()
    expect(screen.queryByRole('button', { name: 'Add annotation' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quote text' }))
    expect(props.inputActions.insertQuote).toHaveBeenCalledWith('selected text')
  })

  it.each(['Quote text', 'Add annotation'])('dismisses stale selections without applying %s', (label) => {
    const { props, mount } = fixture()
    mount()
    props.readText.mockReturnValue(null)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(props.dismiss).toHaveBeenCalledOnce()
    expect(props.beginAnnotation).not.toHaveBeenCalled()
    expect(props.inputActions.insertQuote).not.toHaveBeenCalled()
    expect(props.clearSelection).not.toHaveBeenCalled()
  })

  it('dismisses an annotation action when its mounted source disappears', () => {
    const { props, mount } = fixture()
    mount()
    props.readAnnotationSelection.mockReturnValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
    expect(props.dismiss).toHaveBeenCalledOnce()
    expect(props.beginAnnotation).not.toHaveBeenCalled()
  })

  it.each(['continuable', 'one-shot', 'unknown'] as const)(
    'matches Host selection availability for a %s child without parent availability metadata',
    (mode) => {
      const { props, mount } = fixture(capture, {
        subagent: {
          address: {
            parentSessionId: 'parent-session' as SessionId,
            childSessionId: 'child-session' as SessionId,
            mode,
          },
        },
      })
      mount()
      if (mode !== 'continuable') {
        expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
        expect(props.dismiss).toHaveBeenCalledOnce()
        return
      }
      expect(screen.getAllByRole('toolbar')).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Quote text' }))
      expect(props.inputActions.insertQuote).toHaveBeenCalledWith('selected text')
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
      expect(props.beginAnnotation).toHaveBeenCalledWith(capture)
    },
  )

  it('removes the actions when the conversation becomes unavailable', () => {
    const { props, session, mount } = fixture()
    const view = mount()
    const next = {
      ...props,
      useSession: (select: (state: SessionSnapshot) => unknown) => select({ ...session, removed: true }),
    }
    view.rerender(<MessageSelectionActions {...(next as ComponentProps<typeof MessageSelectionActions>)} />)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(props.dismiss).toHaveBeenCalledOnce()
  })
})
