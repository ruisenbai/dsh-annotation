// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotatedAssistantNode } from '../src/client/components/AnnotatedAssistantNode.tsx'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import { AnnotationDock } from '../src/client/components/AnnotationDock.tsx'
import {
  AnnotationPluginCard,
  type AnnotationPluginCardProps,
} from '../src/client/components/AnnotationPluginCard.tsx'
import { COMPOSER_ATTACHMENT_TOKEN } from '../src/client/composer-attachment.ts'
import type { AnnotationView } from '../src/client/controller.ts'
import type {
  AssistantAnnotationProps,
  InputAnnotationProps,
  UserAnnotationProps,
} from '../src/client/contract.ts'
import type { AnnotationLocaleKey } from '../src/client/locales.ts'
import { styles } from '../src/client/styles.ts'
import { fixturePayload } from './fixtures.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = (key: AnnotationLocaleKey, params?: Record<string, unknown>) => {
  const values: Partial<Record<AnnotationLocaleKey, string>> = {
    'settings.title': 'DSH Inline Comments',
    'settings.description': 'Show inline comment features.',
    'settings.cardDescription': 'Selection comments and composer attachments.',
    'settings.toggle': 'Enable DSH Inline Comments',
    'settings.autoAttach': 'Attach new comments to the composer automatically',
    'settings.localTools': 'Show local data tools',
    'settings.autoAttachHint': 'Saving a new comment attaches it to the official composer.',
    'settings.on': 'On',
    'settings.off': 'Off',
    'settings.expand': 'Show settings',
    'settings.collapse': 'Hide settings',
    'settings.overridden': 'Overridden',
    'settings.reset': 'Reset to default',
    'settings.readOnly': 'This deployment stores settings read-only.',
    'settings.save': 'Save',
    'settings.saving': 'Saving…',
    'settings.discard': 'Discard',
    'settings.unsaved': 'Unsaved',
    'settings.saveFailed': 'The deployment did not accept this value.',
    'timeline.summary': `Added ${String(params?.count)} inline comments`,
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
    'list.delete': 'Delete',
    'list.withdraw': 'Withdraw queued batch',
    'list.deleted': 'Draft comment deleted',
    'list.undo': 'Undo',
    'local.usage': `Local data · ${String(params?.size)}`,
    'local.export': 'Export local data',
    'local.clear': 'Clear drafts',
    'local.exported': 'Local data exported',
    'local.exportFailed': 'Local data export failed',
    'local.confirmClear': 'Clear every draft?',
    'local.keep': 'Keep',
    'local.confirm': 'Clear drafts now',
    'toast.queued': `${String(params?.count)} comments queued; withdrawal is available`,
    'toast.sent': `${String(params?.count)} comments sent; history cannot be withdrawn`,
    'toast.failed': `Send failed; comments remain attached for submission ${String(params?.id)}`,
    'editor.title': 'Add comment',
    'editor.editTitle': 'Edit comment',
    'editor.annotationLabel': 'Your annotation',
    'editor.shortcut': 'Ctrl/⌘ ↵ to save',
    'editor.autosaving': 'Saving locally…',
    'editor.autosaved': 'Automatically saved locally',
    'editor.chooseAction': 'Use Cancel or Save on the right',
    'editor.cancel': 'Cancel',
    'editor.save': 'Save comment',
    'editor.placeholder': 'Explain what to change',
    'selection.toolbar': 'Selection actions',
    'selection.annotate': 'Add annotation',
    'selection.copy': 'Copy',
    'error.imagesRequired': `Re-select the ${String(params?.count)} images or discard the record.`,
    'list.discard': 'Discard this pending record',
    'reply.chip': `Annotation ${String(params?.ordinal)}`,
    'reply.chipLabel': `Annotation ${String(params?.ordinal)}: ${String(params?.quote)} · ${String(params?.annotation)}`,
    'editor.emptyHint': 'Annotation content may be empty; empty means highlight only.',
    highlightOnly: 'Highlight only',
    'compact.count': `Annotations ×${String(params?.count)}`,
    'compact.overview': 'Attached annotations overview',
  }
  return values[key] ?? key
}

function baseView(): AnnotationView {
  return {
    annotations: [],
    outbox: [],
    overallRequirementDraft: '',
    editor: null,
    editorSaveStatus: 'idle',
    deletedDraft: null,
    panelOpen: false,
    notice: null,
    activeAnnotationId: null,
    latestAssistantMessageId: null,
    storageAvailable: true,
    storageBytes: 0,
  }
}

const idleInput = {
  draft: '',
  imageIds: [],
  draftRev: 0,
  phase: 'plain',
  occurrences: [],
  queue: [],
} as const
const noAttachmentRepair = () => undefined
const noAttachmentToggle = () => true
const noAutoAttach = () => false
const noEnsureAttachment = () => true

