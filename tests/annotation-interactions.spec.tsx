// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnnotationComposerChip,
  AnnotationExperience,
  AnnotationRecordToggle,
} from '../src/client/components/AnnotationExperience.tsx'
import type { InputAnnotationProps } from '../src/client/contract.ts'
import { AnnotationController, type AnnotationView } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { FileAnnotationSource, OfficialDiffAnnotationSource } from '../src/shared/annotation-source.ts'
import { officialDiffQuote } from '../src/shared/official-source.ts'
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import { officialDiffHash, sha256Hex } from '../src/shared/snapshot-hash.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const t: InputAnnotationProps['t'] = (key, params) =>
  en[key as keyof typeof en].replace(/\{(\w+)\}/gu, (_match: string, name: string) => String(params?.[name]))

function harness(values = new Map<string, string>()) {
  const sessionId = 'interaction-session' as SessionIdentity
  const storage = new AnnotationStorage(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      },
    },
    sessionId,
  )
  const controller = new AnnotationController(
    sessionId,
    storage,
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
    DEFAULT_CONFIG,
    () => 1_700_000_000_000,
  )
  const actions = {
    beginSelection: (start: number, exact = 'source') => {
      controller.beginSelection({
        messageId: 'assistant-1' as MessageIdentity,
        messageSeq: 20,
        responseVersion: 'assistant-1' as MessageIdentity,
        quote: { exact, start, end: start + exact.length, prefix: '', suffix: '' },
        rect: { top: 10, left: 20, bottom: 28, right: 100 },
      })
    },
    setPanelOpen: vi.fn((open: boolean) => controller.setPanelOpen(open)),
    setRecordExpanded: vi.fn((expanded: boolean) => controller.setRecordExpanded(expanded)),
    toggleSelected: vi.fn((id: AnnotationId) => controller.toggleSelected(id)),
    detachAnnotations: vi.fn((ids: readonly AnnotationId[]) => controller.detachAnnotations(ids)),
    trashAnnotations: vi.fn((ids: readonly AnnotationId[]) => controller.trashAnnotations(ids)),
    openAnnotation: vi.fn((id: AnnotationId, presentation?: 'summary' | 'marker' | 'marker-edit') =>
      controller.openAnnotation(id, presentation),
    ),
    updateEditorText: vi.fn((text: string) => controller.updateEditorText(text)),
    saveEditor: vi.fn(() => controller.saveEditor()),
    closeEditor: vi.fn((force?: boolean) => controller.closeEditor(force)),
    suspendEditor: vi.fn(() => controller.suspendEditor()),
    confirmLongSelection: vi.fn(() => controller.confirmLongSelection()),
    deleteDraft: vi.fn((id: AnnotationId) => controller.deleteDraft(id)),
    undoDelete: vi.fn(() => controller.undoDelete()),
    dismissDeleteUndo: vi.fn(() => controller.dismissDeleteUndo()),
    discardOutbox: vi.fn(),
    navigate: vi.fn(async () => true),
    bindNoticeHost: vi.fn(() => () => undefined),
    repairComposerAttachment: vi.fn(),
    autoAttachEnabled: vi.fn(() => true),
    ensureComposerAttachment: vi.fn(() => true),
  }
  const useAnnotations = <S,>(selector: (view: AnnotationView) => S): S =>
    selector(useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot))
  const props = {
    sessionId,
    input: { draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] },
    useAnnotations,
    useWorkspaces: <S,>(selector: (state: { archivedSessionIds: readonly string[] }) => S) =>
      selector({ archivedSessionIds: [] }),
    t,
    ...actions,
  } as unknown as InputAnnotationProps
  const save = (start: number, note: string) => {
    actions.beginSelection(start)
    controller.updateEditorText(note)
    return controller.saveEditor()
  }
  return { controller, actions, props, save, values, storage }
}

type NewEditorSource = 'body' | 'file' | 'diff'

