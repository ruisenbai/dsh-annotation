import { DiffAnnotationPanel } from './DiffAnnotationPanel.tsx'
import { AnnotationSourceLabel } from './AnnotationSourceLabel.tsx'
import {
  Button,
  IconArchiveOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  IconDataOutlineRegular,
  IconEditOutlineRegular,
  IconListPenOutlineRegular,
  IconPaperclipOutlineRegular,
  IconPlusOutlineRegular,
  IconQueueOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Menu,
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
  ProcessingMode,
  SubmissionId,
} from '../../shared/types.ts'
import { hasComposerAttachment } from '../composer-attachment.ts'
import { composerInput, createComposerFocus, type ComposerFocusRequest } from '../composer-focus.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import {
  editorBufferKey,
  eligibleAnnotations,
  retryEntry,
  selectedAnnotations,
  type AnnotationView,
  type EditorState,
} from '../controller.ts'
import {
  markerElement,
  selectionAnchor,
  useAnnotationFloating,
  type AnnotationFloatingAnchor,
} from '../floating.ts'
import { MapPin } from '../icons.ts'

function statusLabel(status: AnnotationStatus, t: InputAnnotationProps['t']): string {
  return t(`status.${status}`)
}

function editorKey(editor: EditorState | null): string {
  return editor === null ? 'closed' : editorBufferKey(editor)
}

function processingModeLabel(mode: ProcessingMode, t: InputAnnotationProps['t']): string {
  return t(`processing.${mode}`)
}

function editorCapture(editor: EditorState) {
  return editor.kind === 'new' ? editor.capture : editor.expandedCapture
}

