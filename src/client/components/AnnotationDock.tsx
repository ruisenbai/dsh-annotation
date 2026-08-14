import { useMemo, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnnotationId, AnnotationStatus, DeliveryMode, SubmissionId } from '../../shared/types.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import type { AnnotationView } from '../controller.ts'

function statusLabel(status: AnnotationStatus, t: InputAnnotationProps['t']): string {
  return t(`status.${status}`)
}

function editorQuote(view: AnnotationView): string {
  const editor = view.editor
  if (editor === null) return ''
  if (editor.kind === 'new') return editor.capture.quote.exact
  return view.annotations.find((item) => item.annotationId === editor.annotationId)?.quote.exact ?? ''
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
  if (editor === null) return null

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
  const longSelection = editor.kind === 'new' && !editor.longSelectionConfirmed
  return (
    <Modal
      open
      onClose={requestClose}
      title={t('editor.title')}
      closeLabel={t('action.close')}
      footer={
        <div className="dia-actions">
          <button type="button" className="dia-button" onClick={requestClose}>
            {confirmDiscard ? t('editor.discard') : t('editor.cancel')}
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
        </div>
      }
    >
      <blockquote className="dia-quote">{editorQuote(view)}</blockquote>
      {editor.kind === 'edit' && editor.expandedCapture !== undefined && (
        <p className="dia-warning">{t('editor.expand')}</p>
      )}
      {longSelection && (
        <div className="dia-warning">
          <p>{t('selection.tooLong')}</p>
          <button type="button" className="dia-button" onClick={actions.confirmLongSelection}>
            {t('editor.confirmLong')}
          </button>
        </div>
      )}
      <textarea
        autoFocus
        className="dia-textarea"
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
    </Modal>
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
    <article className="dia-item" data-status={item.status}>
      <div className="dia-item__head">
        <span>
          #{item.ordinal} · {statusLabel(item.status, t)}
        </span>
        <span>{item.annotationId}</span>
      </div>
      <p className="dia-item__quote">“{item.quote.exact}”</p>
      <p className="dia-item__comment">{item.comment}</p>
      <div className="dia-actions">
        <button type="button" className="dia-button" onClick={() => void actions.navigate(item.annotationId)}>
          {t('list.locate')}
        </button>
        {item.status === 'draft' && (
          <>
            <button
              type="button"
              className="dia-button"
              onClick={() => actions.openAnnotation(item.annotationId)}
            >
              {t('list.edit')}
            </button>
            <button
              type="button"
              className="dia-button"
              onClick={() => actions.deleteDraft(item.annotationId)}
            >
              {t('list.delete')}
            </button>
          </>
        )}
        {(item.status === 'sent' || item.status === 'processed') && (
          <button
            type="button"
            className="dia-button"
            onClick={() => actions.openAnnotation(item.annotationId)}
          >
            {t('editor.supplement')}
          </button>
        )}
      </div>
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
  const queuedSubmissions = view.outbox.filter((item) => item.status === 'queued')
  return (
    <Modal
      open={view.panelOpen}
      onClose={() => actions.setPanelOpen(false)}
      title={t('list.title')}
      closeLabel={t('action.close')}
      footer={
        <div className="dia-actions">
          {queuedSubmissions.map((entry) => (
            <button
              key={entry.payload.submissionId}
              type="button"
              className="dia-button"
              onClick={() => void actions.withdraw(entry.payload.submissionId as SubmissionId)}
            >
              {t('list.withdraw')}
            </button>
          ))}
          <button
            type="button"
            className="dia-button"
            data-primary="true"
            disabled={!canSend || submitting}
            onClick={() => void submit()}
          >
            {submitting ? t('send.sending') : retry === undefined ? t(disposition.label) : t('send.retry')}
          </button>
        </div>
      }
    >
      <textarea
        className="dia-textarea"
        value={view.overallRequirementDraft}
        placeholder={t('list.overall')}
        onChange={(event) => actions.setOverallRequirementDraft(event.target.value)}
      />
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
        {view.annotations.length === 0 && <p>{t('list.empty')}</p>}
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
    </Modal>
  )
}

/** Composer dock status button plus the Session-owned editor and list dialogs. */
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
  const visible =
    view.annotations.length > 0 ||
    view.editor !== null ||
    view.outbox.some((item) => item.status === 'failed')
  if (!visible) return null
  const count = counts.draft > 0 ? counts.draft : counts.queued > 0 ? counts.queued : view.annotations.length
  const label =
    counts.draft > 0
      ? t('dock.pending', { count })
      : counts.queued > 0
        ? t('dock.queued', { count })
        : t('dock.history', { count })
  return (
    <>
      <button type="button" className="dia-dock" onClick={() => actions.setPanelOpen(true)}>
        <span>{label}</span>
        <span className="dia-badge" aria-hidden="true">
          {count}
        </span>
      </button>
      <AnnotationEditor view={view} t={t} {...actions} />
      <AnnotationPanel view={view} archived={archived} t={t} session={session} {...actions} />
    </>
  )
}
