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
  Button,
  HoverCard,
  MenuSurface,
  SegmentedControl,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  PureComponent,
  createRef,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { AnnotationDraft, AnnotationId, SessionIdentity } from '../../shared/types.ts'
import { sourceType, type AnnotationAnchor } from '../../shared/annotation-source.ts'
import { isOutboxPayloadEntry } from '../../shared/outbox-redaction.ts'
import { composerInput, createComposerFocus } from '../composer-focus.ts'
import type { AnnotationBoundProps, InputAnnotationProps } from '../contract.ts'
import { editorBufferKey, retryEntry, selectedAnnotations, type AnnotationView } from '../controller.ts'
import { markerElement, selectionAnchor, useAnnotationFloating } from '../floating.ts'
import { useComposerChipLayout } from '../composer-chip-layout.ts'
import { MapPin } from '../icons.ts'
import { orderedRecords } from '../record-order.ts'
import { displayAnnotationQuote } from './AnnotationSourceLabel.tsx'
import { AnnotationDetails } from './AnnotationDetails.tsx'

type AnnotationActions = Omit<AnnotationBoundProps, 'useAnnotations' | 'useCompactSummary' | 'saveEditor'>
type RecordActions = Pick<
  AnnotationActions,
  'toggleSelected' | 'navigate' | 'openAnnotation' | 'trashAnnotations'
>
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
          <q>{displayAnnotationQuote(item, t)}</q>
          <span>{item.annotation}</span>
        </div>
      ))}
    </div>
  )
}

/** Count inside the Host composer; click opens the record, and an empty selection closes its preview. */
export function AnnotationComposerChip({
  useAnnotations,
  setPanelOpen,
  setRecordExpanded,
  detachAnnotations,
  trashAnnotations,
  t,
}: ControlProps) {
  const view = useAnnotations((state) => state)
  const items = selectedAnnotations(view)
  const hasItems = items.length > 0
  const chipRef = useComposerChipLayout(hasItems)
  const composerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    composerRef.current = chipRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null
  }, [hasItems])
  const busy =
    items.some((item) => item.status === 'queued') ||
    view.outbox.some(
      (entry) =>
        entry.status !== 'sent' &&
        entry.status !== 'withdrawn' &&
        isOutboxPayloadEntry(entry) &&
        entry.payload.annotations.some((item) =>
          items.some((selected) => selected.annotationId === item.annotationId),
        ),
    )
  if (!hasItems) return null
  return (
    <div ref={chipRef} className="dia-composer-chip" data-dia-annotation-chip="">
      <HoverCard
        inline
        variant="preview"
        widthAnchorRef={composerRef}
        openDelayMs={0}
        anchor={
          <button
            type="button"
            className="dia-composer-chip__main"
            aria-label={t('record.openAttached', { count: items.length })}
            onClick={() => {
              if (!view.panelOpen) setPanelOpen(true)
              else setRecordExpanded(!view.recordExpanded)
            }}
          >
            <IconPaperclipOutlineRegular size={16} />
            <span>{t('record.attachedCount', { count: items.length })}</span>
          </button>
        }
        content={<AttachmentPreview items={items} t={t} />}
      />
      <span className="dia-composer-chip__actions">
        <span className="dia-composer-chip__actions-inner">
          <Tooltip label={t('record.trashAttached')} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-composer-chip__remove"
              data-danger="true"
              aria-label={t('record.trashAttached')}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                trashAnnotations(items.map((item) => item.annotationId))
              }}
            >
              <IconTrashOutlineRegular size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('record.detachAll')} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-composer-chip__remove"
              aria-label={t('record.detachAll')}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                detachAnnotations(items.map((item) => item.annotationId))
              }}
            >
              <IconCloseOutlineRegular size={14} />
            </button>
          </Tooltip>
        </span>
      </span>
    </div>
  )
}

