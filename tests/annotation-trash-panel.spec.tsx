// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationTrashPanel } from '../src/client/components/AnnotationTrashPanel.tsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileSource } from '../src/client/official-adapters.ts'
import { styles } from '../src/client/styles.ts'
import type { AnnotationTrashRow, AnnotationTrashView } from '../src/client/annotation-trash.ts'
import type { SourceSnapshotView } from '../src/client/source-snapshots.ts'
import type {
  AnnotationDeletionId,
  AnnotationDraft,
  AnnotationId,
  MessageIdentity,
  SessionIdentity,
} from '../src/shared/types.ts'

function observable<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    useValue<S>(selector: (value: T) => S): S {
      return useSyncExternalStore(
        subscribe,
        () => selector(snapshot),
        () => selector(snapshot),
      )
    },
    set(value: T): void {
      snapshot = value
      for (const listener of listeners) listener()
    },
  }
}

function messageAnnotation(index: number): AnnotationDraft {
  const messageId = `trash-message-${index}` as MessageIdentity
  return {
    annotationId: `trash-annotation-${index}` as AnnotationId,
    ordinal: index,
    messageId,
    messageSeq: index,
    responseVersion: messageId,
    quote: { exact: `quoted ${index}`, prefix: '', suffix: '', start: 0, end: 8 },
    annotation: `Annotation ${index}`,
    kind: 'note',
    status: 'draft',
    createdAt: index,
    updatedAt: index,
  }
}

function row(session: string, index: number, source: 'message' | 'file' = 'message'): AnnotationTrashRow {
  const sessionId = session as SessionIdentity
  const annotation: AnnotationDraft =
    source === 'message'
      ? messageAnnotation(index)
      : {
          annotationId: `trash-annotation-${index}` as AnnotationId,
          ordinal: index,
          source: fileSource(
            {
              sessionId,
              resourceAddress: `dsh-resource://file/session/${session}/%2Fworkspace%2Fvery-long-${index}.txt`,
              path: `/workspace/a/very/long/path/that/must/not/overflow/very-long-${index}.txt`,
              resourceVersion: `version-${index}`,
              format: 'text',
              hash: String(index).padStart(64, '0'),
              bytes: 8,
              text: `quoted ${index}`,
            },
            'sidebar',
            false,
          ),
          quote: { exact: `quoted ${index}`, prefix: '', suffix: '', start: 0, end: 8 },
          annotation: `Annotation ${index}`,
          kind: 'note',
          status: 'draft',
          createdAt: index,
          updatedAt: index,
        }
  return {
    sessionId,
    entry: {
      annotation,
      deletedAt: 1_700_000_000_000 + index,
      deletionId: `deletion-${index}` as AnnotationDeletionId,
      editorDrafts: [],
    },
  }
}

const translations: Record<string, string> = {
  'trash.open': 'Recycle bin',
  'trash.title': 'Deleted annotations',
  'trash.close': 'Close',
  'trash.description': 'Review deleted annotations.',
  'trash.session': 'Session',
  'trash.source': 'Source',
  'trash.allSessions': 'All sessions',
  'records.filterAll': 'All sources',
  'records.filterBody': 'Conversation',
  'records.filterFile': 'File',
  'records.filterDiff': 'Diff',
  'trash.clear': 'Clear all',
  'trash.empty': 'No deleted annotations',
  'trash.restore': 'Restore',
  'trash.deleteForever': 'Delete forever',
  'trash.deletedAt': 'Deleted',
  'trash.confirmTitle': 'Confirm permanent deletion',
  'trash.confirmText': 'This cannot be undone.',
  'trash.cancel': 'Cancel',
  'trash.retry': 'Retry',
  'trash.error.write': 'Saving failed.',
  'trash.fullSource': 'Full source',
  'trash.fragment': 'Only the captured fragment is available.',
  'details.title': 'Annotation details',
  'details.annotation': 'Annotation',
  'details.quote': 'Quote',
  'details.context': 'Context',
  'details.filename': 'Filename',
  'details.path': 'Path',
  'details.address': 'Address',
  'details.version': 'Version',
  'details.location': 'Location',
  'details.session': 'Session',
  'details.status': 'Status',
  'status.draft': 'Draft',
}

const t = (key: string): string => translations[key] ?? key
const readFragment = async (): Promise<SourceSnapshotView> => ({ state: 'fragment' })
const sessionCatalog: SessionListState = {
  ids: [],
  byId: {
    ['session-a' as SessionId]: {
      id: 'session-a' as SessionId,
      title: 'Fix selection',
      displayTitle: 'Fix selection',
      cwd: '/workspace/demo',
      running: false,
      retainedBy: {},
      blank: false,
      updatedAt: 0,
    },
  },
  phase: 'ready',
  projectionsBySession: {},
}
const useSessionCatalog = <S,>(selector: (value: SessionListState) => S): S => selector(sessionCatalog)

