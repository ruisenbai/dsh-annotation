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
  IconPaperclipOutline16,
  IconPlusOutline16,
  IconQueueOutline14,
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
  OutboxEntry,
  OutboxStatus,
  SubmissionId,
} from '../../shared/types.ts'
import { COMPOSER_ATTACHMENT_TOKEN, hasComposerAttachment } from '../composer-attachment.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import type { AnnotationView, EditorState } from '../controller.ts'
import { MapPin } from '../icons.ts'

function statusLabel(status: AnnotationStatus, t: InputAnnotationProps['t']): string {
  return t(`status.${status}`)
}

function editorKey(editor: EditorState | null): string {
  if (editor === null) return 'closed'
  if (editor.kind === 'edit') return `edit:${editor.annotationId}`
  return `new:${editor.capture.messageId}:${editor.capture.quote.start}:${editor.capture.quote.end}`
}

function markerRectFor(editor: EditorState): DOMRect | null {
  const annotationId = editor.kind === 'edit' ? editor.annotationId : editor.supplementalTo
  if (annotationId === undefined) return null
  const marker = Array.from(document.querySelectorAll<HTMLElement>('button.dia-marker')).find(
    (element) => element.dataset.annotationId === annotationId,
  )
  return marker?.getBoundingClientRect() ?? null
}

function editorPosition(editor: EditorState): { top?: number; left?: number; right?: number } {
  const capture = editor.kind === 'new' ? editor.capture : editor.expandedCapture
  const rect = capture?.rect
  if (rect !== undefined && !(rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0)) {
    const width = Math.min(420, window.innerWidth - 24)
    const estimatedHeight = 116
    const below = rect.bottom + 8
    const top =
      below + estimatedHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - estimatedHeight - 8)
    return {
      top,
      left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)),
    }
  }
  const marker = markerRectFor(editor)
  if (marker === null) return { top: 82, right: 24 }
  const width = Math.min(420, window.innerWidth - 24)
  const estimatedHeight = 116
  const fitsRight = marker.right + 8 + width <= window.innerWidth - 12
  const left = fitsRight ? marker.right + 8 : Math.max(12, marker.left - width - 8)
  const top = Math.max(12, Math.min(marker.top - 6, window.innerHeight - estimatedHeight - 12))
  return { top, left }
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

/** Whether the editor is inside an IME composition, including the post-compositionend latch. */
function compositionActive(
  event: { isComposing?: boolean; keyCode?: number },
  composing: boolean,
  justComposed: boolean,
): boolean {
  return (
    composing ||
    justComposed ||
    event.isComposing === true ||
    (event.keyCode !== undefined && event.keyCode === 229)
  )
}

/** Whether the editor belongs inside the summary box instead of floating in the assistant body. */
function isInlineEditor(editor: EditorState | null): boolean {
  if (editor === null) return false
  if (editor.kind === 'edit') return true
  const rect = editor.capture.rect
  return rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0
}

/** Dock-internal action face: the editor's own saveEditor wrapper is always passed explicitly. */
type DockBoundActions = Omit<AnnotationBoundProps, 'useAnnotations' | 'saveEditor'>

