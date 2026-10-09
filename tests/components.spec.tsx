// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestAnnotatedAssistantNode as AnnotatedAssistantNode } from './assistant-host-fixture.tsx'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import { AnnotationDetails } from '../src/client/components/AnnotationDetails.tsx'
import {
  AnnotationPluginCard,
  type AnnotationPluginCardProps,
} from '../src/client/components/AnnotationPluginCard.tsx'
import type { AnnotationView } from '../src/client/controller.ts'
import type {
  AssistantAnnotationProps,
  InputAnnotationProps,
  UserAnnotationProps,
} from '../src/client/contract.ts'
import type { AnnotationLocaleKey } from '../src/client/locales.ts'
import type { MarketUpdateState } from '../src/client/market-update.ts'
import { DEFAULT_TRANSCRIPT_VISIBILITY } from '../src/shared/settings.ts'
import { fixturePayload } from './fixtures.ts'
import { diffAnnotation } from './diff-fixtures.ts'
import { sourceFields } from '../src/shared/annotation-source.ts'
import { parseSubmissionPayload } from '../src/shared/protocol.ts'
import { en } from '../src/client/locales.ts'
import type { AnnotationDraft, SessionIdentity } from '../src/shared/types.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const QUOTE_FLASH_TEST_MS = 2_200

const t = (key: AnnotationLocaleKey, params?: Record<string, unknown>) => {
  const values: Partial<Record<AnnotationLocaleKey, string>> = {
    'settings.title': 'DSH Inline Comments',
    'settings.description': 'Show inline comment features.',
    'settings.cardDescription': 'Selection comments and composer attachments.',
    'settings.toggle': 'Enable DSH Inline Comments',
    'settings.autoAttach': 'Attach new comments to the composer automatically',
    'settings.autoAttachHint': 'Saving a new comment attaches it to the official composer.',
    'settings.on': 'On',
    'settings.off': 'Off',
    'settings.overridden': 'Overridden',
    'settings.reset': 'Reset to default',
    'settings.readOnly': 'This deployment stores settings read-only.',
    'settings.save': 'Save',
    'settings.saving': 'Saving…',
    'settings.discard': 'Discard',
    'settings.unsaved': 'Unsaved',
    'settings.saveFailed': 'The deployment did not accept this value.',
    'settings.updateTitle': 'Plugin update',
    'settings.updateDescription': 'Check through the public market API.',
    'settings.updateIdle': 'Updates have not been checked.',
    'settings.updateChecking': 'Checking for updates…',
    'settings.marketUnavailable': 'The market API is unavailable.',
    'settings.marketFallback': 'Open Settings → Plugin Market.',
    'settings.marketBeta': 'Beta API',
    'settings.updateCurrent': 'This is the latest version.',
    'settings.updateAvailable': 'A new version is available.',
    'settings.updating': 'Installing the update…',
    'settings.updatingPercent': `Installing the update… ${String(params?.percent)}%`,
    'settings.updateSucceeded': 'The update is installed.',
    'settings.updateFailed': 'The update failed.',
    'settings.rollingBack': 'Rolling back the update…',
    'settings.rolledBack': 'The previous version has been restored.',
    'settings.restarting': 'Requesting a Host restart…',
    'settings.installedVersion': `Installed ${String(params?.version)}`,
    'settings.latestVersion': `Latest ${String(params?.version)}`,
    'settings.checkUpdate': 'Check for updates',
    'settings.checkAgain': 'Check again',
    'settings.installUpdate': 'Install update',
    'settings.forceUpdate': 'Update anyway',
    'settings.rollback': 'Roll back',
    'settings.refresh': 'Refresh page',
    'settings.restart': 'Restart Host',
    'settings.restartManaged': 'Restart it from the Host.',
    'timeline.single': '1 comment',
    'timeline.summary': `${String(params?.count)} comments`,
    'timeline.singleLocate': '1 comment, double-click to locate the source',
    'timeline.previewSource': `Source: ${String(params?.quote)}`,
    'timeline.preview': `Source: ${String(params?.quote)}\nAnnotation: ${String(params?.annotation)}`,
    'list.locate': 'Locate source',
    'status.draft': 'Ready to send',
    'status.submitted': 'Submitted; awaiting confirmation',
    'status.sent': 'Sent',
    'dock.count': `${String(params?.count)} inline comments`,
    'dock.pendingDetail': 'Ready to attach · Open list',
    'dock.expand': 'Expand inline comments',
    'dock.collapse': 'Collapse inline comments',
    'attach.add': `Attach ${String(params?.count)} comments to the next send`,
    'attach.remove': `Detach ${String(params?.count)} comments`,
    'attach.archived': 'Archived tasks cannot attach comments',
    'attach.busy': 'The composer is busy',
    'attach.empty': 'No comments are available to attach',
    'panel.pending': `${String(params?.count)} ready to attach`,
    'panel.submitted': `${String(params?.count)} awaiting delivery outcome`,
    'list.title': 'Inline comments',
    'group.drafts': 'Ready to attach',
    'group.submitted': 'Confirming delivery outcome',
    'group.retry': 'Send failed · Retry from the official composer',
    'group.queued': 'Queued',
    'group.history': 'Sent',
    'list.edit': 'Edit',
    'list.close': 'Close annotation preview',
    'list.delete': 'Delete',
    'list.withdraw': 'Withdraw queued batch',
    'list.deleted': 'Draft comment deleted',
    'list.undo': 'Undo',
    'toast.queued': `${String(params?.count)} comments queued; withdrawal is available`,
    'toast.sent': `${String(params?.count)} comments sent; history cannot be withdrawn`,
    'toast.failed': `${String(params?.count)} comments failed to send`,
    'editor.title': 'Add comment',
    'editor.editTitle': 'Edit comment',
    'editor.supplementTitle': 'Supplement comment',
    'editor.annotationLabel': 'Your annotation',
    'editor.shortcut': 'Ctrl/⌘ ↵ to save',
    'editor.autosaving': 'Saving locally…',
    'editor.autosaved': 'Automatically saved locally',
    'editor.cancel': 'Cancel',
    'editor.save': 'Save comment',
    'editor.supplementPlaceholder': 'Add a clarification',
    'editor.suspendHint': 'Click outside to keep this draft',
    'processing.answer': 'Answer individually',
    'processing.rewrite': 'Integrated rewrite',
    'processing.modify': 'Revise by annotation',
    'processing.selectorLabel': `Processing mode: ${String(params?.mode)}`,
    'processing.retryFrozen': 'Retry mode is frozen',
    'selection.toolbar': 'Selection actions',
    'selection.annotate': 'Add annotation',
    'selection.copy': 'Copy',
    'error.attachmentsRequired': `Re-select the ${String(params?.count)} attachments or discard the record.`,
    'list.discard': 'Discard this pending record',
    'reply.chip': `Annotation ${String(params?.ordinal)}`,
    'reply.chipLabel': `Annotation ${String(params?.ordinal)}: ${String(params?.quote)} · ${String(params?.annotation)}`,
    'editor.emptyHint': 'Annotation content may be empty; empty means highlight only.',
    highlightOnly: 'Highlight only',
    'compact.count': `Annotations ×${String(params?.count)}`,
    'compact.overview': 'Attached annotations overview',
    'marker.groupCount': `×${String(params?.count)}`,
    'marker.groupLabel': `View ${String(params?.count)} annotations on this line, numbered ${String(params?.ordinals)}`,
  }
  return values[key] ?? key
}

