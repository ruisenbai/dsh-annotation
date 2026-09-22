// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationDock } from '../src/client/components/AnnotationDock.tsx'
import type { InputAnnotationProps } from '../src/client/contract.ts'
import { AnnotationController, editorBufferKey, type AnnotationView } from '../src/client/controller.ts'
import { en, zh } from '../src/client/locales.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { diffCapture, diffSnapshot, diffSource } from './diff-fixtures.ts'
import { diffQuote, type DiffSnapshot } from '../src/shared/diff-source.ts'
import { styles } from '../src/client/styles.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type {
  AnnotationConfig,
  AnnotationId,
  MessageIdentity,
  ProcessingMode,
  SessionIdentity,
  SubmissionId,
} from '../src/shared/types.ts'

const controllers: AnnotationController[] = []
afterEach(() => {
  cleanup()
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function translate(locale: 'en' | 'zh' = 'en'): InputAnnotationProps['t'] {
  const dictionary = new Map<unknown, string>(
    Object.entries(locale === 'en' ? { ...en, edit: 'Edit' } : { ...zh, edit: '编辑' }),
  )
  return (key, params) => {
    const template = dictionary.get(key)
    if (template === undefined) throw new Error(`Missing test translation: ${String(key)}`)
    return template.replace(/\{(\w+)\}/gu, (_match: string, name: string) => String(params?.[name]))
  }
}

function capture(start: number, length = 5) {
  const text = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const messageId = 'interaction-source' as MessageIdentity
  return {
    messageId,
    responseVersion: messageId,
    messageSeq: 10,
    quote: { exact: text.slice(start, start + length), start, end: start + length, prefix: '', suffix: '' },
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  }
}

function harness(config: AnnotationConfig = DEFAULT_CONFIG) {
  const values = new Map<string, string>()
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
    config,
    () => 1_700_000_000_000,
  )
  controllers.push(controller)
  const actions = {
    suspendEditor: vi.fn(() => controller.suspendEditor()),
    resumeEditor: vi.fn((key: string) => controller.resumeEditor(key)),
    discardEditorDraft: vi.fn((key: string) => controller.discardEditorDraft(key)),
    chooseOverlap: vi.fn((id?: AnnotationId) => controller.chooseOverlap(id)),
    dismissOverlap: vi.fn(() => controller.dismissOverlap()),
    toggleSelected: vi.fn((id: AnnotationId) => controller.toggleSelected(id)),
    setProcessingMode: vi.fn((mode: ProcessingMode) => controller.setProcessingMode(mode)),
    selectRetry: vi.fn((id: SubmissionId) => controller.selectRetry(id)),
    setPanelOpen: vi.fn((open: boolean) => controller.setPanelOpen(open)),
    openAnnotation: vi.fn((id: AnnotationId) => controller.openAnnotation(id)),
    updateEditorText: vi.fn((text: string) => controller.updateEditorText(text)),
    confirmLongSelection: vi.fn(() => controller.confirmLongSelection()),
    saveEditor: vi.fn(() => controller.saveEditor()),
    closeEditor: vi.fn((force?: boolean) => controller.closeEditor(force)),
    deleteDraft: vi.fn((id: AnnotationId) => controller.deleteDraft(id)),
    undoDelete: vi.fn(() => controller.undoDelete()),
    dismissDeleteUndo: vi.fn(() => controller.dismissDeleteUndo()),
    discardOutbox: vi.fn((id: SubmissionId) => controller.discardOutbox(id)),
    navigate: vi.fn(async () => true),
    withdraw: vi.fn(async () => undefined),
    autoAttachEnabled: vi.fn(() => true),
    ensureComposerAttachment: vi.fn(() => true),
    toggleComposerAttachment: vi.fn(() => true),
    repairComposerAttachment: vi.fn(),
  }
  const useAnnotations = <S,>(selector: (view: AnnotationView) => S): S =>
    selector(useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot))
  const input: InputAnnotationProps['input'] = {
    draft: 'Keep ordinary composer text',
    attachmentIds: ['existing-attachment' as InputAnnotationProps['input']['attachmentIds'][number]],
    draftRev: 1,
    phase: 'plain' as const,
    occurrences: [],
    queue: [],
  }
  return {
    controller,
    storage,
    actions,
    input,
    props: (patch: Partial<InputAnnotationProps> = {}) =>
      ({
        sessionId,
        input,
        useAnnotations,
        useWorkspaces: <S,>(selector: (state: { archivedSessionIds: readonly string[] }) => S) =>
          selector({ archivedSessionIds: [] }),
        useCompactSummary: <S,>(selector: (compact: boolean) => S) => selector(true),
        t: translate(),
        ...actions,
        ...patch,
      }) as unknown as InputAnnotationProps,
    save(start: number, text: string) {
      controller.beginSelection(capture(start))
      if (controller.getSnapshot().overlap !== null) controller.chooseOverlap()
      controller.updateEditorText(text)
      controller.confirmLongSelection()
      return controller.saveEditor()
    },
  }
}