function sourceRoot(anchor: HTMLElement | null, foreign = false): ParentNode {
  const doc = anchor?.ownerDocument ?? document
  return foreign ? doc : (anchor?.closest<HTMLElement>('[data-conversation-content]') ?? doc)
}

/** Message positions belong to the recorded source Session, independently of the receiving editor. */
function annotationSourceSession(
  item: AnnotationAnchor | undefined,
  receiver: InputAnnotationProps['sessionId'],
) {
  return item?.source?.kind === 'message' ? (item.source.sessionId ?? receiver) : receiver
}

function sourceAnchor(
  item: AnnotationDraft,
  root: ParentNode,
  sessionId: InputAnnotationProps['sessionId'] | SessionIdentity,
) {
  return (
    selectionAnchor({ ...item, rect: { top: 0, left: 0, bottom: 0, right: 0 } }, root, sessionId) ??
    markerElement(item.annotationId, root, sessionId)
  )
}

function fitAnnotationTextarea(element: HTMLTextAreaElement, cardHeight: number | undefined): void {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element)
  const lineHeight = Number.parseFloat(style.lineHeight) || 20
  const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
  const minimumHeight = lineHeight + padding
  const maximumHeight = lineHeight * 7 + padding
  const controlsHeight = Math.max(0, element.parentElement!.scrollHeight - element.offsetHeight)
  const scrollTop = element.scrollTop
  const availableHeight = cardHeight === undefined ? maximumHeight : cardHeight - controlsHeight
  const cap = Math.min(maximumHeight, Math.max(minimumHeight, availableHeight))
  element.style.maxHeight = `${cap}px`
  element.style.height = `${minimumHeight}px`
  const requiredHeight = element.scrollHeight
  element.style.height = `${Math.min(cap, Math.max(minimumHeight, requiredHeight))}px`
  element.style.overflowY = requiredHeight > cap ? 'auto' : 'hidden'
  element
    .closest('.dia-record-editor--quick')
    ?.setAttribute('data-single-line', String(requiredHeight <= minimumHeight))
  element.scrollTop = scrollTop
}

function useAnnotationTextareaHeight(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean,
  cardHeight: number | undefined,
): void {
  useLayoutEffect(() => {
    const element = textarea.current
    if (!enabled || element === null) return undefined
    fitAnnotationTextarea(element, cardHeight)
    let width = element.getBoundingClientRect().width
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const nextWidth = element.getBoundingClientRect().width
            if (nextWidth === width) return
            width = nextWidth
            fitAnnotationTextarea(element, cardHeight)
          })
    resize?.observe(element)
    const view = element.ownerDocument.defaultView!
    const fit = () => fitAnnotationTextarea(element, cardHeight)
    const preference = new MutationObserver(fit)
    preference.observe(element.ownerDocument.body, { attributes: true, attributeFilter: ['style'] })
    preference.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
    view.addEventListener('resize', fit)
    let disposed = false
    void element.ownerDocument.fonts?.ready.then(() => {
      if (!disposed) fit()
    })
    return () => {
      disposed = true
      resize?.disconnect()
      preference.disconnect()
      view.removeEventListener('resize', fit)
    }
  }, [textarea, value, enabled, cardHeight])
}

