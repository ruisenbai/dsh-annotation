import {
  Button,
  IconArchiveOutline20,
  IconCheckOutline14,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconListPenOutline16,
  IconPlusOutline16,
  IconQueueOutline14,
  IconRefreshOutline14,
  IconRightUpOutline16,
  IconSendOutline14,
  IconTrashOutline16,
  IconWarningOutline16,
  StateDot,
  Toast,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type {
  AnnotationId,
  AnnotationStatus,
  DeliveryMode,
  OutboxEntry,
  OutboxStatus,
  SubmissionId,
} from '../../shared/types.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import type { AnnotationView, EditorState } from '../controller.ts'

function statusLabel(status: AnnotationStatus, t: InputAnnotationProps['t']): string {
  return t(`status.${status}`)
}

function editorKey(editor: EditorState | null): string {
  if (editor === null) return 'closed'
  if (editor.kind === 'edit') return `edit:${editor.annotationId}`
  return `new:${editor.capture.messageId}:${editor.capture.quote.start}:${editor.capture.quote.end}`
}

function editorPosition(editor: EditorState): { top?: number; left?: number; right?: number } {
  const capture = editor.kind === 'new' ? editor.capture : editor.expandedCapture
  const rect = capture?.rect
  if (rect === undefined || (rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0)) {
    return { top: 82, right: 24 }
  }
  const width = Math.min(420, window.innerWidth - 24)
  const estimatedHeight = 116
  const below = rect.bottom + 8
  const top =
    below + estimatedHeight <= window.innerHeight - 12 ? below : Math.max(12, rect.top - estimatedHeight - 8)
  return {
    top,
    left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)),
  }
}

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