function beginNewEditor(h: ReturnType<typeof harness>, source: NewEditorSource, wholeFile = false): void {
  if (source === 'body') {
    h.actions.beginSelection(0)
    return
  }
  if (source === 'file') {
    const file: FileAnnotationSource = {
      kind: 'file',
      sessionId: h.controller.sessionId,
      resourceAddress: 'dsh-resource://file/session/interaction-session/%2Fworkspace%2Fnotes.txt',
      path: '/workspace/notes.txt',
      resourceVersion: 'file-v1',
      format: 'text',
      snapshot: { version: 1, hash: sha256Hex('hello'), bytes: 5, format: 'text', text: 'hello' },
      wholeFile,
      ...(wholeFile ? {} : { startLine: 1, endLine: 1, startColumn: 0, endColumn: 5 }),
      entry: 'sidebar',
    }
    h.controller.beginSelection({
      source: file,
      quote: wholeFile
        ? { exact: '', prefix: '', suffix: '', start: 0, end: 0 }
        : { exact: 'hello', prefix: '', suffix: '', start: 0, end: 5 },
      rect: { top: 10, left: 20, bottom: 28, right: 100 },
    })
    return
  }
  const diffBase = {
    version: 1,
    sessionId: h.controller.sessionId,
    seq: 20,
    turn: 1,
    fileIndex: 0,
    path: 'notes.txt',
    display: 'notes.txt',
    kind: 'text',
    before: true,
    after: true,
    coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
  } as const
  const diff: OfficialDiffAnnotationSource = {
    kind: 'official-diff',
    snapshot: { ...diffBase, hash: officialDiffHash(diffBase) },
    side: 'new',
    ...(wholeFile ? {} : { startLine: 1, endLine: 1 }),
    wholeFile,
    entry: 'sidebar',
  }
  h.controller.beginSelection({
    source: diff,
    quote: wholeFile ? { exact: '', prefix: '', suffix: '', start: 0, end: 0 } : officialDiffQuote(diff),
    rect: { top: 10, left: 20, bottom: 28, right: 100 },
  })
}

