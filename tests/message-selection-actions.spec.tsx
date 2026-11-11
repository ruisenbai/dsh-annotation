// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionSnapshot,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
  sideChat = false,
  parent?: SessionId,
) {
  const session = {
    sessionId: 'session-test' as SessionId,
    removed: false,
    subagent: null,
    ...overrides,
  } as SessionSnapshot
  const input = { phase: 'plain' } as InputState
  const retention = { mainView: 0 }
  const summary = { retainedBy: retention } as SessionSummary
  const catalog = { phase: 'ready', byId: { [session.sessionId]: summary } } as SessionListState
  const props = {
    trigger: 'selection' as const,
    dismiss: vi.fn(),
    clearSelection: vi.fn(),
    readText: vi.fn<() => string | null>(() => 'selected text'),
    readAnnotationSelection: vi.fn<() => SelectionCapture | null>(() => selected),
    beginAnnotation: vi.fn(() => true),
    readSideChatTarget: vi.fn<() => string | undefined>(() => undefined),
    ...(sideChat ? { beginSideAnnotation: vi.fn<(selection: SelectionCapture) => boolean>(() => true) } : {}),
    ...(parent === undefined ? {} : { sideChatMainSessionId: parent }),
    inputActions: { insertQuote: vi.fn(() => true) },
    useSession: (select: (state: SessionSnapshot) => unknown) => select(session),
    useSessions: (select: (state: SessionListState) => unknown) => select(catalog),
    useInput: (select: (state: InputState) => unknown) => select(input),
    t: (key: string) =>
      ({
        'selection.toolbar': 'Selection actions',
        'selection.quote': 'Quote text',
        'selection.annotate': 'Add annotation',
        'selection.sideChat': 'Annotate in sidebar',
      })[key] ?? key,
  }
  const mount = () =>
    render(<MessageSelectionActions {...(props as ComponentProps<typeof MessageSelectionActions>)} />)
  return { props, session, input, retention, mount }
}

describe('shared message selection actions', () => {
  it('offers a former side chat its own sidebar action only while opened as a main page', () => {
    const { props, retention, mount } = fixture(capture, {}, true, 'original-main' as SessionId)
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Annotate in sidebar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument()
    retention.mainView = 1
    mounted.rerender(
      <MessageSelectionActions {...(props as ComponentProps<typeof MessageSelectionActions>)} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Annotate in sidebar' }))
    expect(props.beginSideAnnotation).toHaveBeenCalledExactlyOnceWith(capture)
    retention.mainView = 0
    mounted.rerender(
      <MessageSelectionActions {...(props as ComponentProps<typeof MessageSelectionActions>)} />,
    )
    expect(screen.queryByRole('button', { name: 'Annotate in sidebar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument()
  })

  it('opens annotations for A, B and C through the same toolbar while the main input is submitting', () => {
    const { props, input, mount } = fixture(capture, {}, true)
    props.useInput = (select) => select({ ...input, phase: 'submitting' })
    mount()
    const selections = ['A', 'B', 'C'].map((exact, index) => ({
      ...capture,
      quote: { ...capture.quote, exact, start: index, end: index + 1 },
    }))
    for (const selection of selections) {
      props.readAnnotationSelection.mockReturnValue(selection)
      fireEvent.click(screen.getByRole('button', { name: 'Annotate in sidebar' }))
    }
    expect(props.beginSideAnnotation!.mock.calls.map(([selection]) => selection)).toEqual(selections)
    expect(props.clearSelection).toHaveBeenCalledTimes(3)
    expect(props.dismiss).toHaveBeenCalledTimes(3)
    expect(props.beginAnnotation).not.toHaveBeenCalled()
    expect(props.inputActions.insertQuote).not.toHaveBeenCalled()
    expect(screen.getAllByRole('toolbar')).toHaveLength(1)
  })

  it('names the receiving chat in the toolbar without adding a second entry', () => {
    const { props, mount } = fixture(capture, {}, true)
    props.readSideChatTarget.mockReturnValue('Receiving now: Side chat 2')
    mount()
    expect(screen.getByText('Receiving now: Side chat 2')).toBeInTheDocument()
    expect(screen.getAllByRole('toolbar')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Annotate in sidebar' })).toHaveLength(1)
  })

  it('keeps a rejected side annotation selection and omits the action without its main-session capability', () => {
    const side = fixture(capture, {}, true)
    side.props.beginSideAnnotation!.mockReturnValue(false)
    const mounted = side.mount()
    fireEvent.click(screen.getByRole('button', { name: 'Annotate in sidebar' }))
    expect(side.props.clearSelection).not.toHaveBeenCalled()
    expect(side.props.dismiss).not.toHaveBeenCalled()
    mounted.unmount()
    fixture().mount()
    expect(screen.queryByRole('button', { name: 'Annotate in sidebar' })).not.toBeInTheDocument()
  })

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

  it.each(['adjudicating', 'submitting', 'sending'] as const)(
    'preserves the selection when annotation editing is locked during %s',
    (phase) => {
      const { props, input, mount } = fixture()
      props.useInput = (select) => select({ ...input, phase })
      mount()
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
      expect(props.beginAnnotation).not.toHaveBeenCalled()
      expect(props.dismiss).not.toHaveBeenCalled()
      expect(props.clearSelection).not.toHaveBeenCalled()
    },
  )

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
