// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationDock } from '../src/client/components/AnnotationDock.tsx'
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'
import type { InputAnnotationProps } from '../src/client/contract.ts'
import type { AnnotationView } from '../src/client/controller.ts'
import { en, type AnnotationLocaleKey } from '../src/client/locales.ts'
import { styles } from '../src/client/styles.ts'
import { fixturePayload } from './fixtures.ts'

afterEach(cleanup)

const t = (key: AnnotationLocaleKey, params?: Record<string, unknown>) =>
  en[key].replace(/\{(\w+)\}/gu, (_match: string, name: string) => String(params?.[name]))

function fixtureView(): AnnotationView {
  const payload = fixturePayload()
  const first = {
    ...payload.annotations[0]!,
    status: 'draft' as const,
    updatedAt: payload.createdAt,
  }
  return {
    annotations: [
      first,
      {
        ...first,
        annotationId: 'ann-compact-second' as typeof first.annotationId,
        ordinal: 2,
        annotation: 'Add a concrete example.',
      },
      {
        ...first,
        annotationId: 'ann-compact-history' as typeof first.annotationId,
        ordinal: 3,
        annotation: 'Already sent annotation.',
        status: 'sent',
        submissionId: payload.submissionId,
      },
    ],
    outbox: [],
    overallRequirementDraft: '',
    editor: null,
    editorSaveStatus: 'idle',
    deletedDraft: null,
    panelOpen: false,
    notice: null,
    activeAnnotationId: null,
    navigationEpoch: 0,
    markerAnnotationId: null,
    latestAssistantMessageId: null,
    storageAvailable: true,
  }
}

function dockProps(view: AnnotationView, compactSummary: boolean): InputAnnotationProps {
  return {
    sessionId: fixturePayload().sessionId,
    input: {
      draft: '',
      attachmentIds: [],
      draftRev: 0,
      phase: 'plain',
      occurrences: [],
      queue: [],
    },
    useAnnotations: <S,>(selector: (state: AnnotationView) => S) => selector(view),
    useWorkspaces: <S,>(selector: (state: { archivedSessionIds: readonly string[] }) => S) =>
      selector({ archivedSessionIds: [] }),
    useCompactSummary: <S,>(selector: (value: boolean) => S) => selector(compactSummary),
    repairComposerAttachment: vi.fn(),
    toggleComposerAttachment: vi.fn(() => true),
    autoAttachEnabled: () => false,
    ensureComposerAttachment: vi.fn(() => true),
    setPanelOpen: vi.fn(),
    openAnnotation: vi.fn(),
    closeEditor: vi.fn(() => false),
    saveEditor: vi.fn(() => view.annotations[0]!.annotationId),
    updateEditorText: vi.fn(),
    deleteDraft: vi.fn(),
    undoDelete: vi.fn(),
    dismissDeleteUndo: vi.fn(),
    navigate: vi.fn(async () => true),
    t,
  } as unknown as InputAnnotationProps
}

function StyledDock(props: InputAnnotationProps) {
  return (
    <>
      <style>{styles}</style>
      <AnnotationDock {...props} />
    </>
  )
}