function TooltipIconAction({
  label,
  className,
  side,
  children,
  onActivate,
  disabled = false,
  primary = false,
  danger = false,
}: {
  label: string
  className: string
  side: 'top' | 'bottom' | 'right'
  children: ReactNode
  onActivate: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
}) {
  return (
    <Tooltip label={label} side={side} delayMs={500} disabled={disabled}>
      <button
        type="button"
        className={className}
        data-primary={primary ? 'true' : undefined}
        data-danger={danger ? 'true' : undefined}
        aria-label={label}
        disabled={disabled}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          onActivate()
        }}
        onClick={(event) => {
          if (event.detail === 0) onActivate()
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function EditorSaveState({ view, t }: { view: AnnotationView; t: InputAnnotationProps['t'] }) {
  if (view.editorSaveStatus === 'saving') return <span>{t('editor.autosaving')}</span>
  if (view.editorSaveStatus === 'saved') return <span>{t('editor.autosaved')}</span>
  if (view.editorSaveStatus === 'error') return <span data-tone="error">{t('editor.autosaveFailed')}</span>
  return <span>{t('editor.shortcut')}</span>
}

function AnnotationEditor({
  view,
  t,
  ...actions
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
} & Omit<AnnotationBoundProps, 'useAnnotations'>) {
  const [error, setError] = useState<string | null>(null)
  const [decisionRequired, setDecisionRequired] = useState(false)
  const [shakeVersion, setShakeVersion] = useState(0)
  const editorRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editor = view.editor

  const requireDecision = () => {
    setDecisionRequired(true)
    setShakeVersion((value) => value + 1)
    textareaRef.current?.focus()
  }
  const cancel = () => {
    actions.closeEditor(true)
    setError(null)
  }
  const save = () => {
    try {
      actions.saveEditor()
      setError(null)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
      requireDecision()
    }
  }

  useEffect(() => {
    if (editor === null) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (!actions.closeEditor()) requireDecision()
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      const editorElement = editorRef.current
      if (
        !(target instanceof Node) ||
        (editorElement !== null &&
          (editorElement.contains(target) || event.composedPath().includes(editorElement)))
      ) {
        return
      }
      if (actions.closeEditor()) return
      event.preventDefault()
      event.stopPropagation()
      requireDecision()
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }
  }, [actions.closeEditor, editor])

  if (editor === null) return null
  const longSelection = editor.kind === 'new' && !editor.longSelectionConfirmed
  const expanded = editor.kind === 'edit' && editor.expandedCapture !== undefined
  return (
    <Portal>
      <section
        ref={editorRef}
        className="dia-editor"
        style={editorPosition(editor)}
        role="dialog"
        aria-modal="false"
        aria-label={editor.kind === 'edit' ? t('editor.editTitle') : t('editor.title')}
        data-decision-required={decisionRequired ? 'true' : undefined}
        data-shake={decisionRequired ? String(shakeVersion % 2) : undefined}
      >
        <div className="dia-editor__row">
          <textarea
            ref={textareaRef}
            autoFocus
            rows={1}
            className="dia-editor__input"
            value={editor.text}
            aria-label={t('editor.commentLabel')}
            aria-invalid={decisionRequired || error !== null}
            placeholder={t('editor.placeholder')}
            onChange={(event) => actions.updateEditorText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                save()
              }
            }}
          />
          <div className="dia-editor__actions">
            <TooltipIconAction
              label={t('editor.cancel')}
              side="bottom"
              className="dia-icon-button"
              onActivate={cancel}
            >
              <IconCloseOutline16 size={14} />
            </TooltipIconAction>
            <TooltipIconAction
              label={t('editor.save')}
              side="bottom"
              className="dia-icon-button"
              primary
              disabled={editor.text.trim().length === 0 || longSelection}
              onActivate={save}
            >
              <IconCheckOutline16 size={14} />
            </TooltipIconAction>
          </div>
        </div>
        <div className="dia-editor__meta" aria-live="polite">
          <EditorSaveState view={view} t={t} />
          {decisionRequired && <span data-tone="error">{t('editor.chooseAction')}</span>}
        </div>
        {expanded && <p className="dia-editor__notice">{t('editor.expand')}</p>}
        {longSelection && (
          <div className="dia-editor__notice" data-tone="warning">
            <span>{t('selection.tooLong')}</span>
            <button type="button" className="dia-text-button" onClick={actions.confirmLongSelection}>
              {t('editor.confirmLong')}
            </button>
          </div>
        )}
        {error !== null && (
          <p className="dia-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Portal>
  )
}

function AnnotationRow({
  annotationId,
  view,
  t,
  ...actions
}: {
  annotationId: AnnotationId
  view: AnnotationView
  t: InputAnnotationProps['t']
} & Omit<AnnotationBoundProps, 'useAnnotations'>) {
  const item = view.annotations.find((candidate) => candidate.annotationId === annotationId)
  if (item === undefined) return null
  const awaitingAuthoritativeState =
    item.status === 'queued' && !authoritativeQueueAnnotationIds(view).has(item.annotationId)
  const renderedStatus = awaitingAuthoritativeState ? t('status.submitted') : statusLabel(item.status, t)
  const editLabel = item.status === 'draft' ? t('list.edit') : t('editor.supplement')
  return (
    <div
      role="listitem"
      aria-label={`#${item.ordinal} · ${renderedStatus} · ${item.quote.exact} · ${item.comment}`}
      className={`dia-item${view.activeAnnotationId === item.annotationId ? ' is-active' : ''}`}
      data-status={item.status}
    >
      <div className="dia-item__main">
        <span className="dia-item__index" aria-hidden="true">
          {item.ordinal}
        </span>
        <span className="dia-item__copy">
          <q>{item.quote.exact}</q>
          <span>{item.comment}</span>
        </span>
      </div>
      <div className="dia-item__actions">
        <TooltipIconAction
          label={t('list.locate')}
          side="bottom"
          className="dia-row-action"
          onActivate={() => void actions.navigate(item.annotationId)}
        >
          <IconRightUpOutline16 size={14} />
        </TooltipIconAction>
        {item.status !== 'queued' && (
          <TooltipIconAction
            label={editLabel}
            side="bottom"
            className="dia-row-action"
            onActivate={() => actions.openAnnotation(item.annotationId)}
          >
            {item.status === 'draft' ? <IconEditOutline16 size={14} /> : <IconPlusOutline16 size={14} />}
          </TooltipIconAction>
        )}
        {item.status === 'draft' && (
          <TooltipIconAction
            label={t('list.delete')}
            side="bottom"
            className="dia-row-action"
            danger
            onActivate={() => actions.deleteDraft(item.annotationId)}
          >
            <IconTrashOutline16 size={14} />
          </TooltipIconAction>
        )}
      </div>
    </div>
  )
}

type LocaleKey = Parameters<InputAnnotationProps['t']>[0]

interface SendDisposition {
  readonly delivery: DeliveryMode
  readonly label: LocaleKey
  readonly detail: LocaleKey
}

function sendDisposition(session: InputAnnotationProps['session'], archived: boolean): SendDisposition {
  if (archived) {
    return { delivery: 'queue', label: 'send.archived', detail: 'send.destination.archived' }
  }
  if (session.pending.length > 0) {
    return { delivery: 'queue', label: 'send.approval', detail: 'send.destination.approval' }
  }
  if (session.running) {
    return { delivery: 'steer', label: 'send.running', detail: 'send.destination.running' }
  }
  return { delivery: 'queue', label: 'send.idle', detail: 'send.destination.idle' }
}

function noticeText(text: string, t: InputAnnotationProps['t']): string {
  if (text === 'storage') return t('error.storage')
  if (text === 'locate') return t('error.locate')
  if (text === 'payload') return t('error.payload')
  if (text === 'items') return t('error.items')
  return text
}

type SubmissionToastKind = 'queued' | 'sent' | 'failed'

interface SubmissionToastState {
  readonly seq: number
  readonly kind: SubmissionToastKind
  readonly submissionId: SubmissionId
  readonly count: number
}

interface ObservedOutboxState {
  readonly status: OutboxStatus
  readonly attempts: number
}

function observedOutbox(items: readonly OutboxEntry[]): Map<SubmissionId, ObservedOutboxState> {
  return new Map(
    items.map((item) => [item.payload.submissionId, { status: item.status, attempts: item.attempts }]),
  )
}

function submissionToastTransition(
  previous: ReadonlyMap<SubmissionId, ObservedOutboxState>,
  items: readonly OutboxEntry[],
): Omit<SubmissionToastState, 'seq'> | null {
  const rank: Record<SubmissionToastKind, number> = { queued: 1, sent: 2, failed: 3 }
  let selected: Omit<SubmissionToastState, 'seq'> | null = null
  for (const item of items) {
    if (item.status !== 'queued' && item.status !== 'sent' && item.status !== 'failed') continue
    const prior = previous.get(item.payload.submissionId)
    if (prior?.status === item.status && prior.attempts === item.attempts) continue
    const candidate = {
      kind: item.status,
      submissionId: item.payload.submissionId,
      count: item.payload.annotations.length,
    } as const
    if (selected === null || rank[candidate.kind] >= rank[selected.kind]) selected = candidate
  }
  return selected
}

function authoritativeQueueAnnotationIds(view: AnnotationView): ReadonlySet<AnnotationId> {
  return new Set(
    view.outbox
      .filter((entry) => entry.status === 'queued')
      .flatMap((entry) => entry.payload.annotations.map((annotation) => annotation.annotationId)),
  )
}

function panelSummary(view: AnnotationView, failed: boolean, t: InputAnnotationProps['t']): string {
  if (failed) return t('panel.failed', { count: view.annotations.length })
  const drafts = view.annotations.filter((item) => item.status === 'draft').length
  if (drafts > 0) return t('panel.pending', { count: drafts })
  const queuedIds = authoritativeQueueAnnotationIds(view)
  const submitted = view.annotations.filter(
    (item) => item.status === 'queued' && !queuedIds.has(item.annotationId),
  ).length
  if (submitted > 0) return t('panel.submitted', { count: submitted })
  const queued = view.annotations.filter(
    (item) => item.status === 'queued' && queuedIds.has(item.annotationId),
  ).length
  if (queued > 0) return t('panel.queued', { count: queued })
  return t('panel.history', { count: view.annotations.length })
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function downloadLocalData(serialized: string): void {
  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dsh-inline-annotations-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function AnnotationGroup({
  title,
  items,
  view,
  t,
  actions,
  state,
  collapsible = false,
  initiallyOpen = true,
}: {
  title: string
  items: readonly AnnotationView['annotations'][number][]
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: Omit<AnnotationBoundProps, 'useAnnotations'>
  state: StateDotState
  collapsible?: boolean
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  if (items.length === 0) return null
  return (
    <section className="dia-group" aria-label={title}>
      {collapsible ? (
        <button
          type="button"
          className="dia-group__heading"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="dia-group__title">
            <StateDot state={state} />
            <span>{title}</span>
          </span>
          <span className="dia-group__count">{items.length}</span>
          {open ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
        </button>
      ) : (
        <div className="dia-group__heading">
          <span className="dia-group__title">
            <StateDot state={state} />
            <span>{title}</span>
          </span>
          <span className="dia-group__count">{items.length}</span>
        </div>
      )}
      {(!collapsible || open) && (
        <div role="list">
          {items.map((item) => (
            <AnnotationRow
              key={item.annotationId}
              annotationId={item.annotationId}
              view={view}
              t={t}
              {...actions}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AnnotationPanel({
  view,
  archived,
  t,
  session,
  shellRef,
  ...actions
}: {
  view: AnnotationView
  archived: boolean
  t: InputAnnotationProps['t']
  session: InputAnnotationProps['session']
  shellRef: RefObject<HTMLElement>
} & Omit<AnnotationBoundProps, 'useAnnotations'>) {
  const [submitting, setSubmitting] = useState(false)
  const [submittingCount, setSubmittingCount] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>('idle')
  const listId = useId()
  const overallId = `${listId}-overall`
  const disposition = sendDisposition(session, archived)
  const retry = view.outbox.find((item) => item.status === 'failed')
  const drafts = view.annotations.filter((item) => item.status === 'draft')
  const queuedIds = authoritativeQueueAnnotationIds(view)
  const submitted = view.annotations.filter(
    (item) => item.status === 'queued' && !queuedIds.has(item.annotationId),
  )
  const queued = view.annotations.filter(
    (item) => item.status === 'queued' && queuedIds.has(item.annotationId),
  )
  const history = view.annotations.filter((item) => item.status === 'sent' || item.status === 'processed')
  const canSend = drafts.length > 0 || retry !== undefined
  const sendCount = retry?.payload.annotations.length ?? drafts.length
  const displayedSendCount = submittingCount ?? sendCount
  const destinationKey = retry === undefined ? disposition.detail : 'send.destination.retry'
  const queuedSubmissions = view.outbox.filter((item) => item.status === 'queued')
  const immutable = history.length > 0
  const hasLocalDrafts =
    drafts.length > 0 ||
    (view.editor !== null && view.editor.text.trim() !== '') ||
    view.overallRequirementDraft.trim() !== ''

  useEffect(() => {
    if (!view.panelOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || view.editor !== null) return
      event.preventDefault()
      actions.setPanelOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [actions.setPanelOpen, view.editor, view.panelOpen])

  useEffect(() => {
    if (view.deletedDraft === null) return undefined
    const timer = setTimeout(actions.dismissDeleteUndo, 4500)
    return () => clearTimeout(timer)
  }, [actions.dismissDeleteUndo, view.deletedDraft])

  const submit = async () => {
    setSubmitting(true)
    setSubmittingCount(sendCount)
    try {
      await actions.submit(archived, disposition.delivery)
    } catch {
      // The controller publishes either a retryable outbox failure or a specific validation notice.
    } finally {
      setSubmitting(false)
      setSubmittingCount(null)
    }
  }
  const exportData = () => {
    try {
      downloadLocalData(actions.exportLocalData())
      setExportState('done')
    } catch {
      setExportState('failed')
    }
  }

  return (
    <section ref={shellRef} className="dia-dock-shell" aria-label={t('list.title')}>
      <div className="dia-dock-body">
        <button
          type="button"
          className="dia-dock"
          aria-controls={listId}
          aria-expanded={view.panelOpen}
          onClick={() => actions.setPanelOpen(!view.panelOpen)}
        >
          <span className="dia-dock__icon" aria-hidden="true">
            <IconListPenOutline16 size={14} />
          </span>
          <span className="dia-dock__title">{t('list.title')}</span>
          <span className="dia-dock__summary">{panelSummary(view, retry !== undefined, t)}</span>
          <span className="dia-dock__chevron" aria-hidden="true">
            {view.panelOpen ? <IconChevronDownOutline14 size={14} /> : <IconChevronUpOutline14 size={14} />}
          </span>
        </button>

        {view.panelOpen && (
          <div id={listId} className="dia-inline-panel">
            {archived && (
              <div className="dia-inline-notice" data-tone="neutral">
                <IconArchiveOutline20 size={16} />
                <p>{t('archived.copyNotice')}</p>
              </div>
            )}
            {retry !== undefined && (
              <div className="dia-inline-notice" data-tone="error">
                <IconWarningOutline16 size={16} />
                <div>
                  <p>{t('error.send')}</p>
                  <code>{retry.payload.submissionId}</code>
                </div>
              </div>
            )}
            {view.notice !== null && (
              <p className={view.notice.level === 'error' ? 'dia-error' : 'dia-warning'} role="status">
                {noticeText(view.notice.text, t)}
              </p>
            )}
            {view.annotations.length === 0 ? (
              <p className="dia-list__empty">{t('list.empty')}</p>
            ) : (
              <div className="dia-list">
                <AnnotationGroup
                  title={t('group.drafts')}
                  state="warning"
                  items={drafts}
                  view={view}
                  t={t}
                  actions={actions}
                />
                <AnnotationGroup
                  title={retry === undefined ? t('group.submitted') : t('group.retry')}
                  state={retry === undefined ? 'ongoing' : 'error'}
                  items={submitted}
                  view={view}
                  t={t}
                  actions={actions}
                />
                <AnnotationGroup
                  title={t('group.queued')}
                  state="warning"
                  items={queued}
                  view={view}
                  t={t}
                  actions={actions}
                />
                <AnnotationGroup
                  title={t('group.history')}
                  state="done"
                  items={history}
                  view={view}
                  t={t}
                  actions={actions}
                  collapsible
                  initiallyOpen={drafts.length === 0 && submitted.length === 0 && queued.length === 0}
                />
              </div>
            )}

            {view.deletedDraft !== null && (
              <div className="dia-undo" role="status">
                <span>{t('list.deleted')}</span>
                <button type="button" className="dia-text-button" onClick={actions.undoDelete}>
                  {t('list.undo')}
                </button>
              </div>
            )}

            <div className="dia-inline-panel__footer">
              {immutable && (
                <p className="dia-immutable-note">
                  <IconDataOutline16 size={14} />
                  {t('list.immutable')}
                </p>
              )}
              <label className="dia-field-label" htmlFor={overallId}>
                {t('list.overallLabel')}
              </label>
              <textarea
                id={overallId}
                className="dia-textarea dia-inline-panel__textarea"
                value={view.overallRequirementDraft}
                placeholder={t('list.overall')}
                disabled={retry !== undefined}
                onChange={(event) => actions.setOverallRequirementDraft(event.target.value)}
              />
              <div className="dia-local-data">
                <span>
                  <IconDataOutline16 size={14} />
                  {t('local.usage', { size: bytesLabel(view.storageBytes) })}
                </span>
                <div>
                  <Tooltip label={t('local.export')} side="top" delayMs={500}>
                    <button
                      type="button"
                      className="dia-row-action"
                      aria-label={t('local.export')}
                      onClick={exportData}
                    >
                      <IconDownloadOutline16 size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('local.clear')} side="top" delayMs={500}>
                    <button
                      type="button"
                      className="dia-row-action"
                      data-danger="true"
                      aria-label={t('local.clear')}
                      disabled={!hasLocalDrafts}
                      onClick={() => setConfirmClear(true)}
                    >
                      <IconTrashOutline16 size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
              {exportState !== 'idle' && (
                <p className={exportState === 'failed' ? 'dia-error' : 'dia-local-status'} role="status">
                  {exportState === 'done' ? t('local.exported') : t('local.exportFailed')}
                </p>
              )}
              {confirmClear && (
                <div className="dia-clear-confirm" role="alert">
                  <span>{t('local.confirmClear')}</span>
                  <button type="button" className="dia-text-button" onClick={() => setConfirmClear(false)}>
                    {t('local.keep')}
                  </button>
                  <button
                    type="button"
                    className="dia-text-button"
                    data-danger="true"
                    onClick={() => {
                      actions.clearLocalDrafts()
                      setConfirmClear(false)
                    }}
                  >
                    {t('local.confirm')}
                  </button>
                </div>
              )}
              <div className="dia-send-block">
                <p className="dia-send-destination">
                  <IconWarningOutline16 size={14} />
                  <span>{t(destinationKey)}</span>
                </p>
                <div className="dia-inline-panel__actions">
                  {queuedSubmissions.map((entry) => (
                    <Button
                      key={entry.payload.submissionId}
                      variant="outline"
                      size="sm"
                      icon={<IconRefreshOutline14 size={14} />}
                      onClick={() => void actions.withdraw(entry.payload.submissionId as SubmissionId)}
                    >
                      {t('list.withdraw')}
                    </Button>
                  ))}
                  <Button
                    variant="primary"
                    size="sm"
                    className="dia-inline-panel__send"
                    icon={
                      retry === undefined ? (
                        <IconSendOutline14 size={14} />
                      ) : (
                        <IconRefreshOutline14 size={14} />
                      )
                    }
                    disabled={!canSend || submitting}
                    onClick={() => void submit()}
                  >
                    {submitting
                      ? t('send.sending', { count: displayedSendCount })
                      : retry === undefined
                        ? t(disposition.label, { count: sendCount })
                        : t('send.retry', { count: sendCount })}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Composer dock list plus the Session-owned selection editor. */
export function AnnotationDock({
  useAnnotations,
  useWorkspaces,
  sessionId,
  session,
  t,
  ...actions
}: InputAnnotationProps) {
  const view = useAnnotations((state) => state)
  const archived = useWorkspaces((state) => state.archivedSessionIds.includes(sessionId))
  const shellRef = useRef<HTMLElement>(null)
  const previousOutbox = useRef<Map<SubmissionId, ObservedOutboxState> | null>(null)
  const toastSeq = useRef(0)
  const [submissionToast, setSubmissionToast] = useState<SubmissionToastState | null>(null)
  const failed = view.outbox.some((item) => item.status === 'failed')
  const dockVisible = view.annotations.length > 0 || failed || view.deletedDraft !== null

  useEffect(() => {
    previousOutbox.current = null
    setSubmissionToast(null)
  }, [sessionId])

  useEffect(() => {
    const current = observedOutbox(view.outbox)
    const previous = previousOutbox.current
    previousOutbox.current = current
    if (previous === null) return
    const transition = submissionToastTransition(previous, view.outbox)
    if (transition === null) return
    toastSeq.current += 1
    setSubmissionToast({ ...transition, seq: toastSeq.current })
  }, [view.outbox])

  if (!dockVisible && view.editor === null) return null
  return (
    <>
      {dockVisible && (
        <AnnotationPanel
          view={view}
          archived={archived}
          t={t}
          session={session}
          shellRef={shellRef}
          {...actions}
        />
      )}
      <AnnotationEditor key={editorKey(view.editor)} view={view} t={t} {...actions} />
      {submissionToast !== null && (
        <Toast
          key={submissionToast.seq}
          text={
            submissionToast.kind === 'failed'
              ? t('toast.failed', { id: submissionToast.submissionId })
              : t(`toast.${submissionToast.kind}`, { count: submissionToast.count })
          }
          icon={
            submissionToast.kind === 'queued' ? (
              <IconQueueOutline14 size={14} />
            ) : submissionToast.kind === 'sent' ? (
              <IconCheckOutline14 size={14} />
            ) : (
              <IconWarningOutline16 size={14} />
            )
          }
          anchor={shellRef.current?.closest<HTMLElement>('[data-composer-card]') ?? shellRef.current}
          onDone={() => {
            setSubmissionToast((current) => (current?.seq === submissionToast.seq ? null : current))
          }}
        />
      )}
    </>
  )
}