function AnnotationEditor({
  anchorRef,
  sessionId,
  view,
  t,
  actions,
  saveEditor,
  submitting,
}: {
  anchorRef: RefObject<HTMLSpanElement | null>
  sessionId: InputAnnotationProps['sessionId']
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: AnnotationActions
  saveEditor: () => void
  submitting: boolean
}) {
  const editor = view.editor
  const source =
    editor?.kind === 'new'
      ? editor.capture
      : view.annotations.find((item) => editor?.kind === 'edit' && item.annotationId === editor.annotationId)
  const sourceId = annotationSourceSession(source, sessionId)
  const foreign = sourceId !== sessionId
  const ref = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const outsideClicks = useRef(0)
  const [shake, setShake] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floating = useAnnotationFloating({
    floatingRef: ref,
    enabled: editor !== null,
    owner: () => anchorRef.current?.parentElement ?? null,
    preferBelow: true,
    anchor: () => {
      if (editor === null) return null
      const root = sourceRoot(anchorRef.current, foreign)
      if (editor.kind === 'new')
        return (
          selectionAnchor(editor.capture, root, sourceId) ??
          (editor.supplementalTo === undefined ? null : markerElement(editor.supplementalTo, root, sourceId))
        )
      const item = view.annotations.find((candidate) => candidate.annotationId === editor.annotationId)
      return item === undefined
        ? markerElement(editor.annotationId, root, sourceId)
        : sourceAnchor(item, root, sourceId)
    },
    composer: (sourceContext) =>
      foreign && sourceContext !== null
        ? undefined
        : (composerInput(anchorRef.current)?.closest<HTMLElement>('[data-composer-card]') ?? null),
  })
  useAnnotationTextareaHeight(
    textarea,
    editor?.text ?? '',
    editor !== null,
    typeof floating.style.maxHeight === 'number' ? floating.style.maxHeight : undefined,
  )
  const save = (): boolean => {
    if (submitting) return false
    try {
      const value = textarea.current?.value
      if (editor !== null && value !== undefined && value !== editor.text) actions.updateEditorText(value)
      saveEditor()
      setError(null)
      return true
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'annotation-storage-failed'
          ? null
          : cause instanceof Error && cause.message === 'whole-file-opinion-required'
            ? t('editor.wholeFileOpinionRequired')
            : cause instanceof Error
              ? cause.message
              : String(cause),
      )
      textarea.current?.focus()
      return false
    }
  }
  const latest = useRef({ editor, actions, save, submitting })
  latest.current = { editor, actions, save, submitting }
  const editorKey = editor === null ? null : editorBufferKey(editor)
  useEffect(() => {
    if (editorKey === null || !floating.visible) return undefined
    textarea.current?.focus({ preventScroll: true })
    outsideClicks.current = 0
    setShake(false)
    setError(null)
    if (compositionTimer.current !== null) clearTimeout(compositionTimer.current)
    compositionTimer.current = null
    composingRef.current = false
    setComposing(false)
    let shakeFrame: number | null = null
    let finishing = false
    let pairedComposerInput = false
    const finishImplicitly = () => {
      const current = latest.current
      if (finishing || current.editor?.kind !== 'new' || current.submitting || composingRef.current) return
      const text = textarea.current?.value ?? current.editor.text
      finishing = true
      if (text.trim() === '') current.actions.closeEditor(true)
      else if (!current.save()) finishing = false
    }
    const hidden = (): boolean =>
      anchorRef.current?.parentElement?.closest('[hidden], [inert], [aria-hidden="true"]') != null
    const onPointer = (event: PointerEvent) => {
      if (finishing || hidden()) return
      if (ref.current?.contains(event.target as Node)) return
      const current = latest.current
      if (current.editor === null || current.submitting || composingRef.current) return
      if (current.editor.kind !== 'new') {
        current.actions.suspendEditor()
        return
      }
      outsideClicks.current += 1
      if (outsideClicks.current >= 3) {
        finishImplicitly()
        return
      }
      setShake(false)
      if (shakeFrame !== null) cancelAnimationFrame(shakeFrame)
      shakeFrame = requestAnimationFrame(() => {
        shakeFrame = null
        setShake(true)
      })
    }
    const onInput = (event: Event) => {
      if (hidden()) return
      if (event instanceof InputEvent && event.isComposing) return
      const target = event.target
      if (!(target instanceof Node) || !composerInput(anchorRef.current)?.contains(target)) return
      if (event.type === 'beforeinput') {
        pairedComposerInput = true
        queueMicrotask(() => {
          pairedComposerInput = false
        })
        finishImplicitly()
      } else if (pairedComposerInput) pairedComposerInput = false
      else finishImplicitly()
    }
    const onKey = (event: KeyboardEvent) => {
      if (finishing || hidden() || event.key !== 'Escape' || event.isComposing || composingRef.current) return
      const current = latest.current
      if (current.editor === null) return
      event.preventDefault()
      if (current.editor.kind === 'new' && (textarea.current?.value ?? current.editor.text).trim() === '')
        current.actions.closeEditor(true)
      else {
        const value = textarea.current?.value
        if (value !== undefined && value !== current.editor.text) current.actions.updateEditorText(value)
        current.actions.suspendEditor()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('input', onInput, true)
    document.addEventListener('beforeinput', onInput, true)
    document.addEventListener('keydown', onKey)
    return () => {
      if (shakeFrame !== null) cancelAnimationFrame(shakeFrame)
      if (compositionTimer.current !== null) clearTimeout(compositionTimer.current)
      compositionTimer.current = null
      composingRef.current = false
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('beforeinput', onInput, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [editorKey, anchorRef, sessionId, floating.visible])
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
      data-dia-annotation-target={sessionId}
      role="dialog"
      aria-modal="false"
      aria-label={quick ? t('editor.title') : t('editor.editTitle')}
      onAnimationEnd={() => setShake(false)}
    >
      <textarea
        ref={textarea}
        rows={1}
        value={editor.text}
        aria-label={t('editor.annotationLabel')}
        disabled={submitting}
        onChange={(event) => actions.updateEditorText(event.target.value)}
        onCompositionStart={() => {
          if (compositionTimer.current !== null) clearTimeout(compositionTimer.current)
          compositionTimer.current = null
          composingRef.current = true
          setComposing(true)
        }}
        onCompositionEnd={() => {
          if (compositionTimer.current !== null) clearTimeout(compositionTimer.current)
          compositionTimer.current = setTimeout(() => {
            compositionTimer.current = null
            composingRef.current = false
            setComposing(false)
          }, 0)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || composing || composingRef.current || event.nativeEvent.isComposing)
            return
          event.stopPropagation()
          if (event.shiftKey) return
          event.preventDefault()
          save()
        }}
      />
      {quick ? (
        <Button
          size="sm"
          variant="primary"
          className="dia-record-editor__check"
          icon={<IconCheckOutlineRegular size={16} />}
          aria-busy={submitting}
          data-saving={submitting || undefined}
          aria-label={t('editor.save')}
          disabled={submitting || editor.longSelectionConfirmed === false}
          onClick={save}
        />
      ) : (
        <div className="dia-record-editor__footer">
          <IconAction
            label={t('list.delete')}
            danger
            disabled={submitting || item?.status !== 'draft'}
            onClick={() => item && actions.trashAnnotations([item.annotationId])}
          >
            <IconTrashOutlineRegular size={15} />
          </IconAction>
          <span className="dia-record-editor__footer-right">
            <Button size="sm" type="button" onClick={() => actions.closeEditor(true)}>
              {t('editor.cancel')}
            </Button>
            <Button size="sm" variant="primary" type="button" onClick={save} disabled={submitting}>
              {t('editor.save')}
            </Button>
          </span>
        </div>
      )}
      {editor.longSelectionConfirmed === false && (
        <Button
          size="sm"
          type="button"
          className="dia-record-editor__confirm"
          onClick={actions.confirmLongSelection}
        >
          {t('editor.confirmLong')}
        </Button>
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
  anchorRef,
  sessionId,
  view,
  t,
  actions,
}: {
  anchorRef: RefObject<HTMLSpanElement | null>
  sessionId: InputAnnotationProps['sessionId']
  view: AnnotationView
  t: InputAnnotationProps['t']
  actions: AnnotationActions
}) {
  const item = view.annotations.find((candidate) => candidate.annotationId === view.markerAnnotationId)
  const sourceId = annotationSourceSession(item, sessionId)
  const foreign = sourceId !== sessionId
  const ref = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const floating = useAnnotationFloating({
    floatingRef: ref,
    enabled: item !== undefined && view.editor === null,
    owner: () => anchorRef.current?.parentElement ?? null,
    preferBelow: true,
    anchor: () =>
      item === undefined ? null : sourceAnchor(item, sourceRoot(anchorRef.current, foreign), sourceId),
    composer: (sourceContext) =>
      foreign && sourceContext !== null
        ? undefined
        : (composerInput(anchorRef.current)?.closest<HTMLElement>('[data-composer-card]') ?? null),
  })
  useAnnotationTextareaHeight(
    textarea,
    item?.annotation ?? '',
    item !== undefined && view.editor === null,
    typeof floating.style.maxHeight === 'number' ? floating.style.maxHeight : undefined,
  )
  useEffect(() => {
    if (item === undefined || view.editor !== null || !floating.visible) return undefined
    const onPointer = (event: PointerEvent) => {
      const sourceMarker =
        event.target instanceof Element ? event.target.closest<HTMLElement>('button.dia-marker') : null
      if (
        event.target instanceof Node &&
        (ref.current?.contains(event.target) ||
          (sourceMarker?.dataset.annotationId === item.annotationId &&
            sourceMarker.dataset.diaAnnotationTarget === String(sessionId)) ||
          markerElement(item.annotationId, sourceRoot(anchorRef.current, foreign), sourceId)?.contains(
            event.target,
          ))
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
  }, [item, view.editor, actions.openAnnotation, anchorRef, sessionId, sourceId, foreign, floating.visible])
  if (item === undefined || view.editor !== null) return null
  const selected = view.selectedAnnotationIds.includes(item.annotationId)
  const content = (
    <section
      ref={ref}
      className="dia-record-editor dia-record-editor--detail"
      style={floating.style}
      data-floating-placement={floating.placement}
      data-dia-annotation-target={sessionId}
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
          label={selected ? t('record.detach') : t('record.attach')}
          active={selected}
          onClick={() => actions.toggleSelected(item.annotationId)}
        >
          <IconPaperclipOutlineRegular size={15} />
        </IconAction>
        <span className="dia-record-editor__footer-right">
          <Button size="sm" type="button" onClick={() => actions.openAnnotation(item.annotationId, 'marker')}>
            {t('editor.cancel')}
          </Button>
        </span>
      </div>
    </section>
  )
  return createPortal(content, document.body)
}

/** Keep readable previews outside the whole record so other rows remain clickable. */
function RecordPreview({
  item,
  summary,
  disabled,
  t,
}: {
  item: AnnotationDraft
  summary: string
  disabled: boolean
  t: InputAnnotationProps['t']
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const visible = open && !disabled
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const close = () => {
    clearTimer()
    setOpen(false)
  }
  const schedule = (next: boolean, delay: number) => {
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      setOpen(next)
    }, delay)
  }
  const record = () => anchor.current?.closest<HTMLElement>('.dia-record') ?? null
  const floating = useAnnotationFloating({
    enabled: visible,
    floatingRef: panel,
    anchor: record,
    composer: record,
  })
  useDismissOnOutsidePointer(anchor, visible, close, panel)
  useEffect(() => {
    if (disabled) setOpen(false)
    return clearTimer
  }, [disabled])
  useEffect(() => {
    if (!visible) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [visible])
  return (
    <>
      <span
        ref={anchor}
        className="dia-record-row__text"
        onPointerEnter={(event) => {
          if (
            disabled ||
            event.pointerType === 'touch' ||
            (event.pointerType === 'mouse' && !window.matchMedia('(any-hover: hover)').matches)
          )
            return
          if (visible) clearTimer()
          else schedule(true, 500)
        }}
        onPointerLeave={() => schedule(false, 200)}
        onPointerDown={close}
        onFocus={(event) => {
          if (!disabled && event.target.matches(':focus-visible')) {
            clearTimer()
            setOpen(true)
          }
        }}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node) || !panel.current?.contains(event.relatedTarget)) close()
        }}
      >
        <span tabIndex={0} className="dia-record-row__preview-anchor" aria-label={summary}>
          {summary}
        </span>
      </span>
      {visible &&
        createPortal(
          <MenuSurface
            ref={panel}
            className="dia-record-preview"
            style={floating.style}
            onPointerEnter={clearTimer}
            onPointerLeave={() => schedule(false, 200)}
            onBlur={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                (!panel.current?.contains(event.relatedTarget) &&
                  !anchor.current?.contains(event.relatedTarget))
              )
                close()
            }}
          >
            <AnnotationDetails item={item} t={t} />
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}

const RecordRow = memo(function RecordRow({
  item,
  selected,
  editorOpen,
  t,
  actions,
  submitting,
}: {
  item: AnnotationDraft
  selected: boolean
  editorOpen: boolean
  t: InputAnnotationProps['t']
  actions: RecordActions
  submitting: boolean
}) {
  const legacyDiff = item.source?.kind === 'diff'
  const attachLabel = selected ? t('record.detach') : t('record.attach')
  const summary =
    item.annotation.trim() ||
    displayAnnotationQuote(item, t).replace(/\s+/gu, ' ').trim() ||
    t('highlightOnly')
  return (
    <div
      className="dia-record-row"
      role="listitem"
      data-annotation-id={item.annotationId}
      aria-label={`${item.ordinal} · ${summary}`}
    >
      <RecordPreview item={item} summary={summary} disabled={editorOpen} t={t} />
      <div className="dia-record-row__actions">
        {legacyDiff ? <span className="dia-record-row__legacy">{t('source.readOnly')}</span> : null}
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
              </>
            )}
          </>
        )}
        <IconAction
          label={t('list.delete')}
          danger
          disabled={submitting || item.status === 'queued'}
          onClick={() => actions.trashAnnotations([item.annotationId])}
        >
          <IconTrashOutlineRegular size={15} />
        </IconAction>
      </div>
    </div>
  )
})