describe('compact annotation summary', () => {
  it('updates the summary layout and leading icon without changing pending counts or controls', () => {
    const props = dockProps(fixtureView(), true)
    const { rerender } = render(<StyledDock {...props} />)
    const shell = screen.getByRole('region', { name: 'Annotations' })
    const summary = screen.getByRole('button', { name: 'Annotations' })
    const attach = screen.getByRole('button', { name: 'Attach 2 annotations to the next send' })
    const fold = screen.getByRole('button', { name: 'Expand annotations' })
    const body = summary.closest('.dia-dock-body')!

    expect(shell).toHaveAttribute('data-compact-summary', 'true')
    expect(shell).toHaveAttribute('data-panel-open', 'false')
    expect(summary.querySelector('svg')).toBeNull()
    expect(summary).toHaveTextContent('Annotations2 ready to attach')
    expect(getComputedStyle(body)).toMatchObject({
      width: 'fit-content',
      marginLeft: 'auto',
      maxWidth: '100%',
    })
    expect(getComputedStyle(summary)).toMatchObject({ flexGrow: '0', gap: '6px' })
    expect(attach.querySelector('svg')).not.toBeNull()
    expect(fold.querySelectorAll('svg')).toHaveLength(1)
    expect(fold.querySelector('.dia-dock__chevron')).toHaveAttribute('data-open', 'false')
    fireEvent.click(attach)
    expect(props.toggleComposerAttachment).toHaveBeenCalledOnce()
    fireEvent.click(fold)
    expect(props.setPanelOpen).toHaveBeenCalledWith(true)

    rerender(<StyledDock {...props} useCompactSummary={(selector) => selector(false)} />)
    expect(shell).toHaveAttribute('data-compact-summary', 'false')
    expect(screen.getByRole('button', { name: 'Annotations' })).toBe(summary)
    expect(summary.querySelector('svg')).not.toBeNull()
    expect(summary).toHaveTextContent('Annotations2 ready to attach')
    expect(getComputedStyle(summary)).toMatchObject({ flexGrow: '1', gap: '10px' })
    expect(getComputedStyle(attach.closest('.dia-dock__actions')!)).toMatchObject({
      gap: '10px',
      marginRight: '-7px',
    })
  })

  it.each([true, false])('counts only attached drafts when compact summary is %s', (compactSummary) => {
    const props = dockProps(fixtureView(), compactSummary)
    render(
      <StyledDock
        {...props}
        input={{ ...props.input, draft: `${COMPOSER_ATTACHMENT_TOKEN}Keep composer text` }}
      />,
    )
    const summary = screen.getByRole('button', { name: 'Annotations ×2' })
    const attach = screen.getByRole('button', { name: 'Detach 2 annotations' })
    expect(attach).toHaveAttribute('aria-pressed', 'true')
    expect(summary).not.toHaveTextContent('ready to attach')
    fireEvent.pointerEnter(summary)
    const preview = screen.getByRole('tooltip', { name: 'Attached annotations overview' })
    expect(within(preview).getByText('Explain this claim.')).toBeInTheDocument()
    expect(within(preview).getByText('Add a concrete example.')).toBeInTheDocument()
    expect(within(preview).queryByText('Already sent annotation.')).not.toBeInTheDocument()
    if (compactSummary) {
      expect(getComputedStyle(preview)).toMatchObject({
        position: 'absolute',
        right: '0px',
        width: '360px',
        maxWidth: '100%',
      })
      expect(preview.style.left).toBe('')
      expect(preview.style.top).toBe('')
    }
    fireEvent.click(summary)
    expect(props.setPanelOpen).toHaveBeenCalledWith(true)
    fireEvent.click(attach)
    expect(props.toggleComposerAttachment).toHaveBeenCalledOnce()
  })

  it('removes the compact hover overview while the full panel is visible', () => {
    const collapsedView = fixtureView()
    const attachedInput = {
      ...dockProps(collapsedView, true).input,
      draft: `${COMPOSER_ATTACHMENT_TOKEN}Keep composer text`,
    }
    const { rerender } = render(<StyledDock {...dockProps(collapsedView, true)} input={attachedInput} />)
    const summary = screen.getByRole('button', { name: 'Annotations ×2' })
    fireEvent.pointerEnter(summary)
    expect(screen.getByRole('tooltip', { name: 'Attached annotations overview' })).toBeInTheDocument()

    const expandedView = { ...collapsedView, panelOpen: true }
    rerender(<StyledDock {...dockProps(expandedView, true)} input={attachedInput} />)
    expect(screen.getByRole('region', { name: 'Annotations' })).toHaveAttribute('data-panel-open', 'true')
    expect(screen.queryByRole('tooltip', { name: 'Attached annotations overview' })).toBeNull()
    const expandedSummary = screen.getByRole('button', { name: 'Annotations ×2' })
    fireEvent.pointerEnter(expandedSummary)
    fireEvent.focus(expandedSummary)
    expect(screen.queryByRole('tooltip', { name: 'Attached annotations overview' })).toBeNull()
  })

  it('keeps the expanded list and summary row connected at the same readable width', () => {
    const view = { ...fixtureView(), panelOpen: true }
    const props = dockProps(view, true)
    const { rerender } = render(<StyledDock {...props} />)
    const shell = screen.getByRole('region', { name: 'Annotations' })
    const fold = screen.getByRole('button', { name: 'Collapse annotations' })
    const list = document.getElementById(fold.getAttribute('aria-controls')!)!
    const body = shell.querySelector<HTMLElement>('.dia-dock-body')!
    const main = shell.querySelector<HTMLElement>('.dia-dock__main')!
    const chevron = fold.querySelector('.dia-dock__chevron')!
    expect(list.parentElement).toBe(shell)
    expect(shell).toHaveAttribute('data-panel-open', 'true')
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(fold.querySelectorAll('svg')).toHaveLength(1)
    expect(chevron).toHaveAttribute('data-open', 'true')
    expect(getComputedStyle(chevron).transform).toBe('rotate(180deg)')
    expect(getComputedStyle(shell).position).toBe('relative')
    const bodyStyle = getComputedStyle(body)
    expect({
      width: bodyStyle.width,
      maxWidth: bodyStyle.maxWidth,
      borderRadius: bodyStyle.borderRadius,
      zIndex: bodyStyle.zIndex,
    }).toEqual({
      width: '560px',
      maxWidth: '100%',
      borderRadius: '0 0 12px 12px',
      zIndex: '9',
    })
    expect(getComputedStyle(main).flexGrow).toBe('1')
    const listStyle = getComputedStyle(list)
    expect({
      position: listStyle.position,
      bottom: listStyle.bottom,
      left: listStyle.left,
      right: listStyle.right,
      width: listStyle.width,
      maxWidth: listStyle.maxWidth,
      boxSizing: listStyle.boxSizing,
      borderBottomWidth: listStyle.borderBottomWidth,
      borderRadius: listStyle.borderRadius,
      transformOrigin: listStyle.transformOrigin,
      zIndex: listStyle.zIndex,
    }).toEqual({
      position: 'absolute',
      bottom: 'calc(100% - 1px)',
      left: 'auto',
      right: '0px',
      width: '560px',
      maxWidth: '100%',
      boxSizing: 'border-box',
      borderBottomWidth: '0px',
      borderRadius: '12px 12px 0 0',
      transformOrigin: 'bottom right',
      zIndex: '8',
    })
    expect(styles).toContain('animation: dia-panel-reveal 160ms ease-out both;')
    expect(styles).toContain('transform: translateY(4px);')
    expect(styles).not.toContain('scale(0.985)')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('button', { name: /^Sent/u })).toHaveAttribute('aria-expanded', 'false')
    within(list).getAllByRole('button', { name: en['list.edit'] })[0]!.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.setPanelOpen).toHaveBeenCalledWith(false)
    expect(props.setPanelOpen).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annotations' }))
    fireEvent.click(fold)
    expect(props.setPanelOpen).toHaveBeenCalledTimes(2)
    expect(props.setPanelOpen).toHaveBeenLastCalledWith(false)

    rerender(<StyledDock {...props} useCompactSummary={(selector) => selector(false)} />)
    expect(document.getElementById(fold.getAttribute('aria-controls')!)).toBe(list)
    expect(getComputedStyle(shell).borderRadius).toBe('0 0 12px 12px')
    expect(getComputedStyle(list)).toMatchObject({
      bottom: 'calc(100% - 1px)',
      left: '0px',
      right: '0px',
    })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it.each([true, false])(
    'keeps per-item edit, delete, undo, and history without local-data tools when compact summary is %s',
    (compactSummary) => {
      const view = { ...fixtureView(), panelOpen: true }
      const props = dockProps(view, compactSummary)
      const { rerender } = render(<StyledDock {...props} />)
      const draft = view.annotations[0]!
      const row = within(screen.getByRole('region', { name: en['group.drafts'] })).getAllByRole(
        'listitem',
      )[0]!

      expect(screen.queryByText(/Local data|本地数据/u)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /export|download|clear/iu })).not.toBeInTheDocument()
      expect(document.querySelector('.dia-local-data, .dia-local-status, .dia-clear-confirm')).toBeNull()

      fireEvent.click(within(row).getByRole('button', { name: en['list.edit'] }))
      expect(props.openAnnotation).toHaveBeenCalledWith(draft.annotationId)
      fireEvent.click(within(row).getByRole('button', { name: en['list.delete'] }))
      expect(props.deleteDraft).toHaveBeenCalledWith(draft.annotationId)

      rerender(
        <StyledDock
          {...props}
          useAnnotations={(selector) =>
            selector({
              ...view,
              annotations: view.annotations.filter((item) => item.annotationId !== draft.annotationId),
              deletedDraft: draft,
            })
          }
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: en['list.undo'] }))
      expect(props.undoDelete).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: /^Sent/u }))
      const history = screen.getByRole('region', { name: en['group.history'] })
      expect(within(history).getByText('Already sent annotation.')).toBeInTheDocument()
      expect(within(history).queryByRole('button', { name: en['list.delete'] })).not.toBeInTheDocument()
      expect(screen.getByText(en['list.immutable'])).toBeInTheDocument()

      rerender(
        <StyledDock
          {...props}
          useAnnotations={(selector) =>
            selector({ ...view, annotations: view.annotations.filter((item) => item.status === 'draft') })
          }
        />,
      )
      expect(document.querySelector('.dia-inline-panel__footer')).toBeNull()
    },
  )

  it.each([true, false])('keeps storage failure feedback when compact summary is %s', (compactSummary) => {
    const props = dockProps(
      {
        ...fixtureView(),
        panelOpen: true,
        storageAvailable: false,
        notice: { level: 'error', text: 'storage' },
      },
      compactSummary,
    )
    render(<StyledDock {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent(en['error.storage'])
    expect(screen.queryByRole('button', { name: /export|download|clear/iu })).not.toBeInTheDocument()
  })

  it('preserves a dirty inline editor and its IME guard while the setting changes', () => {
    const view = fixtureView()
    const props = dockProps(
      {
        ...view,
        editor: { kind: 'edit', annotationId: view.annotations[0]!.annotationId, text: '未保存的注解' },
      },
      true,
    )
    const { rerender } = render(<StyledDock {...props} />)
    const editor = screen.getByRole('dialog', { name: 'Edit annotation' })
    const input = within(editor).getByRole('textbox', { name: 'Your annotation' })
    fireEvent.pointerDown(document.body, { button: 0 })
    expect(editor).toHaveAttribute('data-decision-required', 'true')
    expect(input).toHaveFocus()
    fireEvent.compositionStart(input)

    rerender(<StyledDock {...props} useCompactSummary={(selector) => selector(false)} />)
    expect(screen.getByRole('dialog', { name: 'Edit annotation' })).toBe(editor)
    expect(within(editor).getByRole('textbox', { name: 'Your annotation' })).toBe(input)
    expect(input).toHaveValue('未保存的注解')
    expect(input).toHaveFocus()
    expect(editor).toHaveAttribute('data-decision-required', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.saveEditor).not.toHaveBeenCalled()
    fireEvent.click(within(editor).getByRole('button', { name: 'Save annotation' }))
    expect(props.saveEditor).toHaveBeenCalledOnce()
    expect(props.setPanelOpen).not.toHaveBeenCalled()
  })
})
