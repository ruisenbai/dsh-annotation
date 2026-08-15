import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronUp,
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

function editorQuote(view: AnnotationView): string {
  const editor = view.editor
  if (editor === null) return ''
  if (editor.kind === 'new') return editor.capture.quote.exact
  return view.annotations.find((item) => item.annotationId === editor.annotationId)?.quote.exact ?? ''
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editor = view.editor

  const resetTransientState = () => {
    setConfirmDiscard(false)
    setError(null)
  }
  const requestClose = () => {
    if (actions.closeEditor()) {
      resetTransientState()
    } else {
      setConfirmDiscard(true)
    }
  }
  const discard = () => {
    actions.closeEditor(true)
    resetTransientState()
  }
  const continueEditing = () => {
    setConfirmDiscard(false)
    textareaRef.current?.focus()
  }
  const save = () => {
    try {
      actions.saveEditor()
      resetTransientState()
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
          ref={textareaRef}
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
        {confirmDiscard ? (
          <div className="dia-discard-confirm">
            <p role="alert">{t('editor.discard')}</p>
            <div>
              <button type="button" className="dia-button" autoFocus onClick={continueEditing}>
                {t('editor.keepEditing')}
              </button>
              <button type="button" className="dia-button" data-danger="true" onClick={discard}>
                {t('editor.confirmDiscard')}
              </button>
            </div>
          </div>
        ) : (
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
  const editLabel = item.status === 'draft' ? t('list.edit') : t('editor.supplement')
  return (
    <div
      role="listitem"
      aria-label={`#${item.ordinal} · ${statusLabel(item.status, t)} · ${item.quote.exact} · ${item.comment}`}
      className={`dia-item${view.activeAnnotationId === item.annotationId ? ' is-active' : ''}`}
      data-status={item.status}
    >
      <div className="dia-item__main">
        <span className="dia-item__index" aria-hidden="true">
          {item.ordinal}
        </span>
        <span className="dia-item__copy">
          <q title={item.quote.exact}>{item.quote.exact}</q>
          <span title={item.comment}>{item.comment}</span>
        </span>
      </div>
      <div className="dia-item__actions">
        <button
          type="button"
          className="dia-row-action"
          aria-label={t('list.locate')}
          title={t('list.locate')}
          onClick={() => void actions.navigate(item.annotationId)}
        >
          <MapPin aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
        {item.status !== 'queued' && (
          <button
            type="button"
            className="dia-row-action"
            aria-label={editLabel}
            title={editLabel}
            onClick={() => actions.openAnnotation(item.annotationId)}
          >
            {item.status === 'draft' ? (
              <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
            ) : (
              <MessageSquarePlus aria-hidden="true" size={14} strokeWidth={1.8} />
            )}
          </button>
        )}
        {item.status === 'draft' && (
          <button
            type="button"
            className="dia-row-action"
            data-danger="true"
            aria-label={t('list.delete')}
            title={t('list.delete')}
            onClick={() => actions.deleteDraft(item.annotationId)}
          >
            <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
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
  const listId = useId()
  const overallId = `${listId}-overall`
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

  return (
    <section className="dia-dock-shell" aria-label={t('list.title')}>
      <div className="dia-dock-body">
        <button
          type="button"
          className="dia-dock"
          aria-controls={listId}
          aria-expanded={view.panelOpen}
          onClick={() => actions.setPanelOpen(!view.panelOpen)}
        >
          <span className="dia-dock__icon" aria-hidden="true">
            <MessagesSquare size={14} strokeWidth={1.8} />
          </span>
          <span className="dia-dock__title">{t('list.title')}</span>
          <span className="dia-dock__summary">{panelSummary(view, retry !== undefined, t)}</span>
          <span className="dia-dock__chevron" aria-hidden="true">
            {view.panelOpen ? (
              <ChevronDown size={14} strokeWidth={1.8} />
            ) : (
              <ChevronUp size={14} strokeWidth={1.8} />
            )}
          </span>
        </button>

        {view.panelOpen && (
          <div id={listId} className="dia-inline-panel">
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
            <div className="dia-list" role={view.annotations.length > 0 ? 'list' : undefined}>
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

            <div className="dia-inline-panel__footer">
              {immutable && (
                <p className="dia-immutable-note">
                  <LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />
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
              <div className="dia-inline-panel__actions">
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
                  className="dia-button dia-inline-panel__send"
                  data-primary="true"
                  disabled={!canSend || submitting}
                  onClick={() => void submit()}
                >
                  {retry === undefined ? (
                    <Send aria-hidden="true" size={14} strokeWidth={1.8} />
                  ) : (
                    <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
                  )}
                  {submitting
                    ? t('send.sending')
                    : retry === undefined
                      ? t(disposition.label)
                      : t('send.retry')}
                </button>
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
  const failed = view.outbox.some((item) => item.status === 'failed')
  const dockVisible = view.annotations.length > 0 || failed
  if (!dockVisible && view.editor === null) return null
  return (
    <>
      {dockVisible && (
        <AnnotationPanel view={view} archived={archived} t={t} session={session} {...actions} />
      )}
      <AnnotationEditor key={editorKey(view.editor)} view={view} t={t} {...actions} />
    </>
  )
}