interface RecordListProps {
  readonly id: string
  readonly scope: string
  readonly items: readonly AnnotationDraft[]
  readonly selectedIds: ReadonlySet<AnnotationId>
  readonly editorOpen: boolean
  readonly t: InputAnnotationProps['t']
  readonly actions: RecordActions
  readonly submitting: boolean
}

interface RecordListSnapshot {
  readonly row: HTMLElement
  readonly offset: number
  readonly focus: HTMLElement | null
}

interface RecordListState {
  readonly scope: string
  readonly ids: readonly AnnotationId[]
}

/** Keep attachment toggles in place; membership and filter changes retain the visible reading anchor. */
class RecordList extends PureComponent<RecordListProps, RecordListState, RecordListSnapshot | null> {
  private readonly list = createRef<HTMLDivElement>()
  state: RecordListState = { scope: this.props.scope, ids: this.props.items.map((item) => item.annotationId) }

  static getDerivedStateFromProps(next: RecordListProps, previous: RecordListState): RecordListState | null {
    const ids = new Set(previous.ids)
    if (
      next.scope === previous.scope &&
      next.items.length === ids.size &&
      next.items.every((item) => ids.has(item.annotationId))
    )
      return null
    return { scope: next.scope, ids: next.items.map((item) => item.annotationId) }
  }

