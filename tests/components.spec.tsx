// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { styles } from '../src/client/styles.ts'
import { fixturePayload } from './fixtures.ts'

afterEach(cleanup)

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
    'editor.discard': 'Discard the unsaved changes?',
    'editor.keepEditing': 'Keep editing',
    'editor.confirmDiscard': 'Discard changes',
    'editor.save': 'Save annotation',
    'editor.placeholder': 'Explain what to change',
    'action.close': 'Close',
    'action.copy': 'Copy',
    'selection.actions': 'Selected text actions',
    'selection.copied': 'Selected text copied',
    'selection.copyFailed': 'Copy failed; copy the selection manually',
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
    fireEvent.click(screen.getByRole('button', { name: /Inline annotations/u }))
    expect(setPanelOpen).toHaveBeenCalledWith(true)

    const emptyProps = {
      ...props,
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
    } as unknown as InputAnnotationProps
    rerender(<AnnotationDock {...emptyProps} />)
    expect(screen.queryByRole('button', { name: /inline annotations/u })).not.toBeInTheDocument()
  })

  it('expands an official-style inline list with two-line rows and icon actions', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const secondAnnotation = {
      ...annotation,
      annotationId: 'ann-test-2' as typeof annotation.annotationId,
      ordinal: 2,
      quote: { ...annotation.quote, exact: 'second selected source' },
      comment: 'Use a concrete example here.',
    }
    const navigate = vi.fn(async () => true)
    const submit = vi.fn(async () => undefined)
    const view: AnnotationView = {
      ...baseView(),
      annotations: [annotation, secondAnnotation],
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

    const panel = screen.getByRole('region', { name: 'Inline annotations' })
    expect(panel).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Inline annotations' })).not.toBeInTheDocument()
    const rows = panel.querySelectorAll<HTMLElement>('.dia-item')
    expect(rows).toHaveLength(2)
    expect(within(panel).getByText(secondAnnotation.comment)).toBeInTheDocument()
    const firstRow = within(rows[0]!)
    const comment = firstRow.getByText(annotation.comment)
    expect(comment.parentElement?.children).toHaveLength(2)
    expect(within(panel).queryByText(annotation.annotationId)).not.toBeInTheDocument()
    expect(within(panel).getByLabelText('Overall request (optional)')).toBeInTheDocument()

    for (const name of ['Locate source', 'Edit', 'Delete']) {
      expect(firstRow.getByRole('button', { name })).not.toHaveTextContent(/\S/u)
    }
    fireEvent.click(firstRow.getByRole('button', { name: 'Locate source' }))
    expect(navigate).toHaveBeenCalledWith(annotation.annotationId)
    fireEvent.click(firstRow.getByRole('button', { name: 'Edit' }))
    expect(props.openAnnotation).toHaveBeenCalledWith(annotation.annotationId)
    fireEvent.click(firstRow.getByRole('button', { name: 'Delete' }))
    expect(props.deleteDraft).toHaveBeenCalledWith(annotation.annotationId)

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
    expect(await within(toolbar).findByRole('button', { name: 'Selected text copied' })).toBeInTheDocument()

    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    const execCommand = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    fireEvent.pointerUp(paragraph)
    fireEvent.click(await within(toolbar).findByRole('button', { name: 'Copy' }))
    expect(
      await within(toolbar).findByRole('button', { name: 'Copy failed; copy the selection manually' }),
    ).toBeInTheDocument()
    expect(execCommand).toHaveBeenCalledWith('copy')

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add annotation' }))
    expect(beginSelection).toHaveBeenCalledWith(
      expect.objectContaining({ quote: expect.objectContaining({ exact: 'selected text' }) }),
    )
  })

  it('anchors each number to the selected text final line and recomputes after zoom-like resize', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const elementRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    let finalLineTop = 150
    let finalLineRight = 360
    const rect = (top: number, right: number, width: number): DOMRect =>
      ({
        x: right - width,
        y: top,
        top,
        right,
        bottom: top + 20,
        left: right - width,
        width,
        height: 20,
        toJSON: () => ({}),
      }) as DOMRect
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        const ignored = this.startContainer.parentElement?.closest(
          '[data-dsh-inline-annotation-ignore="true"]',
        )
        return (ignored === null
          ? [rect(finalLineTop - 30, 240, 140), rect(finalLineTop, finalLineRight, 180)]
          : [rect(105, 140, 80)]) as unknown as DOMRectList
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(100, 550, 500),
    })

    try {
      const view: AnnotationView = { ...baseView(), annotations: [annotation] }
      const props = {
        node: {
          data: {
            status: 'closed',
            blocks: [
              { kind: 'reasoning', text: 'before selected source after' },
              { kind: 'text', text: 'before selected source after' },
            ],
            finalNode: { messageId: annotation.messageId, seq: annotation.messageSeq },
          },
          location: { kind: 'root' },
        },
        useTurnData: () => undefined,
        openFile: vi.fn(),
        loadImage: vi.fn(),
        fileMentions: vi.fn(),
        useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
        beginSelection: vi.fn(),
        openAnnotation: vi.fn(),
        registerEndpoint: vi.fn(() => () => undefined),
        updateHighlightRanges: vi.fn(),
        activateHighlight: vi.fn(),
        removeHighlights: vi.fn(),
        t,
      } as unknown as AssistantAnnotationProps
      render(<AnnotatedAssistantNode {...props} />)

      const marker = screen.getByRole('button', { name: '#1: Explain this claim.' })
      expect(marker).toHaveStyle({ top: '48px', left: '315px' })

      finalLineTop = 190
      fireEvent(screen.getByText('assistant.reasoning').closest('details')!, new Event('toggle'))
      expect(marker).toHaveStyle({ top: '88px', left: '315px' })

      finalLineRight = 410
      fireEvent(window, new Event('resize'))
      expect(marker).toHaveStyle({ top: '88px', left: '365px' })
    } finally {
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
      if (elementRect === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
      else Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', elementRect)
    }
  })

  it('offers explicit actions before discarding unsaved editor changes', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const closeEditor = vi.fn((force = false) => force)
    const view: AnnotationView = {
      ...baseView(),
      annotations: [annotation],
      editor: { kind: 'edit', annotationId: annotation.annotationId, text: 'Unsaved change' },
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      saveEditor: vi.fn(),
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(<AnnotationDock {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Discard the unsaved changes?')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your comment')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(closeEditor).toHaveBeenLastCalledWith(true)
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
    render(
      <>
        <style>{styles}</style>
        <AnnotationDock {...props} />
      </>,
    )

    const editor = screen.getByRole('dialog', { name: 'Add annotation' })
    expect(editor).toHaveStyle({ top: '74px', left: '80px' })
    expect(window.getComputedStyle(editor).boxSizing).toBe('border-box')
    fireEvent.keyDown(screen.getByLabelText('Your comment'), { key: 'Enter', ctrlKey: true })
    expect(saveEditor).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeEditor).toHaveBeenCalled()
    expect(setPanelOpen).not.toHaveBeenCalled()
  })
})