function editorAnchor(editor: EditorState): AnnotationFloatingAnchor | null {
  const capture = editor.kind === 'new' ? editor.capture : editor.expandedCapture
  const rect = capture?.rect
  if (
    capture !== undefined &&
    rect !== undefined &&
    !(rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0)
  ) {
    const selection = selectionAnchor(capture)
    if (selection !== null) return selection
  }
  const annotationId = editor.kind === 'edit' ? editor.annotationId : editor.supplementalTo
  return annotationId === undefined ? null : markerElement(annotationId)
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
          if (disabled || event.button !== 0) return
          event.preventDefault()
          onActivate()
        }}
        onClick={(event) => {
          if (!disabled && event.detail === 0) onActivate()
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

/** Diff editors belong to the frozen comparison, never a second editor behind its modal. */
function isDiffEditor(view: AnnotationView): boolean {
  const editor = view.editor
  if (editor === null) return false
  return (
    (editor.kind === 'new'
      ? editor.capture
      : (editor.expandedCapture ?? view.annotations.find((item) => item.annotationId === editor.annotationId))
    )?.source?.kind === 'diff'
  )
}

/** Whether the editor belongs inside the summary box instead of under a body marker or selection. */
function isInlineEditor(editor: EditorState | null, markerAnnotationId: AnnotationId | null): boolean {
  if (editor === null || markerAnnotationId !== null) return false
  if (editor.kind === 'edit') return true
  const rect = editor.capture.rect
  return rect.top === 0 && rect.left === 0 && rect.bottom === 0 && rect.right === 0
}

/** Internal components receive resolved settings and the Dock's save wrapper, not injected hooks. */
type DockBoundActions = Omit<AnnotationBoundProps, 'useAnnotations' | 'saveEditor' | 'useCompactSummary'>

function AnnotationEditor({
  view,
  t,
  inline = false,
  composerAnchorRef,
  submitting,
  saveEditor,
  ...actions
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
  inline?: boolean
  composerAnchorRef?: RefObject<HTMLElement>
  submitting: boolean
  saveEditor: () => AnnotationId
} & DockBoundActions) {
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const justComposedRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editor = view.editor
  const floating = useAnnotationFloating({
    floatingRef: editorRef,
    enabled: editor !== null && !inline,
    anchor: () => (editor === null ? null : editorAnchor(editor)),
    composer: () => composerAnchorRef?.current?.closest<HTMLElement>('[data-composer-card]') ?? null,
  })

  const discard = () => {
    if (submitting) {
      setError(t('error.submitting'))
      return
    }
    actions.closeEditor(true)
    setError(null)
  }
  const save = () => {
    if (submitting) {
      setError(t('error.submitting'))
      return
    }
    try {
      saveEditor()
      setError(null)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
      textareaRef.current?.focus()
    }
  }
  const remove = () => {
    if (editor?.kind !== 'edit') return
    if (submitting) {
      setError(t('error.submitting'))
      return
    }
    try {
      actions.deleteDraft(editor.annotationId)
      setError(null)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
      textareaRef.current?.focus()
    }
  }

  useEffect(() => {
    if (editor === null) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 输入法组合期间按 Escape 只用于取消候选，不收起编辑器。
      if (compositionActive(event, composingRef.current, justComposedRef.current)) return
      event.preventDefault()
      actions.suspendEditor()
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      const editorElement = editorRef.current
      if (
        composingRef.current ||
        justComposedRef.current ||
        !(target instanceof Node) ||
        (target instanceof Element &&
          target.closest('[data-annotation-diff]') !== null &&
          (editor.kind === 'new'
            ? editor.capture.source?.kind === 'diff'
            : view.annotations.find((item) => item.annotationId === editor.annotationId)?.source?.kind ===
              'diff')) ||
        (editorElement !== null &&
          (editorElement.contains(target) || event.composedPath().includes(editorElement)))
      ) {
        return
      }
      // 外部操作照常发生；编辑内容先持久暂存，绝不吞掉原点击。
      actions.suspendEditor()
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }
  }, [actions.suspendEditor, editor])

  useEffect(
    () => () => {
      // 组件卸载时清掉延迟解除定时器。
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    },
    [],
  )

  if (editor === null) return null
  const capture = editorCapture(editor)
  const longSelection = capture !== undefined && editor.longSelectionConfirmed !== true
  const expanded = editor.kind === 'edit' && editor.expandedCapture !== undefined
  const savedAnnotation =
    editor.kind === 'edit'
      ? view.annotations.find((item) => item.annotationId === editor.annotationId)
      : undefined
  const supplement = editor.kind === 'edit' && editor.supplement === true
  const editorElement = (
    <section
      ref={editorRef}
      className={`dia-editor${inline ? ' dia-editor--inline' : ''}${view.markerAnnotationId !== null ? ' dia-editor--marker' : ''}`}
      style={inline ? undefined : floating.style}
      data-floating-placement={inline ? undefined : floating.placement}
      role="dialog"
      aria-modal="false"
      aria-label={
        supplement
          ? t('editor.supplementTitle')
          : editor.kind === 'edit'
            ? t('editor.editTitle')
            : t('editor.title')
      }
    >
      {(capture ?? savedAnnotation)?.source?.kind === 'diff' && (
        <div className="dia-diff-quote">
          <AnnotationSourceLabel item={(capture ?? savedAnnotation)!} t={t} />
          <pre>{(capture ?? savedAnnotation)?.quote.exact}</pre>
        </div>
      )}
      <div className="dia-editor__row">
        <textarea
          ref={textareaRef}
          autoFocus
          rows={1}
          className="dia-editor__input"
          value={editor.text}
          aria-label={t('editor.annotationLabel')}
          disabled={submitting}
          aria-invalid={error !== null}
          placeholder={supplement ? t('editor.supplementPlaceholder') : t('editor.placeholder')}
          onChange={(event) => {
            if (!submitting) actions.updateEditorText(event.target.value)
          }}
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
            // 空内容允许保存：空内容表示仅标记原文。
            save()
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
            label={t('editor.discard')}
            side="bottom"
            className="dia-icon-button"
            disabled={submitting}
            onActivate={discard}
          >
            <IconCloseOutlineRegular size={14} />
          </TooltipIconAction>
          <TooltipIconAction
            label={t('editor.save')}
            side="bottom"
            className="dia-icon-button"
            primary
            disabled={submitting || longSelection}
            onActivate={save}
          >
            <IconCheckOutlineRegular size={14} />
          </TooltipIconAction>
          {editor.kind === 'edit' && (
            <TooltipIconAction
              label={t('list.delete')}
              side="bottom"
              className="dia-icon-button"
              danger
              disabled={submitting}
              onActivate={remove}
            >
              <IconTrashOutlineRegular size={14} />
            </TooltipIconAction>
          )}
        </div>
      </div>
      <div className="dia-editor__meta" aria-live="polite">
        <EditorSaveState view={view} t={t} />
        <span>{submitting ? t('error.submitting') : t('editor.suspendHint')}</span>
      </div>
      {editor.text.trim() === '' && (
        <p className="dia-editor__hint">{supplement ? t('editor.supplementHint') : t('editor.emptyHint')}</p>
      )}
      {expanded && savedAnnotation !== undefined && capture !== undefined && (
        <div className="dia-editor__range-change">
          <p>{t('editor.expand')}</p>
          <dl>
            <div>
              <dt>{t('editor.originalRange')}</dt>
              <dd>
                <q>{savedAnnotation.quote.exact}</q>
              </dd>
            </div>
            <div>
              <dt>{t('editor.newRange')}</dt>
              <dd>
                <q>{capture.quote.exact}</q>
              </dd>
            </div>
          </dl>
        </div>
      )}
      {longSelection && (
        <div className="dia-editor__notice" data-tone="warning">
          <span>{t('selection.tooLong')}</span>
          <button
            type="button"
            className="dia-text-button"
            disabled={submitting}
            onClick={actions.confirmLongSelection}
          >
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

function selectionTooltip(
  ordinal: number,
  quote: string,
  annotation: string,
  state: string,
  t: InputAnnotationProps['t'],
): string {
  return t('selection.itemTooltip', {
    ordinal,
    quote,
    annotation: annotation === '' ? t('highlightOnly') : annotation,
    state,
  })
}

function IndividualSelection({
  view,
  submitting,
  t,
  toggleSelected,
}: {
  view: AnnotationView
  submitting: boolean
  t: InputAnnotationProps['t']
  toggleSelected: DockBoundActions['toggleSelected']
}) {
  const eligibleIds = new Set(eligibleAnnotations(view).map((item) => item.annotationId))
  const drafts = view.annotations.filter((item) => item.status === 'draft')
  if (drafts.length === 0) return <p className="dia-selection-strip__empty">{t('selection.none')}</p>
  return (
    <div className="dia-selection-strip" role="group" aria-label={t('selection.group')}>
      {drafts.map((item) => {
        const eligible = eligibleIds.has(item.annotationId)
        const selected = eligible && view.selectedAnnotationIds.includes(item.annotationId)
        const state = !eligible
          ? t('selection.unsaved')
          : selected
            ? t('selection.sendWithMessage')
            : t('selection.holdBack')
        return (
          <Tooltip
            key={item.annotationId}
            label={selectionTooltip(item.ordinal, item.quote.exact, item.annotation, state, t)}
            side="top"
            delayMs={300}
            maxWidth={360}
          >
            <span className="dia-selection-button-anchor">
              <Button
                variant={selected ? 'primary' : 'outline'}
                size="sm"
                className="dia-selection-button"
                aria-label={t('selection.itemLabel', { ordinal: item.ordinal, state })}
                aria-pressed={selected}
                disabled={submitting}
                aria-disabled={!eligible || submitting}
                data-send-state={!eligible ? 'unsaved' : selected ? 'selected' : 'held'}
                onClick={() => {
                  if (eligible && !submitting) toggleSelected(item.annotationId)
                }}
              >
                <span aria-hidden="true">#{item.ordinal}</span>
                <span>{state}</span>
              </Button>
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

function ProcessingModeMenu({
  view,
  submitting,
  t,
  setProcessingMode,
}: {
  view: AnnotationView
  submitting: boolean
  t: InputAnnotationProps['t']
  setProcessingMode: DockBoundActions['setProcessingMode']
}) {
  const [open, setOpen] = useState(false)
  const retry = retryEntry(view)
  const mode = retry?.payload.processingMode ?? view.processingMode
  const frozen = retry !== undefined
  useEffect(() => {
    if (submitting || frozen) setOpen(false)
  }, [frozen, submitting])
  return (
    <Menu
      open={open}
      side="top"
      align="end"
      portal
      compact
      selectedId={mode}
      items={
        [
          { id: 'answer', label: t('processing.answer') },
          { id: 'rewrite', label: t('processing.rewrite') },
          { id: 'modify', label: t('processing.modify') },
        ] satisfies ReadonlyArray<{ id: ProcessingMode; label: string }>
      }
      onClose={() => setOpen(false)}
      onSelect={(id) => {
        if (submitting || frozen || (id !== 'answer' && id !== 'rewrite' && id !== 'modify')) return
        setProcessingMode(id)
        setOpen(false)
      }}
      anchor={
        <Button
          variant="outline"
          size="sm"
          className="dia-processing-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('processing.selectorLabel', { mode: processingModeLabel(mode, t) })}
          title={frozen ? t('processing.retryFrozen') : undefined}
          disabled={submitting || frozen}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{processingModeLabel(mode, t)}</span>
          <IconChevronDownOutlineRegular size={14} aria-hidden="true" />
        </Button>
      }
    />
  )
}

function SuspendedEditors({
  view,
  submitting,
  t,
  resumeEditor,
  discardEditorDraft,
}: {
  view: AnnotationView
  submitting: boolean
  t: InputAnnotationProps['t']
  resumeEditor: DockBoundActions['resumeEditor']
  discardEditorDraft: DockBoundActions['discardEditorDraft']
}) {
  if (view.editorDrafts.length === 0) return null
  return (
    <section className="dia-editor-drafts" aria-label={t('drafts.title')}>
      <h3>{t('drafts.title')}</h3>
      {view.editorDrafts.map((editor) => {
        const key = editorBufferKey(editor)
        const annotation =
          editor.kind === 'edit'
            ? view.annotations.find((item) => item.annotationId === editor.annotationId)
            : undefined
        const capture = editorCapture(editor)
        const quote = capture?.quote.exact ?? annotation?.quote.exact ?? ''
        return (
          <article key={key} className="dia-editor-draft">
            <div className="dia-editor-draft__copy">
              <strong>{editor.kind === 'new' ? t('drafts.new') : t('drafts.edit')}</strong>
              <small>{t('selection.unsaved')}</small>
              {quote !== '' && <q>{quote}</q>}
              <span>{editor.text.trim() === '' ? t('drafts.empty') : editor.text}</span>
            </div>
            <div className="dia-editor-draft__actions">
              <Button variant="outline" size="sm" disabled={submitting} onClick={() => resumeEditor(key)}>
                {t('drafts.resume')}
              </Button>
              <Button variant="ghost" size="sm" disabled={submitting} onClick={() => discardEditorDraft(key)}>
                {t('drafts.discard')}
              </Button>
            </div>
          </article>
        )
      })}
    </section>
  )
}

function OverlapChooser({
  view,
  submitting,
  t,
  chooseOverlap,
  dismissOverlap,
}: {
  view: AnnotationView
  submitting: boolean
  t: InputAnnotationProps['t']
  chooseOverlap: DockBoundActions['chooseOverlap']
  dismissOverlap: DockBoundActions['dismissOverlap']
}) {
  const overlap = view.overlap
  if (overlap === null) return null
  const candidates = overlap.annotationIds.flatMap((annotationId) => {
    const item = view.annotations.find((candidate) => candidate.annotationId === annotationId)
    return item === undefined ? [] : [item]
  })
  return (
    <section className="dia-overlap" role="dialog" aria-modal="false" aria-label={t('overlap.title')}>
      <div className="dia-overlap__head">
        <div>
          <strong>{t('overlap.title')}</strong>
          <p>{t('overlap.hint')}</p>
        </div>
        <TooltipIconAction
          label={t('overlap.dismiss')}
          className="dia-icon-button"
          side="bottom"
          onActivate={dismissOverlap}
        >
          <IconCloseOutlineRegular size={14} />
        </TooltipIconAction>
      </div>
      <q className="dia-overlap__quote">{overlap.capture.quote.exact}</q>
      <div className="dia-overlap__choices">
        <Button variant="outline" size="sm" disabled={submitting} onClick={() => chooseOverlap()}>
          {t('overlap.new')}
        </Button>
        {candidates.map((item) => (
          <Tooltip
            key={item.annotationId}
            label={selectionTooltip(
              item.ordinal,
              item.quote.exact,
              item.annotation,
              t('overlap.supplementState'),
              t,
            )}
            side="top"
            delayMs={300}
            maxWidth={360}
          >
            <span className="dia-overlap__choice-anchor">
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => chooseOverlap(item.annotationId)}
              >
                {t('overlap.supplement', { ordinal: item.ordinal })}
              </Button>
            </span>
          </Tooltip>
        ))}
      </div>
    </section>
  )
}

function RetryRecords({
  view,
  submitting,
  t,
  selectRetry,
}: {
  view: AnnotationView
  submitting: boolean
  t: InputAnnotationProps['t']
  selectRetry: DockBoundActions['selectRetry']
}) {
  const entries = view.outbox.filter((entry) => entry.status === 'ready' || entry.status === 'failed')
  if (entries.length === 0) return null
  return (
    <section className="dia-retries" aria-label={t('retry.title')}>
      <h3>{t('retry.title')}</h3>
      {entries.map((entry) => {
        const active = view.retrySubmissionId === entry.payload.submissionId
        return (
          <article
            key={entry.payload.submissionId}
            className="dia-retry"
            data-active={active ? 'true' : undefined}
          >
            <div className="dia-retry__main">
              <strong>{entry.status === 'failed' ? t('retry.failed') : t('retry.ready')}</strong>
              <span>
                {t('retry.summary', {
                  count: entry.payload.annotations.length,
                  mode: processingModeLabel(entry.payload.processingMode, t),
                })}
              </span>
            </div>
            <Button
              variant={active ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={active}
              disabled={submitting}
              onClick={() => selectRetry(entry.payload.submissionId)}
            >
              {active ? t('retry.cancel') : t('retry.select')}
            </Button>
            <details className="dia-diagnostics">
              <summary>{t('diagnostics.title')}</summary>
              <dl>
                <div>
                  <dt>{t('diagnostics.submissionId')}</dt>
                  <dd>
                    <code>{entry.payload.submissionId}</code>
                  </dd>
                </div>
                <div>
                  <dt>{t('diagnostics.attempts')}</dt>
                  <dd>{entry.attempts}</dd>
                </div>
                {entry.lastError !== undefined && (
                  <div>
                    <dt>{t('diagnostics.lastError')}</dt>
                    <dd>{entry.lastError}</dd>
                  </div>
                )}
              </dl>
            </details>
          </article>
        )
      })}
    </section>
  )
}

function AnnotationRow({
  annotationId,
  view,
  t,
  submitting,
  markerAnchored = false,
  ...actions
}: {
  annotationId: AnnotationId
  view: AnnotationView
  t: InputAnnotationProps['t']
  submitting: boolean
  markerAnchored?: boolean
} & DockBoundActions) {
  const item = view.annotations.find((candidate) => candidate.annotationId === annotationId)
  if (item === undefined) return null
  const awaitingAuthoritativeState =
    item.status === 'queued' && !authoritativeQueueAnnotationIds(view).has(item.annotationId)
  const hasUnsavedChanges =
    item.status === 'draft' &&
    !eligibleAnnotations(view).some((candidate) => candidate.annotationId === item.annotationId)
  const renderedStatus = hasUnsavedChanges
    ? t('selection.unsaved')
    : awaitingAuthoritativeState
      ? t('status.submitted')
      : statusLabel(item.status, t)
  const editLabel = item.status === 'draft' ? t('list.edit') : t('editor.supplement')
  const annotationCopy = item.annotation === '' ? t('highlightOnly') : item.annotation
  return (
    <div
      role="listitem"
      aria-label={`#${item.ordinal} · ${renderedStatus} · ${item.quote.exact} · ${annotationCopy}`}
      className={`dia-item${view.activeAnnotationId === item.annotationId ? ' is-active' : ''}`}
      data-status={item.status}
      data-kind={item.kind}
      data-unsaved={hasUnsavedChanges ? 'true' : undefined}
    >
      <div className="dia-item__main">
        <span className="dia-item__index" aria-hidden="true">
          {item.ordinal}
        </span>
        <span className="dia-item__copy">
          <AnnotationSourceLabel item={item} t={t} />
          <q>{item.quote.exact}</q>
          <span data-highlight-only={item.kind === 'highlight-only' ? 'true' : undefined}>
            {annotationCopy}
          </span>
          {hasUnsavedChanges && <small>{t('selection.unsavedDetail')}</small>}
        </span>
      </div>
      <div className="dia-item__actions">
        {!markerAnchored && (
          <TooltipIconAction
            label={t('list.locate')}
            side="bottom"
            className="dia-row-action"
            onActivate={() => void actions.navigate(item.annotationId)}
          >
            <MapPin aria-hidden="true" size={12} strokeWidth={1.8} />
          </TooltipIconAction>
        )}
        {item.status !== 'queued' && (
          <TooltipIconAction
            label={editLabel}
            side="bottom"
            className="dia-row-action"
            disabled={submitting}
            onActivate={() =>
              markerAnchored
                ? actions.openAnnotation(item.annotationId, 'marker-edit')
                : actions.openAnnotation(item.annotationId)
            }
          >
            {item.status === 'draft' ? (
              <IconEditOutlineRegular size={14} />
            ) : (
              <IconPlusOutlineRegular size={14} />
            )}
          </TooltipIconAction>
        )}
        {item.status === 'draft' && (
          <TooltipIconAction
            label={t('list.delete')}
            side="bottom"
            className="dia-row-action"
            danger
            disabled={submitting}
            onActivate={() => actions.deleteDraft(item.annotationId)}
          >
            <IconTrashOutlineRegular size={14} />
          </TooltipIconAction>
        )}
      </div>
    </div>
  )
}

function MarkerAnnotationPopover({
  view,
  t,
  composerAnchorRef,
  submitting,
  ...actions
}: {
  view: AnnotationView
  t: InputAnnotationProps['t']
  composerAnchorRef: RefObject<HTMLElement>
  submitting: boolean
} & DockBoundActions) {
  const annotationId = view.markerAnnotationId
  const popoverRef = useRef<HTMLElement>(null)
  const [markerIds, setMarkerIds] = useState('')
  const floating = useAnnotationFloating({
    floatingRef: popoverRef,
    enabled: annotationId !== null && view.editor === null,
    anchor: () => {
      const marker = annotationId === null ? null : markerElement(annotationId)
      setMarkerIds(marker?.dataset.annotationIds ?? annotationId ?? '')
      return marker
    },
    composer: () => composerAnchorRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null,
  })

  useEffect(() => {
    if (annotationId === null || view.editor !== null) return undefined
    const dismiss = () => actions.openAnnotation(annotationId, 'marker')
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismiss()
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) === true) return
      if (markerElement(annotationId)?.contains(target) === true) return
      dismiss()
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }
  }, [actions.openAnnotation, annotationId, view.editor])

  if (annotationId === null || view.editor !== null) return null
  const item = view.annotations.find((candidate) => candidate.annotationId === annotationId)
  if (item === undefined) return null
  const ids = new Set(markerIds.split(/\s+/))
  const group = view.annotations.filter((candidate) => ids.has(candidate.annotationId))
  return (
    <Portal>
      <aside
        ref={popoverRef}
        className="dia-marker-popover"
        style={floating.style}
        data-floating-placement={floating.placement}
        role="dialog"
        aria-modal="false"
        aria-label={`#${item.ordinal}: ${item.annotation === '' ? t('highlightOnly') : item.annotation}`}
      >
        <button
          type="button"
          className="dia-marker-popover__close"
          aria-label={t('list.close')}
          onClick={() => actions.openAnnotation(annotationId, 'marker')}
        >
          <IconCloseOutlineRegular size={14} />
        </button>
        {group.length > 1 && (
          <div className="dia-marker-popover__tabs" role="group" aria-label={t('list.title')}>
            {group.map((entry) => (
              <button
                key={entry.annotationId}
                type="button"
                className="dia-marker-popover__tab"
                aria-label={t('reply.chip', { ordinal: entry.ordinal })}
                aria-pressed={entry.annotationId === annotationId}
                onClick={() => {
                  if (entry.annotationId !== annotationId)
                    actions.openAnnotation(entry.annotationId, 'marker')
                }}
              >
                {entry.ordinal}
              </button>
            ))}
          </div>
        )}
        <AnnotationRow
          annotationId={annotationId}
          view={view}
          t={t}
          submitting={submitting}
          markerAnchored
          {...actions}
        />
      </aside>
    </Portal>
  )
}

function noticeText(text: string, t: InputAnnotationProps['t']): string {
  if (text === 'storage') return t('error.storage')
  if (text === 'locate') return t('error.locate')
  if (text === 'payload') return t('error.payload')
  if (text === 'items') return t('error.items')
  if (text === 'selection-mode-changed') return t('notice.selectionModeChanged')
  if (text === 'resume-before-supplement') return t('notice.resumeBeforeSupplement')
  if (text === 'local-edits-preserved') return t('notice.localEditsPreserved')
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

function panelSummary(view: AnnotationView, t: InputAnnotationProps['t']): string {
  const retry = retryEntry(view)
  if (retry !== undefined) {
    return t('panel.retryActive', {
      count: retry.payload.annotations.length,
      mode: processingModeLabel(retry.payload.processingMode, t),
    })
  }
  if (view.selectionMode === 'individual') {
    return t('selection.count', { count: selectedAnnotations(view).length })
  }
  const drafts = eligibleAnnotations(view).length
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

function AnnotationGroup({
  title,
  items,
  view,
  t,
  actions,
  state,
  submitting,
  collapsible = false,
  initiallyOpen = true,
}: {
  title: string
  items: readonly AnnotationView['annotations'][number][]
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: DockBoundActions
  state: StateDotState
  submitting: boolean
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
          {open ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
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
              submitting={submitting}
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
  attachmentCount,
  attachmentDisabled,
  attachmentLabel,
  onToggleAttachment,
  submitting,
  saveEditor,
  compactSummary,
  t,
  shellRef,
  ...actions
}: {
  view: AnnotationView
  archived: boolean
  attached: boolean
  attachmentCount: number
  attachmentDisabled: boolean
  attachmentLabel: string
  onToggleAttachment: () => void
  submitting: boolean
  saveEditor: () => AnnotationId
  compactSummary: boolean
  t: InputAnnotationProps['t']
  shellRef: RefObject<HTMLElement>
} & DockBoundActions) {
  const [chipPopover, setChipPopover] = useState<{ left: number; top: number } | null>(null)
  const listId = useId()
  const retry = retryEntry(view)
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
  const overviewItems =
    retry === undefined
      ? selectedAnnotations(view)
      : retry.payload.annotations.map((item) => ({ ...item, status: 'queued' as const }))
  const showChip =
    attachmentCount > 0 && (attached || view.selectionMode === 'individual' || retry !== undefined)
  const inlineEditor = !isDiffEditor(view) && isInlineEditor(view.editor, view.markerAnnotationId)
  const panelVisible = view.panelOpen || inlineEditor
  const openChipPopover = () => {
    if (panelVisible) return
    const anchor = chipAnchorRef.current
    if (anchor === null) return
    const rect = anchor.getBoundingClientRect()
    setChipPopover({ left: Math.max(12, rect.left), top: rect.top - 6 })
  }
  const togglePanel = () => {
    if (!view.panelOpen) setChipPopover(null)
    actions.setPanelOpen(!view.panelOpen)
  }
  const chipAnchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (panelVisible) setChipPopover(null)
  }, [panelVisible])

  useEffect(() => {
    if (!view.panelOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || view.editor !== null) return
      event.preventDefault()
      actions.setPanelOpen(false)
      chipAnchorRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [actions.setPanelOpen, view.editor, view.panelOpen])

  useEffect(() => {
    if (view.deletedDraft === null) return undefined
    const timer = setTimeout(actions.dismissDeleteUndo, 4500)
    return () => clearTimeout(timer)
  }, [actions.dismissDeleteUndo, view.deletedDraft])

  return (
    <section
      ref={shellRef}
      className="dia-dock-shell"
      data-compact-summary={compactSummary ? 'true' : 'false'}
      data-panel-open={panelVisible ? 'true' : 'false'}
      data-selection-mode={view.selectionMode}
      aria-label={t('list.title')}
    >
      <div className="dia-dock-body">
        <div className="dia-dock" data-attached={attached ? 'true' : 'false'}>
          <button
            ref={chipAnchorRef}
            type="button"
            className="dia-dock__main"
            aria-controls={listId}
            aria-expanded={view.panelOpen}
            aria-label={showChip ? t('compact.count', { count: attachmentCount }) : t('list.title')}
            onPointerEnter={() => {
              if (showChip && !panelVisible) openChipPopover()
            }}
            onPointerLeave={() => setChipPopover(null)}
            onFocus={() => {
              if (showChip && !panelVisible) openChipPopover()
            }}
            onBlur={() => setChipPopover(null)}
            onClick={togglePanel}
          >
            {!compactSummary && (
              <span className="dia-dock__icon" aria-hidden="true">
                <IconListPenOutlineRegular size={14} />
              </span>
            )}
            <span className={`dia-dock__title${showChip ? ' dia-dock__chip' : ''}`}>
              {showChip ? t('compact.count', { count: attachmentCount }) : t('list.title')}
            </span>
            {!showChip && <span className="dia-dock__summary">{panelSummary(view, t)}</span>}
          </button>
          <div className="dia-dock__actions">
            <ProcessingModeMenu
              view={view}
              submitting={submitting}
              t={t}
              setProcessingMode={actions.setProcessingMode}
            />
            {view.selectionMode === 'all' && (
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
                  <IconPaperclipOutlineRegular size={15} />
                </button>
              </Tooltip>
            )}
            <button
              type="button"
              className="dia-dock__fold"
              aria-label={view.panelOpen ? t('dock.collapse') : t('dock.expand')}
              aria-controls={listId}
              aria-expanded={view.panelOpen}
              onClick={togglePanel}
            >
              <span
                className="dia-dock__chevron"
                data-open={panelVisible ? 'true' : 'false'}
                aria-hidden="true"
              >
                <IconChevronUpOutlineRegular size={14} />
              </span>
            </button>
          </div>
        </div>
        {view.selectionMode === 'individual' && (
          <IndividualSelection
            view={view}
            submitting={submitting}
            t={t}
            toggleSelected={actions.toggleSelected}
          />
        )}
      </div>
      {panelVisible && (
        <div id={listId} className="dia-inline-panel dia-inline-panel--dropup">
          {inlineEditor && (
            <AnnotationEditor
              key={editorKey(view.editor)}
              inline
              view={view}
              t={t}
              submitting={submitting}
              {...actions}
              saveEditor={saveEditor}
            />
          )}
          {(view.overlap?.capture.source?.kind !== 'diff' || view.diffPanel == null) && (
            <OverlapChooser
              view={view}
              submitting={submitting}
              t={t}
              chooseOverlap={actions.chooseOverlap}
              dismissOverlap={actions.dismissOverlap}
            />
          )}
          <SuspendedEditors
            view={view}
            submitting={submitting}
            t={t}
            resumeEditor={actions.resumeEditor}
            discardEditorDraft={actions.discardEditorDraft}
          />
          <RetryRecords view={view} submitting={submitting} t={t} selectRetry={actions.selectRetry} />
          {archived && (
            <div className="dia-inline-notice" data-tone="neutral">
              <IconArchiveOutlineRegular size={16} />
              <p>{t('archived.copyNotice')}</p>
            </div>
          )}
          {retry !== undefined && (
            <div className="dia-inline-notice" data-tone="error">
              <IconWarningOutlineRegular size={16} />
              <div>
                <p>{t('error.send')}</p>
                <p className="dia-inline-notice__detail">
                  {t('retry.activeSummary', {
                    count: retry.payload.annotations.length,
                    mode: processingModeLabel(retry.payload.processingMode, t),
                  })}
                </p>
                {(retry.attachments ?? retry.images) !== undefined && (
                  <p className="dia-inline-notice__detail">
                    {t('error.attachmentsRequired', { count: (retry.attachments ?? retry.images)?.count })}
                  </p>
                )}
                <button
                  type="button"
                  className="dia-text-button"
                  disabled={submitting}
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
                submitting={submitting}
                actions={actions}
              />
              <AnnotationGroup
                title={retry === undefined ? t('group.submitted') : t('group.retry')}
                state={retry === undefined ? 'ongoing' : 'error'}
                items={submitted}
                view={view}
                t={t}
                submitting={submitting}
                actions={actions}
              />
              <AnnotationGroup
                title={t('group.queued')}
                state="warning"
                items={queued}
                view={view}
                t={t}
                submitting={submitting}
                actions={actions}
              />
              <AnnotationGroup
                title={t('group.history')}
                state="done"
                items={history}
                view={view}
                t={t}
                submitting={submitting}
                actions={actions}
                collapsible
                initiallyOpen={drafts.length === 0 && submitted.length === 0 && queued.length === 0}
              />
            </div>
          )}

          {view.deletedDraft !== null && (
            <div className="dia-undo" role="status">
              <span>{t('list.deleted')}</span>
              <button
                type="button"
                className="dia-text-button"
                disabled={submitting}
                onClick={actions.undoDelete}
              >
                {t('list.undo')}
              </button>
            </div>
          )}

          {(immutable || queuedSubmissions.length > 0) && (
            <div className="dia-inline-panel__footer">
              {immutable && (
                <p className="dia-immutable-note">
                  <IconDataOutlineRegular size={14} />
                  {t('list.immutable')}
                </p>
              )}
              {queuedSubmissions.length > 0 && (
                <div className="dia-inline-panel__actions">
                  {queuedSubmissions.map((entry) => (
                    <Button
                      key={entry.payload.submissionId}
                      variant="outline"
                      size="sm"
                      icon={<IconCloseOutlineRegular size={14} />}
                      onClick={() => void actions.withdraw(entry.payload.submissionId as SubmissionId)}
                    >
                      {t('list.withdraw')}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!panelVisible && chipPopover !== null && overviewItems.length > 0 && (
        <aside
          className="dia-hover dia-chip-overview"
          role="tooltip"
          aria-label={t('compact.overview')}
          style={compactSummary ? undefined : { left: chipPopover.left, top: chipPopover.top }}
        >
          {overviewItems.map((item) => (
            <div key={item.annotationId} className="dia-chip-overview__row" data-kind={item.kind}>
              <span className="dia-chip-overview__index" aria-hidden="true">
                #{item.ordinal}
              </span>
              <span className="dia-chip-overview__status">
                {retry === undefined ? statusLabel(item.status, t) : t('status.submitted')}
              </span>
              <q className="dia-chip-overview__quote">{item.quote.exact}</q>
              <span
                className="dia-chip-overview__annotation"
                data-highlight-only={item.kind === 'highlight-only' ? 'true' : undefined}
              >
                {item.annotation === '' ? t('highlightOnly') : item.annotation}
              </span>
            </div>
          ))}
        </aside>
      )}
    </section>
  )
}

/**
 * Render the composer summary with selection and marker overlays; list editing stays inline.
 * @param props - Bound annotation actions, composer state, Session hooks, and localized labels.
 * @returns The summary, annotation overlays, and submission toast.
 */
export function AnnotationDock({
  useAnnotations,
  useWorkspaces,
  sessionId,
  input,
  t,
  useCompactSummary,
  saveEditor: controllerSaveEditor,
  diff,
  ...actions
}: InputAnnotationProps) {
  const view = useAnnotations((state) => state)
  const diffEditor = isDiffEditor(view)
  const archived = useWorkspaces((state) => state.archivedSessionIds.includes(sessionId))
  const compactSummary = useCompactSummary((snapshot) => snapshot)
  const shellRef = useRef<HTMLElement>(null)
  const composerAnchorRef = useRef<HTMLSpanElement>(null)
  const composerFocus = useRef<ReturnType<typeof createComposerFocus> | null>(null)
  const previousOutbox = useRef<Map<SubmissionId, ObservedOutboxState> | null>(null)
  const toastSeq = useRef(0)
  const [submissionToast, setSubmissionToast] = useState<SubmissionToastState | null>(null)
  const [pendingFocus, setPendingFocus] = useState<{
    sessionId: typeof sessionId
    request: ComposerFocusRequest
  } | null>(null)
  const hasRetry = view.outbox.some((item) => item.status === 'failed' || item.status === 'ready')
  const dockVisible =
    view.annotations.length > 0 ||
    view.editorDrafts.length > 0 ||
    view.overlap !== null ||
    hasRetry ||
    view.deletedDraft !== null ||
    isInlineEditor(view.editor, view.markerAnnotationId)
  const retry = retryEntry(view)
  const attachmentCount = retry?.payload.annotations.length ?? selectedAnnotations(view).length
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
    const suspend = actions.suspendEditor
    return () => suspend()
    // This cleanup belongs to the Session lifetime, not transient render callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    previousOutbox.current = null
    setSubmissionToast(null)
    setPendingFocus(null)
    const focus = createComposerFocus(() => composerInput(composerAnchorRef.current))
    composerFocus.current = focus
    return () => {
      focus.dispose()
      composerFocus.current = null
    }
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
    if (pendingFocus === null || pendingFocus.sessionId !== sessionId || view.editor !== null)
      return undefined
    let cancelled = false
    let frame = 0
    void Promise.resolve().then(() => {
      if (cancelled) return
      frame = requestAnimationFrame(() => {
        if (cancelled) return
        composerFocus.current?.restore(pendingFocus.request)
        setPendingFocus(null)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [pendingFocus, sessionId, view.editor])

  const toggleAttachment = () => {
    const request = composerFocus.current?.capture()
    if (actions.toggleComposerAttachment() && request != null) setPendingFocus({ sessionId, request })
  }

  const saveEditor = () => {
    const isNew = view.editor?.kind === 'new'
    const shouldAttach =
      isNew && view.selectionMode === 'all' && actions.autoAttachEnabled() && !archived && !attached
    const request = composerFocus.current?.capture()
    const annotationId = controllerSaveEditor()
    if (shouldAttach) actions.ensureComposerAttachment()
    if (isNew && request != null) setPendingFocus({ sessionId, request })
    return annotationId
  }

  return (
    <>
      <span ref={composerAnchorRef} hidden aria-hidden="true" />
      {diff !== undefined && (
        <DiffAnnotationPanel
          view={view}
          actions={diff}
          t={t}
          onEdit={(id) => actions.openAnnotation(id, 'summary')}
          onSuspend={actions.suspendEditor}
        >
          {view.overlap?.capture.source?.kind === 'diff' && (
            <OverlapChooser
              view={view}
              submitting={input.phase === 'submitting'}
              t={t}
              chooseOverlap={actions.chooseOverlap}
              dismissOverlap={actions.dismissOverlap}
            />
          )}
          {diffEditor && (
            <AnnotationEditor
              key={editorKey(view.editor)}
              view={view}
              t={t}
              inline
              submitting={input.phase === 'submitting'}
              {...actions}
              saveEditor={saveEditor}
            />
          )}
        </DiffAnnotationPanel>
      )}
      {dockVisible && (
        <AnnotationPanel
          view={view}
          archived={archived}
          attached={attached}
          attachmentCount={attachmentCount}
          attachmentDisabled={attachmentDisabled}
          attachmentLabel={attachmentLabel}
          onToggleAttachment={toggleAttachment}
          submitting={input.phase === 'submitting'}
          saveEditor={saveEditor}
          compactSummary={compactSummary}
          t={t}
          shellRef={shellRef}
          {...actions}
        />
      )}
      <MarkerAnnotationPopover
        view={view}
        t={t}
        composerAnchorRef={composerAnchorRef}
        submitting={input.phase === 'submitting'}
        {...actions}
      />
      {!diffEditor && !isInlineEditor(view.editor, view.markerAnnotationId) && (
        <AnnotationEditor
          key={editorKey(view.editor)}
          view={view}
          t={t}
          composerAnchorRef={composerAnchorRef}
          submitting={input.phase === 'submitting'}
          {...actions}
          saveEditor={saveEditor}
        />
      )}
      {submissionToast !== null && (
        <Toast
          key={submissionToast.seq}
          text={
            submissionToast.kind === 'failed'
              ? t('toast.failed', { count: submissionToast.count })
              : t(`toast.${submissionToast.kind}`, { count: submissionToast.count })
          }
          icon={
            submissionToast.kind === 'queued' ? (
              <IconQueueOutlineRegular size={14} />
            ) : submissionToast.kind === 'sent' ? (
              <IconCheckOutlineRegular size={14} />
            ) : (
              <IconWarningOutlineRegular size={14} />
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
