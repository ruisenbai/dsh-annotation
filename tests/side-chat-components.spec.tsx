// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  SideChatComposerChip,
  SideChatHistoryReferences,
  SideChatRecordPanel,
  SideChatSubmissionNotice,
  type SideChatControlsProps,
} from '../src/client/components/SideChatReferences.tsx'
import { SideChatGuideEntry } from '../src/client/components/SideChatGuideEntry.tsx'
import { ReferenceMarkerButton } from '../src/client/components/ReferenceMarkerButton.tsx'
import { SideChatFailure, type SideChatView } from '../src/client/side-chat-controller.ts'
import { en } from '../src/client/locales.ts'
import type { SideChatId, SideChatReference, SideChatReferenceId } from '../src/shared/side-chat-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageIdentity, SubmissionId } from '../src/shared/types.ts'

afterEach(cleanup)

const mainId = 'main-session' as SessionId
const sideId = 'side-session' as SessionId
const chatId = 'side-chat-a' as SideChatId
const copy: Readonly<Record<string, string>> = en
const t: SideChatControlsProps['t'] = (key, params) => {
  const template = copy[key]
  if (template === undefined) throw new Error(`Missing annotation copy: ${key}`)
  return template.replace(/\{([^}]+)\}/g, (_match: string, name: string) => String(params?.[name] ?? ''))
}

function reference(
  id: string,
  exact = 'The same source text',
  message = 'message-a',
  start = 0,
): SideChatReference {
  return {
    referenceId: id as SideChatReferenceId,
    sourceSessionId: mainId,
    messageId: message as MessageIdentity,
    messageSeq: 10,
    responseVersion: message as MessageIdentity,
    quote: { exact, prefix: '', suffix: '', start, end: start + exact.length },
    createdAt: 1,
  }
}

it('releases a reference bubble highlight when that record leaves the view', () => {
  // The tooltip's geometry observer has no measurements to deliver in jsdom.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const onPreview = vi.fn()
  const source = reference('removed-source')
  const rendered = render(
    <ReferenceMarkerButton
      group={{ annotationIds: [source.referenceId], top: 0, left: 0, width: 24, height: 24, fontSize: 12 }}
      item={{ sideChatId: chatId, reference: source, ordinal: 1, disabled: false }}
      t={t}
      remove={vi.fn()}
      locate={vi.fn(async () => true)}
      onPreview={onPreview}
    />,
  )
  fireEvent.focus(screen.getByRole('button', { name: 'Reference 1' }))
  expect(onPreview).toHaveBeenLastCalledWith(true)
  rendered.unmount()
  expect(onPreview).toHaveBeenLastCalledWith(false)
})

function view(references: readonly SideChatReference[] = [], panelOpen = true): SideChatView {
  return {
    mainSessionId: mainId,
    chats: [
      {
        sideChatId: chatId,
        sideSessionId: sideId,
        title: null,
        archived: false,
        status: 'ready',
        references,
        referenceRecords: references,
        failure: null,
        outbox: null,
        panelOpen,
        saveState: 'saved',
      },
    ],
    activeSideChatId: chatId,
    active: {
      sideChatId: chatId,
      sideSessionId: sideId,
      title: null,
      archived: false,
      status: 'ready',
      references,
      referenceRecords: references,
      failure: null,
      outbox: null,
      panelOpen,
      saveState: 'saved',
    },
    sideSessionId: sideId,
    status: 'ready',
    visible: true,
    references,
    failure: null,
    storageAvailable: true,
    storageOutdated: false,
    saveState: 'saved',
    recoveryAvailable: true,
    outbox: null,
  }
}

function controls(snapshot: SideChatView | null): SideChatControlsProps {
  return {
    useSideChat: (selector) => selector(snapshot),
    removeReference: vi.fn(),
    removeAllReferences: vi.fn(),
    locateReference: vi.fn(async () => true),
    retrySideChat: vi.fn(),
    retrySideChatSave: vi.fn(),
    exportSideChatRecovery: vi.fn(),
    openSideChat: vi.fn(),
    closeSideChat: vi.fn(),
    createSideChat: vi.fn(),
    selectSideChat: vi.fn(),
    openSideChatAlone: vi.fn(),
    setReferencePanelOpen: vi.fn(),
    t,
  }
}

function guideProps(snapshot: SideChatView | null) {
  return {
    ...controls(snapshot),
    useSessions: (selector: (state: { byId: Record<string, never> }) => unknown) => selector({ byId: {} }),
    entryId: 'side-chat',
    kind: 'annotationsidechat',
    title: en['sideChat.title'],
    description: en['sideChat.guideDescription'],
  } as unknown as React.ComponentProps<typeof SideChatGuideEntry>
}

