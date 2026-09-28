// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: InputAnnotationProps['t'] = (key, params) =>
  en[key as keyof typeof en].replace(/\{(\w+)\}/gu, (_match: string, name: string) => String(params?.[name]))

function harness() {
  const values = new Map<string, string>()
  const sessionId = 'interaction-session' as SessionIdentity
  const controller = new AnnotationController(
    sessionId,
    new AnnotationStorage(
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
    ),
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
    openAnnotation: vi.fn((id: AnnotationId, presentation?: 'summary' | 'marker' | 'marker-edit') =>
      controller.openAnnotation(id, presentation),
    ),
    updateEditorText: vi.fn((text: string) => controller.updateEditorText(text)),
    saveEditor: vi.fn(() => controller.saveEditor()),
    closeEditor: vi.fn((force?: boolean) => controller.closeEditor(force)),
    suspendEditor: vi.fn(() => controller.suspendEditor()),
    confirmLongSelection: vi.fn(() => controller.confirmLongSelection()),
    deleteDraft: vi.fn((id: AnnotationId) => controller.deleteDraft(id)),
    discardOutbox: vi.fn(),
    navigate: vi.fn(async () => true),
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
  return { controller, actions, props, save }
}

describe('annotation record and composer interactions', () => {
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

  it('saves an empty new annotation after three outside clicks without opening records', () => {
    const h = harness()
    act(() => {
      h.actions.beginSelection(0)
    })
    render(<AnnotationExperience {...h.props} />)
    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument()
    for (let click = 0; click < 3; click += 1) fireEvent.pointerDown(document.body)
    expect(h.controller.getSnapshot().annotations).toHaveLength(1)
    expect(h.controller.getSnapshot().annotations[0]?.annotation).toBe('')
    expect(h.controller.getSnapshot().panelOpen).toBe(false)
    expect(h.actions.ensureComposerAttachment).toHaveBeenCalled()
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
    h.controller.dispose()
  })
})