function baseView(): AnnotationView {
  return {
    annotations: [],
    trash: [],
    deletionMarks: [],
    outbox: [],
    overallRequirementDraft: '',
    editor: null,
    editorDrafts: [],
    selectionMode: 'all',
    selectedAnnotationIds: [],
    processingMode: 'answer',
    retrySubmissionId: null,
    overlap: null,
    editorSaveStatus: 'idle',
    deletedDraft: null,
    deletedAnnotationIds: [],
    panelOpen: false,
    recordExpanded: true,
    notice: null,
    activeAnnotationId: null,
    navigationEpoch: 0,
    markerAnnotationId: null,
    latestAssistantMessageId: null,
    storageAvailable: true,
  }
}

describe('annotation Settings tab', () => {
  const state = {
    available: true,
    writable: true,
    enabled: true,
    overridden: false,
    individualSelection: false,
    individualSelectionOverridden: false,
    autoAttach: true,
    autoAttachOverridden: false,
    compactSummary: true,
    compactSummaryOverridden: false,
    transcriptVisibility: { ...DEFAULT_TRANSCRIPT_VISIBILITY },
    transcriptVisibilityOverridden: { ...DEFAULT_TRANSCRIPT_VISIBILITY },
    dirty: false,
    saving: false,
    failed: false,
  }

  const marketState: MarketUpdateState = {
    phase: 'idle',
    marketVersion: null,
    stability: null,
    installedVersion: null,
    latestVersion: null,
    source: null,
    progressPercent: null,
    progressDetail: null,
    error: null,
    forceAllowed: false,
    rollbackAvailable: false,
    refreshRequired: false,
    restartRequired: false,
    restartSupported: false,
  }

  function cardProps(
    overrides: Partial<typeof state> = {},
    marketOverrides: Partial<typeof marketState> = {},
  ) {
    const snapshot = { ...state, ...overrides }
    const marketSnapshot = { ...marketState, ...marketOverrides }
    return {
      useSettingsCard: <S,>(selector: (value: typeof snapshot) => S) => selector(snapshot),
      useMarketUpdate: <S,>(selector: (value: typeof marketSnapshot) => S) => selector(marketSnapshot),
      useAnnotationTrash: <S,>(selector: (value: { rows: never[]; error: null }) => S) =>
        selector({ rows: [], error: null }),
      useSourceSnapshots: <S,>(selector: (value: number) => S) => selector(0),
      useSessionCatalog: <S,>(selector: (value: { byId: Record<string, never> }) => S) =>
        selector({ byId: {} }),
      refreshTrash: vi.fn(),
      setEnabled: vi.fn(),
      resetEnabled: vi.fn(),
      setIndividualSelection: vi.fn(),
      resetIndividualSelection: vi.fn(),
      setAutoAttach: vi.fn(),
      resetAutoAttach: vi.fn(),
      setCompactSummary: vi.fn(),
      resetCompactSummary: vi.fn(),
      setTranscriptVisibility: vi.fn(),
      resetTranscriptVisibility: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      checkUpdate: vi.fn(),
      installUpdate: vi.fn(),
      rollbackUpdate: vi.fn(),
      restartHost: vi.fn(),
      refreshClient: vi.fn(),
      t,
    } as unknown as AnnotationPluginCardProps
  }

  it('stages the switch and writes only from the card footer', () => {
    const props = cardProps({ dirty: true })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'DSH Inline Comments' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable DSH Inline Comments' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Attach new comments to the composer automatically' }))
    expect(screen.queryByRole('switch', { name: 'Show local data tools' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(props.setEnabled).toHaveBeenCalledWith(false)
    expect(props.setAutoAttach).toHaveBeenCalledWith(false)
    expect(props.save).toHaveBeenCalledOnce()
    expect(props.discard).toHaveBeenCalledOnce()
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('resets each override and hides an unavailable namespace', () => {
    const props = cardProps({
      overridden: true,
      individualSelectionOverridden: true,
      autoAttachOverridden: true,
      compactSummaryOverridden: true,
    })
    const { rerender } = render(<AnnotationPluginCard {...props} />)
    for (const button of screen.getAllByRole('button', { name: 'Reset to default' })) fireEvent.click(button)
    expect(props.resetEnabled).toHaveBeenCalledOnce()
    expect(props.resetAutoAttach).toHaveBeenCalledOnce()
    rerender(<AnnotationPluginCard {...cardProps({ available: false })} />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('offers override reset and reports read-only save failures', () => {
    const props = cardProps({ writable: false, overridden: true, dirty: true, failed: true })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getByText('This deployment stores settings read-only.')).toHaveAttribute('role', 'status')
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    for (const control of screen.getAllByRole('switch')) expect(control).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled()
    expect(screen.getByText('The deployment did not accept this value.')).toBeInTheDocument()
  })

  it('renders capability-gated market update actions', () => {
    const props = cardProps(
      {},
      {
        phase: 'available',
        stability: 'beta',
        installedVersion: '0.6.0',
        latestVersion: '0.7.0',
      },
    )
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getByText('Beta API')).toBeInTheDocument()
    expect(screen.getByText('Installed 0.6.0')).toBeInTheDocument()
    expect(screen.getByText('Latest 0.7.0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }))
    expect(props.installUpdate).toHaveBeenCalledWith()
    expect(screen.queryByRole('button', { name: 'Restart Host' })).not.toBeInTheDocument()
  })

  it('retains force-update rollback refresh and Host restart controls in Settings', () => {
    const props = cardProps(
      {},
      {
        phase: 'succeeded',
        forceAllowed: true,
        rollbackAvailable: true,
        refreshRequired: true,
        restartRequired: true,
        restartSupported: true,
      },
    )
    render(<AnnotationPluginCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update anyway' }))
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart Host' }))
    expect(props.installUpdate).toHaveBeenCalledWith(true)
    expect(props.rollbackUpdate).toHaveBeenCalledOnce()
    expect(props.refreshClient).toHaveBeenCalledOnce()
    expect(props.restartHost).toHaveBeenCalledOnce()
  })

  it('falls back to Plugin Market when the public API is unavailable', () => {
    const props = cardProps({}, { phase: 'unavailable' })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getByText('Open Settings → Plugin Market.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(props.checkUpdate).toHaveBeenCalledOnce()
  })
})

describe('inline comment presentation', () => {
  it('shows rendered Markdown offsets and saved Diff identity and context without inventing file lines', () => {
    const translate: InputAnnotationProps['t'] = (key, params) =>
      en[key as keyof typeof en].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    const base = {
      annotationId: fixturePayload().annotations[0]!.annotationId,
      ordinal: 1,
      quote: { exact: '中😀', prefix: '前', suffix: '后', start: 4, end: 7 },
      annotation: 'Check this source',
      kind: 'note' as const,
      createdAt: 1,
      updatedAt: 1,
      status: 'draft' as const,
    }
    const file: AnnotationDraft = {
      ...base,
      source: {
        kind: 'file',
        sessionId: 'details-session' as SessionIdentity,
        resourceAddress: 'dsh-resource://file/details-session/notes.md',
        path: '/workspace/notes.md',
        resourceVersion: 'revision-1',
        format: 'markdown',
        snapshot: {
          version: 2,
          hash: 'saved-digest',
          bytes: 40,
          format: 'markdown',
          coordinateSpace: 'rendered',
        },
        wholeFile: false,
        entry: 'sidebar',
      },
    }
    const { rerender } = render(<AnnotationDetails item={file} t={translate} />)
    const fileDetails = screen.getByRole('region', { name: 'Annotation details' })
    expect(within(fileDetails).getByText('4–7')).toBeVisible()
    expect(within(fileDetails).getByText('Rendered text offsets (UTF-16)')).toBeVisible()
    expect(within(fileDetails).queryByText('undefined')).toBeNull()

    const diff: AnnotationDraft = {
      ...base,
      source: {
        kind: 'official-diff',
        snapshot: {
          version: 2,
          hash: 'saved-diff-digest',
          sessionId: 'details-session' as SessionIdentity,
          seq: 42,
          turn: 3,
          fileIndex: 2,
          path: 'notes.md',
          display: 'notes.md',
          kind: 'text',
          before: true,
          after: true,
          coarse: false,
          hunks: [],
          contextBefore: 'before change',
          contextAfter: 'after change',
        },
        side: 'new',
        startLine: 8,
        endLine: 8,
        wholeFile: false,
        entry: 'sidebar',
      },
    }
    rerender(<AnnotationDetails item={diff} t={translate} />)
    const diffDetails = screen.getByRole('region', { name: 'Annotation details' })
    expect(within(diffDetails).getByText('File index (zero-based)')).toBeVisible()
    expect(within(diffDetails).getByText('2')).toBeVisible()
    expect(within(diffDetails).getByText('before change')).toBeVisible()
    expect(within(diffDetails).getByText('after change')).toBeVisible()
  })

  it('changes the active quote without rebuilding mounted base highlights', () => {
    const submitted = fixturePayload().annotations[0]!
    const annotation = { ...submitted, status: 'draft' as const, updatedAt: submitted.createdAt }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const updateHighlightRanges = vi.fn()
    const activateHighlight = vi.fn()
    const removeHighlights = vi.fn()
    const selectView = (snapshot: AnnotationView) => (selector: (state: AnnotationView) => unknown) => {
      const selected = selector(snapshot)
      return Array.isArray(selected) && selected[0] === annotation ? view.annotations : selected
    }
    const props = {
      node: {
        data: {
          status: 'closed',
          blocks: [{ kind: 'text', text: 'before selected source after' }],
          finalNode: { messageId: annotation.messageId, seq: annotation.messageSeq },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
      fileMentions: vi.fn(),
      useAnnotations: selectView(view),
      beginSelection: vi.fn(),
      openAnnotation: vi.fn(),
      registerEndpoint: vi.fn(() => () => undefined),
      updateHighlightRanges,
      activateHighlight,
      removeHighlights,
      t,
    } as unknown as AssistantAnnotationProps
    const { rerender } = render(<AnnotatedAssistantNode {...props} />)
    expect(updateHighlightRanges).toHaveBeenCalled()
    updateHighlightRanges.mockClear()
    removeHighlights.mockClear()
    activateHighlight.mockClear()

    const activeView: AnnotationView = { ...view, activeAnnotationId: annotation.annotationId }
    rerender(
      <AnnotatedAssistantNode
        {...props}
        useAnnotations={selectView(activeView) as AssistantAnnotationProps['useAnnotations']}
      />,
    )
    expect(activateHighlight).toHaveBeenCalledOnce()
    expect(updateHighlightRanges).not.toHaveBeenCalled()
    expect(removeHighlights).not.toHaveBeenCalled()
  })

  it('shows a mixed historical batch above the message and keeps Diff sources read-only', () => {
    const message = fixturePayload().annotations[0]!
    const second = {
      ...message,
      annotationId: 'ann-second' as typeof message.annotationId,
      ordinal: 2,
      quote: {
        ...message.quote,
        exact: 'another source',
        end: message.quote.start + 'another source'.length,
      },
      annotation: 'Another note.',
    }
    const payload = parseSubmissionPayload({
      ...fixturePayload(),
      protocolVersion: 3,
      annotations: [
        { ...message, ...sourceFields(message) },
        { ...second, ...sourceFields(second) },
        { ...diffAnnotation(), annotationId: 'ann-diff', ordinal: 3 },
      ],
    })
    const translate = (key: AnnotationLocaleKey, params?: Record<string, unknown>) =>
      en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    const navigate = vi.fn(async () => true)
    const props = {
      node: { data: { source: { kind: 'user', annotationSubmission: payload }, content: [] } },
      navigate,
      renderMessageImages: () => null,
      t: translate,
    } as unknown as UserAnnotationProps<'user'>
    const { container } = render(<AnnotatedUserNode {...props} />)
    const badge = screen.getByRole('button', { name: '3 comments' })
    expect(container.querySelector('.dia-user-submission')?.firstElementChild).toHaveClass('dia-timeline')
    expect(badge).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('src/example.ts')).not.toBeInTheDocument()
    fireEvent.click(badge)
    expect(badge).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('src/example.ts')).toBeVisible()
    expect(screen.getByText('Working tree · New side · 2–2')).toBeVisible()
    expect(screen.getByText('Legacy Diff annotation (read-only)')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('selected source')).toBeVisible()
    expect(screen.getByText('another source')).toBeVisible()
    expect(screen.getByText('Explain this claim.')).toBeVisible()
    expect(screen.getByText('Another note.')).toBeVisible()
    const locate = screen.getAllByRole('button', { name: 'Locate source' })
    expect(locate).toHaveLength(2)
    expect(locate[1]?.querySelector('svg.lucide-map-pin')).toBeInTheDocument()
    fireEvent.click(locate[1]!)
    expect(navigate).toHaveBeenCalledWith(second.annotationId)
    expect(container.querySelector('.dia-diagnostics')).toBeNull()
    fireEvent.click(badge)
    expect(badge).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('src/example.ts')).not.toBeInTheDocument()
    expect(screen.queryByText('Another note.')).not.toBeInTheDocument()
  })

  it('places one compact comment above the message and locates only on double-click', async () => {
    const payload = fixturePayload({ processingMode: 'rewrite' })
    const navigate = vi.fn(async (_annotationId: unknown) => true)
    const props = {
      node: { data: { source: { kind: 'user', inlineComments: payload }, content: [] } },
      navigate,
      renderMessageImages: () => null,
      t,
    } as unknown as UserAnnotationProps<'user'>
    const { container } = render(<AnnotatedUserNode {...props} />)
    const submission = container.querySelector('.dia-user-submission')!
    expect(submission.firstElementChild).toHaveClass('dia-timeline')
    expect(submission.children[1]).toHaveClass('dia-user')
    expect(screen.getByText('Rewrite the proposal coherently.')).toBeInTheDocument()
    const badge = screen.getByRole('button', { name: '1 comment, double-click to locate the source' })
    expect(badge).toHaveTextContent('1 comment')
    fireEvent.click(badge, { detail: 1 })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.doubleClick(badge)
    expect(navigate).toHaveBeenCalledWith(payload.annotations[0]!.annotationId)
    expect(container.querySelector('.dia-diagnostics')).toBeNull()
    expect(screen.queryByText(payload.annotations[0]!.annotationId)).not.toBeInTheDocument()
  })

  it.each(['user', 'steering'] as const)(
    'preserves official reference chips in ordinary %s messages',
    (kind) => {
      const props = {
        node: {
          kind,
          data: {
            source: { kind: 'user' },
            content: [
              { type: 'text', text: 'Compare @' },
              { type: 'text', text: '会话一 /review @src/note.md /unresolved' },
            ],
            referenceLabels: ['会话一'],
            skillNames: ['review'],
          },
        },
        renderMessageImages: () => null,
        openFile: vi.fn(),
        openSkill: vi.fn(),
        t,
      } as unknown as UserAnnotationProps<typeof kind>
      const { container } = render(<AnnotatedUserNode {...props} />)
      expect(container).toHaveTextContent('Compare 会话一 /review note.md /unresolved')
      expect(
        Array.from(container.querySelectorAll('[data-ref-chip]')).map((chip) => [
          chip.getAttribute('data-ref-chip'),
          chip.textContent,
        ]),
      ).toEqual([
        ['session', '会话一'],
        ['skill', '/review'],
        ['file', 'note.md'],
      ])
      fireEvent.click(screen.getByRole('button', { name: 'note.md' }))
      fireEvent.click(screen.getByRole('button', { name: '/review' }))
      expect(props.openFile).toHaveBeenCalledWith('src/note.md')
      expect(props.openSkill).toHaveBeenCalledWith('review')
      expect(screen.queryByRole('button', { name: '会话一' })).not.toBeInTheDocument()
    },
  )

  it('opens file and skill references in an annotation overall requirement', () => {
    const payload = { ...fixturePayload(), overallRequirement: 'Review @src/note.md with /review' }
    const props = {
      node: {
        data: {
          source: { kind: 'user', annotationSubmission: payload },
          content: [],
          skillNames: ['review'],
        },
      },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
      navigate: vi.fn(async () => true),
      renderMessageImages: () => null,
      openFile: vi.fn(),
      openSkill: vi.fn(),
      t,
    } as unknown as UserAnnotationProps<'user'>
    render(<AnnotatedUserNode {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'note.md' }))
    fireEvent.click(screen.getByRole('button', { name: '/review' }))
    expect(props.openFile).toHaveBeenCalledWith('src/note.md')
    expect(props.openSkill).toHaveBeenCalledWith('review')
  })

  it('preserves image and file order in an annotation submission', () => {
    const payload = fixturePayload()
    const file = { attachmentId: 'file-1', name: 'notes.pdf', bytes: 2048 }
    const renderMessageImages = vi.fn(() => <span data-testid="ordered-image">image</span>)
    const props = {
      node: {
        data: {
          source: { kind: 'user', annotationSubmission: payload },
          content: [
            { type: 'image', attachment: { attachmentId: 'image-1' } },
            { type: 'file', attachment: file },
            { type: 'image', attachment: { attachmentId: 'image-2' } },
          ],
        },
      },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
      navigate: vi.fn(async () => true),
      renderMessageImages,
      t,
    } as unknown as UserAnnotationProps<'user'>
    const { container } = render(<AnnotatedUserNode {...props} />)
    expect(screen.getByTitle('notes.pdf')).toHaveTextContent('2.0KB')
    const row = container.querySelector('[data-message-attachments]')!
    expect(Array.from(row.children).map((child) => child.textContent)).toEqual([
      'image',
      'notes.pdf2.0KB',
      'image',
    ])
    expect(renderMessageImages).toHaveBeenNthCalledWith(1, {
      images: [{ attachment: { attachmentId: 'image-1' } }],
      align: 'end',
      compact: true,
    })
    expect(renderMessageImages).toHaveBeenNthCalledWith(2, {
      images: [{ attachment: { attachmentId: 'image-2' } }],
      align: 'end',
      compact: true,
    })
  })

  it('delegates historical images through the conversation image renderer', () => {
    const userAttachment = { attachmentId: 'user-image' }
    const renderUserImages = vi.fn(() => <div data-testid="user-images" />)
    const userProps = {
      node: {
        data: {
          source: { kind: 'user' },
          content: [{ type: 'image', attachment: userAttachment }],
        },
      },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
      navigate: vi.fn(async () => true),
      renderMessageImages: renderUserImages,
      t,
    } as unknown as UserAnnotationProps<'user'>
    render(<AnnotatedUserNode {...userProps} />)

    expect(screen.getByTestId('user-images')).toBeInTheDocument()
    expect(renderUserImages).toHaveBeenCalledWith({
      images: [{ attachment: userAttachment }],
      align: 'end',
      compact: false,
    })
    cleanup()

    const firstAttachment = { attachmentId: 'assistant-image-1' }
    const secondAttachment = { attachmentId: 'assistant-image-2' }
    const renderAssistantImages = vi.fn(() => <div data-testid="assistant-images" />)
    const assistantProps = {
      node: {
        data: {
          status: 'closed',
          blocks: [
            { kind: 'image', attachment: firstAttachment },
            { kind: 'image', attachment: secondAttachment },
          ],
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: renderAssistantImages,
      fileMentions: vi.fn(),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
      beginSelection: vi.fn(),
      openAnnotation: vi.fn(),
      registerEndpoint: vi.fn(() => () => undefined),
      updateHighlightRanges: vi.fn(),
      activateHighlight: vi.fn(),
      removeHighlights: vi.fn(),
      t,
    } as unknown as AssistantAnnotationProps
    render(<AnnotatedAssistantNode {...assistantProps} />)

    expect(screen.getByTestId('assistant-images')).toBeInTheDocument()
    expect(renderAssistantImages).toHaveBeenCalledOnce()
    expect(renderAssistantImages).toHaveBeenCalledWith({
      images: [{ attachment: firstAttachment }, { attachment: secondAttachment }],
      align: 'start',
    })

    cleanup()
    render(
      <AnnotatedAssistantNode {...assistantProps}>
        <div data-testid="composed-assistant">Existing renderer output</div>
      </AnnotatedAssistantNode>,
    )
    expect(screen.getByTestId('composed-assistant')).toBeInTheDocument()
    expect(renderAssistantImages).toHaveBeenCalledOnce()
  })

  it('shows a selection action bar instead of opening the editor directly', () => {
    const beginSelection = vi.fn()
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
          finalNode: { messageId: 'assistant-direct-input-test', seq: 9 },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
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

    const bar = screen.getByRole('toolbar', { name: 'Selection actions' })
    expect(bar).toHaveTextContent('Add annotation')
    expect(bar).not.toHaveTextContent('Copy')
    expect(bar).toHaveStyle({ left: '40px', top: '50px' })
    expect(beginSelection).not.toHaveBeenCalled()
    expect(selection.isCollapsed).toBe(false)

    fireEvent.click(within(bar).getByRole('button', { name: 'Add annotation' }))
    expect(beginSelection).toHaveBeenCalledOnce()
    expect(beginSelection).toHaveBeenCalledWith(
      expect.objectContaining({ quote: expect.objectContaining({ exact: 'selected text' }) }),
    )
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(selection.isCollapsed).toBe(false)
    selection.removeAllRanges()
  })

  it('opens the selection bar when the pointer is released outside the assistant body', () => {
    const beginSelection = vi.fn()
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
          finalNode: { messageId: 'assistant-outside-release-test', seq: 9 },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
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
    fireEvent.pointerUp(document.body)

    const bar = screen.getByRole('toolbar', { name: 'Selection actions' })
    expect(bar).toHaveTextContent('Add annotation')
    expect(selection.isCollapsed).toBe(false)
    fireEvent.click(within(bar).getByRole('button', { name: 'Add annotation' }))
    expect(beginSelection).toHaveBeenCalledWith(
      expect.objectContaining({ quote: expect.objectContaining({ exact: 'selected text' }) }),
    )
    selection.removeAllRanges()
  })

  it('dismisses the selection action bar on outside pointerdown and on Escape', () => {
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
          finalNode: { messageId: 'assistant-dismiss-test', seq: 9 },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
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
    const { unmount } = render(<AnnotatedAssistantNode {...props} />)

    const paragraph = screen.getByText('Alpha selected text omega')
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 6)
    range.setEnd(text, 19)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.pointerUp(paragraph)
    expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    fireEvent.pointerUp(paragraph)
    expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    selection.removeAllRanges()
    unmount()
  })

  it('keeps mobile text width and hides markers when no safe whitespace remains', async () => {
    vi.stubGlobal('innerWidth', 320)
    let lineRight = 280
    const payload = fixturePayload()
    const base = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const annotations = Array.from({ length: 5 }, (_, index) => ({
      ...base,
      annotationId: `ann-mobile-${index + 1}` as typeof base.annotationId,
      ordinal: index + 1,
      annotation: `Mobile note ${index + 1}`,
    }))
    const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const elementRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
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
      value: () => [rect(150, lineRight, 80)] as unknown as DOMRectList,
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ ...rect(100, 320, 320), bottom: 500, height: 400 }),
    })

    try {
      const view: AnnotationView = { ...baseView(), annotations }
      const props = {
        node: {
          data: {
            status: 'closed',
            blocks: [{ kind: 'text', text: 'before selected source after' }],
            finalNode: { messageId: base.messageId, seq: base.messageSeq },
          },
          location: { kind: 'root' },
        },
        useTurnData: () => undefined,
        openFile: vi.fn(),
        renderMessageImages: () => null,
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
      const { container, rerender } = render(<AnnotatedAssistantNode {...props} />)
      const marker = screen.getByRole('button', {
        name: 'View 5 annotations on this line, numbered 1, 2, 3, 4, 5',
      })
      expect(marker).toHaveStyle({ left: '282px', width: '24px' })
      expect(marker).toHaveTextContent('×5')
      expect(marker).toHaveAttribute(
        'data-annotation-ids',
        annotations.map((item) => item.annotationId).join(' '),
      )
      const body = container.querySelector<HTMLElement>('.dia-assistant__body')!
      expect(body.style.paddingRight).toBe('')
      expect(body.textContent).toBe('before selected source after')
      lineRight = 320
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(container.querySelector('.dia-marker')).toBeNull())
      expect(body.style.paddingRight).toBe('')
      expect(body.textContent).toBe('before selected source after')

      const unresolvedView: AnnotationView = {
        ...view,
        annotations: annotations.map((annotation) => ({
          ...annotation,
          quote: {
            exact: `missing source ${annotation.ordinal}`,
            prefix: '',
            suffix: '',
            start: 1_000 + annotation.ordinal * 20,
            end: 1_010 + annotation.ordinal * 20,
          },
        })),
      }
      rerender(
        <AnnotatedAssistantNode
          {...props}
          useAnnotations={(selector) => selector(unresolvedView) as never}
        />,
      )
      expect(container.querySelector('.dia-marker')).toBeNull()
      expect(body.style.paddingRight).toBe('')
      expect(unresolvedView.annotations).toHaveLength(5)
    } finally {
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
      if (elementRect === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
      else Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', elementRect)
    }
  })

  it('centers the first newly saved comment through the already-mounted navigation endpoint', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    let view: AnnotationView = baseView()
    const savedView: AnnotationView = { ...view, annotations: [annotation] }
    const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
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
        return [
          this.toString() === 'selected source' ? rect(360, 250, 100) : rect(360, 360, 100),
        ] as unknown as DOMRectList
      },
    })
    let endpoint:
      | {
          reveal(annotationId: typeof annotation.annotationId, navigationEpoch: number): void
        }
      | undefined
    const activateHighlight = vi.fn()
    const props = {
      node: {
        data: {
          status: 'closed',
          blocks: [{ kind: 'text', text: 'before selected source after' }],
          finalNode: { messageId: annotation.messageId, seq: annotation.messageSeq },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
      fileMentions: vi.fn(),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      beginSelection: vi.fn(),
      openAnnotation: vi.fn(),
      registerEndpoint: vi.fn((_messageId, candidate) => {
        endpoint = candidate
        return () => undefined
      }),
      updateHighlightRanges: vi.fn(),
      activateHighlight,
      removeHighlights: vi.fn(),
      t,
    } as unknown as AssistantAnnotationProps

    try {
      const { getByTestId, rerender } = render(
        <div data-testid="conversation-scroll" style={{ overflowY: 'auto' }}>
          <AnnotatedAssistantNode {...props} />
        </div>,
      )
      const scroller = getByTestId('conversation-scroll')
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 1200 },
      })
      scroller.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 100,
          top: 100,
          right: 600,
          bottom: 500,
          left: 0,
          width: 600,
          height: 400,
          toJSON: () => ({}),
        }) as DOMRect
      const scrollBy = vi.fn()
      Object.defineProperty(scroller, 'scrollBy', { configurable: true, value: scrollBy })
      const mountedEndpoint = endpoint
      expect(mountedEndpoint).toBeDefined()
      view = savedView
      rerender(
        <div data-testid="conversation-scroll" style={{ overflowY: 'auto' }}>
          <AnnotatedAssistantNode {...props} />
        </div>,
      )

      activateHighlight.mockClear()
      act(() => mountedEndpoint?.reveal(annotation.annotationId, 0))
      expect(scrollBy).toHaveBeenCalledWith({ top: 70, behavior: 'smooth' })
      expect(document.querySelector('.dia-quote-flash')).toBeInTheDocument()
      expect(activateHighlight).not.toHaveBeenCalledWith(annotation.messageId, expect.any(Range))

      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true })),
      )
      scrollBy.mockClear()
      act(() => endpoint?.reveal(annotation.annotationId, 0))
      expect(scrollBy).toHaveBeenCalledWith({ top: 70, behavior: 'auto' })

      scroller.style.overflowY = 'visible'
      const root = document.documentElement
      const rootWidth = Object.getOwnPropertyDescriptor(root, 'offsetWidth')
      const rootRect = Object.getOwnPropertyDescriptor(root, 'getBoundingClientRect')
      try {
        Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 800 })
        Object.defineProperty(root, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            x: 0,
            y: 0,
            top: 0,
            right: 1000,
            bottom: 800,
            left: 0,
            width: 1000,
            height: 800,
            toJSON: () => ({}),
          }),
        })
        const windowScrollBy = vi.fn()
        vi.stubGlobal('visualViewport', {
          offsetTop: 100,
          height: 400,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })
        vi.stubGlobal('scrollBy', windowScrollBy)
        act(() => endpoint?.reveal(annotation.annotationId, 0))
        expect(windowScrollBy).toHaveBeenCalledWith({ top: 56, behavior: 'auto' })
      } finally {
        if (rootWidth === undefined) Reflect.deleteProperty(root, 'offsetWidth')
        else Object.defineProperty(root, 'offsetWidth', rootWidth)
        if (rootRect === undefined) Reflect.deleteProperty(root, 'getBoundingClientRect')
        else Object.defineProperty(root, 'getBoundingClientRect', rootRect)
      }
    } finally {
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
    }
  })

  it('expands a hidden Turn source, centers the full quote, and clears its transient flash', () => {
    vi.useFakeTimers()
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      messageId: 'assistant-chip' as (typeof payload.annotations)[0]['messageId'],
      messageSeq: 9,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const rect = (top: number): DOMRect => new DOMRect(160, top, 120, 20)
    let rangeMeasurements = 0
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        if (this.toString() !== annotation.quote.exact) return [] as unknown as DOMRectList
        rangeMeasurements += 1
        return [rect(200), rect(360)] as unknown as DOMRectList
      },
    })
    let endpoint:
      | {
          reveal(annotationId: typeof annotation.annotationId, navigationEpoch: number): void
        }
      | undefined
    let processOpen = false
    const setOpen = vi.fn((open: boolean) => {
      processOpen = open
    })
    const activateHighlight = vi.fn()
    const baseProps = {
      ...assistantPropsFor(view, 'closed', [
        { kind: 'text', text: `before ${annotation.quote.exact} after` },
      ]),
      registerEndpoint: vi.fn((_messageId, candidate) => {
        endpoint = candidate
        return () => undefined
      }),
      activateHighlight,
    }
    const tree = (open: boolean, hidden: boolean) => (
      <div
        data-testid="folded-source-scroll"
        style={{ overflowY: 'auto' }}
        data-turn-process-hidden={hidden ? 'true' : undefined}
      >
        <AnnotatedAssistantNode
          {...(baseProps as AssistantAnnotationProps)}
          turnProcess={
            {
              spec: {},
              foldable: true,
              open,
              setOpen,
            } as unknown as AssistantAnnotationProps['turnProcess']
          }
        />
      </div>
    )

    try {
      const rendered = render(tree(false, true))
      const scroller = screen.getByTestId('folded-source-scroll')
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 1_200 },
      })
      scroller.getBoundingClientRect = () => new DOMRect(0, 100, 600, 400)
      const scrollBy = vi.fn()
      Object.defineProperty(scroller, 'scrollBy', { configurable: true, value: scrollBy })
      rangeMeasurements = 0
      activateHighlight.mockClear()

      act(() => endpoint?.reveal(annotation.annotationId, 0))
      expect(setOpen).toHaveBeenCalledWith(true)
      expect(processOpen).toBe(true)
      expect(rangeMeasurements).toBe(0)
      expect(scrollBy).not.toHaveBeenCalled()

      rendered.rerender(tree(true, false))
      expect(scrollBy).toHaveBeenCalledWith({ top: -10, behavior: 'smooth' })
      expect(rendered.container.querySelectorAll('.dia-quote-flash')).toHaveLength(2)
      expect(activateHighlight).not.toHaveBeenCalledWith(annotation.messageId, expect.any(Range))

      act(() => vi.advanceTimersByTime(QUOTE_FLASH_TEST_MS - 1))
      expect(rendered.container.querySelectorAll('.dia-quote-flash')).toHaveLength(2)
      act(() => vi.advanceTimersByTime(1))
      expect(rendered.container.querySelector('.dia-quote-flash')).toBeNull()

      setOpen.mockClear()
      scrollBy.mockClear()
      rendered.rerender(tree(false, false))
      act(() => endpoint?.reveal(annotation.annotationId, 0))
      expect(setOpen).not.toHaveBeenCalled()
      expect(scrollBy).toHaveBeenCalled()
      rendered.unmount()
    } finally {
      vi.useRealTimers()
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
    }
  })

  it('supersedes an earlier message flash when a newer navigation epoch starts', () => {
    const payload = fixturePayload()
    const first = {
      ...payload.annotations[0]!,
      messageId: 'assistant-source-first' as (typeof payload.annotations)[0]['messageId'],
      quote: { exact: 'First source', prefix: '', suffix: '', start: 0, end: 12 },
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const second = {
      ...first,
      annotationId: 'ann-source-second' as typeof first.annotationId,
      messageId: 'assistant-source-second' as typeof first.messageId,
      messageSeq: 43,
      quote: { exact: 'Second source', prefix: '', suffix: '', start: 0, end: 13 },
    }
    let view: AnnotationView = { ...baseView(), annotations: [first, second] }
    const endpoints = new Map<
      string,
      { reveal(annotationId: typeof first.annotationId, epoch: number): void }
    >()
    const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        return /^(?:First|Second) source$/u.test(this.toString())
          ? ([new DOMRect(120, 240, 100, 20)] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList)
      },
    })
    vi.stubGlobal('scrollBy', vi.fn())
    const tree = () => (
      <>
        {[first, second].map((annotation) => {
          const props = assistantPropsFor(view, 'closed', [{ kind: 'text', text: annotation.quote.exact }])
          return (
            <AnnotatedAssistantNode
              key={annotation.messageId}
              {...props}
              node={
                {
                  ...props.node,
                  data: {
                    ...props.node.data,
                    blocks: [{ kind: 'text', text: annotation.quote.exact }],
                    finalNode: { messageId: annotation.messageId, seq: annotation.messageSeq },
                  },
                } as AssistantAnnotationProps['node']
              }
              registerEndpoint={(_messageId, endpoint) => {
                endpoints.set(annotation.messageId, endpoint)
                return () => endpoints.delete(annotation.messageId)
              }}
            />
          )
        })}
      </>
    )

    try {
      const rendered = render(tree())
      view = { ...view, navigationEpoch: 1 }
      rendered.rerender(tree())
      act(() => endpoints.get(first.messageId)?.reveal(first.annotationId, 1))
      expect(
        rendered.container.querySelector(
          `[data-dsh-annotation-message-id="${first.messageId}"] .dia-quote-flash`,
        ),
      ).toBeInTheDocument()

      view = { ...view, navigationEpoch: 2 }
      rendered.rerender(tree())
      expect(
        rendered.container.querySelector(
          `[data-dsh-annotation-message-id="${first.messageId}"] .dia-quote-flash`,
        ),
      ).toBeNull()
      act(() => endpoints.get(first.messageId)?.reveal(first.annotationId, 1))
      expect(
        rendered.container.querySelector(
          `[data-dsh-annotation-message-id="${first.messageId}"] .dia-quote-flash`,
        ),
      ).toBeNull()
      act(() => endpoints.get(second.messageId)?.reveal(second.annotationId, 2))
      expect(rendered.container.querySelectorAll('.dia-quote-flash')).toHaveLength(1)
      expect(
        rendered.container.querySelector(
          `[data-dsh-annotation-message-id="${second.messageId}"] [data-navigation-epoch="2"]`,
        ),
      ).toBeInTheDocument()
      rendered.unmount()
    } finally {
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
    }
  })
})

