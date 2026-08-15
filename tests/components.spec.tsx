// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnnotatedAssistantNode } from '../src/client/components/AnnotatedAssistantNode.tsx'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import { AnnotationDock } from '../src/client/components/AnnotationDock.tsx'
import type { AnnotationView } from '../src/client/controller.ts'
import type {
  AssistantAnnotationProps,
  InputAnnotationProps,
  UserAnnotationProps,
} from '../src/client/contract.ts'
import type { InlineAnnotationLocaleKey } from '../src/client/locales.ts'
import { fixturePayload } from './fixtures.ts'

const t = (key: InlineAnnotationLocaleKey, params?: Record<string, unknown>) => {
  const values: Partial<Record<InlineAnnotationLocaleKey, string>> = {
    'timeline.summary': `Added ${String(params?.count)} inline annotations`,
    'list.locate': 'Locate source',
    'status.draft': 'Ready to send',
    'status.sent': 'Sent',
    'dock.count': `${String(params?.count)} inline annotations`,
    'dock.pendingDetail': 'Ready to send · Open list',
    'panel.pending': `${String(params?.count)} ready to send`,
    'list.title': 'Inline annotations',
    'list.overallLabel': 'Overall request (optional)',
    'list.overall': 'Add an overall request',
    'list.edit': 'Edit',
    'list.delete': 'Delete',
    'send.idle': 'Send to task',
    'editor.title': 'Add annotation',
    'editor.commentLabel': 'Your comment',
    'editor.shortcut': 'Ctrl/⌘ ↵ to save',
    'editor.cancel': 'Cancel',
    'editor.save': 'Save annotation',
    'editor.placeholder': 'Explain what to change',
    'action.close': 'Close',
    'action.copy': 'Copy',
    'selection.actions': 'Selected text actions',
    'selection.copied': 'Selected text copied',
    'selection.add': 'Add annotation',
  }
  return values[key] ?? key
}

function baseView(): AnnotationView {
  return {
    annotations: [],
    outbox: [],
    overallRequirementDraft: '',
    editor: null,
    panelOpen: false,
    notice: null,
    activeAnnotationId: null,
    latestAssistantMessageId: null,
    storageAvailable: true,
  }
}

describe('annotation presentation', () => {
  it('folds a durable annotation submission and navigates by id', () => {
    const payload = fixturePayload()
    const navigate = vi.fn(async () => true)
    const view: AnnotationView = {
      ...baseView(),
      annotations: payload.annotations.map((item) => ({
        ...item,
        status: 'sent' as const,
        updatedAt: payload.createdAt,
        submissionId: payload.submissionId,
      })),
    }
    const props = {
      node: { data: { source: { kind: 'user', inlineAnnotations: payload }, content: [] } },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      navigate,
      loadImage: vi.fn(),
      t,
    } as unknown as UserAnnotationProps<'user'>
    render(<AnnotatedUserNode {...props} />)
    expect(screen.getByText('Added 1 inline annotations')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Added 1 inline annotations'))
    expect(screen.getByText('Explain this claim.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Locate source' }))
    expect(navigate).toHaveBeenCalledWith(payload.annotations[0]?.annotationId)
  })

  it('shows the composer dock only when recoverable annotation state exists', () => {
    const payload = fixturePayload()
    const setPanelOpen = vi.fn()
    const view: AnnotationView = {
      ...baseView(),
      annotations: [
        {
          ...payload.annotations[0]!,
          status: 'draft',
          updatedAt: payload.createdAt,
        },
      ],
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen,
      t,
    } as unknown as InputAnnotationProps
    const { rerender } = render(<AnnotationDock {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /1 inline annotations/u }))
    expect(setPanelOpen).toHaveBeenCalledWith(true)

    const emptyProps = {
      ...props,
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
    } as unknown as InputAnnotationProps
    rerender(<AnnotationDock {...emptyProps} />)
    expect(screen.queryByRole('button', { name: /inline annotations/u })).not.toBeInTheDocument()
  })

  it('renders the annotation list as a right-side dialog with task actions', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const navigate = vi.fn(async () => true)
    const submit = vi.fn(async () => undefined)
    const view: AnnotationView = {
      ...baseView(),
      annotations: [annotation],
      panelOpen: true,
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      setOverallRequirementDraft: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate,
      submit,
      withdraw: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(<AnnotationDock {...props} />)

    const panel = screen.getByRole('dialog', { name: 'Inline annotations' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByText(annotation.comment)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Overall request (optional)')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Send to task' }))
    expect(submit).toHaveBeenCalledWith(false, 'queue')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.setPanelOpen).toHaveBeenCalledWith(false)
  })

  it('shows add and copy actions next to an assistant text selection', async () => {
    const beginSelection = vi.fn()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 20, left: 40, right: 150, bottom: 42, width: 110, height: 22 }),
    })
    const view = baseView()
    const props = {
      node: {
        data: {
          status: 'closed',
          blocks: [{ kind: 'text', text: 'Alpha selected text omega' }],
          finalNode: { messageId: 'assistant-toolbar-test', seq: 9 },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      loadImage: vi.fn(),
      fileMentions: vi.fn(),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      beginSelection,
      openAnnotation: vi.fn(),
      registerEndpoint: vi.fn(() => () => undefined),
      updateHighlightRanges: vi.fn(),
      activateHighlight: vi.fn(),
      removeHighlights: vi.fn(),
      t,
    } as unknown as AssistantAnnotationProps
    render(<AnnotatedAssistantNode {...props} />)

    const paragraph = screen.getByText('Alpha selected text omega')
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 6)
    range.setEnd(text, 19)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.pointerUp(paragraph)

    const toolbar = await screen.findByRole('toolbar', { name: 'Selected text actions' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('selected text')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add annotation' }))
    expect(beginSelection).toHaveBeenCalledWith(
      expect.objectContaining({ quote: expect.objectContaining({ exact: 'selected text' }) }),
    )
  })

  it('uses a selection-positioned editor and saves with the keyboard shortcut', () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn()
    const closeEditor = vi.fn(() => true)
    const setPanelOpen = vi.fn()
    const view: AnnotationView = {
      ...baseView(),
      panelOpen: true,
      editor: {
        kind: 'new',
        capture: {
          messageId: payload.annotations[0]!.messageId,
          messageSeq: payload.annotations[0]!.messageSeq,
          responseVersion: payload.annotations[0]!.responseVersion,
          quote: payload.annotations[0]!.quote,
          rect: { top: 40, left: 80, right: 180, bottom: 64 },
        },
        text: 'Clarify this claim.',
        longSelectionConfirmed: true,
      },
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      setPanelOpen,
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(<AnnotationDock {...props} />)

    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toHaveStyle({ top: '74px', left: '80px' })
    fireEvent.keyDown(screen.getByLabelText('Your comment'), { key: 'Enter', ctrlKey: true })
    expect(saveEditor).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeEditor).toHaveBeenCalled()
    expect(setPanelOpen).not.toHaveBeenCalled()
  })
})