describe('annotation record and composer interactions', () => {
  it('derives source filters from all records and adds the file label only in the view', () => {
    const h = harness()
    const bodyId = h.save(0, 'Body note')
    act(() => {
      h.controller.beginSelection({
        source: {
          kind: 'file',
          sessionId: h.controller.sessionId,
          resourceAddress: 'dsh-resource://file/session/interaction-session/%2Fworkspace%2Fnotes.txt',
          path: '/workspace/notes.txt',
          resourceVersion: 'file-v1',
          format: 'text',
          snapshot: { version: 1, hash: sha256Hex('hello'), bytes: 5, format: 'text', text: 'hello' },
          wholeFile: false,
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 5,
          entry: 'sidebar',
        },
        quote: { exact: 'hello', prefix: '', suffix: '', start: 0, end: 5 },
        rect: { top: 10, left: 20, bottom: 28, right: 100 },
      })
      h.controller.updateEditorText('File note')
      h.controller.saveEditor()
      h.controller.setPanelOpen(true)
    })
    render(
      <>
        <AnnotationComposerChip {...h.props} />
        <AnnotationExperience {...h.props} />
      </>,
    )
    const record = screen.getByRole('region', { name: 'Annotations' })
    expect(within(record).getByRole('tab', { name: 'File' })).toBeInTheDocument()
    expect(within(record).getByRole('tab', { name: 'File' }).closest('.dia-record__header')).not.toBeNull()
    fireEvent.click(within(record).getByRole('tab', { name: 'File' }))
    expect(within(record).getByRole('button', { name: /^Annotations/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(record).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.pointerEnter(document.querySelector('.dia-composer-chip')!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('File:hello')
    expect(h.controller.getSnapshot().annotations[1]?.quote.exact).toBe('hello')
    const selected = h.controller.getSnapshot().selectedAnnotationIds
    const fileId = h.controller.getSnapshot().annotations[1]!.annotationId
    act(() => h.controller.deleteDraft(fileId))
    expect(within(record).queryByRole('tab', { name: 'File' })).toBeNull()
    expect(within(record).getAllByRole('listitem')).toHaveLength(1)
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual(selected.filter((id) => id !== fileId))
    expect(h.controller.getSnapshot().selectedAnnotationIds).toContain(bodyId)
    h.controller.dispose()
  })

  it('keeps a new conversation free of empty record copy, then opens the record from the model-side control', () => {
    const h = harness()
    const { rerender } = render(
      <>
        <AnnotationRecordToggle {...h.props} />
        <AnnotationExperience {...h.props} />
      </>,
    )
    expect(screen.queryByRole('button', { name: 'Show annotation records' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()

    act(() => {
      h.save(0, 'Clarify this point.')
    })
    rerender(
      <>
        <AnnotationRecordToggle {...h.props} />
        <AnnotationExperience {...h.props} />
      </>,
    )
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show annotation records' }))
    const record = screen.getByRole('region', { name: 'Annotations' })
    expect(within(record).getByText('Clarify this point.')).toBeInTheDocument()
    expect(within(record).queryByText('source')).toBeNull()
    const header = within(record).getByRole('button', { name: /^Annotations/ })
    fireEvent.click(record.querySelector('.dia-record__header')!)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(record.querySelector('.dia-record__body')!)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    h.controller.dispose()
  })

  it('uses each row paperclip to detach and reattach, leaving empty note text blank', () => {
    const h = harness()
    const id = h.save(0, '')
    act(() => {
      h.controller.setPanelOpen(true)
    })
    render(<AnnotationExperience {...h.props} />)
    const row = screen.getByRole('listitem')
    expect(within(row).queryByText('Highlight only')).toBeNull()
    const attached = within(row).getByRole('button', { name: 'Remove from message' })
    expect(attached).toHaveAttribute('data-active', 'true')
    fireEvent.click(attached)
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([])
    fireEvent.click(within(row).getByRole('button', { name: 'Send with message' }))
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([id])
    h.controller.dispose()
  })

  it('previews the selected quote and note on the composer chip and opens the expanded record', () => {
    const h = harness()
    h.save(0, 'Clarify this point.')
    render(
      <>
        <AnnotationComposerChip {...h.props} />
        <AnnotationExperience {...h.props} />
      </>,
    )
    const chip = screen.getByRole('button', { name: /Open annotation records/ })
    fireEvent.pointerEnter(chip.closest('.dia-composer-chip')!)
    const preview = screen.getByRole('tooltip')
    expect(within(preview).getByText('source')).toBeInTheDocument()
    expect(within(preview).getByText('Clarify this point.')).toBeInTheDocument()
    fireEvent.click(chip)
    expect(h.actions.setPanelOpen).toHaveBeenCalledWith(true)
    const header = screen.getByRole('button', { name: /^Annotations/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(chip)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(chip)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotations from this message' }))
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([])
    h.controller.dispose()
  })

  it.each(['', ' \n\t ', 'typed then erased'])(
    'cancels an empty new annotation after three outside clicks: %s',
    (value) => {
      const h = harness()
      act(() => {
        h.actions.beginSelection(0)
      })
      render(<AnnotationExperience {...h.props} />)
      if (value === 'typed then erased') {
        fireEvent.change(screen.getByRole('textbox'), { target: { value } })
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
      } else if (value) fireEvent.change(screen.getByRole('textbox'), { target: { value } })
      expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument()
      for (let click = 0; click < 2; click += 1) {
        fireEvent.pointerDown(document.body)
        expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument()
      }
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('dialog', { name: 'Add annotation' })).toBeNull()
      expect(h.controller.getSnapshot().annotations).toHaveLength(0)
      expect(h.controller.getSnapshot().editorDrafts).toHaveLength(0)
      expect(h.controller.getSnapshot().trash).toHaveLength(0)
      expect(h.controller.getSnapshot().panelOpen).toBe(false)
      expect(h.actions.saveEditor).not.toHaveBeenCalled()
      expect(h.actions.ensureComposerAttachment).not.toHaveBeenCalled()
      h.controller.dispose()
    },
  )

  it.each(['body', 'file', 'diff'] as const)(
    'shakes twice, then discards a blank %s editor without creating a record',
    async (source) => {
      const h = harness()
      act(() => beginNewEditor(h, source))
      render(
        <>
          <AnnotationRecordToggle {...h.props} />
          <AnnotationComposerChip {...h.props} />
          <AnnotationExperience {...h.props} />
        </>,
      )
      for (let click = 0; click < 2; click += 1) {
        fireEvent.pointerDown(document.body)
        const editor = screen.getByRole('dialog', { name: 'Add annotation' })
        await waitFor(() => expect(editor).toHaveClass('dia-record-editor--shake'))
        fireEvent.animationEnd(editor)
      }
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('dialog', { name: 'Add annotation' })).toBeNull()
      expect(h.actions.closeEditor).toHaveBeenCalledExactlyOnceWith(true)
      expect(h.actions.saveEditor).not.toHaveBeenCalled()
      expect(h.controller.getSnapshot()).toMatchObject({
        editor: null,
        annotations: [],
        editorDrafts: [],
        selectedAnnotationIds: [],
        trash: [],
      })
      expect(screen.queryByRole('button', { name: 'Show annotation records' })).toBeNull()
      expect(screen.queryByRole('button', { name: /Open annotation records/u })).toBeNull()
      h.controller.dispose()
    },
  )

  it('does not count editor controls or selected input text and keeps the count across rerenders', () => {
    const h = harness()
    act(() => beginNewEditor(h, 'body'))
    const { rerender } = render(<AnnotationExperience {...h.props} />)
    const editor = screen.getByRole('dialog', { name: 'Add annotation' })
    const input = within(editor).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.pointerDown(input)
    input.setSelectionRange(0, 0)
    fireEvent.pointerDown(within(editor).getByRole('button', { name: 'Save' }))
    fireEvent.pointerDown(document.body)
    rerender(<AnnotationExperience {...h.props} />)
    fireEvent.pointerDown(input)
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Add annotation' })).toBeNull()
    act(() => beginNewEditor(h, 'body'))
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Add annotation' })).toBeNull()
    expect(h.controller.getSnapshot().annotations).toHaveLength(0)
    h.controller.dispose()
  })

  it('keeps the quick editor focused when persistence rejects an explicit save', () => {
    const h = harness()
    act(() => beginNewEditor(h, 'body'))
    h.actions.saveEditor.mockImplementationOnce(() => {
      throw new Error('annotation-storage-failed')
    })
    render(<AnnotationExperience {...h.props} />)
    const editor = screen.getByRole('dialog', { name: 'Add annotation' })
    const input = within(editor).getByRole('textbox', { name: 'Your annotation' })
    fireEvent.change(input, { target: { value: 'Retain this draft' } })

    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(editor).toBeInTheDocument()
    expect(input).toHaveValue('Retain this draft')
    expect(input).toHaveFocus()
    expect(within(editor).queryByRole('alert')).toBeNull()
    expect(h.actions.ensureComposerAttachment).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('uses the latest textarea value when a pointer arrives before React publishes input', () => {
    const h = harness()
    act(() => beginNewEditor(h, 'body'))
    render(<AnnotationExperience {...h.props} />)
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(document.body)
    const input = screen.getByRole('textbox', { name: 'Your annotation' }) as HTMLTextAreaElement
    input.value = 'Most recent note'
    fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().annotations[0]?.annotation).toBe('Most recent note')

    act(() => beginNewEditor(h, 'body'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your annotation' }), {
      target: { value: 'Stale note' },
    })
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(document.body)
    const second = screen.getByRole('textbox', { name: 'Your annotation' }) as HTMLTextAreaElement
    second.value = ''
    fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().annotations).toHaveLength(1)
    expect(h.controller.getSnapshot().editor).toBeNull()
    expect(h.actions.saveEditor).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('uses the same detail card for a sent bubble and reattaches its existing id', () => {
    const h = harness()
    const id = h.save(0, 'Clarify this point.')
    const first = h.controller.createOutbox('queue', h.controller.sessionId)
    h.controller.reconcile({
      chat: {
        nodes: new Map([
          ['0', { kind: 'user', data: { source: { kind: 'user', inlineComments: first.payload } } }],
        ]),
      },
      queue: [],
      hasMore: false,
    })
    act(() => {
      h.controller.openAnnotation(id, 'marker')
    })
    render(<AnnotationExperience {...h.props} />)
    const card = screen.getByRole('dialog', { name: 'Edit annotation' })
    expect(within(card).getByRole('textbox')).toHaveValue('Clarify this point.')
    expect(within(card).queryByText('source')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Send again with message' }))
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([id])
    expect(h.controller.getSnapshot().annotations).toHaveLength(1)
    act(() => h.controller.setPanelOpen(true))
    expect(screen.getByRole('listitem')).toHaveAccessibleName(/Clarify this point\. · Sent/u)
    expect(screen.getByText('1 sent')).toBeInTheDocument()
    expect(screen.queryByText('1 pending')).toBeNull()
    h.controller.dispose()
  })

  it('removes only the captured attachments through one batch action and moves deletion into trash', () => {
    const h = harness()
    const first = h.save(0, 'First note')
    const second = h.save(20, 'Second note')
    render(<AnnotationComposerChip {...h.props} />)
    expect(screen.getByText('2 annotations')).toBeInTheDocument()
    const chip = document.querySelector('.dia-composer-chip')!
    const actions = chip.querySelector('.dia-composer-chip__actions')!
    expect(actions).toHaveAttribute('data-expanded', 'false')
    fireEvent.pointerEnter(chip)
    expect(actions).toHaveAttribute('data-expanded', 'true')
    fireEvent.pointerLeave(chip)
    expect(actions).toHaveAttribute('data-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotations from this message' }))
    expect(h.actions.detachAnnotations).toHaveBeenCalledExactlyOnceWith([first, second])
    expect(h.controller.getSnapshot().annotations).toHaveLength(2)
    expect(h.controller.getSnapshot().trash).toHaveLength(0)
    act(() => h.controller.toggleSelected(first))
    const remove = screen.getByRole('button', { name: 'Move attached annotations to the recycle bin' })
    expect(remove.nextElementSibling).toHaveAttribute('aria-label', 'Remove annotations from this message')
    fireEvent.click(remove)
    expect(h.actions.trashAnnotations).toHaveBeenCalledExactlyOnceWith([first])
    expect(h.controller.getSnapshot().annotations.map((item) => item.annotationId)).toEqual([second])
    expect(h.controller.getSnapshot().trash).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Open annotation records/ })).toBeNull()
    h.controller.dispose()
  })

  it('offers a short undo for the whole deleted batch, then leaves later deletions in trash', () => {
    vi.useFakeTimers()
    const h = harness()
    const first = h.save(0, 'First note')
    const second = h.save(20, 'Second note')
    render(<AnnotationExperience {...h.props} />)

    act(() => h.controller.trashAnnotations([first, second]))
    expect(h.controller.getSnapshot().notice).toMatchObject({
      level: 'success',
      messageKey: 'notice.deleted',
      params: { count: 2 },
      action: { kind: 'undo-delete', labelKey: 'list.undo' },
    })
    act(() => h.actions.undoDelete())
    expect(h.actions.undoDelete).toHaveBeenCalledOnce()
    expect(h.controller.getSnapshot().annotations.map((item) => item.annotationId)).toEqual([first, second])
    expect(h.controller.getSnapshot().trash).toHaveLength(0)

    act(() => h.controller.trashAnnotations([first, second]))
    expect(h.controller.getSnapshot().notice?.action?.kind).toBe('undo-delete')
    act(() => h.controller.dismissDeleteUndo())
    expect(h.controller.getSnapshot().deletedAnnotationIds).toEqual([])
    expect(h.controller.getSnapshot().trash).toHaveLength(2)
    h.controller.dispose()
  })

  it('shows untruncated note and quote in a record hover card while keeping source labels out of the row', () => {
    vi.useFakeTimers()
    const h = harness()
    const note = 'Full note '.repeat(40)
    const quote = 'Full source '.repeat(40)
    h.actions.beginSelection(0, quote)
    h.controller.updateEditorText(note)
    h.controller.saveEditor()
    h.controller.setPanelOpen(true)
    render(<AnnotationExperience {...h.props} />)
    const row = screen.getByRole('listitem')
    expect(within(row).queryByText('[Body]')).toBeNull()
    expect(within(row).getByText(note.trim())).toBeInTheDocument()
    const anchor = row.querySelector('.dia-record-row__preview-anchor')!
    fireEvent.pointerEnter(anchor.parentElement!)
    act(() => vi.advanceTimersByTime(500))
    const details = screen.getByRole('region', { name: 'Annotation details' })
    expect(within(details).getByText(note.trim())).toBeInTheDocument()
    expect(details.querySelector('q')?.textContent).toBe(quote)
    expect(within(details).getByText('[Body]')).toBeInTheDocument()
    h.controller.dispose()
  })

  it.each(['', 'Opinion'])(
    'composer input finishes a new editor without implicitly saving a blank note: %s',
    (text) => {
      const h = harness()
      h.actions.beginSelection(0)
      h.controller.updateEditorText(text)
      render(
        <>
          <input data-composer-input aria-label="Message" />
          <AnnotationExperience {...h.props} />
        </>,
      )
      const composer = screen.getByRole('textbox', { name: 'Message' })
      composer.focus()
      fireEvent.input(composer, { target: { value: 'Keep typing' } })
      expect(h.controller.getSnapshot().editor).toBeNull()
      expect(h.controller.getSnapshot().annotations).toHaveLength(text ? 1 : 0)
      if (!text) {
        expect(document.activeElement).toBe(composer)
        expect(h.controller.getSnapshot().editorDrafts).toHaveLength(0)
        expect(h.actions.saveEditor).not.toHaveBeenCalled()
      }
      h.controller.dispose()
    },
  )

  it('keeps composer focus and handles one implicit save attempt per input action', () => {
    const h = harness()
    act(() => beginNewEditor(h, 'body'))
    act(() => h.controller.updateEditorText('Draft opinion'))
    const saveEditor = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Temporary save failure')
      })
      .mockImplementation(() => h.controller.saveEditor())
    render(
      <>
        <input data-composer-input aria-label="Message" />
        <AnnotationExperience {...h.props} saveEditor={saveEditor} />
      </>,
    )
    const composer = screen.getByRole('textbox', { name: 'Message' })
    composer.focus()
    fireEvent(composer, new InputEvent('beforeinput', { bubbles: true, data: 'x', inputType: 'insertText' }))
    fireEvent.input(composer, { target: { value: 'x' } })
    expect(saveEditor).toHaveBeenCalledTimes(1)
    expect(h.controller.getSnapshot().editor).not.toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary save failure')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your annotation' }))
    composer.focus()
    fireEvent.input(composer, { target: { value: 'xy' } })
    expect(saveEditor).toHaveBeenCalledTimes(2)
    expect(h.controller.getSnapshot().annotations[0]?.annotation).toBe('Draft opinion')
    expect(document.activeElement).toBe(composer)
    h.controller.dispose()
  })

  it('does not let an earlier composition-end timer finish a later composition', () => {
    vi.useFakeTimers()
    const h = harness()
    act(() => beginNewEditor(h, 'body'))
    render(<AnnotationExperience {...h.props} />)
    const input = screen.getByRole('textbox', { name: 'Your annotation' })
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.compositionStart(input)
    act(() => vi.runOnlyPendingTimers())
    for (let click = 0; click < 3; click += 1) fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().editor).not.toBeNull()
    expect(h.actions.closeEditor).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    act(() => vi.runOnlyPendingTimers())
    for (let click = 0; click < 3; click += 1) fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().editor).toBeNull()
    h.controller.dispose()
  })

  it.each(['body', 'file', 'diff'] as const)(
    'retains explicit highlight-only saving for a blank %s selection',
    (source) => {
      const h = harness()
      act(() => beginNewEditor(h, source))
      render(<AnnotationExperience {...h.props} />)
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your annotation' }), { key: 'Enter' })
      expect(h.controller.getSnapshot().annotations[0]).toMatchObject({
        kind: 'highlight-only',
        annotation: '',
      })
      expect(h.controller.getSnapshot().selectedAnnotationIds).toHaveLength(1)
      h.controller.dispose()
    },
  )

  it.each(['file', 'diff'] as const)(
    'requires an opinion for an explicitly saved whole %s, then cancels the blank editor',
    (source) => {
      const h = harness()
      act(() => beginNewEditor(h, source, true))
      render(<AnnotationExperience {...h.props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Add an opinion for the whole file')
      expect(h.controller.getSnapshot().annotations).toHaveLength(0)
      for (let click = 0; click < 3; click += 1) fireEvent.pointerDown(document.body)
      expect(h.controller.getSnapshot().editor).toBeNull()
      expect(h.controller.getSnapshot().trash).toHaveLength(0)
      h.controller.dispose()
    },
  )

  it('suspends an existing annotation edit without deleting its saved record', () => {
    const h = harness()
    const id = h.save(0, 'Saved opinion')
    act(() => h.controller.openAnnotation(id, 'summary'))
    render(<AnnotationExperience {...h.props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Your annotation' }), { target: { value: '' } })
    fireEvent.pointerDown(document.body)
    expect(h.actions.suspendEditor).toHaveBeenCalledOnce()
    expect(h.controller.getSnapshot().annotations[0]).toMatchObject({
      annotationId: id,
      annotation: 'Saved opinion',
    })
    expect(h.controller.getSnapshot().trash).toHaveLength(0)
    h.controller.dispose()
  })

  it.each(['body', 'file', 'diff'] as const)(
    'does not restore a cancelled blank %s editor after its buffer was persisted',
    async (source) => {
      const h = harness()
      act(() => beginNewEditor(h, source))
      act(() => h.controller.updateEditorText(' \n\t '))
      h.controller.flush()
      const before = JSON.parse(h.values.get(h.storage.key)!) as { editorDraft?: { text: string } }
      expect(before.editorDraft?.text).toBe(' \n\t ')
      render(<AnnotationExperience {...h.props} />)
      for (let click = 0; click < 3; click += 1) fireEvent.pointerDown(document.body)
      expect(h.controller.getSnapshot().editor).toBeNull()
      expect(await h.controller.whenStorageIdle()).toBe(true)
      const after = JSON.parse(h.values.get(h.storage.key)!) as { editorDraft?: { text: string } }
      expect(after.editorDraft).toBeUndefined()
      h.controller.dispose()
      const restored = harness(h.values)
      expect(restored.controller.getSnapshot()).toMatchObject({
        editor: null,
        editorDrafts: [],
        annotations: [],
        selectedAnnotationIds: [],
        trash: [],
      })
      restored.controller.dispose()
    },
  )

  it('keeps outside-click counting stable across edits and allows explicit highlight-only saves', () => {
    const h = harness()
    h.actions.beginSelection(0)
    render(<AnnotationExperience {...h.props} />)
    fireEvent.pointerDown(document.body)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'temporary' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => h.actions.beginSelection(0))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(h.controller.getSnapshot().annotations[0]?.kind).toBe('highlight-only')
    h.controller.dispose()
  })

  it('does not submit or cancel a composing editor when focus moves to the composer', () => {
    const h = harness()
    h.actions.beginSelection(0)
    render(
      <>
        <input data-composer-input aria-label="Message" />
        <AnnotationExperience {...h.props} />
      </>,
    )
    fireEvent.compositionStart(screen.getByRole('textbox', { name: 'Your annotation' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'x' } })
    expect(h.controller.getSnapshot().editor).not.toBeNull()
    expect(h.actions.saveEditor).not.toHaveBeenCalled()
    expect(h.actions.closeEditor).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('keeps a sent record labelled sent when its paperclip is selected for another message', () => {
    const h = harness()
    const id = h.save(0, 'Clarify this point.')
    const first = h.controller.createOutbox('queue', h.controller.sessionId)
    act(() => {
      h.controller.reconcile({
        chat: {
          nodes: new Map([
            ['0', { kind: 'user', data: { source: { kind: 'user', annotationSubmission: first.payload } } }],
          ]),
        },
        queue: [],
        hasMore: false,
      })
      h.controller.setPanelOpen(true)
      h.controller.toggleSelected(id)
    })
    expect(h.controller.getSnapshot().annotations[0]?.status).toBe('sent')
    render(
      <>
        <AnnotationComposerChip {...h.props} />
        <AnnotationExperience {...h.props} />
      </>,
    )
    const record = screen.getByRole('region', { name: 'Annotations' })
    expect(within(record).getByRole('listitem', { name: /Sent$/u })).toBeInTheDocument()
    expect(within(record).getByText('1 sent')).toBeInTheDocument()
    expect(within(record).getByRole('button', { name: 'Remove from message' })).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(screen.getByRole('button', { name: /Open annotation records, 1/ })).toBeInTheDocument()
    h.controller.dispose()
  })
})