function assistantPropsFor(
  view: AnnotationView,
  status: 'running' | 'closed',
  blocks: unknown[],
  openAnnotation: (...args: unknown[]) => void = vi.fn(),
  navigate: (annotationId: unknown) => Promise<boolean> = vi.fn(async () => true),
): AssistantAnnotationProps {
  return {
    node: {
      data: {
        status,
        blocks,
        finalNode: { messageId: 'assistant-chip', seq: 9 },
      },
      location: { kind: 'root' },
    },
    useTurnData: () => undefined,
    openFile: vi.fn(),
    renderMessageImages: () => null,
    fileMentions: vi.fn(),
    useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
    beginSelection: vi.fn(),
    openAnnotation,
    navigate,
    registerEndpoint: vi.fn(() => () => undefined),
    updateHighlightRanges: vi.fn(),
    activateHighlight: vi.fn(),
    removeHighlights: vi.fn(),
    t,
  } as unknown as AssistantAnnotationProps
}

describe('reply chips', () => {
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const inlineRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  const elementRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')

  afterEach(() => {
    vi.useRealTimers()
    if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    else Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRects)
    if (inlineRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
    else Object.defineProperty(Range.prototype, 'getClientRects', inlineRects)
    if (elementRect === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
    else Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', elementRect)
  })

  function chipGeometry() {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, left: 200, right: 260, bottom: 118, width: 60, height: 18 }),
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400 }),
    })
  }

  it('preserves heading text and gives its exact bounds a keyboard annotation target', async () => {
    chipGeometry()
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'sent' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const rawText = `<!-- dsh-annotation-reply:{"submissionId":"${payload.submissionId}","annotationId":"${payload.annotations[0]!.annotationId}","ordinal":1} -->\n注解 1：已处理这段内容。`
    const openAnnotation = vi.fn()
    const navigate = vi.fn(async (_annotationId: unknown) => true)
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    render(
      <AnnotatedAssistantNode
        {...assistantPropsFor(view, 'closed', [{ kind: 'text', text: rawText }], openAnnotation, navigate)}
      />,
    )

    const chip = await screen.findByRole('button', { name: /Annotation 1:/u })
    expect(chip).toBeEmptyDOMElement()
    expect(chip).toHaveStyle({ top: '100px', left: '200px', width: '60px', height: '18px' })
    expect(screen.getByText('注解 1：已处理这段内容。')).toBeInTheDocument()
    expect(screen.queryByText('dsh-annotation-reply')).not.toBeInTheDocument()

    fireEvent.focus(chip)
    expect(screen.getByText('selected source')).toBeInTheDocument()
    expect(screen.getByText('Explain this claim.')).toBeInTheDocument()
    fireEvent.blur(chip)
    expect(screen.queryByText('selected source')).not.toBeInTheDocument()

    fireEvent.click(chip)
    expect(navigate).toHaveBeenCalledWith(payload.annotations[0]!.annotationId)
    expect(openAnnotation).not.toHaveBeenCalled()
  })

  it.each(['durable history', 'sent outbox'])(
    'keeps both reply headings interactive after resending from %s',
    (source) => {
      chipGeometry()
      const payload = fixturePayload()
      const annotation = {
        ...payload.annotations[0]!,
        status: 'sent' as const,
        updatedAt: payload.createdAt,
        submissionId: payload.submissionId,
      }
      const resentSubmissionId = 'sub-resent' as typeof payload.submissionId
      const resentPayload = { ...payload, submissionId: resentSubmissionId }
      const view: AnnotationView = {
        ...baseView(),
        annotations: [annotation],
        ...(source === 'durable history'
          ? {
              replyAssociations: [
                { submissionId: payload.submissionId, annotationId: annotation.annotationId },
                { submissionId: resentSubmissionId, annotationId: annotation.annotationId },
              ],
            }
          : {
              outbox: [
                {
                  payload: resentPayload,
                  targetSessionId: payload.sessionId,
                  messageId: payload.annotations[0]!.messageId,
                  status: 'sent' as const,
                  attempts: 1,
                },
              ],
            }),
      }
      const reply = (submissionId: typeof payload.submissionId, wording: string) =>
        `<!-- dsh-annotation-reply:{"submissionId":"${submissionId}","annotationId":"${annotation.annotationId}","ordinal":1} -->\n注解 1：${wording}`
      const navigate = vi.fn(async (_annotationId: unknown) => true)
      render(
        <>
          <AnnotatedAssistantNode
            {...assistantPropsFor(
              view,
              'closed',
              [{ kind: 'text', text: reply(payload.submissionId, '首次回复。') }],
              vi.fn(),
              navigate,
            )}
          />
          <AnnotatedAssistantNode
            {...assistantPropsFor(
              view,
              'closed',
              [{ kind: 'text', text: reply(resentSubmissionId, '再次回复。') }],
              vi.fn(),
              navigate,
            )}
          />
        </>,
      )

      const chips = screen.getAllByRole('button', { name: /Annotation 1:/u })
      expect(chips).toHaveLength(2)
      for (const chip of chips) {
        fireEvent.focus(chip)
        const preview = screen.getByRole('tooltip', { name: 'Annotation 1' })
        expect(within(preview).getByText('selected source')).toBeInTheDocument()
        expect(within(preview).getByText('Explain this claim.')).toBeInTheDocument()
        fireEvent.blur(chip)
        fireEvent.click(chip)
      }
      expect(navigate).toHaveBeenCalledTimes(2)
      expect(navigate).toHaveBeenNthCalledWith(1, annotation.annotationId)
      expect(navigate).toHaveBeenNthCalledWith(2, annotation.annotationId)
    },
  )

  it('restores and activates four marker headings after display whitespace normalization', () => {
    chipGeometry()
    const payload = fixturePayload()
    const base = {
      ...payload.annotations[0]!,
      status: 'sent' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const secondSubmissionId = 'sub-restored-second' as typeof payload.submissionId
    const annotations = [
      { submissionId: payload.submissionId, annotationId: base.annotationId, ordinal: 1 },
      {
        submissionId: payload.submissionId,
        annotationId: 'ann-restored-2' as typeof base.annotationId,
        ordinal: 2,
      },
      {
        submissionId: secondSubmissionId,
        annotationId: 'ann-restored-3' as typeof base.annotationId,
        ordinal: 1,
      },
      {
        submissionId: secondSubmissionId,
        annotationId: 'ann-restored-4' as typeof base.annotationId,
        ordinal: 2,
      },
    ].map((identity, index) => {
      const quote = `Restored source ${index + 1}`
      return {
        ...base,
        ...identity,
        quote: { exact: quote, prefix: '', suffix: '', start: index * 20, end: index * 20 + quote.length },
        annotation: `Restored note ${index + 1}`,
      }
    })
    const rawText = annotations
      .map(
        (annotation, index) =>
          `<!-- dsh-annotation-reply:{"submissionId":"${annotation.submissionId}","annotationId":"${annotation.annotationId}","ordinal":${annotation.ordinal}} -->\n\n\n\nAnnotation ${annotation.ordinal}: Answer ${index + 1}.`,
      )
      .join('\n\n\n\n')
    const view: AnnotationView = { ...baseView(), annotations }
    const openAnnotation = vi.fn()
    const navigate = vi.fn(async (_annotationId: unknown) => true)

    render(
      <AnnotatedAssistantNode
        {...assistantPropsFor(view, 'closed', [{ kind: 'text', text: rawText }], openAnnotation, navigate)}
      />,
    )

    expect(screen.getAllByRole('button', { name: /Annotation [12]:/u })).toHaveLength(4)
    for (const annotation of annotations) {
      const chip = screen.getByRole('button', {
        name: `Annotation ${annotation.ordinal}: ${annotation.quote.exact} · ${annotation.annotation}`,
      })
      fireEvent.focus(chip)
      const preview = screen.getByRole('tooltip', { name: `Annotation ${annotation.ordinal}` })
      expect(within(preview).getByText(annotation.quote.exact)).toBeInTheDocument()
      expect(within(preview).getByText(annotation.annotation)).toBeInTheDocument()
      fireEvent.blur(chip)
      fireEvent.click(chip)
    }
    expect(navigate.mock.calls.map(([annotationId]) => annotationId)).toEqual(
      annotations.map((annotation) => annotation.annotationId),
    )
    expect(openAnnotation).not.toHaveBeenCalled()
  })

  function linkedReply(heading: string) {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'sent' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const text = `<!-- dsh-annotation-reply:{"submissionId":"${payload.submissionId}","annotationId":"${annotation.annotationId}","ordinal":1} -->\n${heading} Original wording.`
    return { annotation, view, text }
  }

  it.each(['Annotation 1:', '注解 1：'])(
    'retains the original %s label instead of painting translated text over it',
    (heading) => {
      chipGeometry()
      const { view, text } = linkedReply(heading)
      const { container } = render(
        <AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />,
      )
      const chip = screen.getByRole('button', { name: /Annotation 1:/u })
      expect(chip).toBeEmptyDOMElement()
      expect(container.querySelector('.dia-assistant__body')?.textContent).toBe(
        `${heading} Original wording.`,
      )
    },
  )

  it.each(['wrapped', 'unmeasurable'])(
    'keeps measurable reply heading fragments interactive: %s',
    (geometry) => {
      chipGeometry()
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () =>
          geometry === 'wrapped' ? [new DOMRect(200, 100, 30, 18), new DOMRect(0, 128, 30, 18)] : [],
      })
      if (geometry === 'unmeasurable') {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: () => new DOMRect(),
        })
      }
      const { view, text } = linkedReply('Annotation 1:')
      render(<AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />)
      if (geometry === 'unmeasurable') {
        expect(screen.queryByRole('button', { name: /Annotation 1:/u })).not.toBeInTheDocument()
      } else {
        const chip = screen.getByRole('button', { name: /Annotation 1:/u })
        expect(chip.querySelectorAll('.dia-reply-chip__fragment')).toHaveLength(2)
      }
      expect(screen.getByText('Annotation 1: Original wording.')).toBeInTheDocument()
    },
  )

  it('delays pointer previews, preserves selected heading text, and cancels previews on Escape and unmount', () => {
    vi.useFakeTimers()
    chipGeometry()
    const { annotation, view, text } = linkedReply('Annotation 1:')
    const openAnnotation = vi.fn()
    const navigate = vi.fn(async (_annotationId: unknown) => true)
    const rendered = render(
      <AnnotatedAssistantNode
        {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }], openAnnotation, navigate)}
      />,
    )
    const paragraph = screen.getByText('Annotation 1: Original wording.')
    const point = { bubbles: true, clientX: 210, clientY: 110, buttons: 0 }
    const selection = window.getSelection()!
    try {
      fireEvent(paragraph, new MouseEvent('pointermove', point))
      act(() => vi.advanceTimersByTime(299))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByRole('tooltip', { name: 'Annotation 1' })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      const range = document.createRange()
      range.selectNodeContents(paragraph)
      selection.removeAllRanges()
      selection.addRange(range)
      fireEvent(paragraph, new MouseEvent('pointermove', point))
      fireEvent.click(paragraph, point)
      act(() => vi.advanceTimersByTime(300))
      expect(selection.toString()).toBe('Annotation 1: Original wording.')
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      expect(navigate).not.toHaveBeenCalled()
      expect(openAnnotation).not.toHaveBeenCalled()

      selection.removeAllRanges()
      fireEvent.click(paragraph, point)
      expect(navigate).toHaveBeenCalledWith(annotation.annotationId)
      expect(openAnnotation).not.toHaveBeenCalled()

      const editorView: AnnotationView = {
        ...view,
        editor: { kind: 'edit', annotationId: annotation.annotationId, text: annotation.annotation },
      }
      rendered.rerender(
        <AnnotatedAssistantNode
          {...assistantPropsFor(editorView, 'closed', [{ kind: 'text', text }], openAnnotation, navigate)}
        />,
      )
      fireEvent.click(screen.getByText('Annotation 1: Original wording.'), point)
      expect(navigate).toHaveBeenCalledTimes(1)

      rendered.rerender(
        <AnnotatedAssistantNode
          {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }], openAnnotation, navigate)}
        />,
      )
      const restoredParagraph = screen.getByText('Annotation 1: Original wording.')
      fireEvent(restoredParagraph, new MouseEvent('pointermove', point))
      const pending = vi.getTimerCount()
      expect(pending).toBeGreaterThan(0)
      rendered.unmount()
      expect(vi.getTimerCount()).toBeLessThan(pending)
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    } finally {
      selection.removeAllRanges()
    }
  })

  it.each([
    'Annotation 1: Answer first. A later citation says 注解 1: example.',
    'Annotation 10: Another label. Annotation 1: Answer first.',
  ])('locates the nearest complete heading in %s', (heading) => {
    chipGeometry()
    const measured: string[] = []
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        measured.push(this.toString())
        return new DOMRect(200, 100, 60, 18)
      },
    })
    const { view, text } = linkedReply(heading)
    render(<AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />)
    expect(screen.getByRole('button', { name: /Annotation 1:/u })).toBeInTheDocument()
    expect(measured).toContain('Annotation 1')
    expect(measured).not.toContain('注解 1')
  })

  it('keeps the preview and navigation when a resized heading wraps onto another line', () => {
    vi.useFakeTimers()
    chipGeometry()
    let wrapped = false
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () =>
        wrapped
          ? [new DOMRect(200, 100, 30, 18), new DOMRect(0, 128, 30, 18)]
          : [new DOMRect(200, 100, 60, 18)],
    })
    const { view, text } = linkedReply('Annotation 1:')
    render(<AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />)
    fireEvent.focus(screen.getByRole('button', { name: /Annotation 1:/u }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    wrapped = true
    fireEvent(window, new Event('resize'))
    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Annotation 1:/u }).querySelectorAll('.dia-reply-chip__fragment'),
    ).toHaveLength(2)
    expect(screen.getByText('Annotation 1: Original wording.')).toBeInTheDocument()
  })

  it('keeps ambiguously repeated formatted headings as plain text', () => {
    chipGeometry()
    const { view, text } = linkedReply('**Annotation 1**: First.\n\n**Annotation 1**: Repeated.')
    render(<AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />)
    expect(screen.queryByRole('button', { name: /Annotation 1:/u })).not.toBeInTheDocument()
    expect(screen.getAllByText('Annotation 1')).toHaveLength(2)
  })

  it('does not substitute a unique translated citation for an earlier duplicated heading', () => {
    chipGeometry()
    const { view, text } = linkedReply(
      'Annotation 1: First.\n\nAnnotation 1: Repeated.\n\n注解 1：translated citation.',
    )
    render(<AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text }])} />)
    expect(screen.queryByRole('button', { name: /Annotation 1:/u })).not.toBeInTheDocument()
  })

  it('ignores unknown, duplicate, and malformed markers while keeping plain text', async () => {
    chipGeometry()
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'sent' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const { annotationId } = payload.annotations[0]!
    const rawText = [
      `<!-- dsh-annotation-reply:{"submissionId":"${payload.submissionId}","annotationId":"${annotationId}","ordinal":1} -->\n注解 1：第一段。`,
      `<!-- dsh-annotation-reply:{"submissionId":"${payload.submissionId}","annotationId":"${annotationId}","ordinal":1} -->\n注解 1：重复标记被忽略。`,
      `<!-- dsh-annotation-reply:{"submissionId":"unknown-sub","annotationId":"ann-unknown","ordinal":2} -->\n注解 2：伪造标记。`,
      '<!-- dsh-annotation-reply:{bad} -->',
      '注解 3：没有标记的普通文字。',
    ].join('\n\n')
    render(
      <AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text: rawText }])} />,
    )

    const chips = await screen.findAllByRole('button', { name: /Annotation \d+:/u })
    expect(chips).toHaveLength(1)
    expect(screen.getByText('注解 1：第一段。')).toBeInTheDocument()
    expect(screen.getByText(/注解 2：伪造标记。/u)).toBeInTheDocument()
    expect(screen.getByText(/注解 3：没有标记的普通文字。/u)).toBeInTheDocument()
  })

  it('waits for streaming to settle before showing chips', () => {
    chipGeometry()
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'sent' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const rawText = `<!-- dsh-annotation-reply:{"submissionId":"${payload.submissionId}","annotationId":"${payload.annotations[0]!.annotationId}","ordinal":1} -->\n注解 1：回答中。`
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const props = assistantPropsFor(view, 'running', [{ kind: 'text', text: rawText }])
    const { rerender } = render(<AnnotatedAssistantNode {...props} />)
    expect(screen.queryByRole('button', { name: /Annotation 1:/u })).not.toBeInTheDocument()

    rerender(
      <AnnotatedAssistantNode {...assistantPropsFor(view, 'closed', [{ kind: 'text', text: rawText }])} />,
    )
    expect(screen.getByRole('button', { name: /Annotation 1:/u })).toBeInTheDocument()
  })
})