  getSnapshotBeforeUpdate(
    previous: RecordListProps,
    previousState: RecordListState,
  ): RecordListSnapshot | null {
    const list = this.list.current
    if (list === null || previous.scope !== this.props.scope || previousState.ids === this.state.ids)
      return null
    const retainedIds = new Set<string>(this.props.items.map((item) => item.annotationId))
    const bounds = list.getBoundingClientRect()
    const visible = (row: HTMLElement): boolean => {
      const rect = row.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    }
    const active = list.ownerDocument.activeElement
    const focus = active instanceof HTMLElement && list.contains(active) ? active : null
    const focusedRow = focus?.closest<HTMLElement>('[data-annotation-id]')
    const focusedAnchor =
      focusedRow && retainedIds.has(focusedRow.dataset.annotationId!) && visible(focusedRow)
        ? focusedRow
        : null
    if (list.scrollTop === 0 && focusedAnchor === null) return null
    const row =
      focusedAnchor ??
      Array.from(list.children).find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          retainedIds.has(element.dataset.annotationId!) &&
          visible(element),
      )
    return row ? { row, offset: row.getBoundingClientRect().top - bounds.top, focus } : null
  }

  componentDidUpdate(
    previous: RecordListProps,
    _state: RecordListState,
    snapshot: RecordListSnapshot | null,
  ): void {
    const list = this.list.current
    if (list === null) return
    if (previous.scope !== this.props.scope) {
      list.scrollTop = 0
      return
    }
    if (snapshot === null || !list.contains(snapshot.row)) return
    if (
      snapshot.focus !== null &&
      list.contains(snapshot.focus) &&
      list.ownerDocument.activeElement === list.ownerDocument.body
    )
      snapshot.focus.focus({ preventScroll: true })
    list.scrollTop +=
      snapshot.row.getBoundingClientRect().top - list.getBoundingClientRect().top - snapshot.offset
  }

  render(): ReactNode {
    const { id, items, selectedIds, editorOpen, t, actions, submitting } = this.props
    const byId = new Map(items.map((item) => [item.annotationId, item]))
    return (
      <div ref={this.list} id={id} className="dia-record__list" role="list">
        {this.state.ids
          .map((annotationId) => byId.get(annotationId)!)
          .map((item) => (
            <RecordRow
              key={item.annotationId}
              item={item}
              selected={selectedIds.has(item.annotationId) || item.status === 'queued'}
              editorOpen={editorOpen}
              t={t}
              actions={actions}
              submitting={submitting}
            />
          ))}
      </div>
    )
  }
}