describe('annotation send controls and editing drafts', () => {
  it('selects only the chosen annotations and keeps paused buffers out of the send preview', () => {
    const h = harness()
    h.controller.setSelectionMode(true)
    const ids = [h.save(0, 'First opinion'), h.save(10, 'Second opinion'), h.save(20, 'Third opinion')]
    h.controller.beginSelection(capture(30))
    h.controller.updateEditorText('Paused opinion')
    h.controller.suspendEditor()
    render(<AnnotationDock {...h.props()} />)

    expect(screen.getByText('0 selected for this send')).toBeInTheDocument()
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Annotation 1: Hold for later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annotation 3: Hold for later' }))
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([ids[0], ids[2]])
    expect(screen.getByRole('button', { name: 'Annotation 2: Hold for later' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const summary = screen.getByRole('button', { name: '2 selected for this send' })
    fireEvent.pointerEnter(summary)
    const preview = screen.getByRole('tooltip', { name: 'Annotations in this send' })
    expect(within(preview).getByText('First opinion')).toBeInTheDocument()
    expect(within(preview).getByText('Third opinion')).toBeInTheDocument()
    expect(within(preview).queryByText('Second opinion')).toBeNull()
    expect(within(preview).queryByText('Paused opinion')).toBeNull()
    expect(h.actions.ensureComposerAttachment).not.toHaveBeenCalled()
    expect(h.input).toMatchObject({
      draft: 'Keep ordinary composer text',
      attachmentIds: ['existing-attachment'],
    })
  })

  it.each(['en', 'zh'] as const)('labels every suspended editor as excluded from sending in %s', (locale) => {
    const h = harness()
    h.controller.setSelectionMode(true)
    const id = h.save(0, 'Saved opinion')
    h.controller.openAnnotation(id)
    h.controller.updateEditorText('Unfinished edit')
    h.controller.beginSelection(capture(20))
    h.controller.updateEditorText('Unfinished new annotation')
    h.controller.suspendEditor()
    h.controller.setPanelOpen(true)
    const dictionary = locale === 'en' ? en : zh
    render(<AnnotationDock {...h.props({ t: translate(locale) })} />)

    const drafts = screen.getByRole('region', { name: dictionary['drafts.title'] })
    expect(within(drafts).getAllByText(dictionary['selection.unsaved'])).toHaveLength(2)
    expect(within(drafts).getAllByRole('button', { name: dictionary['drafts.resume'] })).toHaveLength(2)
    expect(h.controller.getSnapshot().annotations).toHaveLength(1)
    expect(h.controller.getSnapshot().annotations[0]?.annotation).toBe('Saved opinion')
    expect(screen.getByText(dictionary['compact.count'].replace('{count}', '0'))).toBeInTheDocument()
  })

  it('keeps newly saved individual annotations unselected even when automatic attachment is enabled', () => {
    const h = harness()
    h.controller.setSelectionMode(true)
    h.controller.beginSelection(capture(0))
    h.controller.updateEditorText('New opinion')
    render(<AnnotationDock {...h.props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    expect(h.controller.getSnapshot().annotations).toHaveLength(1)
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(h.actions.ensureComposerAttachment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Annotation 1: Hold for later' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('gives marker copy the full card width and wraps its quote and note instead of truncating them', () => {
    const h = harness()
    const id = h.save(0, 'A readable explanation with several words.')
    h.controller.openAnnotation(id, 'marker')
    render(
      <>
        <style>{styles}</style>
        <AnnotationDock {...h.props()} />
      </>,
    )
    const popover = screen.getByRole('dialog', { name: '#1: A readable explanation with several words.' })
    expect(getComputedStyle(popover).paddingRight).toBe('8px')
    for (const selector of ['.dia-item__copy q', '.dia-item__copy > span']) {
      expect(getComputedStyle(popover.querySelector(selector)!)).toMatchObject({
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        textOverflow: 'clip',
        overflow: 'visible',
      })
    }
    expect(within(popover).getByText('A readable explanation with several words.')).toBeInTheDocument()
  })

  it('uses the official menu to change the processing mode', () => {
    const h = harness()
    h.save(0, 'An opinion')
    render(<AnnotationDock {...h.props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Processing mode: Answer individually' }))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Integrated rewrite'))
    expect(h.actions.setProcessingMode).toHaveBeenCalledWith('rewrite')
    expect(h.controller.getSnapshot().processingMode).toBe('rewrite')
    expect(screen.getByRole('button', { name: 'Processing mode: Integrated rewrite' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('previews the immutable retry payload rather than a later local annotation or mode', () => {
    const h = harness()
    h.save(0, 'Frozen original opinion')
    h.controller.setProcessingMode('rewrite')
    const entry = h.controller.createOutbox('queue', h.controller.sessionId)
    h.controller.markFailed(entry.payload.submissionId, 'Offline')
    const view: AnnotationView = {
      ...h.controller.getSnapshot(),
      processingMode: 'modify',
      annotations: h.controller
        .getSnapshot()
        .annotations.map((item) => ({ ...item, ordinal: 42, annotation: 'Later local opinion' })),
    }
    render(<AnnotationDock {...h.props({ useAnnotations: (selector) => selector(view) })} />)
    expect(screen.getByRole('button', { name: 'Processing mode: Integrated rewrite' })).toBeDisabled()
    fireEvent.pointerEnter(screen.getByRole('button', { name: '1 selected for this send' }))
    const preview = screen.getByRole('tooltip', { name: 'Annotations in this send' })
    expect(within(preview).getByText('Frozen original opinion')).toBeInTheDocument()
    expect(within(preview).getByText('#1')).toBeInTheDocument()
    expect(within(preview).queryByText('Later local opinion')).toBeNull()
    expect(within(preview).queryByText('#42')).toBeNull()
    expect(within(preview).getByText(en['status.submitted'])).toBeInTheDocument()
  })

  it('resumes the chosen paused buffer and discards another without losing the active edit', () => {
    const h = harness()
    h.controller.beginSelection(capture(0))
    h.controller.suspendEditor()
    h.controller.beginSelection(capture(10))
    h.controller.updateEditorText('Second unfinished opinion')
    h.controller.suspendEditor()
    h.controller.setPanelOpen(true)
    const [first, second] = h.controller.getSnapshot().editorDrafts
    render(<AnnotationDock {...h.props()} />)
    const drafts = screen.getByRole('region', { name: 'Saved editing drafts' })
    const secondRow = within(drafts).getByText('Second unfinished opinion').closest('article')!
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Continue editing' }))
    expect(h.actions.resumeEditor).toHaveBeenCalledWith(editorBufferKey(second!))
    expect(screen.getByRole('textbox')).toHaveValue('Second unfinished opinion')
    const firstRow = screen.getByText('No note entered yet').closest('article')!
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Discard' }))
    expect(h.actions.discardEditorDraft).toHaveBeenCalledWith(editorBufferKey(first!))
    expect(h.controller.getSnapshot().editorDrafts).toEqual([])
    expect(h.controller.getSnapshot().editor?.text).toBe('Second unfinished opinion')
    expect(h.storage.load().editorDraft?.text).toBe('Second unfinished opinion')
  })

  it('chooses the explicit overlap target and appends its supplemental opinion', () => {
    const h = harness()
    const first = h.save(0, 'First saved opinion')
    const second = h.save(3, 'Second saved opinion')
    h.controller.beginSelection(capture(1, 6))
    render(<AnnotationDock {...h.props()} />)
    const chooser = screen.getByRole('dialog', { name: en['overlap.title'] })
    expect(within(chooser).getByRole('button', { name: 'Supplement annotation 1' })).toBeInTheDocument()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Supplement annotation 2' }))
    expect(h.actions.chooseOverlap).toHaveBeenCalledWith(second)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New clarification' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    expect(
      h.controller.getSnapshot().annotations.find((item) => item.annotationId === second)?.annotation,
    ).toBe('Second saved opinion\n\nNew clarification')
    expect(
      h.controller.getSnapshot().annotations.find((item) => item.annotationId === first)?.annotation,
    ).toBe('First saved opinion')
  })

  it('disables edits, long-selection confirmation, deletion, undo and send choices while submitting', () => {
    const h = harness({ ...DEFAULT_CONFIG, warnSelectionChars: 6 })
    h.controller.setSelectionMode(true)
    const first = h.save(0, 'Selected opinion')
    const deleted = h.save(10, 'Deleted opinion')
    h.controller.deleteDraft(deleted)
    h.controller.toggleSelected(first)
    h.controller.beginSelection(capture(20, 10))
    h.controller.updateEditorText('Keep this unfinished opinion')
    render(<AnnotationDock {...h.props({ input: { ...h.input, phase: 'submitting' } })} />)
    const editor = screen.getByRole('dialog', { name: 'Add annotation' })
    const input = within(editor).getByRole('textbox')
    expect(input).toBeDisabled()
    for (const name of ['Save annotation', 'Discard this edit', 'Keep the complete long selection']) {
      const button = within(editor).getByRole('button', { name })
      expect(button).toBeDisabled()
      fireEvent.pointerDown(button, { button: 0 })
      fireEvent.click(button)
    }
    for (const name of [
      'Edit',
      'Delete',
      'Undo',
      'Annotation 1: Send with message',
      'Processing mode: Answer individually',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    fireEvent.change(input, { target: { value: 'Unexpected edit' } })
    expect(h.actions.updateEditorText).not.toHaveBeenCalled()
    expect(h.actions.saveEditor).not.toHaveBeenCalled()
    expect(h.actions.closeEditor).not.toHaveBeenCalled()
    expect(h.actions.confirmLongSelection).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(h.controller.getSnapshot().editor).toBeNull()
    expect(h.controller.getSnapshot().editorDrafts[0]?.text).toBe('Keep this unfinished opinion')
  })

  it('disables paused-buffer and overlap mutations while submitting', () => {
    const h = harness()
    h.save(0, 'Saved opinion')
    h.controller.beginSelection(capture(10))
    h.controller.updateEditorText('Paused opinion')
    h.controller.suspendEditor()
    h.controller.beginSelection(capture(1))
    render(<AnnotationDock {...h.props({ input: { ...h.input, phase: 'submitting' } })} />)
    for (const name of ['Continue editing', 'Discard', 'New annotation', 'Supplement annotation 1']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(h.actions.resumeEditor).not.toHaveBeenCalled()
    expect(h.actions.discardEditorDraft).not.toHaveBeenCalled()
    expect(h.actions.chooseOverlap).not.toHaveBeenCalled()
  })

  it('disables retry selection and pending-record discard while submitting', () => {
    const h = harness()
    h.save(0, 'Frozen opinion')
    const entry = h.controller.createOutbox('queue', h.controller.sessionId)
    h.controller.markFailed(entry.payload.submissionId, 'Offline')
    h.controller.setPanelOpen(true)
    render(<AnnotationDock {...h.props({ input: { ...h.input, phase: 'submitting' } })} />)
    for (const name of [translate()('retry.cancel'), translate()('list.discard')]) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(h.actions.selectRetry).not.toHaveBeenCalled()
    expect(h.actions.discardOutbox).not.toHaveBeenCalled()
    expect(h.controller.getSnapshot().outbox[0]?.payload).toBe(entry.payload)
  })

  it('does not suspend composition on outside pointers, Escape or the composition-ending Enter', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.controller.beginSelection(capture(0))
    render(<AnnotationDock {...h.props()} />)
    const input = screen.getByRole('textbox')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '正在输入' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(h.actions.suspendEditor).not.toHaveBeenCalled()
    expect(h.actions.saveEditor).not.toHaveBeenCalled()
    expect(h.controller.getSnapshot().editor?.text).toBe('正在输入')
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.pointerDown(document.body)
    expect(h.actions.suspendEditor).not.toHaveBeenCalled()
    expect(h.actions.saveEditor).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().editor).toBeNull()
    expect(h.storage.load().editorDrafts?.[0]?.text).toBe('正在输入')
  })

  it.each(['en', 'zh'] as const)('shows the preserved-edit notice in %s without internal codes', (locale) => {
    const h = harness()
    h.save(0, 'A saved opinion')
    h.controller.setPanelOpen(true)
    h.controller.setNotice('info', 'local-edits-preserved')
    render(<AnnotationDock {...h.props({ t: translate(locale) })} />)
    expect(screen.getByText(translate(locale)('notice.localEditsPreserved'))).toBeInTheDocument()
    expect(screen.queryByText('local-edits-preserved')).toBeNull()
  })
})

/** The real Dock composes the Diff dialog with the same editor and overlap chooser. */
describe('Diff line actions in the annotation Dock', () => {
  function diffActions(
    h: ReturnType<typeof harness>,
    snapshot = diffSnapshot(),
  ): NonNullable<InputAnnotationProps['diff']> {
    return {
      open: () => h.controller.openDiffPanel(),
      close: () => h.controller.closeDiffPanel(),
      begin: (capture, extend, supplementalTo) =>
        h.controller.beginDiffSelection(capture, extend, supplementalTo),
      request: vi.fn(async (raw: unknown) => {
        const value = raw as {
          action: string
          snapshot: DiffSnapshot
          side: 'old' | 'new'
          startLine: number
          endLine: number
        }
        if (value.action === 'list')
          return {
            files: [
              { path: 'src/example.ts', oldPath: 'src/example.ts', newPath: 'src/example.ts', status: 'M' },
            ],
          }
        if (value.action === 'capture') return { kind: 'text', snapshot }
        const source = diffSource(value.snapshot, value.side, value.startLine, value.endLine)
        return { source, quote: diffQuote(source) }
      }),
    }
  }

  it('opens the actual file, supports keyboard ranges and saves markers without a duplicate editor', async () => {
    const h = harness()
    h.controller.setSelectionMode(true)
    const diff = diffActions(h)
    render(<AnnotationDock {...h.props({ diff })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Annotate code Diff' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'File' }), {
      target: { value: 'src/example.ts' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Annotate New side line 2' }))
    const input = await screen.findByRole('textbox')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(input.closest('[data-annotation-diff]')).not.toBeNull()
    fireEvent.change(input, { target: { value: 'Revise the added lines' } })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annotate Old side line 2' }), {
      key: 'Enter',
      shiftKey: true,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('same file, version and side')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annotate New side line 3' }), {
      key: 'Enter',
      shiftKey: true,
    })
    await waitFor(() =>
      expect(h.controller.getSnapshot().editor).toMatchObject({
        capture: { source: { startLine: 2, endLine: 3 } },
        text: 'Revise the added lines',
      }),
    )
    fireEvent.click(
      within(screen.getByRole('textbox').closest('.dia-editor')!).getByRole('button', {
        name: 'Save annotation',
      }),
    )
    const marker = await screen.findByRole('button', { name: 'Open annotation 1' })
    expect(h.controller.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(h.actions.ensureComposerAttachment).not.toHaveBeenCalled()
    expect(marker.closest('.dia-diff-row')?.querySelector('code')?.textContent).toBe('new value')
    fireEvent.click(marker)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to composer' }))
    act(() => h.controller.openAnnotation(h.controller.getSnapshot().annotations[0]!.annotationId))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox').closest('[data-annotation-diff]')).not.toBeNull()
  })

  it('puts overlap choices inside the modal and focuses original coordinates through folded context', async () => {
    const h = harness()
    const text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
    const snapshot = diffSnapshot(text, text)
    h.controller.beginDiffSelection(diffCapture(diffSource(snapshot, 'old', 20)))
    h.controller.updateEditorText('Original opinion')
    const id = h.controller.saveEditor()
    await h.controller.navigate(id)
    render(<AnnotationDock {...h.props({ diff: diffActions(h, snapshot) })} />)
    const target = await screen.findByRole('button', { name: 'Annotate Old side line 20' })
    expect(target).toHaveFocus()
    fireEvent.click(target)
    await waitFor(() => expect(h.controller.getSnapshot().overlap).not.toBeNull())
    const chooser = document.querySelector('.dia-overlap')
    expect(chooser?.closest('[data-annotation-diff]')).not.toBeNull()
    expect(document.querySelectorAll('.dia-overlap')).toHaveLength(1)
  })

  it('extends an existing range without dropping its far endpoint', async () => {
    const h = harness()
    h.controller.openDiffPanel(diffSnapshot())
    h.controller.beginDiffSelection(diffCapture(diffSource(diffSnapshot(), 'new', 2, 3)))
    render(<AnnotationDock {...h.props({ diff: diffActions(h) })} />)
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Annotate New side line 1' }), {
      key: ' ',
      shiftKey: true,
    })
    await waitFor(() =>
      expect(h.controller.getSnapshot().editor).toMatchObject({
        capture: { source: { startLine: 1, endLine: 3 } },
      }),
    )
  })

  it('clears stale rebind proposals when the current source disappears or becomes ambiguous', async () => {
    const h = harness()
    const block = 'b1\nb2\nb3\ntarget\na1\na2\na3\n'
    const snapshot = diffSnapshot('', block)
    h.controller.beginDiffSelection(diffCapture(diffSource(snapshot, 'new', 4)))
    h.controller.updateEditorText('Keep the original')
    const id = h.controller.saveEditor()
    await h.controller.navigate(id)
    const diff = diffActions(h, snapshot)
    const read = diff.request
    let current: unknown = { kind: 'text', snapshot: diffSnapshot('', `prefix\n${block}`) }
    diff.request = async (raw) => ((raw as { action: string }).action === 'recapture' ? current : read(raw))
    render(<AnnotationDock {...h.props({ diff })} />)
    const check = await screen.findByRole('button', { name: 'Check current location' })
    fireEvent.click(check)
    expect(await screen.findByRole('button', { name: 'Create a supplement at this location' })).toBeVisible()
    current = { kind: 'unsupported', reason: 'missing' }
    fireEvent.click(check)
    expect(await screen.findByRole('alert')).toHaveTextContent('Original location changed')
    expect(screen.queryByRole('button', { name: 'Create a supplement at this location' })).toBeNull()
    current = { kind: 'text', snapshot: diffSnapshot('', block + block) }
    fireEvent.click(check)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('multiple candidates'))
    expect(screen.queryByRole('button', { name: 'Create a supplement at this location' })).toBeNull()
    expect(h.controller.getSnapshot().annotations[0]?.source).toEqual(diffSource(snapshot, 'new', 4))
  })

  it('does not offer fabricated line actions for an unsupported binary file', async () => {
    const h = harness()
    const diff = diffActions(h)
    const read = diff.request
    diff.request = async (raw) =>
      (raw as { action: string }).action === 'capture' ? { kind: 'unsupported', reason: 'binary' } : read(raw)
    render(<AnnotationDock {...h.props({ diff })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Annotate code Diff' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'File' }), {
      target: { value: 'src/example.ts' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Precise line annotations are unavailable')
    expect(document.querySelectorAll('.dia-diff-plus')).toHaveLength(0)
  })
})
