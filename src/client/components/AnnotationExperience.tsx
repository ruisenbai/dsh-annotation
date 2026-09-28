/** Annotation records, composer controls, and source-anchored editors. */
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconListPenOutlineRegular,
  IconPaperclipOutlineRegular,
  IconTrashOutlineRegular,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AnnotationDraft } from '../../shared/types.ts'
import { composerInput, createComposerFocus } from '../composer-focus.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import { retryEntry, selectedAnnotations, type AnnotationView } from '../controller.ts'
import { markerElement, selectionAnchor, useAnnotationFloating } from '../floating.ts'
import { MapPin } from '../icons.ts'

type AnnotationActions = Omit<AnnotationBoundProps, 'useAnnotations' | 'useCompactSummary' | 'saveEditor'>
type ControlProps = AnnotationBoundProps & PropsLocale<'dshAnnotation'>

function IconAction({
  label,
  children,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip label={label} side="top" delayMs={350}>
      <button
        type="button"
        className="dia-record-action"
        aria-label={label}
        aria-pressed={active || undefined}
        data-active={active || undefined}
        data-danger={danger || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function recordStatus(item: AnnotationDraft, view: AnnotationView): 'pending' | 'sent' | 'off' {
  if (item.source?.kind === 'diff')
    return item.status === 'sent' || item.status === 'processed' ? 'sent' : 'off'
  if (view.selectedAnnotationIds.includes(item.annotationId) || item.status === 'queued') return 'pending'
  return item.status === 'sent' || item.status === 'processed' ? 'sent' : 'off'
}

function recordSummary(view: AnnotationView, t: InputAnnotationProps['t']): string {
  const pending = view.annotations.filter((item) => recordStatus(item, view) === 'pending').length
  const sent = view.annotations.filter((item) => recordStatus(item, view) === 'sent').length
  const off = view.annotations.filter((item) => recordStatus(item, view) === 'off').length
  return [
    sent > 0 ? t('record.sentCount', { count: sent }) : '',
    pending > 0 ? t('record.pendingCount', { count: pending }) : '',
    off > 0 ? t('record.offCount', { count: off }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact control immediately before the Host model selector. */
export function AnnotationRecordToggle({ useAnnotations, setPanelOpen, t }: ControlProps) {
  const view = useAnnotations((state) => state)
  if (view.annotations.length === 0) return null
  return (
    <Tooltip label={view.panelOpen ? t('record.hide') : t('record.show')} side="top" delayMs={350}>
      <button
        type="button"
        className="dia-record-toggle"
        aria-label={view.panelOpen ? t('record.hide') : t('record.show')}
        aria-pressed={view.panelOpen}
        onClick={() => setPanelOpen(!view.panelOpen)}
      >
        <IconListPenOutlineRegular size={16} />
      </button>
    </Tooltip>
  )
}

function AttachmentPreview({ items, t }: { items: readonly AnnotationDraft[]; t: ControlProps['t'] }) {
  return (
    <div className="dia-composer-chip__preview" role="tooltip">
      {items.map((item) => (
        <div className="dia-composer-chip__preview-row" key={item.annotationId}>
          <strong>{t('reply.chip', { ordinal: item.ordinal })}</strong>
          <q>{item.quote.exact}</q>
          <span>{item.annotation}</span>
        </div>
      ))}
    </div>
  )
}

/** Count inside the Host composer; click opens the expanded record. */
export function AnnotationComposerChip({
  useAnnotations,
  setPanelOpen,
  setRecordExpanded,
  toggleSelected,
  t,
}: ControlProps) {
  const view = useAnnotations((state) => state)
  const [preview, setPreview] = useState(false)
  const items = selectedAnnotations(view)
  if (items.length === 0) return null
  return (
    <div
      className="dia-composer-chip"
      onPointerEnter={() => setPreview(true)}
      onPointerLeave={() => setPreview(false)}
      onFocus={() => setPreview(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreview(false)
      }}
    >
      <button
        type="button"
        className="dia-composer-chip__main"
        aria-label={t('record.openAttached', { count: items.length })}
        onClick={() => {
          setPreview(false)
          if (!view.panelOpen) setPanelOpen(true)
          else setRecordExpanded(!view.recordExpanded)
        }}
      >
        <IconPaperclipOutlineRegular size={16} />
        <span>{t('record.attachedCount', { count: items.length })}</span>
      </button>
      <button
        type="button"
        className="dia-composer-chip__remove"
        aria-label={t('record.detachAll')}
        onClick={() => items.forEach((item) => toggleSelected(item.annotationId))}
      >
        <IconCloseOutlineRegular size={14} />
      </button>
      {preview && <AttachmentPreview items={items} t={t} />}
    </div>
  )
}

function sourceAnchor(item: AnnotationDraft) {
  return (
    selectionAnchor({
      ...item,
      rect: { top: 0, left: 0, bottom: 0, right: 0 },
    }) ?? markerElement(item.annotationId)
  )
}

const annotationTextLineHeight = 20
const annotationTextMinimumHeight = annotationTextLineHeight + 12
const annotationTextMaximumHeight = annotationTextLineHeight * 7 + 12

function fitAnnotationTextarea(
  element: HTMLTextAreaElement,
  cardHeight: number | undefined,
  quick: boolean,
): void {
  const scrollTop = element.scrollTop
  const availableHeight =
    cardHeight === undefined ? annotationTextMaximumHeight : cardHeight - (quick ? 16 : 51)
  const cap = Math.min(annotationTextMaximumHeight, Math.max(annotationTextMinimumHeight, availableHeight))
  element.style.maxHeight = `${cap}px`
  element.style.height = `${annotationTextMinimumHeight}px`
  const requiredHeight = element.scrollHeight
  element.style.height = `${Math.min(cap, Math.max(annotationTextMinimumHeight, requiredHeight))}px`
  element.style.overflowY = requiredHeight > cap ? 'auto' : 'hidden'
  element
    .closest('.dia-record-editor--quick')
    ?.setAttribute('data-single-line', String(requiredHeight <= annotationTextMinimumHeight))
  element.scrollTop = scrollTop
}

function useAnnotationTextareaHeight(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean,
  cardHeight: number | undefined,
  quick: boolean,
): void {
  useLayoutEffect(() => {
    const element = textarea.current
    if (!enabled || element === null) return undefined
    fitAnnotationTextarea(element, cardHeight, quick)
    let width = element.getBoundingClientRect().width
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const nextWidth = element.getBoundingClientRect().width
            if (nextWidth === width) return
            width = nextWidth
            fitAnnotationTextarea(element, cardHeight, quick)
          })
    resize?.observe(element)
    const view = element.ownerDocument.defaultView!
    const fit = () => fitAnnotationTextarea(element, cardHeight, quick)
    view.addEventListener('resize', fit)
    let disposed = false
    void element.ownerDocument.fonts?.ready.then(() => {
      if (!disposed) fit()
    })
    return () => {
      disposed = true
      resize?.disconnect()
      view.removeEventListener('resize', fit)
    }
  }, [textarea, value, enabled, cardHeight, quick])
}

function AnnotationEditor({
  view,
  t,
  actions,
  saveEditor,
  submitting,
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: AnnotationActions
  saveEditor: () => void
  submitting: boolean
}) {
  const editor = view.editor
  const ref = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const outsideClicks = useRef(0)
  const [shake, setShake] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const floating = useAnnotationFloating({
    floatingRef: ref,
    enabled: editor !== null,
    preferBelow: true,
    anchor: () => {
      if (editor === null) return null
      if (editor.kind === 'new')
        return (
          selectionAnchor(editor.capture) ??
          (editor.supplementalTo === undefined ? null : markerElement(editor.supplementalTo))
        )
      const item = view.annotations.find((candidate) => candidate.annotationId === editor.annotationId)
      return item === undefined ? markerElement(editor.annotationId) : sourceAnchor(item)
    },
  })
  useAnnotationTextareaHeight(
    textarea,
    editor?.text ?? '',
    editor !== null,
    typeof floating.style.maxHeight === 'number' ? floating.style.maxHeight : undefined,
    editor?.kind === 'new',
  )
  const save = () => {
    if (submitting) return
    try {
      saveEditor()
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      textarea.current?.focus()
    }
  }
  useEffect(() => {
    if (editor === null) return undefined
    outsideClicks.current = 0
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return
      if (editor.kind !== 'new') {
        actions.suspendEditor()
        return
      }
      outsideClicks.current += 1
      if (outsideClicks.current >= 3) {
        save()
        return
      }
      setShake(false)
      requestAnimationFrame(() => setShake(true))
    }
    const onInput = (event: Event) => {
      if (editor.kind !== 'new') return
      const target = event.target
      if (target instanceof Element && target.closest('[data-composer-input]')) save()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      actions.suspendEditor()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [editor, actions.suspendEditor, saveEditor, submitting])
  if (editor === null) return null
  const quick = editor.kind === 'new'
  const item =
    editor.kind === 'edit'
      ? view.annotations.find((candidate) => candidate.annotationId === editor.annotationId)
      : undefined
  const content = (
    <section
      ref={ref}
      className={`dia-record-editor ${quick ? 'dia-record-editor--quick' : 'dia-record-editor--detail'}${shake ? ' dia-record-editor--shake' : ''}`}
      style={floating.style}
      data-floating-placement={floating.placement}
      role="dialog"
      aria-modal="false"
      aria-label={quick ? t('editor.title') : t('editor.editTitle')}
      onAnimationEnd={() => setShake(false)}
    >
      <textarea
        ref={textarea}
        autoFocus
        rows={1}
        value={editor.text}
        aria-label={t('editor.annotationLabel')}
        disabled={submitting}
        onChange={(event) => actions.updateEditorText(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setTimeout(() => setComposing(false), 0)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || composing || event.nativeEvent.isComposing) return
          event.stopPropagation()
          if (event.shiftKey) return
          event.preventDefault()
          save()
        }}
      />
      {quick ? (
        <button
          type="button"
          className="dia-record-editor__check"
          aria-label={t('editor.save')}
          disabled={submitting || editor.longSelectionConfirmed === false}
          onClick={save}
        >
          <IconCheckOutlineRegular size={17} />
        </button>
      ) : (
        <div className="dia-record-editor__footer">
          <IconAction
            label={t('list.delete')}
            danger
            disabled={submitting || item?.status !== 'draft'}
            onClick={() => item && actions.deleteDraft(item.annotationId)}
          >
            <IconTrashOutlineRegular size={15} />
          </IconAction>
          <span className="dia-record-editor__footer-right">
            <button type="button" onClick={() => actions.closeEditor(true)}>
              {t('editor.cancel')}
            </button>
            <button type="button" onClick={save} disabled={submitting}>
              {t('editor.save')}
            </button>
          </span>
        </div>
      )}
      {editor.longSelectionConfirmed === false && (
        <button type="button" className="dia-record-editor__confirm" onClick={actions.confirmLongSelection}>
          {t('editor.confirmLong')}
        </button>
      )}
      {error && (
        <p className="dia-record-editor__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
  return createPortal(content, document.body)
}

function SentAnnotationCard({
  view,
  t,
  actions,
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: AnnotationActions
}) {
  const item = view.annotations.find((candidate) => candidate.annotationId === view.markerAnnotationId)
  const ref = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const floating = useAnnotationFloating({
    floatingRef: ref,
    enabled: item !== undefined && view.editor === null,
    preferBelow: true,
    anchor: () => (item === undefined ? null : sourceAnchor(item)),
  })
  useAnnotationTextareaHeight(
    textarea,
    item?.annotation ?? '',
    item !== undefined && view.editor === null,
    typeof floating.style.maxHeight === 'number' ? floating.style.maxHeight : undefined,
    false,
  )
  useEffect(() => {
    if (item === undefined || view.editor !== null) return undefined
    const onPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (ref.current?.contains(event.target) || markerElement(item.annotationId)?.contains(event.target))
      )
        return
      actions.openAnnotation(item.annotationId, 'marker')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') actions.openAnnotation(item.annotationId, 'marker')
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [item, view.editor, actions.openAnnotation])
  if (item === undefined || view.editor !== null) return null
  const selected = view.selectedAnnotationIds.includes(item.annotationId)
  return createPortal(
    <section
      ref={ref}
      className="dia-record-editor dia-record-editor--detail"
      style={floating.style}
      data-floating-placement={floating.placement}
      role="dialog"
      aria-modal="false"
      aria-label={t('editor.editTitle')}
    >
      <textarea
        ref={textarea}
        aria-label={t('editor.annotationLabel')}
        value={item.annotation}
        readOnly
        rows={1}
      />
      <div className="dia-record-editor__footer">
        <IconAction
          label={selected ? t('record.detach') : t('record.resend')}
          active={selected}
          onClick={() => actions.toggleSelected(item.annotationId)}
        >
          <IconPaperclipOutlineRegular size={15} />
        </IconAction>
        <span className="dia-record-editor__footer-right">
          <button type="button" onClick={() => actions.openAnnotation(item.annotationId, 'marker')}>
            {t('editor.cancel')}
          </button>
        </span>
      </div>
    </section>,
    document.body,
  )
}

function RecordRow({
  item,
  view,
  t,
  actions,
  submitting,
}: {
  item: AnnotationDraft
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: AnnotationActions
  submitting: boolean
}) {
  const legacyDiff = item.source?.kind === 'diff'
  const state = recordStatus(item, view)
  const selected = state === 'pending'
  const attachLabel = selected
    ? t('record.detach')
    : item.status === 'sent' || item.status === 'processed'
      ? t('record.resend')
      : t('record.attach')
  return (
    <div
      className="dia-record-row"
      role="listitem"
      aria-label={`${item.ordinal} · ${item.annotation} · ${t(`record.${state}`)}`}
    >
      <span className="dia-record-row__glyph" aria-hidden="true">
        <StateDot state={state === 'sent' ? 'done' : state === 'pending' ? 'warning' : 'idle'} />
      </span>
      <span className="dia-record-row__text">{item.annotation}</span>
      <div className="dia-record-row__actions">
        {legacyDiff ? <span className="dia-record-row__legacy">{t('diff.legacyReadOnly')}</span> : null}
        {!legacyDiff && (
          <>
            <IconAction
              label={attachLabel}
              active={selected}
              disabled={submitting || item.status === 'queued'}
              onClick={() => actions.toggleSelected(item.annotationId)}
            >
              <IconPaperclipOutlineRegular size={15} />
            </IconAction>
            <IconAction label={t('list.locate')} onClick={() => void actions.navigate(item.annotationId)}>
              <MapPin size={15} strokeWidth={1.8} aria-hidden="true" />
            </IconAction>
            {item.status === 'draft' && (
              <>
                <IconAction
                  label={t('list.edit')}
                  disabled={submitting}
                  onClick={() => actions.openAnnotation(item.annotationId, 'summary')}
                >
                  <IconEditOutlineRegular size={15} />
                </IconAction>
                <IconAction
                  label={t('list.delete')}
                  danger
                  disabled={submitting}
                  onClick={() => actions.deleteDraft(item.annotationId)}
                >
                  <IconTrashOutlineRegular size={15} />
                </IconAction>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** The record grows below its header and occupies normal layout above the composer. */
export function AnnotationExperience({
  useAnnotations,
  useWorkspaces,
  sessionId,
  input,
  t,
  saveEditor: controllerSaveEditor,
  ...actions
}: InputAnnotationProps) {
  const view = useAnnotations((state) => state)
  const archived = useWorkspaces((state) => state.archivedSessionIds.includes(sessionId))
  const listId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const focus = useRef<ReturnType<typeof createComposerFocus> | null>(null)
  useEffect(() => {
    focus.current = createComposerFocus(() => composerInput(anchorRef.current))
    return () => {
      focus.current?.dispose()
      focus.current = null
    }
  }, [sessionId])
  useEffect(() => {
    actions.repairComposerAttachment()
  }, [
    actions.repairComposerAttachment,
    input.claim?.token,
    input.draft,
    input.phase,
    view.selectedAnnotationIds,
  ])
  const saveEditor = () => {
    const isNew = view.editor?.kind === 'new'
    const request = focus.current?.capture()
    controllerSaveEditor()
    if (isNew && !archived && actions.autoAttachEnabled()) actions.ensureComposerAttachment()
    if (isNew && request) requestAnimationFrame(() => focus.current?.restore(request))
  }
  const retry = retryEntry(view)
  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {view.annotations.length > 0 && view.panelOpen && (
        <section id="dia-annotation-record" className="dia-record" aria-label={t('record.title')}>
          <div className="dia-record__body">
            <button
              type="button"
              className="dia-record__header"
              aria-controls={listId}
              aria-expanded={view.recordExpanded}
              onClick={() => actions.setRecordExpanded(!view.recordExpanded)}
            >
              <span className="dia-record__lead" aria-hidden="true">
                <IconListPenOutlineRegular />
              </span>
              <span className="dia-record__title">{t('record.title')}</span>
              <span className="dia-record__progress">{recordSummary(view, t)}</span>
              <span className="dia-record__chevron" aria-hidden="true">
                {view.recordExpanded ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}
              </span>
            </button>
            {view.recordExpanded && (
              <div id={listId} className="dia-record__list" role="list">
                {view.annotations.map((item) => (
                  <RecordRow
                    key={item.annotationId}
                    item={item}
                    view={view}
                    t={t}
                    actions={actions}
                    submitting={input.phase === 'submitting'}
                  />
                ))}
              </div>
            )}
            {retry && (
              <div className="dia-record__retry" role="status">
                <span>{t('error.send')}</span>
                <button type="button" onClick={() => actions.discardOutbox(retry.payload.submissionId)}>
                  {t('list.discard')}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      <AnnotationEditor
        view={view}
        t={t}
        actions={actions}
        saveEditor={saveEditor}
        submitting={input.phase === 'submitting'}
      />
      <SentAnnotationCard view={view} t={t} actions={actions} />
    </>
  )
}