/**
 * The record grows below its header and occupies normal layout above the composer.
 * Derived counts and selection belong to this mounted view and follow immutable controller snapshots.
 */
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
  const submitting = input.phase !== 'plain' && input.phase !== 'claimed'
  const archived = useWorkspaces((state) => state.archivedSessionIds.includes(sessionId))
  const listId = useId()
  const [filter, setFilter] = useState<'all' | 'message' | 'diff' | 'file'>('all')
  const anchorRef = useRef<HTMLSpanElement>(null)
  const focus = useRef<ReturnType<typeof createComposerFocus> | null>(null)
  useEffect(() => {
    focus.current = createComposerFocus(() => composerInput(anchorRef.current))
    return () => {
      focus.current?.dispose()
      focus.current = null
    }
  }, [sessionId])
  useLayoutEffect(() => actions.bindNoticeHost(anchorRef.current), [actions.bindNoticeHost, sessionId])
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
  const records = useMemo(() => orderedRecords(view), [view.annotations])
  const selectedIds = useMemo(() => new Set(view.selectedAnnotationIds), [view.selectedAnnotationIds])
  const sourceTypes = useMemo(() => new Set(view.annotations.map(sourceType)), [view.annotations])
  const recordActions = useMemo(
    () => ({
      toggleSelected: actions.toggleSelected,
      navigate: actions.navigate,
      openAnnotation: actions.openAnnotation,
      trashAnnotations: actions.trashAnnotations,
    }),
    [actions.toggleSelected, actions.navigate, actions.openAnnotation, actions.trashAnnotations],
  )
  const effectiveFilter = filter === 'all' || sourceTypes.has(filter) ? filter : 'all'
  useEffect(() => {
    if (effectiveFilter !== filter) setFilter('all')
  }, [effectiveFilter, filter])
  const filteredAnnotations = useMemo(
    () =>
      effectiveFilter === 'all' ? records : records.filter((item) => sourceType(item) === effectiveFilter),
    [records, effectiveFilter],
  )
  const filterOptions = (
    [
      ['all', 'records.filterAll'],
      ['message', 'records.filterBody'],
      ['diff', 'records.filterDiff'],
      ['file', 'records.filterFile'],
    ] as const
  )
    .filter(([value]) => value === 'all' || sourceTypes.has(value))
    .map(([value, key]) => ({ value, label: t(key) }))
  const showFilters = view.recordExpanded && sourceTypes.size >= 2
  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {view.annotations.length > 0 && view.panelOpen && (
        <section id={`${listId}-record`} className="dia-record" aria-label={t('record.title')}>
          <div
            className="dia-record__body"
            onClick={(event) => {
              if (event.target === event.currentTarget) actions.setRecordExpanded(!view.recordExpanded)
            }}
          >
            <div
              className="dia-record__header"
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button, [role="tab"]')) return
                actions.setRecordExpanded(!view.recordExpanded)
              }}
            >
              <Tooltip
                label={view.recordExpanded ? t('dock.collapse') : t('dock.expand')}
                side="top"
                delayMs={350}
              >
                <button
                  type="button"
                  className="dia-record__heading-action"
                  aria-controls={listId}
                  aria-expanded={view.recordExpanded}
                  onClick={() => actions.setRecordExpanded(!view.recordExpanded)}
                >
                  <span className="dia-record__lead" aria-hidden="true">
                    <IconListPenOutlineRegular />
                  </span>
                  <span className="dia-record__title">{t('record.title')}</span>
                </button>
              </Tooltip>
              <span className="dia-record__progress">
                {t('record.totalCount', { count: view.annotations.length })}
              </span>
              {showFilters && (
                <Tooltip label={t('details.sourceFilter')} side="top" delayMs={350}>
                  <span className="dia-record__filters">
                    <SegmentedControl
                      id={`${listId}-filter`}
                      value={effectiveFilter}
                      options={filterOptions}
                      onChange={setFilter}
                      label={t('details.sourceFilter')}
                    />
                  </span>
                </Tooltip>
              )}
              <Tooltip
                label={view.recordExpanded ? t('dock.collapse') : t('dock.expand')}
                side="top"
                delayMs={350}
              >
                <button
                  type="button"
                  className="dia-record__chevron"
                  aria-label={view.recordExpanded ? t('dock.collapse') : t('dock.expand')}
                  aria-controls={listId}
                  aria-expanded={view.recordExpanded}
                  onClick={() => actions.setRecordExpanded(!view.recordExpanded)}
                >
                  {view.recordExpanded ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}
                </button>
              </Tooltip>
            </div>
            {view.recordExpanded && (
              <div
                id={showFilters ? `${listId}-filter-${effectiveFilter}-panel` : undefined}
                role={showFilters ? 'tabpanel' : undefined}
                aria-labelledby={showFilters ? `${listId}-filter-${effectiveFilter}` : undefined}
              >
                <RecordList
                  id={listId}
                  scope={`${sessionId}:${effectiveFilter}`}
                  items={filteredAnnotations}
                  selectedIds={selectedIds}
                  editorOpen={view.editor !== null}
                  t={t}
                  actions={recordActions}
                  submitting={submitting}
                />
              </div>
            )}
            {retry && (
              <div className="dia-record__retry" role="status">
                <span>{t('error.send')}</span>
                <Tooltip label={t('list.discard')} side="top" delayMs={350}>
                  <button
                    type="button"
                    aria-label={t('list.discard')}
                    onClick={() => actions.discardOutbox(retry.payload.submissionId)}
                  >
                    {t('list.discard')}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </section>
      )}
      <AnnotationEditor
        anchorRef={anchorRef}
        sessionId={sessionId}
        view={view}
        t={t}
        actions={actions}
        saveEditor={saveEditor}
        submitting={submitting}
      />
      <SentAnnotationCard anchorRef={anchorRef} sessionId={sessionId} view={view} t={t} actions={actions} />
    </>
  )
}