function panel(rows: readonly AnnotationTrashRow[], overrides: Partial<AnnotationTrashView> = {}) {
  const trash = observable<AnnotationTrashView>({ rows, error: null, ...overrides })
  const snapshots = observable(0)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  const flushFrames = (): void => {
    act(() => {
      for (const callback of frames.splice(0)) callback(0)
    })
  }
  return { trash, snapshots, frames, flushFrames }
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('annotation recycle-bin panel', () => {
  it('tracks disclosure selection and clears stale detail state when filters change', () => {
    const message = row('session-a', 1)
    const file = row('session-b', 2, 'file')
    const state = panel([message, file])
    render(
      <AnnotationTrashPanel
        useSessionCatalog={useSessionCatalog}
        useAnnotationTrash={state.trash.useValue}
        useSourceSnapshots={state.snapshots.useValue}
        refreshTrash={vi.fn()}
        restoreTrashed={vi.fn(async () => true)}
        purgeTrashed={vi.fn(async () => true)}
        readSourceSnapshot={vi.fn(readFragment)}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recycle bin' }))
    const messageDisclosure = screen.getByRole('button', { name: /Annotation 1/u })
    expect(messageDisclosure).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(messageDisclosure)
    expect(messageDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(messageDisclosure.closest('li')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('region', { name: 'Annotation details' })).toBeInTheDocument()

    expect(screen.getByRole('option', { name: 'demo - Fix selection' })).toHaveValue('session-a')
    expect(screen.getByRole('option', { name: 'session-b' })).toHaveValue('session-b')
    fireEvent.click(screen.getByRole('radio', { name: 'File' }))
    expect(screen.getByRole('radio', { name: 'File' })).toBeChecked()
    expect(screen.queryByRole('button', { name: /Annotation 1/u })).toBeNull()
    const fileDisclosure = screen.getByRole('button', { name: /Annotation 2/u })
    expect(fileDisclosure).toHaveAttribute('aria-expanded', 'false')
    expect(fileDisclosure.closest('li')).not.toHaveAttribute('data-selected')
    expect(document.querySelector('.dia-trash__detail--empty')).not.toBeNull()
  })

  it('restores a row and returns focus to a remaining disclosure', async () => {
    const first = row('session-a', 1)
    const second = row('session-a', 2)
    const state = panel([first, second])
    const restoreTrashed = vi.fn(async (_sessionId: SessionIdentity, ids: readonly AnnotationId[]) => {
      state.trash.set({
        rows: [first, second].filter((candidate) => !ids.includes(candidate.entry.annotation.annotationId)),
        error: null,
      })
      return true
    })
    render(
      <AnnotationTrashPanel
        useSessionCatalog={useSessionCatalog}
        useAnnotationTrash={state.trash.useValue}
        useSourceSnapshots={state.snapshots.useValue}
        refreshTrash={vi.fn()}
        restoreTrashed={restoreTrashed}
        purgeTrashed={vi.fn(async () => true)}
        readSourceSnapshot={vi.fn(readFragment)}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recycle bin' }))
    fireEvent.click(screen.getByRole('button', { name: /Annotation 1/u }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]!)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Annotation 1/u })).toBeNull())
    state.flushFrames()
    expect(screen.getByRole('button', { name: /Annotation 2/u })).toHaveFocus()
    expect(restoreTrashed).toHaveBeenCalledWith(first.sessionId, [first.entry.annotation.annotationId])
  })

  it('keeps a failed purge retryable and uses the scoped danger action', async () => {
    const target = row('session-with-a-very-long-identifier', 3, 'file')
    const state = panel([target])
    let succeed = false
    const purgeTrashed = vi.fn(async (rows: readonly AnnotationTrashRow[]) => {
      if (!succeed) {
        state.trash.set({ rows: [target], error: 'write' })
        return false
      }
      state.trash.set({ rows: [], error: null })
      expect(rows).toEqual([target])
      return true
    })
    render(
      <AnnotationTrashPanel
        useSessionCatalog={useSessionCatalog}
        useAnnotationTrash={state.trash.useValue}
        useSourceSnapshots={state.snapshots.useValue}
        refreshTrash={vi.fn()}
        restoreTrashed={vi.fn(async () => true)}
        purgeTrashed={purgeTrashed}
        readSourceSnapshot={vi.fn(readFragment)}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recycle bin' }))
    fireEvent.click(screen.getByRole('button', { name: /Annotation 3/u }))
    expect(document.querySelectorAll('.dia-detail-value[tabindex="0"]').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }))
    const confirmation = screen.getByRole('dialog', { name: 'Confirm permanent deletion' })
    const confirm = within(confirmation).getByRole('button', { name: 'Delete forever' })
    expect(confirm).toHaveClass('dia-danger-button')
    fireEvent.click(confirm)
    await waitFor(() => expect(within(confirmation).getByRole('alert')).toHaveTextContent('Saving failed.'))
    expect(screen.getByRole('button', { name: /Annotation 3/u })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Confirm permanent deletion' })).toBeInTheDocument()

    succeed = true
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete forever' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm permanent deletion' })).toBeNull(),
    )
    state.flushFrames()
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveFocus()
    expect(screen.getByText('No deleted annotations')).toBeInTheDocument()
    expect(purgeTrashed).toHaveBeenCalledTimes(2)
  })

  it('keeps the height constraint on Modal content and switches the workspace to one column', () => {
    expect(styles).toMatch(/\.dia-trash-modal__content\s*\{[^}]*height:\s*min\(720px,\s*100%\)[^}]*\}/su)
    const modalBlock = /\.dia-trash-modal\s*\{(?<rules>[^}]*)\}/u.exec(styles)?.groups?.rules
    expect(modalBlock).toBeDefined()
    expect(modalBlock).not.toMatch(/(?:^|\n)\s*height:/u)
    expect(styles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*\.dia-trash-modal__content\s*\{[^}]*height:\s*100%[^}]*\}/u,
    )
    expect(styles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*\.dia-trash__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    )
    expect(styles).toMatch(
      /\.dia-trash__list,\s*\.dia-trash__detail\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/su,
    )
  })
})
