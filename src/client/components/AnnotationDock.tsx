import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Archive,
  BadgeCheck,
  ChevronUp,
  CircleCheck,
  Clock3,
  FileText,
  LockKeyhole,
  MapPin,
  MessageSquarePlus,
  MessagesSquare,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
} from '../icons.ts'
import type { AnnotationId, AnnotationStatus, DeliveryMode, SubmissionId } from '../../shared/types.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import type { AnnotationView, EditorState } from '../controller.ts'

function statusLabel(status: AnnotationStatus, t: InputAnnotationProps['t']): string {
  return t(`status.${status}`)
}

function StatusIcon({ status }: { status: AnnotationStatus }) {
  if (status === 'queued') return <Clock3 aria-hidden="true" size={12} strokeWidth={2} />
  if (status === 'sent') return <CircleCheck aria-hidden="true" size={12} strokeWidth={2} />
  if (status === 'processed') return <BadgeCheck aria-hidden="true" size={12} strokeWidth={2} />
  return <FileText aria-hidden="true" size={12} strokeWidth={2} />
}

function editorQuote(view: AnnotationView): string {
  const editor = view.editor
  if (editor === null) return ''
  if (editor.kind === 'new') return editor.capture.quote.exact
  return view.annotations.find((item) => item.annotationId === editor.annotationId)?.quote.exact ?? ''
}

function editorPosition(editor: EditorState): { top?: number; left?: number; right?: number } {
  const capture = editor.kind === 'new' ? editor.capture : editor.expandedCapture
  const rect = capture?.rect
  if (rect === undefined || (rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0)) {
    return { top: 82, right: 24 }
  }
  const width = Math.min(320, window.innerWidth - 24)
  return {
    top: Math.max(12, Math.min(window.innerHeight - 360, rect.bottom + 10)),
    left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)),
  }
}

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
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
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const editor = view.editor

  const requestClose = () => {
    if (confirmDiscard || actions.closeEditor()) {
      actions.closeEditor(true)
      setConfirmDiscard(false)
      setError(null)
    } else {
      setConfirmDiscard(true)
    }
  }
  const save = () => {
    try {
      actions.saveEditor()
      setError(null)
      setConfirmDiscard(false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    if (editor === null) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      requestClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  })

  if (editor === null) return null
  const longSelection = editor.kind === 'new' && !editor.longSelectionConfirmed
  return (
    <Portal>
      <section
        className="dia-editor"
        style={editorPosition(editor)}
        role="dialog"
        aria-modal="false"
        aria-labelledby="dia-editor-title"
      >
        <header className="dia-editor__head">
          <div>
            <MessageSquarePlus aria-hidden="true" size={15} strokeWidth={1.8} />
            <strong id="dia-editor-title">
              {editor.kind === 'edit' ? t('editor.editTitle') : t('editor.title')}
            </strong>
          </div>
          <button
            type="button"
            className="dia-icon-button"
            aria-label={t('action.close')}
            onClick={requestClose}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </header>
        <blockquote className="dia-quote">“{editorQuote(view)}”</blockquote>
        {editor.kind === 'edit' && editor.expandedCapture !== undefined && (
          <p className="dia-warning">{t('editor.expand')}</p>
        )}
        {longSelection && (
          <div className="dia-inline-notice" data-tone="warning">
            <AlertCircle aria-hidden="true" size={15} strokeWidth={1.8} />
            <div>
              <p>{t('selection.tooLong')}</p>
              <button type="button" className="dia-text-button" onClick={actions.confirmLongSelection}>
                {t('editor.confirmLong')}
              </button>
            </div>
          </div>
        )}
        <label className="dia-field-label" htmlFor="dia-annotation-comment">
          {t('editor.commentLabel')}
        </label>
        <textarea
          id="dia-annotation-comment"
          autoFocus
          className="dia-textarea dia-editor__textarea"
          value={editor.text}
          placeholder={t('editor.placeholder')}
          onChange={(event) => actions.updateEditorText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              save()
            }
          }}
        />
        {error !== null && (
          <p className="dia-error" role="alert">
            {error}
          </p>
        )}
        {confirmDiscard && <p className="dia-warning">{t('editor.discard')}</p>}
        <footer className="dia-editor__footer">
          <span>{t('editor.shortcut')}</span>
          <button type="button" className="dia-button" onClick={requestClose}>
            {t('editor.cancel')}
          </button>
          <button
            type="button"
            className="dia-button"
            data-primary="true"
            disabled={editor.text.trim().length === 0 || longSelection}
            onClick={save}
          >
            {t('editor.save')}
          </button>
        </footer>
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
  return (
    <article
      className={`dia-item${view.activeAnnotationId === item.annotationId ? ' is-active' : ''}`}
      data-status={item.status}
    >
      <button
        type="button"
        className="dia-item__main"
        onClick={() => void actions.navigate(item.annotationId)}
      >
        <span className="dia-item__index" aria-hidden="true">
          {item.ordinal}
        </span>
        <span className="dia-item__copy">
          <q>{item.quote.exact}</q>
          <span>{item.comment}</span>
          <code>{item.annotationId}</code>
        </span>
      </button>
      <footer className="dia-item__footer">
        <span className="dia-status" data-status={item.status}>
          <StatusIcon status={item.status} />
          {statusLabel(item.status, t)}
        </span>
        <button
          type="button"
          className="dia-text-button"
          aria-label={t('list.locate')}
          onClick={() => void actions.navigate(item.annotationId)}
        >
          <MapPin aria-hidden="true" size={12} strokeWidth={1.8} />
          {t('list.locate')}
        </button>
        {item.status === 'draft' && (
          <>
            <button
              type="button"
              className="dia-text-button"
              onClick={() => actions.openAnnotation(item.annotationId)}
            >
              <Pencil aria-hidden="true" size={12} strokeWidth={1.8} />
              {t('list.edit')}
            </button>
            <button
              type="button"
              className="dia-text-button"
              data-danger="true"
              onClick={() => actions.deleteDraft(item.annotationId)}
            >
              <Trash2 aria-hidden="true" size={12} strokeWidth={1.8} />
              {t('list.delete')}
            </button>
          </>
        )}
        {(item.status === 'sent' || item.status === 'processed') && (
          <button
            type="button"
            className="dia-text-button"
            onClick={() => actions.openAnnotation(item.annotationId)}
          >
            <MessageSquarePlus aria-hidden="true" size={12} strokeWidth={1.8} />
            {t('editor.supplement')}
          </button>
        )}
      </footer>
    </article>
  )
}