function TestAnnotationDock({
  input = idleInput as InputAnnotationProps['input'],
  repairComposerAttachment = noAttachmentRepair,
  toggleComposerAttachment = noAttachmentToggle,
  autoAttachEnabled = noAutoAttach,
  ensureComposerAttachment = noEnsureAttachment,
  ...props
}: InputAnnotationProps) {
  return (
    <AnnotationDock
      input={input}
      repairComposerAttachment={repairComposerAttachment}
      toggleComposerAttachment={toggleComposerAttachment}
      autoAttachEnabled={autoAttachEnabled}
      ensureComposerAttachment={ensureComposerAttachment}
      {...props}
    />
  )
}

describe('plugin settings card', () => {
  const state = {
    available: true,
    writable: true,
    enabled: true,
    overridden: false,
    autoAttach: true,
    autoAttachOverridden: false,
    localTools: true,
    localToolsOverridden: false,
    dirty: false,
    saving: false,
    failed: false,
  }

  function cardProps(overrides: Partial<typeof state> = {}) {
    const snapshot = { ...state, ...overrides }
    return {
      useSettingsCard: <S,>(selector: (value: typeof snapshot) => S) => selector(snapshot),
      setEnabled: vi.fn(),
      resetEnabled: vi.fn(),
      setAutoAttach: vi.fn(),
      resetAutoAttach: vi.fn(),
      setLocalTools: vi.fn(),
      resetLocalTools: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      t,
    } as unknown as AnnotationPluginCardProps
  }

  it('stages the switch and writes only from the card footer', () => {
    const props = cardProps({ dirty: true })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('DSH Inline Comments'))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable DSH Inline Comments' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Attach new comments to the composer automatically' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show local data tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(props.setEnabled).toHaveBeenCalledWith(false)
    expect(props.setAutoAttach).toHaveBeenCalledWith(false)
    expect(props.setLocalTools).toHaveBeenCalledWith(false)
    expect(props.save).toHaveBeenCalledOnce()
    expect(props.discard).toHaveBeenCalledOnce()
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('offers override reset and reports read-only save failures', () => {
    const props = cardProps({ writable: false, overridden: true, dirty: true, failed: true })
    render(<AnnotationPluginCard {...props} />)
    fireEvent.click(screen.getByText('DSH Inline Comments'))

    expect(screen.getByText('This deployment stores settings read-only.')).toHaveAttribute('role', 'status')
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    for (const control of screen.getAllByRole('switch')) expect(control).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled()
    expect(screen.getByText('The deployment did not accept this value.')).toBeInTheDocument()
  })
})

describe('inline comment presentation', () => {
  it('folds a durable comment submission and navigates by id', () => {
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
      node: { data: { source: { kind: 'user', inlineComments: payload }, content: [] } },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      navigate,
      renderMessageImages: () => null,
      t,
    } as unknown as UserAnnotationProps<'user'>
    render(<AnnotatedUserNode {...props} />)
    expect(screen.getByText('Rewrite the proposal coherently.')).toBeInTheDocument()
    expect(screen.getByText('Added 1 inline comments')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Added 1 inline comments'))
    expect(screen.getByText('Explain this claim.')).toBeInTheDocument()
    const locate = screen.getByRole('button', { name: 'Locate source' })
    expect(locate.querySelector('svg.lucide-map-pin')).toBeInTheDocument()
    fireEvent.click(locate)
    expect(navigate).toHaveBeenCalledWith(payload.annotations[0]?.annotationId)
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

  it('shows the composer dock only when recoverable comment state exists', () => {
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen,
      t,
    } as unknown as InputAnnotationProps
    const { rerender } = render(<TestAnnotationDock {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Inline comments/u }))
    expect(setPanelOpen).toHaveBeenCalledWith(true)

    const emptyProps = {
      ...props,
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
    } as unknown as InputAnnotationProps
    rerender(<TestAnnotationDock {...emptyProps} />)
    expect(screen.queryByRole('button', { name: /inline comments/u })).not.toBeInTheDocument()
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
      annotation: 'Use a concrete example here.',
    }
    const navigate = vi.fn(async () => true)
    const toggleComposerAttachment = vi.fn(() => true)
    const view: AnnotationView = {
      ...baseView(),
      annotations: [annotation, secondAnnotation],
      panelOpen: true,
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      toggleComposerAttachment,
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate,
      withdraw: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(
      <>
        <style>{styles}</style>
        <TestAnnotationDock {...props} />
      </>,
    )

    const panel = screen.getByRole('region', { name: 'Inline comments' })
    expect(panel).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Inline comments' })).not.toBeInTheDocument()
    const rows = panel.querySelectorAll<HTMLElement>('.dia-item')
    expect(rows).toHaveLength(2)
    expect(within(panel).getByText(secondAnnotation.annotation)).toBeInTheDocument()
    const firstRow = within(rows[0]!)
    const comment = firstRow.getByText(annotation.annotation)
    expect(comment.parentElement?.children).toHaveLength(2)
    expect(within(panel).queryByText(annotation.annotationId)).not.toBeInTheDocument()
    expect(within(panel).queryByLabelText('Overall request (optional)')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Send 2 comments/u })).not.toBeInTheDocument()

    for (const name of ['Locate source', 'Edit', 'Delete']) {
      expect(firstRow.getByRole('button', { name })).not.toHaveTextContent(/\S/u)
    }
    const locate = firstRow.getByRole('button', { name: 'Locate source' })
    expect(locate.querySelector('svg.lucide-map-pin')).toBeInTheDocument()
    fireEvent.click(locate)
    expect(navigate).toHaveBeenCalledWith(annotation.annotationId)
    fireEvent.click(firstRow.getByRole('button', { name: 'Edit' }))
    expect(props.openAnnotation).toHaveBeenCalledWith(annotation.annotationId)
    fireEvent.click(firstRow.getByRole('button', { name: 'Delete' }))
    expect(props.deleteDraft).toHaveBeenCalledWith(annotation.annotationId)

    const attach = screen.getByRole('button', { name: 'Attach 2 comments to the next send' })
    const summaryActions = attach.closest('.dia-dock__actions')
    expect(summaryActions).not.toBeNull()
    expect(window.getComputedStyle(summaryActions!)).toMatchObject({ gap: '10px' })
    expect(window.getComputedStyle(attach)).toMatchObject({
      width: '28px',
      height: '28px',
      borderRadius: '999px',
    })
    expect(
      attach.compareDocumentPosition(screen.getByRole('button', { name: 'Collapse inline comments' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.click(attach)
    expect(toggleComposerAttachment).toHaveBeenCalled()
    expect(props.setPanelOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.setPanelOpen).toHaveBeenCalledWith(false)
  })

  it('shows the armed business state and detaches without folding the list', () => {
    const payload = fixturePayload()
    const view: AnnotationView = {
      ...baseView(),
      annotations: [
        {
          ...payload.annotations[0]!,
          status: 'draft',
          updatedAt: payload.createdAt,
        },
      ],
      panelOpen: true,
    }
    const toggleComposerAttachment = vi.fn(() => true)
    const setPanelOpen = vi.fn()
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      input: {
        ...idleInput,
        draft: `${COMPOSER_ATTACHMENT_TOKEN}Rewrite this.`,
        draftRev: 2,
        phase: 'claimed',
        claim: { token: COMPOSER_ATTACHMENT_TOKEN },
      },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen,
      toggleComposerAttachment,
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    const detach = screen.getByRole('button', { name: 'Detach 1 comments' })
    expect(detach).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(detach)
    expect(toggleComposerAttachment).toHaveBeenCalled()
    expect(setPanelOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Inline comments' })).toBeInTheDocument()
  })

  it.each([
    {
      name: 'running task',
      session: { pending: [], running: true },
      archived: false,
      label: 'Attach 1 comments to the next send',
      disabled: false,
    },
    {
      name: 'awaiting confirmation',
      session: { pending: [{}], running: true },
      archived: false,
      label: 'Attach 1 comments to the next send',
      disabled: false,
    },
    {
      name: 'archived task',
      session: { pending: [], running: false },
      archived: true,
      label: 'Archived tasks cannot attach comments',
      disabled: true,
    },
  ])('offers only the composer attachment action for a $name', ({ session, archived, label, disabled }) => {
    const payload = fixturePayload()
    const view: AnnotationView = {
      ...baseView(),
      annotations: [
        {
          ...payload.annotations[0]!,
          status: 'draft',
          updatedAt: payload.createdAt,
        },
      ],
      panelOpen: true,
    }
    const props = {
      sessionId: payload.sessionId,
      session,
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: archived ? [payload.sessionId] : [] }),
      setPanelOpen: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      withdraw: vi.fn(async () => undefined),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)
    const attach = screen.getByRole('button', { name: label })
    expect(attach).toHaveProperty('disabled', disabled)
    expect(screen.queryByRole('button', { name: /Send 1 comments/u })).not.toBeInTheDocument()
  })

  it('shows authoritative queued and durable sent Toasts with matching withdrawal rules', async () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'queued' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const acceptedEntry = {
      payload,
      targetSessionId: payload.sessionId,
      messageId: `dsh-inline-annotations:${payload.submissionId}` as typeof annotation.messageId,
      status: 'accepted' as const,
      attempts: 1,
    }
    const baseProps = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      setOverallRequirementDraft: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      submit: vi.fn(async () => undefined),
      withdraw: vi.fn(async () => undefined),
      t,
    }
    const acceptedView: AnnotationView = {
      ...baseView(),
      annotations: [annotation],
      outbox: [acceptedEntry],
      panelOpen: true,
    }
    const { rerender } = render(
      <TestAnnotationDock
        {...(baseProps as unknown as InputAnnotationProps)}
        useAnnotations={(selector) => selector(acceptedView) as never}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Confirming delivery outcome')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw queued batch' })).not.toBeInTheDocument()

    const queuedView: AnnotationView = {
      ...acceptedView,
      outbox: [{ ...acceptedEntry, status: 'queued' }],
    }
    rerender(
      <TestAnnotationDock
        {...(baseProps as unknown as InputAnnotationProps)}
        useAnnotations={(selector) => selector(queuedView) as never}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('1 comments queued; withdrawal is available')
    expect(screen.getByRole('button', { name: 'Withdraw queued batch' })).toBeInTheDocument()

    const sentView: AnnotationView = {
      ...queuedView,
      annotations: [{ ...annotation, status: 'sent' }],
      outbox: [{ ...acceptedEntry, status: 'sent' }],
    }
    rerender(
      <TestAnnotationDock
        {...(baseProps as unknown as InputAnnotationProps)}
        useAnnotations={(selector) => selector(sentView) as never}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('1 comments sent; history cannot be withdrawn')
    expect(screen.queryByRole('button', { name: 'Withdraw queued batch' })).not.toBeInTheDocument()
  })

  it('shows the immutable submission id and leaves retry on the composer attachment action', async () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'queued' as const,
      updatedAt: payload.createdAt,
      submissionId: payload.submissionId,
    }
    const sendingEntry = {
      payload,
      targetSessionId: payload.sessionId,
      messageId: `dsh-inline-annotations:${payload.submissionId}` as typeof annotation.messageId,
      status: 'sending' as const,
      attempts: 1,
    }
    const baseProps = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      setOverallRequirementDraft: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      submit: vi.fn(async () => undefined),
      withdraw: vi.fn(async () => undefined),
      t,
    }
    const sendingView: AnnotationView = {
      ...baseView(),
      annotations: [annotation],
      outbox: [sendingEntry],
      panelOpen: true,
    }
    const { rerender } = render(
      <TestAnnotationDock
        {...(baseProps as unknown as InputAnnotationProps)}
        useAnnotations={(selector) => selector(sendingView) as never}
      />,
    )
    const failedView: AnnotationView = {
      ...sendingView,
      outbox: [{ ...sendingEntry, status: 'failed', lastError: 'offline' }],
    }
    rerender(
      <TestAnnotationDock
        {...(baseProps as unknown as InputAnnotationProps)}
        useAnnotations={(selector) => selector(failedView) as never}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Send failed; comments remain attached for submission ${payload.submissionId}`,
    )
    expect(screen.getByRole('button', { name: 'Attach 1 comments to the next send' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry 1 comments/u })).not.toBeInTheDocument()
    expect(
      screen.queryByText('Retry reuses the original submission id and destination'),
    ).not.toBeInTheDocument()
  })

  it('groups statuses, offers delete undo, and manages local recovery data', () => {
    const payload = fixturePayload()
    const draft = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const queued = {
      ...draft,
      annotationId: 'ann-queued' as typeof draft.annotationId,
      ordinal: 2,
      status: 'queued' as const,
      submissionId: payload.submissionId,
      annotation: 'Queued note',
    }
    const sent = {
      ...draft,
      annotationId: 'ann-sent' as typeof draft.annotationId,
      ordinal: 3,
      status: 'sent' as const,
      submissionId: payload.submissionId,
      annotation: 'Sent note',
    }
    const undoDelete = vi.fn()
    const clearLocalDrafts = vi.fn()
    const exportLocalData = vi.fn(() => '{"storageVersion":2}')
    const view: AnnotationView = {
      ...baseView(),
      annotations: [draft, queued, sent],
      outbox: [
        {
          payload: { ...payload, annotations: [queued] },
          targetSessionId: payload.sessionId,
          messageId: `dsh-inline-annotations:${payload.submissionId}` as typeof queued.messageId,
          status: 'queued',
          attempts: 1,
        },
      ],
      deletedDraft: { ...draft, annotationId: 'ann-deleted' as typeof draft.annotationId },
      panelOpen: true,
      storageBytes: 1536,
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      setOverallRequirementDraft: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      undoDelete,
      dismissDeleteUndo: vi.fn(),
      exportLocalData,
      clearLocalDrafts,
      navigate: vi.fn(async () => true),
      submit: vi.fn(async () => undefined),
      withdraw: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<TestAnnotationDock {...props} />)

    expect(screen.getByText('Ready to attach')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.queryByText('Sent note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sent/u }))
    expect(screen.getByText('Sent note')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undoDelete).toHaveBeenCalledOnce()
    expect(screen.getByText('Local data · 1.5 KB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export local data' }))
    expect(exportLocalData).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')

    fireEvent.click(screen.getByRole('button', { name: 'Clear drafts' }))
    expect(screen.getByText('Clear every draft?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear drafts now' }))
    expect(clearLocalDrafts).toHaveBeenCalledOnce()
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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
    expect(bar).toHaveTextContent('Copy')
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

  it('copies the selection from the action bar and keeps the selection alive', async () => {
    const beginSelection = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
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
          finalNode: { messageId: 'assistant-copy-test', seq: 9 },
        },
        location: { kind: 'root' },
      },
      useTurnData: () => undefined,
      openFile: vi.fn(),
      renderMessageImages: () => null,
      fileMentions: vi.fn(),
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Selection actions' })).getByRole('button', {
        name: 'Copy',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith('selected text')
    expect(beginSelection).not.toHaveBeenCalled()
    expect(selection.isCollapsed).toBe(false)
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

  it('anchors markers after the complete text line and orders same-line numbers ascending', async () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const earlierSelection = {
      ...annotation,
      annotationId: 'ann-test-2' as typeof annotation.annotationId,
      ordinal: 2,
      quote: {
        exact: 'before',
        prefix: '',
        suffix: ' selected source after',
        start: 0,
        end: 6,
      },
      annotation: 'Clarify the introduction.',
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
        const ignored = this.startContainer.parentElement?.closest('[data-dsh-annotation-ignore="true"]')
        if (ignored !== null) return [rect(105, 140, 80)] as unknown as DOMRectList
        const text = this.toString()
        if (text === 'selected source') return [rect(finalLineTop, 260, 100)] as unknown as DOMRectList
        if (text === 'before') return [rect(finalLineTop, 115, 60)] as unknown as DOMRectList
        if (text === ' after' || text === ' selected source after') {
          return [rect(finalLineTop, finalLineRight, 100)] as unknown as DOMRectList
        }
        return [] as unknown as DOMRectList
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(100, 550, 500),
    })

    try {
      const view: AnnotationView = { ...baseView(), annotations: [annotation, earlierSelection] }
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
        renderMessageImages: () => null,
        fileMentions: vi.fn(),
        useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

      const firstMarker = screen.getByRole('button', { name: '#1: Explain this claim.' })
      const secondMarker = screen.getByRole('button', { name: '#2: Clarify the introduction.' })
      await waitFor(() => {
        expect(firstMarker).toHaveStyle({ top: '48px', left: '315px' })
        expect(secondMarker).toHaveStyle({ top: '48px', left: '341px' })
      })

      finalLineTop = 190
      fireEvent(
        screen.getByText('assistant.reasoning').closest('.dia-assistant__reasoning')!,
        new Event('toggle', { bubbles: true }),
      )
      await waitFor(() => {
        expect(firstMarker).toHaveStyle({ top: '88px', left: '315px' })
        expect(secondMarker).toHaveStyle({ top: '88px', left: '341px' })
      })

      const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
      finalLineRight = 410
      fireEvent(window, new Event('resize'))
      fireEvent(window, new Event('resize'))
      expect(requestFrame).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(firstMarker).toHaveStyle({ top: '88px', left: '365px' })
        expect(secondMarker).toHaveStyle({ top: '88px', left: '391px' })
      })
    } finally {
      if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
      if (elementRect === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
      else Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', elementRect)
    }
  })

  it('reserves a mobile gutter and wraps excess same-line markers without overflow', async () => {
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
      value: () => [rect(150, 280, 80)] as unknown as DOMRectList,
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(100, 320, 320),
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
        useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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
      const markers = annotations.map((annotation) =>
        screen.getByRole('button', { name: `#${annotation.ordinal}: ${annotation.annotation}` }),
      )

      await waitFor(() =>
        expect(container.querySelector('.dia-assistant__body')).toHaveStyle({ paddingRight: '111px' }),
      )
      const lefts = markers.map((marker) => Number.parseFloat(marker.style.left))
      expect(lefts.slice(0, 4)).toEqual(lefts.slice(0, 4).sort((left, right) => left - right))
      expect(Math.max(...lefts) + 24).toBeLessThanOrEqual(320)
      expect(markers[4]).toHaveStyle({ left: `${lefts[0]}px` })
      expect(Number.parseFloat(markers[4]!.style.top)).toBeGreaterThan(
        Number.parseFloat(markers[0]!.style.top),
      )

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
      await waitFor(() => expect(markers[0]).toHaveStyle({ top: '0px' }))
      const unresolvedLefts = markers.map((marker) => Number.parseFloat(marker.style.left))
      expect(Math.max(...unresolvedLefts) + 24).toBeLessThanOrEqual(320)
      expect(markers[4]).toHaveStyle({ left: `${unresolvedLefts[0]}px`, top: '30px' })
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
    let endpoint: { reveal(annotationId: typeof annotation.annotationId): void } | undefined
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
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

      act(() => mountedEndpoint?.reveal(annotation.annotationId))
      expect(scrollBy).toHaveBeenCalledWith({ top: 70, behavior: 'smooth' })
      expect(activateHighlight).toHaveBeenCalledWith(annotation.messageId, expect.any(Range))

      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true })),
      )
      scrollBy.mockClear()
      act(() => endpoint?.reveal(annotation.annotationId))
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
        act(() => endpoint?.reveal(annotation.annotationId))
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

  it('keeps dirty input open with a red shake until an icon action decides it', () => {
    const payload = fixturePayload()
    const closeEditor = vi.fn((force = false) => force)
    const saveEditor = vi.fn()
    const view: AnnotationView = {
      ...baseView(),
      editor: {
        kind: 'new',
        capture: {
          messageId: payload.annotations[0]!.messageId,
          messageSeq: payload.annotations[0]!.messageSeq,
          responseVersion: payload.annotations[0]!.responseVersion,
          quote: payload.annotations[0]!.quote,
          rect: { top: 40, left: 80, right: 180, bottom: 64 },
        },
        text: 'Unsaved change',
        longSelectionConfirmed: true,
      },
      editorSaveStatus: 'saved',
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(
      <>
        <style>{styles}</style>
        <TestAnnotationDock {...props} />
      </>,
    )

    const input = screen.getByLabelText('Your annotation')
    fireEvent.pointerDown(document.body)
    expect(closeEditor).toHaveBeenCalledWith()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Use Cancel or Save on the right')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('data-decision-required', 'true')
    expect(styles).toContain(".dia-editor[data-shake='1'] .dia-editor__input")

    for (const name of ['Cancel', 'Save comment']) {
      expect(screen.getByRole('button', { name })).not.toHaveTextContent(/\S/u)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(saveEditor).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closeEditor).toHaveBeenLastCalledWith(true)
  })

  it('dismisses an empty selection editor on an outside click', () => {
    const payload = fixturePayload()
    const closeEditor = vi.fn(() => true)
    const view: AnnotationView = {
      ...baseView(),
      editor: {
        kind: 'new',
        capture: {
          messageId: payload.annotations[0]!.messageId,
          messageSeq: payload.annotations[0]!.messageSeq,
          responseVersion: payload.annotations[0]!.responseVersion,
          quote: payload.annotations[0]!.quote,
          rect: { top: 20, left: 30, right: 80, bottom: 40 },
        },
        text: '',
        longSelectionConfirmed: true,
      },
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      saveEditor: vi.fn(),
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    const { rerender } = render(<TestAnnotationDock {...props} />)

    fireEvent.pointerDown(document.body)
    expect(closeEditor).toHaveBeenCalledWith()
    rerender(<TestAnnotationDock {...props} useAnnotations={(selector) => selector(baseView()) as never} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses a selection-positioned editor, saves with the keyboard shortcut, and auto-attaches', () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn(() => payload.annotations[0]!.annotationId)
    const ensureComposerAttachment = vi.fn(() => true)
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
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      setPanelOpen,
      saveEditor,
      autoAttachEnabled: () => true,
      ensureComposerAttachment,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(
      <>
        <style>{styles}</style>
        <TestAnnotationDock {...props} />
      </>,
    )

    const editor = screen.getByRole('dialog', { name: 'Add comment' })
    expect(editor).toHaveStyle({ top: '72px', left: '80px' })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(window.getComputedStyle(editor).boxSizing).toBe('border-box')
    fireEvent.keyDown(screen.getByLabelText('Your annotation'), { key: 'Enter', ctrlKey: true })
    expect(saveEditor).toHaveBeenCalledOnce()
    expect(ensureComposerAttachment).toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeEditor).toHaveBeenCalled()
    expect(setPanelOpen).not.toHaveBeenCalled()
  })

  it('edits an existing draft inline inside the summary box with a delete action', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const deleteDraft = vi.fn()
    const view: AnnotationView = {
      ...baseView(),
      annotations: [annotation],
      editor: { kind: 'edit', annotationId: annotation.annotationId, text: annotation.annotation },
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor: vi.fn(() => true),
      saveEditor: vi.fn(),
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      deleteDraft,
      t,
    } as unknown as InputAnnotationProps
    render(
      <>
        <style>{styles}</style>
        <TestAnnotationDock {...props} />
      </>,
    )

    // 编辑已有注解不再定位正文：编辑器直接内嵌在注解汇总框的向上弹出列表中。
    const editor = screen.getByRole('dialog', { name: 'Edit comment' })
    expect(editor).toHaveClass('dia-editor--inline')
    expect(editor).not.toHaveStyle({ top: expect.any(String), left: expect.any(String) })
    expect(editor.closest('.dia-inline-panel--dropup')).not.toBeNull()
    const deleteButton = within(editor).getByRole('button', { name: 'Delete' })
    expect(deleteButton).toHaveAttribute('data-danger', 'true')
    fireEvent.click(deleteButton)
    expect(deleteDraft).toHaveBeenCalledOnce()
    expect(deleteDraft).toHaveBeenCalledWith(annotation.annotationId)
  })
})