function AnnotationEditor({
  view,
  t,
  inline = false,
  saveEditor,
  ...actions
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
  inline?: boolean
  saveEditor: () => AnnotationId
} & DockBoundActions) {
  const [error, setError] = useState<string | null>(null)
  const [decisionRequired, setDecisionRequired] = useState(false)
  const [shakeVersion, setShakeVersion] = useState(0)
  const editorRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const justComposedRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      saveEditor()
      setError(null)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
      requireDecision()
    }
  }
  const remove = () => {
    if (editor?.kind !== 'edit') return
    try {
      actions.deleteDraft(editor.annotationId)
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
      // 输入法组合期间按 Escape 只用于取消候选，不关闭编辑器。
      if (compositionActive(event, composingRef.current, justComposedRef.current)) return
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

  useEffect(
    () => () => {
      // 组件卸载时清掉延迟解除定时器。
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    },
    [],
  )

  if (editor === null) return null
  const longSelection = editor.kind === 'new' && !editor.longSelectionConfirmed
  const expanded = editor.kind === 'edit' && editor.expandedCapture !== undefined
  const editorElement = (
    <section
      ref={editorRef}
      className={`dia-editor${inline ? ' dia-editor--inline' : ''}`}
      style={inline ? undefined : editorPosition(editor)}
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
          aria-label={t('editor.annotationLabel')}
          aria-invalid={decisionRequired || error !== null}
          placeholder={t('editor.placeholder')}
          onChange={(event) => actions.updateEditorText(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
            justComposedRef.current = false
          }}
          onCompositionEnd={() => {
            // 延迟到下一次事件循环后才解除组合状态，吞掉选词后的同一次 Enter。
            justComposedRef.current = true
            composingRef.current = false
            if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
            releaseTimerRef.current = setTimeout(() => {
              justComposedRef.current = false
              releaseTimerRef.current = null
            }, 0)
          }}
          onKeyDown={(event) => {
            const native = event.nativeEvent as unknown as KeyboardEvent
            const composing = compositionActive(native, composingRef.current, justComposedRef.current)
            if (composing) {
              // 组合输入事件只属于选词，不保存、不冒泡到官方输入框。
              event.stopPropagation()
              return
            }
            if (event.key !== 'Enter') return
            event.stopPropagation()
            if (event.shiftKey) return // Shift+Enter 换行，走 textarea 默认行为。
            event.preventDefault()
            if (event.ctrlKey || event.metaKey || editor.text.trim().length > 0) save()
            else requireDecision()
          }}
          onKeyUp={(event) => {
            if (
              compositionActive(
                event.nativeEvent as unknown as KeyboardEvent,
                composingRef.current,
                justComposedRef.current,
              )
            ) {
              event.stopPropagation()
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
          {editor.kind === 'edit' && (
            <TooltipIconAction
              label={t('list.delete')}
              side="bottom"
              className="dia-icon-button"
              danger
              onActivate={remove}
            >
              <IconTrashOutline16 size={14} />
            </TooltipIconAction>
          )}
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
  )
  return inline ? editorElement : <Portal>{editorElement}</Portal>
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
} & DockBoundActions) {
  const item = view.annotations.find((candidate) => candidate.annotationId === annotationId)
  if (item === undefined) return null
  const awaitingAuthoritativeState =
    item.status === 'queued' && !authoritativeQueueAnnotationIds(view).has(item.annotationId)
  const renderedStatus = awaitingAuthoritativeState ? t('status.submitted') : statusLabel(item.status, t)
  const editLabel = item.status === 'draft' ? t('list.edit') : t('editor.supplement')
  return (
    <div
      role="listitem"
      aria-label={`#${item.ordinal} · ${renderedStatus} · ${item.quote.exact} · ${item.annotation}`}
      className={`dia-item${view.activeAnnotationId === item.annotationId ? ' is-active' : ''}`}
      data-status={item.status}
    >
      <div className="dia-item__main">
        <span className="dia-item__index" aria-hidden="true">
          {item.ordinal}
        </span>
        <span className="dia-item__copy">
          <q>{item.quote.exact}</q>
          <span>{item.annotation}</span>
        </span>
      </div>
      <div className="dia-item__actions">
        <TooltipIconAction
          label={t('list.locate')}
          side="bottom"
          className="dia-row-action"
          onActivate={() => void actions.navigate(item.annotationId)}
        >
          <MapPin aria-hidden="true" size={12} strokeWidth={1.8} />
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
  anchor.download = `dsh-annotation-${new Date().toISOString().slice(0, 10)}.json`
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
  actions: DockBoundActions
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
  attached,
  attachmentDisabled,
  attachmentLabel,
  onToggleAttachment,
  saveEditor,
  t,
  shellRef,
  ...actions
}: {
  view: AnnotationView
  archived: boolean
  attached: boolean
  attachmentDisabled: boolean
  attachmentLabel: string
  onToggleAttachment: () => void
  saveEditor: () => AnnotationId
  t: InputAnnotationProps['t']
  shellRef: RefObject<HTMLElement>
} & DockBoundActions) {
  const [confirmClear, setConfirmClear] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>('idle')
  const listId = useId()
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
        <div className="dia-dock" data-attached={attached ? 'true' : 'false'}>
          <button
            type="button"
            className="dia-dock__main"
            aria-controls={listId}
            aria-expanded={view.panelOpen}
            onClick={() => actions.setPanelOpen(!view.panelOpen)}
          >
            <span className="dia-dock__icon" aria-hidden="true">
              <IconListPenOutline16 size={14} />
            </span>
            <span className="dia-dock__title">{t('list.title')}</span>
            <span className="dia-dock__summary">{panelSummary(view, retry !== undefined, t)}</span>
          </button>
          <div className="dia-dock__actions">
            <Tooltip label={attachmentLabel} side="top" delayMs={400}>
              <button
                type="button"
                className="dia-dock__attach"
                aria-label={attachmentLabel}
                aria-pressed={attached}
                disabled={attachmentDisabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={onToggleAttachment}
              >
                <IconPaperclipOutline16 size={15} />
              </button>
            </Tooltip>
            <button
              type="button"
              className="dia-dock__fold"
              aria-label={view.panelOpen ? t('dock.collapse') : t('dock.expand')}
              aria-controls={listId}
              aria-expanded={view.panelOpen}
              onClick={() => actions.setPanelOpen(!view.panelOpen)}
            >
              {view.panelOpen ? <IconChevronDownOutline14 size={14} /> : <IconChevronUpOutline14 size={14} />}
            </button>
          </div>
        </div>

        {isInlineEditor(view.editor) && (
          <AnnotationEditor
            key={editorKey(view.editor)}
            inline
            view={view}
            t={t}
            {...actions}
            saveEditor={saveEditor}
          />
        )}

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
                  {retry.images !== undefined && (
                    <p className="dia-inline-notice__detail">
                      {t('error.imagesRequired', { count: retry.images.count })}
                    </p>
                  )}
                  <button
                    type="button"
                    className="dia-text-button"
                    onClick={() => actions.discardOutbox(retry.payload.submissionId as SubmissionId)}
                  >
                    {t('list.discard')}
                  </button>
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
              {queuedSubmissions.length > 0 && (
                <div className="dia-inline-panel__actions">
                  {queuedSubmissions.map((entry) => (
                    <Button
                      key={entry.payload.submissionId}
                      variant="outline"
                      size="sm"
                      icon={<IconCloseOutline16 size={14} />}
                      onClick={() => void actions.withdraw(entry.payload.submissionId as SubmissionId)}
                    >
                      {t('list.withdraw')}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

interface ComposerCaret {
  readonly start: number
  readonly end: number
  readonly direction: 'forward' | 'backward' | 'none' | null
}

function composerTextarea(shell: HTMLElement | null): HTMLTextAreaElement | null {
  const card = shell?.closest<HTMLElement>('[data-composer-card]')
  const textarea = card?.querySelector<HTMLTextAreaElement>('textarea')
  return textarea ?? null
}

/** Composer dock list plus the Session-owned selection editor. */
export function AnnotationDock({
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
  const shellRef = useRef<HTMLElement>(null)
  const previousOutbox = useRef<Map<SubmissionId, ObservedOutboxState> | null>(null)
  const toastSeq = useRef(0)
  const [submissionToast, setSubmissionToast] = useState<SubmissionToastState | null>(null)
  const [pendingFocus, setPendingFocus] = useState<{
    textarea: HTMLTextAreaElement | null
    caret: ComposerCaret | null
  } | null>(null)
  const failed = view.outbox.some((item) => item.status === 'failed')
  const dockVisible =
    view.annotations.length > 0 || failed || view.deletedDraft !== null || isInlineEditor(view.editor)
  const retry = view.outbox.find((item) => item.status === 'failed' || item.status === 'ready')
  const draftCount = view.annotations.filter((item) => item.status === 'draft').length
  const attachmentCount = retry?.payload.annotations.length ?? draftCount
  const attached = hasComposerAttachment(input)
  const attachmentDisabled =
    input.phase === 'submitting' ||
    (!attached && (archived || input.phase !== 'plain' || attachmentCount === 0))
  const attachmentLabel = attached
    ? t('attach.remove', { count: attachmentCount })
    : archived
      ? t('attach.archived')
      : input.phase !== 'plain'
        ? t('attach.busy')
        : attachmentCount === 0
          ? t('attach.empty')
          : t('attach.add', { count: attachmentCount })

  useEffect(() => {
    actions.repairComposerAttachment()
  }, [actions.repairComposerAttachment, attachmentCount, input.claim?.token, input.draft, input.phase])

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

  /**
   * 新增注解保存成功后，等一次微任务加一帧页面渲染，再把焦点交还官方输入框。
   * 组件卸载（会话切换）时清理，绝不抢焦点；也不改写输入框已有文字。
   */
  useEffect(() => {
    if (pendingFocus === null || view.editor !== null) return undefined
    let cancelled = false
    let frame = 0
    void Promise.resolve().then(() => {
      if (cancelled) return
      frame = requestAnimationFrame(() => {
        if (cancelled) return
        const captured = pendingFocus.textarea
        const textarea =
          captured !== null && captured.isConnected ? captured : composerTextarea(shellRef.current)
        if (textarea === null || !textarea.isConnected) return
        textarea.focus({ preventScroll: true })
        const caret = pendingFocus.caret
        if (caret === null) {
          textarea.setSelectionRange(textarea.value.length, textarea.value.length)
          return
        }
        textarea.setSelectionRange(
          caret.start,
          caret.end,
          caret.direction === null ? 'none' : caret.direction,
        )
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [pendingFocus, view.editor])

  const toggleAttachment = () => {
    const active = document.activeElement
    const textarea = active instanceof HTMLTextAreaElement ? active : null
    const selection =
      textarea === null
        ? null
        : {
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
            direction: textarea.selectionDirection,
          }
    if (!actions.toggleComposerAttachment() || textarea === null || selection === null) return
    const offset = attached ? -COMPOSER_ATTACHMENT_TOKEN.length : COMPOSER_ATTACHMENT_TOKEN.length
    requestAnimationFrame(() => {
      if (!textarea.isConnected) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(
        Math.max(0, selection.start + offset),
        Math.max(0, selection.end + offset),
        selection.direction,
      )
    })
  }

  const saveEditor = () => {
    const isNew = view.editor?.kind === 'new'
    const shouldAttach = isNew && actions.autoAttachEnabled() && !archived && !attached
    const caretElement = composerTextarea(shellRef.current)
    const captured: ComposerCaret | null =
      caretElement === null
        ? null
        : {
            start: caretElement.selectionStart,
            end: caretElement.selectionEnd,
            direction: caretElement.selectionDirection,
          }
    const annotationId = controllerSaveEditor()
    if (shouldAttach) actions.ensureComposerAttachment()
    if (isNew) setPendingFocus({ textarea: caretElement, caret: captured })
    return annotationId
  }

  if (!dockVisible && view.editor === null) return null
  return (
    <>
      {dockVisible && (
        <AnnotationPanel
          view={view}
          archived={archived}
          attached={attached}
          attachmentDisabled={attachmentDisabled}
          attachmentLabel={attachmentLabel}
          onToggleAttachment={toggleAttachment}
          saveEditor={saveEditor}
          t={t}
          shellRef={shellRef}
          {...actions}
        />
      )}
      {!isInlineEditor(view.editor) && (
        <AnnotationEditor
          key={editorKey(view.editor)}
          view={view}
          t={t}
          {...actions}
          saveEditor={saveEditor}
        />
      )}
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