function sendDisposition(
  session: InputAnnotationProps['session'],
  archived: boolean,
): { delivery: DeliveryMode; label: Parameters<InputAnnotationProps['t']>[0] } {
  if (archived) return { delivery: 'queue', label: 'send.archived' }
  if (session.pending.length > 0) return { delivery: 'queue', label: 'send.approval' }
  if (session.running) return { delivery: 'steer', label: 'send.running' }
  return { delivery: 'queue', label: 'send.idle' }
}

function noticeText(text: string, t: InputAnnotationProps['t']): string {
  if (text === 'storage') return t('error.storage')
  if (text === 'locate') return t('error.locate')
  if (text === 'payload') return t('error.payload')
  if (text === 'items') return t('error.items')
  return text
}

function panelSummary(view: AnnotationView, failed: boolean, t: InputAnnotationProps['t']): string {
  if (failed) return t('panel.failed', { count: view.annotations.length })
  const drafts = view.annotations.filter((item) => item.status === 'draft').length
  if (drafts > 0) return t('panel.pending', { count: drafts })
  const queued = view.annotations.filter((item) => item.status === 'queued').length
  if (queued > 0) return t('panel.queued', { count: queued })
  return t('panel.history', { count: view.annotations.length })
}

function AnnotationPanel({
  view,
  archived,
  t,
  session,
  ...actions
}: {
  view: AnnotationView
  archived: boolean
  t: InputAnnotationProps['t']
  session: InputAnnotationProps['session']
} & Omit<AnnotationBoundProps, 'useAnnotations'>) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const disposition = sendDisposition(session, archived)
  const retry = view.outbox.find((item) => item.status === 'failed')
  const drafts = view.annotations.filter((item) => item.status === 'draft')
  const canSend = drafts.length > 0 || retry !== undefined
  const queuedSubmissions = view.outbox.filter((item) => item.status === 'queued')
  const immutable = view.annotations.some((item) => item.status === 'sent' || item.status === 'processed')

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

  const submit = async () => {
    setSubmitting(true)
    setSubmitError(false)
    try {
      await actions.submit(archived, disposition.delivery)
    } catch {
      setSubmitError(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (!view.panelOpen) return null
  return (
    <Portal>
      <button
        type="button"
        className="dia-panel-scrim"
        aria-label={t('action.close')}
        onClick={() => actions.setPanelOpen(false)}
      />
      <aside className="dia-panel" role="dialog" aria-modal="false" aria-labelledby="dia-panel-title">
        <header className="dia-panel__head">
          <span className="dia-panel__title-icon" aria-hidden="true">
            <MessagesSquare size={17} strokeWidth={1.8} />
          </span>
          <div>
            <strong id="dia-panel-title">{t('list.title')}</strong>
            <span>{panelSummary(view, retry !== undefined, t)}</span>
          </div>
          <button
            type="button"
            className="dia-icon-button"
            aria-label={t('action.close')}
            onClick={() => actions.setPanelOpen(false)}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="dia-panel__body">
          {archived && (
            <div className="dia-inline-notice" data-tone="neutral">
              <Archive aria-hidden="true" size={16} strokeWidth={1.8} />
              <p>{t('archived.copyNotice')}</p>
            </div>
          )}
          {retry !== undefined && (
            <div className="dia-inline-notice" data-tone="error">
              <AlertCircle aria-hidden="true" size={16} strokeWidth={1.8} />
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
          {submitError && (
            <p className="dia-error" role="alert">
              {t('error.send')}
            </p>
          )}
          <div className="dia-list">
            {view.annotations.length === 0 && <p className="dia-list__empty">{t('list.empty')}</p>}
            {view.annotations.map((item) => (
              <AnnotationRow
                key={item.annotationId}
                annotationId={item.annotationId}
                view={view}
                t={t}
                {...actions}
              />
            ))}
          </div>
        </div>

        <footer className="dia-panel__footer">
          {immutable && (
            <p className="dia-immutable-note">
              <LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />
              {t('list.immutable')}
            </p>
          )}
          <label className="dia-field-label" htmlFor="dia-overall-requirement">
            {t('list.overallLabel')}
          </label>
          <textarea
            id="dia-overall-requirement"
            className="dia-textarea dia-panel__textarea"
            value={view.overallRequirementDraft}
            placeholder={t('list.overall')}
            disabled={retry !== undefined}
            onChange={(event) => actions.setOverallRequirementDraft(event.target.value)}
          />
          <div className="dia-panel__actions">
            {queuedSubmissions.map((entry) => (
              <button
                key={entry.payload.submissionId}
                type="button"
                className="dia-button"
                onClick={() => void actions.withdraw(entry.payload.submissionId as SubmissionId)}
              >
                <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
                {t('list.withdraw')}
              </button>
            ))}
            <button
              type="button"
              className="dia-button dia-panel__send"
              data-primary="true"
              disabled={!canSend || submitting}
              onClick={() => void submit()}
            >
              {retry === undefined ? (
                <Send aria-hidden="true" size={14} strokeWidth={1.8} />
              ) : (
                <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
              )}
              {submitting ? t('send.sending') : retry === undefined ? t(disposition.label) : t('send.retry')}
            </button>
          </div>
        </footer>
      </aside>
    </Portal>
  )
}

/** Composer dock status button plus the Session-owned editor and annotation panel. */
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
  const counts = useMemo(
    () => ({
      draft: view.annotations.filter((item) => item.status === 'draft').length,
      queued: view.annotations.filter((item) => item.status === 'queued').length,
    }),
    [view.annotations],
  )
  const failed = view.outbox.some((item) => item.status === 'failed')
  const visible = view.annotations.length > 0 || view.editor !== null || failed
  if (!visible) return null
  const count = counts.draft > 0 ? counts.draft : counts.queued > 0 ? counts.queued : view.annotations.length
  const detail = failed
    ? t('dock.failed')
    : counts.draft > 0
      ? t('dock.pendingDetail')
      : counts.queued > 0
        ? t('dock.queuedDetail')
        : t('dock.historyDetail')
  return (
    <>
      <button
        type="button"
        className="dia-dock"
        aria-expanded={view.panelOpen}
        onClick={() => actions.setPanelOpen(true)}
      >
        <span className="dia-dock__icon" aria-hidden="true">
          <MessagesSquare size={16} strokeWidth={1.8} />
        </span>
        <span className="dia-dock__copy">
          <strong>{t('dock.count', { count })}</strong>
          <small>{detail}</small>
        </span>
        <ChevronUp aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      <AnnotationEditor view={view} t={t} {...actions} />
      <AnnotationPanel view={view} archived={archived} t={t} session={session} {...actions} />
    </>
  )
}