function assistantPropsFor(
  view: AnnotationView,
  status: 'running' | 'closed',
  blocks: unknown[],
  openAnnotation: (...args: unknown[]) => void = vi.fn(),
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
    useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
    useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
    beginSelection: vi.fn(),
    openAnnotation,
    registerEndpoint: vi.fn(() => () => undefined),
    updateHighlightRanges: vi.fn(),
    activateHighlight: vi.fn(),
    removeHighlights: vi.fn(),
    t,
  } as unknown as AssistantAnnotationProps
}

describe('reply chips', () => {
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const elementRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')

  afterEach(() => {
    if (rangeRects === undefined) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    else Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRects)
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

  it('overlays a chip on a marker-backed heading and reveals source on focus', async () => {
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
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    render(
      <AnnotatedAssistantNode
        {...assistantPropsFor(view, 'closed', [{ kind: 'text', text: rawText }], openAnnotation)}
      />,
    )

    const chip = await screen.findByRole('button', { name: /Annotation 1:/u })
    expect(chip).toHaveTextContent('Annotation 1')
    expect(chip).toHaveStyle({ top: '100px', left: '200px' })
    expect(screen.queryByText('dsh-annotation-reply')).not.toBeInTheDocument()

    fireEvent.focus(chip)
    expect(screen.getByText('selected source')).toBeInTheDocument()
    expect(screen.getByText('Explain this claim.')).toBeInTheDocument()
    fireEvent.blur(chip)
    expect(screen.queryByText('selected source')).not.toBeInTheDocument()

    fireEvent.click(chip)
    expect(openAnnotation).toHaveBeenCalledWith(payload.annotations[0]!.annotationId)
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

describe('annotation editor input methods', () => {
  function editorView(): AnnotationView {
    const payload = fixturePayload()
    return {
      ...baseView(),
      editor: {
        kind: 'new',
        capture: {
          messageId: payload.annotations[0]!.messageId,
          messageSeq: payload.annotations[0]!.messageSeq,
          responseVersion: payload.annotations[0]!.responseVersion,
          quote: payload.annotations[0]!.quote,
          rect: { top: 40, left: 80, right: 180, bottom: 64 },
        },
        text: '输入内容',
        longSelectionConfirmed: true,
      },
    }
  }

  it('never saves during composition, swallows the post-composition Enter, and saves on a plain Enter', async () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn()
    const closeEditor = vi.fn(() => true)
    const view = editorView()
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor,
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    const input = screen.getByLabelText('Your annotation')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(saveEditor).not.toHaveBeenCalled()

    // Escape during composition must not close the editor.
    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(closeEditor).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    // The Enter produced by the same composition must not save.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(saveEditor).not.toHaveBeenCalled()

    // After the next event loop the latch clears; a plain Enter saves.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(saveEditor).toHaveBeenCalledOnce()

    // Shift+Enter stays a newline and never saves.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(saveEditor).toHaveBeenCalledOnce()
  })

  it('returns focus and the caret to the official composer after saving a new annotation', async () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn(() => payload.annotations[0]!.annotationId)
    const ensureComposerAttachment = vi.fn(() => true)
    let view: AnnotationView = editorView()
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor: vi.fn(() => true),
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      autoAttachEnabled: () => true,
      ensureComposerAttachment,
      t,
    } as unknown as InputAnnotationProps
    const tree = (
      <div data-composer-card>
        <textarea aria-label="Official composer" value="draft text" onChange={() => undefined} />
        <TestAnnotationDock {...props} />
      </div>
    )
    const { rerender } = render(tree)

    const composer = screen.getByLabelText<HTMLTextAreaElement>('Official composer')
    composer.focus()
    composer.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(saveEditor).toHaveBeenCalledOnce()
    expect(ensureComposerAttachment).toHaveBeenCalledOnce()

    view = baseView()
    rerender(tree)
    await waitFor(() => expect(document.activeElement).toBe(composer))
    expect(composer.value).toBe('draft text')
    expect(composer.selectionStart).toBe(3)
  })

  it('does not force focus after editing an existing annotation', async () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn(() => payload.annotations[0]!.annotationId)
    const view: AnnotationView = {
      ...baseView(),
      editor: { kind: 'edit', annotationId: payload.annotations[0]!.annotationId, text: 'Edited' },
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor: vi.fn(() => true),
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    const tree = (
      <div data-composer-card>
        <textarea aria-label="Official composer" value="draft text" onChange={() => undefined} />
        <TestAnnotationDock {...props} />
      </div>
    )
    render(tree)

    const composer = screen.getByLabelText<HTMLTextAreaElement>('Official composer')
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).not.toBe(composer)
    expect(composer.value).toBe('draft text')
  })
})

describe('highlight-only annotations and compact summary', () => {
  function editorView(rect = { top: 40, left: 80, right: 180, bottom: 64 }): AnnotationView {
    const payload = fixturePayload()
    return {
      ...baseView(),
      editor: {
        kind: 'new' as const,
        capture: {
          messageId: payload.annotations[0]!.messageId,
          messageSeq: payload.annotations[0]!.messageSeq,
          responseVersion: payload.annotations[0]!.responseVersion,
          quote: payload.annotations[0]!.quote,
          rect,
        },
        text: '',
        longSelectionConfirmed: true,
      },
    }
  }

  it('keeps the save action enabled for empty content and shows the empty hint', () => {
    const payload = fixturePayload()
    const saveEditor = vi.fn(() => payload.annotations[0]!.annotationId)
    const view = editorView()
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      closeEditor: vi.fn(() => true),
      saveEditor,
      updateEditorText: vi.fn(),
      confirmLongSelection: vi.fn(),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    expect(screen.getByRole('button', { name: 'Save comment' })).not.toBeDisabled()
    expect(
      screen.getByText('Annotation content may be empty; empty means highlight only.'),
    ).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Your annotation'), { key: 'Enter' })
    expect(saveEditor).toHaveBeenCalledOnce()
  })

  it('shows 仅标记原文 in the list instead of a blank line', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      annotation: '',
      kind: 'highlight-only' as const,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation], panelOpen: true }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    expect(screen.getByText('Highlight only')).toBeInTheDocument()
  })

  it('renders the compact 注解 ×N chip with a hover overview of attached annotations', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      annotation: '',
      kind: 'highlight-only' as const,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      input: {
        ...idleInput,
        draft: COMPOSER_ATTACHMENT_TOKEN,
        draftRev: 2,
        phase: 'claimed',
        claim: { token: COMPOSER_ATTACHMENT_TOKEN },
      },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    const chip = screen.getByRole('button', { name: 'Annotations ×1' })
    expect(chip).toHaveTextContent('Annotations ×1')

    fireEvent.focus(chip)
    expect(screen.getByRole('tooltip', { name: 'Attached annotations overview' })).toBeInTheDocument()
    expect(screen.getByText('selected source')).toBeInTheDocument()
    expect(screen.getByText('Highlight only')).toBeInTheDocument()
    fireEvent.blur(chip)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps the full list reachable from the compact chip', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation] }
    const setPanelOpen = vi.fn()
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      input: {
        ...idleInput,
        draft: COMPOSER_ATTACHMENT_TOKEN,
        draftRev: 2,
        phase: 'claimed',
        claim: { token: COMPOSER_ATTACHMENT_TOKEN },
      },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(true),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen,
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Annotations ×1' }))
    expect(setPanelOpen).toHaveBeenCalledWith(true)
  })

  it('hides the local data tools when the setting is off', () => {
    const payload = fixturePayload()
    const annotation = {
      ...payload.annotations[0]!,
      status: 'draft' as const,
      updatedAt: payload.createdAt,
    }
    const view: AnnotationView = { ...baseView(), annotations: [annotation], panelOpen: true }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useLocalTools: (selector: (value: boolean) => unknown) => selector(false),
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen: vi.fn(),
      openAnnotation: vi.fn(),
      deleteDraft: vi.fn(),
      navigate: vi.fn(async () => true),
      t,
    } as unknown as InputAnnotationProps
    render(<TestAnnotationDock {...props} />)

    expect(screen.queryByText('Local data · 0 B')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export local data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear drafts' })).not.toBeInTheDocument()
    // 列表本身仍然可用。
    expect(screen.getByText('Ready to attach')).toBeInTheDocument()
  })
})