describe('side-chat guide entry', () => {
  it('shows one fixed-meaning pending badge across parallel chats', () => {
    const base = view()
    const second = {
      ...base.active!,
      sideChatId: 'side-chat-b' as SideChatId,
      title: 'Second chat',
      references: [reference('reference-b', 'Another source')],
    }
    const snapshot: SideChatView = {
      ...base,
      chats: [{ ...base.active!, references: [reference('reference-a'), reference('reference-a2')] }, second],
    }
    render(<SideChatGuideEntry {...guideProps(snapshot)} />)
    const badge = screen.getByLabelText('3 pending references')
    expect(badge).toHaveTextContent('3')
    expect(screen.queryByText('2 side chats')).toBeNull()
  })

  it('switches the receiving chat and opens the panel without closing it first', () => {
    const props = guideProps(view())
    render(<SideChatGuideEntry {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.guideSwitch'] }))
    const row = screen.getByRole('menuitem', { name: /Side chat 1/u })
    fireEvent.click(row)
    expect(props.selectSideChat).toHaveBeenCalledWith(chatId)
    expect(props.openSideChat).toHaveBeenCalledOnce()
  })

  it('creates a fresh chat and opens it from the same switch list', () => {
    const props = guideProps(view())
    render(<SideChatGuideEntry {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.guideSwitch'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['sideChat.guideNew'] }))
    expect(props.createSideChat).toHaveBeenCalledOnce()
    expect(props.openSideChat).toHaveBeenCalledOnce()
  })

  it('opens the panel from the capsule itself', () => {
    const props = guideProps(view())
    render(<SideChatGuideEntry {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Keep discussing the selected text/u }))
    expect(props.openSideChat).toHaveBeenCalledOnce()
  })

  it('renders no count badge while every chat has no pending reference', () => {
    render(<SideChatGuideEntry {...guideProps(view())} />)
    expect(screen.queryByLabelText(/pending references/u)).toBeNull()
  })
})

describe('side-chat reference records', () => {
  it('keeps repeated text as separate rows and removes only the chosen occurrence', () => {
    const first = reference('reference-a')
    const second = reference('reference-b', first.quote.exact, 'message-b', 40)
    const props = controls(view([first, second]))
    render(
      <>
        <textarea aria-label="Question" defaultValue="Compare these sources" />
        <SideChatRecordPanel {...props} />
      </>,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-dia-side-chat-reference', first.referenceId)
    expect(rows[1]).toHaveAttribute('data-dia-side-chat-reference', second.referenceId)
    fireEvent.click(within(rows[1]!).getByRole('button', { name: en['sideChat.remove'] }))
    expect(props.removeReference).toHaveBeenCalledExactlyOnceWith(second.referenceId)
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Compare these sources')
  })

  it('displays unsafe source text literally and locates the recorded occurrence', async () => {
    const source = reference('unsafe-source', '<img src=x onerror=alert(1)>\n[link](javascript:alert(2))')
    const locate = vi.fn(async () => false)
    const props = { ...controls(view([source])), locateReference: locate }
    const { container } = render(
      <>
        <SideChatRecordPanel {...props} />
        <p role="status">{en['sideChat.locationFailed']}</p>
      </>,
    )
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.locate'] }))
    await waitFor(() => expect(locate).toHaveBeenCalledExactlyOnceWith(source))
  })

  it('expands the chip into the panel and clears only pending references', () => {
    const props = controls(view([reference('reference-a')], false))
    render(
      <>
        <SideChatComposerChip {...props} />
        <SideChatRecordPanel {...props} />
      </>,
    )
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 references' }))
    expect(props.setReferencePanelOpen).toHaveBeenCalledExactlyOnceWith(true)
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.removeAll'] }))
    expect(props.removeAllReferences).toHaveBeenCalledOnce()
    expect(props.removeReference).not.toHaveBeenCalled()
  })

  it('counts only references, leaving annotations to their own capsule', () => {
    render(<SideChatComposerChip {...controls(view([reference('reference-a')]))} />)
    expect(screen.getByText('1 references')).toBeInTheDocument()
    expect(screen.queryByText(/annotations/u)).toBeNull()
  })

  it('hides the capsule while no reference is pending', () => {
    const { container } = render(<SideChatComposerChip {...controls(view())} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps submitted references read-only and permits source navigation', async () => {
    const source = Object.freeze(reference('sent-source', 'Immutable quoted content'))
    const references = Object.freeze([source])
    const locate = vi.fn(async () => true)
    render(<SideChatHistoryReferences references={references} onLocate={locate} t={t} />)
    expect(screen.queryByRole('button', { name: en['sideChat.remove'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Submitted references \(1\)/u }))
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.locate'] }))
    await waitFor(() => expect(locate).toHaveBeenCalledExactlyOnceWith(source))
    expect(references[0]?.quote.exact).toBe('Immutable quoted content')
  })

  it('expands exact multiline quotes in a separate focusable region and restores the summary', () => {
    const text = `First line\nhttps://example.test/${'long-path-'.repeat(100)}\n${'continuous'.repeat(300)}`
    const source = reference('long-source', text)
    const { container } = render(<SideChatRecordPanel {...controls(view([source]))} />)
    const original = container.querySelector('.dia-side-chat-record__quote')!
    expect(original).toHaveAttribute('data-expanded', 'false')
    expect(original.textContent).not.toContain('\n')
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.expand'] }))
    const full = container.querySelector('.dia-side-chat-record__quote')!
    expect(full).toHaveAttribute('data-expanded', 'true')
    expect(full).toHaveAttribute('tabindex', '0')
    expect(full.closest('[role="button"]')).toBeNull()
    expect(full.textContent).toBe(text)
    expect(screen.getByRole('button', { name: en['sideChat.remove'] })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.collapse'] }))
    expect(container.querySelector('.dia-side-chat-record__quote')).toHaveAttribute('data-expanded', 'false')
    expect(source.quote.exact).toBe(text)
  })

  it('opens a fixed body-portal preview by tap and keyboard and dismisses with tap, Escape, and outside click', () => {
    const source = reference('preview-source', 'Original\nfull quote')
    const { container } = render(<SideChatRecordPanel {...controls(view([source]))} />)
    const trigger = container.querySelector<HTMLElement>('[data-dia-side-chat-preview-trigger]')!
    fireEvent.pointerDown(trigger, { pointerType: 'touch' })
    fireEvent.click(trigger)
    const preview = screen.getByRole('dialog')
    expect(preview.parentElement).toBe(document.body)
    expect(preview.style.position).toBe('fixed')
    expect(preview.textContent).toContain(source.quote.exact)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(trigger, { pointerType: 'touch' })
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => trigger.focus())
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => screen.getByRole('dialog').focus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports an unknown frozen request even with no pending references', () => {
    const base = view()
    const snapshot: SideChatView = {
      ...base,
      failure: new SideChatFailure('send-unknown'),
      active: { ...base.active!, failure: new SideChatFailure('send-unknown') },
    }
    const { container } = render(<SideChatComposerChip {...controls(snapshot)} />)
    expect(container).toBeEmptyDOMElement()
    expect(snapshot.failure?.code).toBe('send-unknown')
  })

  it('keeps an explicitly opened preview through pointer leave and releases it when its owning panel hides', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<SideChatRecordPanel {...controls(view([reference('pinned-preview')]))} />)
      const trigger = container.querySelector<HTMLElement>('[data-dia-side-chat-preview-trigger]')!
      fireEvent.click(trigger)
      fireEvent.pointerLeave(trigger.parentElement!)
      fireEvent.pointerLeave(screen.getByRole('dialog'))
      act(() => vi.advanceTimersByTime(250))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await act(async () => {
        container.hidden = true
      })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a read-only exact frozen question preview without replacing the composer draft', () => {
    const question = '<script>unsafe()</script>\nKeep the exact original question'
    const base = view()
    const outbox: SideChatView['outbox'] = {
      status: 'unknown',
      payload: {
        protocolVersion: 1,
        source: 'dsh-annotation-side-chat',
        submissionId: 'frozen-submit' as SubmissionId,
        mainSessionId: mainId,
        sideSessionId: sideId,
        delivery: 'queue',
        createdAt: 1,
        protocolLocale: 'en',
        question,
        references: [],
        attachmentIdentities: [],
      },
    }
    const snapshot: SideChatView = {
      ...base,
      failure: new SideChatFailure('send-unknown'),
      outbox,
      active: { ...base.active!, failure: new SideChatFailure('send-unknown'), outbox },
    }
    const { container } = render(
      <>
        <textarea aria-label="Question" defaultValue="Next question draft" />
        <SideChatSubmissionNotice {...controls(snapshot)} />
      </>,
    )
    expect(container.querySelector('script')).toBeNull()
    const preview = container.querySelector('[data-dia-side-chat-frozen-question]')
    expect(preview).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Next question draft')
  })

  it('renders nothing outside a side association', () => {
    const { container } = render(
      <>
        <SideChatComposerChip {...controls(null)} />
        <SideChatRecordPanel {...controls(null)} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
