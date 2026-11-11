/** Pending source references, the shared attach chip, and the collapsible record panel. */
import {
  Button,
  HoverCard,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  IconLinkOutlineRegular,
  IconListPenOutlineRegular,
  IconPaperclipOutlineRegular,
  MenuSurface,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { rendered, useAnnotationFloating } from '../floating.ts'
import { useComposerChipLayout } from '../composer-chip-layout.ts'
import { composerInput } from '../composer-focus.ts'
import type { SideChatId, SideChatReference, SideChatReferenceId } from '../../shared/side-chat-types.ts'
import type { SideChatChatView, SideChatView } from '../side-chat-controller.ts'

/** One chat as the sidebar list and the dock address it. */
export interface SideChatTarget {
  readonly sideChatId: SideChatId
  readonly label: string
  readonly references: number
  readonly selected: boolean
}

/** Observable data and Session-addressed actions supplied by the registration owner. */
export interface SideChatInjected {
  readonly hooks: {
    readonly sideChat: HostObservable<SideChatView | null>
  }
  readonly removeReference: (referenceId: SideChatReferenceId) => void
  readonly removeAllReferences: () => void
  readonly locateReference: (reference: SideChatReference) => Promise<boolean>
  readonly retrySideChat: () => void
  /** Retry retained local edits without refreshing or discarding either page. */
  readonly retrySideChatSave: () => void
  /** Export local association and reference recovery data before closing this page. */
  readonly exportSideChatRecovery: () => void
  /** Open the panel through the plugin's own Host navigation path. */
  readonly openSideChat: () => void
  readonly closeSideChat: () => void
  /** Create one parallel chat and select it for subsequent confirmations. */
  readonly createSideChat: () => void
  /** Switch the receiving chat without touching either chat's collected references. */
  readonly selectSideChat: (sideChatId: SideChatId) => void
  /** Open one chat as the full Conversation page for its ordinary Session. */
  readonly openSideChatAlone: (sideChatId?: SideChatId) => void
  /** Expand or collapse the shared chip row inside the side composer. */
  readonly setReferencePanelOpen: (open: boolean) => void
}

/** Framework-bound side-chat data and localized controls. */
export type SideChatControlsProps = InjectFace<SideChatInjected> & PropsLocale<'dshAnnotation'>

/** Chip and record-panel props: the composer dock's own face and copy. */
export type SideChatDockProps = SideChatControlsProps

/** Truncated single-line summary used by the record row and the hover preview. */
function quoteSummary(reference: SideChatReference): string {
  const text = reference.quote.exact.replace(/\s+/gu, ' ').trim()
  return text === '' ? '—' : text
}

function ReferenceDetails({
  reference,
  ordinal,
  t,
}: {
  readonly reference: SideChatReference
  readonly ordinal: number
  readonly t: SideChatControlsProps['t']
}) {
  return (
    <div className="dia-annotation-details">
      <strong>{t('sideChat.referenceLabel', { ordinal })}</strong>
      <span className="dia-side-chat-record__source">
        {t('sideChat.referenceSource', { seq: reference.messageSeq })}
      </span>
      <q>{reference.quote.exact}</q>
    </div>
  )
}

/**
 * Shared record row: source label, ordinal, quote summary, and the annotation row's action geometry.
 * @param props - One pending occurrence and the actions the surrounding list allows.
 * @returns A hover-preview row without any permanent card frame.
 */
export function ReferenceRecord({
  reference,
  ordinal,
  disabled,
  removeReference,
  locateReference,
  t,
}: {
  readonly reference: SideChatReference
  readonly ordinal: number
  readonly disabled: boolean
  readonly removeReference?: SideChatInjected['removeReference']
  readonly locateReference: SideChatInjected['locateReference']
  readonly t: SideChatControlsProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationFailed, setLocationFailed] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const locatingNow = useRef(false)
  const explicitlyOpen = useRef(false)
  const previewId = useId()
  const quoteId = useId()
  const label = `${t('sideChat.referenceLabel', { ordinal })} · ${quoteSummary(reference)}`
  const record = useCallback(() => {
    const text = anchor.current
    const contextElement = text?.closest<HTMLElement>('.dia-record')
    return text == null || contextElement == null
      ? null
      : { rect: text.getBoundingClientRect(), contextElement }
  }, [])
  const composer = useCallback(
    () => composerInput(anchor.current)?.closest<HTMLElement>('[data-composer-card]') ?? null,
    [],
  )
  // The record panel supplies the visible conversation band; its inner list cannot clip a portal.
  const floating = useAnnotationFloating({
    enabled: open,
    floatingRef: panel,
    anchor: record,
    composer,
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const close = useCallback(() => {
    clearTimer()
    explicitlyOpen.current = false
    const restoreFocus = panel.current?.contains(document.activeElement) === true
    setOpen(false)
    if (restoreFocus)
      anchor.current?.querySelector<HTMLElement>('[data-dia-side-chat-preview-trigger]')?.focus()
  }, [clearTimer])
  const schedule = useCallback(
    (next: boolean, delay: number) => {
      clearTimer()
      if (!next && explicitlyOpen.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        setOpen(next)
      }, delay)
    },
    [clearTimer],
  )
  useDismissOnOutsidePointer(anchor, open, close, panel)
  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    document.addEventListener('keydown', dismiss, true)
    const observer = new MutationObserver(() => {
      if (anchor.current !== null && !rendered(anchor.current)) close()
    })
    for (let element: HTMLElement | null = anchor.current; element !== null; element = element.parentElement)
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'],
      })
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', dismiss, true)
    }
  }, [open, close])
  const locate = async (): Promise<void> => {
    if (locatingNow.current) return
    locatingNow.current = true
    setLocating(true)
    setLocationFailed(false)
    try {
      const found = await locateReference(reference)
      if (mounted.current) setLocationFailed(!found)
    } catch (_unavailableSource) {
      void _unavailableSource
      if (mounted.current) setLocationFailed(true)
    } finally {
      locatingNow.current = false
      if (mounted.current) setLocating(false)
    }
  }
  return (
    <>
      <div
        role="listitem"
        className="dia-record-row dia-side-chat-record"
        data-dia-side-chat-reference={reference.referenceId}
      >
        <span
          ref={anchor}
          className="dia-record-row__text"
          onPointerEnter={(event) => {
            if (
              event.pointerType === 'touch' ||
              (event.pointerType === 'mouse' && !window.matchMedia('(any-hover: hover)').matches)
            )
              return
            if (open) clearTimer()
            else schedule(true, 500)
          }}
          onPointerLeave={() => schedule(false, 200)}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              (!anchor.current?.contains(event.relatedTarget) &&
                !panel.current?.contains(event.relatedTarget))
            )
              close()
          }}
        >
          <span
            tabIndex={0}
            role="button"
            className="dia-record-row__preview-anchor"
            data-dia-side-chat-preview-trigger=""
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? previewId : undefined}
            onClick={() => {
              clearTimer()
              explicitlyOpen.current = !open
              setOpen(!open)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              clearTimer()
              explicitlyOpen.current = !open
              setOpen(!open)
            }}
          >
            <span className="dia-side-chat-record__ordinal" aria-hidden="true">
              {ordinal}
            </span>
            {!expanded && (
              <q id={quoteId} className="dia-side-chat-record__quote" data-expanded="false">
                {quoteSummary(reference)}
              </q>
            )}
            <span className="dia-side-chat-record__source">
              {t('sideChat.referenceSource', { seq: reference.messageSeq })}
            </span>
          </span>
          {expanded && (
            <q id={quoteId} className="dia-side-chat-record__quote" data-expanded="true" tabIndex={0}>
              {reference.quote.exact}
            </q>
          )}
        </span>
        <div className="dia-record-row__actions">
          <Tooltip label={expanded ? t('sideChat.collapse') : t('sideChat.expand')} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-record-action"
              aria-label={expanded ? t('sideChat.collapse') : t('sideChat.expand')}
              aria-expanded={expanded}
              aria-controls={quoteId}
              data-dia-side-chat-expand=""
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <IconChevronUpOutlineRegular size={15} />
              ) : (
                <IconChevronDownOutlineRegular size={15} />
              )}
            </button>
          </Tooltip>
          <Tooltip label={t('sideChat.locate')} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-record-action"
              aria-label={t('sideChat.locate')}
              data-dia-side-chat-locate=""
              disabled={locating}
              onClick={() => {
                void locate()
              }}
            >
              <IconLinkOutlineRegular size={15} />
            </button>
          </Tooltip>
          {removeReference !== undefined && (
            <Tooltip label={t('sideChat.remove')} side="top" delayMs={350}>
              <button
                type="button"
                className="dia-record-action"
                aria-label={t('sideChat.remove')}
                data-dia-side-chat-remove=""
                disabled={disabled}
                onClick={() => removeReference(reference.referenceId)}
              >
                <IconCloseOutlineRegular size={15} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {locationFailed && (
        <p className="dia-side-chat-notice" role="status" data-dia-side-chat-locate-failed="">
          {t('sideChat.locationFailed')}
        </p>
      )}
      {open &&
        createPortal(
          <MenuSurface
            ref={panel}
            id={previewId}
            role="dialog"
            aria-label={t('sideChat.referenceLabel', { ordinal })}
            tabIndex={0}
            className="dia-record-preview dia-side-chat-record-preview"
            style={floating.style}
            data-floating-placement={floating.placement}
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
            <ReferenceDetails reference={reference} ordinal={ordinal} t={t} />
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}

/** Shared count chip: the annotation chip's geometry with reference semantics. */
function CountChip({
  mainLabel,
  onMain,
  onRemoveAll,
  removeAllLabel,
  expanded,
  disabled,
  preview,
  widthAnchorRef,
}: {
  readonly mainLabel: string
  readonly onMain: () => void
  readonly onRemoveAll: () => void
  readonly removeAllLabel: string
  readonly expanded: boolean
  readonly disabled: boolean
  readonly preview: ReactNode
  readonly widthAnchorRef: import('react').RefObject<HTMLElement | null>
}) {
  return (
    <div className="dia-composer-chip dia-side-chat-chip">
      <HoverCard
        inline
        variant="preview"
        widthAnchorRef={widthAnchorRef}
        openDelayMs={0}
        anchor={
          <button
            type="button"
            className="dia-composer-chip__main"
            aria-expanded={expanded}
            aria-label={mainLabel}
            data-dia-side-chat-chip-main=""
            onClick={onMain}
          >
            <IconPaperclipOutlineRegular size={16} />
            <span>{mainLabel}</span>
          </button>
        }
        content={preview}
      />
      <span className="dia-composer-chip__actions">
        <span className="dia-composer-chip__actions-inner">
          <Tooltip label={removeAllLabel} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-composer-chip__remove"
              aria-label={removeAllLabel}
              disabled={disabled}
              data-dia-side-chat-remove-all=""
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                onRemoveAll()
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

function ChipPreview({
  references,
  locateReference,
  t,
}: {
  readonly references: readonly SideChatReference[]
  readonly locateReference: SideChatInjected['locateReference']
  readonly t: SideChatControlsProps['t']
}) {
  return (
    <div className="dia-composer-chip__preview" role="tooltip">
      {references.map((reference, index) => (
        <div className="dia-composer-chip__preview-row" key={reference.referenceId}>
          <strong>{t('sideChat.referenceLabel', { ordinal: index + 1 })}</strong>
          <q>{quoteSummary(reference)}</q>
          <Button
            size="sm"
            icon={<IconLinkOutlineRegular size={14} />}
            onClick={() => {
              void locateReference(reference)
            }}
          >
            {t('sideChat.locate')}
          </Button>
        </div>
      ))}
    </div>
  )
}

/**
 * The side composer's reference capsule, sharing the annotation chip's geometry.
 *
 * It counts only the pending references of this chat: annotations keep their own
 * capsule from the ordinary annotation flow, and the two sit in one shared row.
 * @param props - Chat state and localized labels.
 * @returns The capsule, or absence while no reference is pending.
 */
export function SideChatComposerChip({
  useSideChat,
  removeAllReferences,
  locateReference,
  setReferencePanelOpen,
  t,
}: SideChatDockProps) {
  const view = useSideChat((value) => value)
  const active = view?.active ?? null
  const references = active?.references ?? []
  const referencePanelOpen = active?.panelOpen === true
  const hasReferences = references.length > 0 && view?.status !== 'disposed'
  const rowRef = useComposerChipLayout(hasReferences)
  const composerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    composerRef.current = rowRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null
  }, [hasReferences])
  if (view === null || view.status === 'disposed' || references.length === 0) return null
  return (
    <div ref={rowRef} className="dia-side-chat-chip-row" data-dia-side-chat-chip-row="">
      <CountChip
        widthAnchorRef={composerRef}
        mainLabel={t('sideChat.referenceCount', { count: references.length })}
        disabled={view.saveState === 'conflict' || view.saveState === 'unavailable'}
        expanded={referencePanelOpen}
        onMain={() => setReferencePanelOpen(!referencePanelOpen)}
        onRemoveAll={() => removeAllReferences()}
        removeAllLabel={t('sideChat.removeAll')}
        preview={<ChipPreview references={references} locateReference={locateReference} t={t} />}
      />
    </div>
  )
}

/**
 * The collapsible record panel above the side composer: references first, and the
 * annotation records keep their own list from the ordinary annotation flow.
 * @param props - Chat state, panel visibility, and localized labels.
 * @returns The compact record panel, or absence while it is closed or empty.
 */
export function SideChatRecordPanel({
  useSideChat,
  removeReference,
  removeAllReferences,
  locateReference,
  setReferencePanelOpen,
  t,
}: SideChatDockProps) {
  const view = useSideChat((value) => value)
  const active = view?.active ?? null
  const referencePanelOpen = active?.panelOpen === true
  const listId = useId()
  if (view === null || view.status === 'disposed' || active === null) return null
  const references = active.references
  if (!referencePanelOpen || references.length === 0) return null
  return (
    <section
      id={listId}
      className="dia-record dia-side-chat-record-panel"
      aria-label={t('sideChat.referenceTitle')}
    >
      <div className="dia-record__body">
        <div className="dia-record__header">
          <button
            type="button"
            className="dia-record__heading-action"
            aria-controls={listId}
            aria-expanded={referencePanelOpen}
            onClick={() => setReferencePanelOpen(!referencePanelOpen)}
          >
            <span className="dia-record__lead" aria-hidden="true">
              <IconListPenOutlineRegular />
            </span>
            <span className="dia-record__title">{t('sideChat.referenceTitle')}</span>
          </button>
          <span className="dia-record__progress">
            {t('sideChat.referenceCount', { count: references.length })}
          </span>
          <Tooltip label={t('sideChat.removeAll')} side="top" delayMs={350}>
            <button
              type="button"
              className="dia-record__chevron dia-side-chat-remove-all"
              aria-label={t('sideChat.removeAll')}
              disabled={view.saveState === 'conflict' || view.saveState === 'unavailable'}
              data-dia-side-chat-panel-remove-all=""
              onClick={() => removeAllReferences()}
            >
              <IconCloseOutlineRegular size={14} />
            </button>
          </Tooltip>
          <Tooltip
            label={referencePanelOpen ? t('sideChat.collapsePanel') : t('sideChat.expandPanel')}
            side="top"
            delayMs={350}
          >
            <button
              type="button"
              className="dia-record__chevron"
              aria-label={referencePanelOpen ? t('sideChat.collapsePanel') : t('sideChat.expandPanel')}
              aria-controls={listId}
              aria-expanded={referencePanelOpen}
              onClick={() => setReferencePanelOpen(!referencePanelOpen)}
            >
              <IconChevronUpOutlineRegular />
            </button>
          </Tooltip>
        </div>
        <div role="list" className="dia-record__list">
          {references.map((reference, index) => (
            <ReferenceRecord
              key={reference.referenceId}
              reference={reference}
              ordinal={index + 1}
              disabled={view.saveState === 'conflict' || view.saveState === 'unavailable'}
              removeReference={removeReference}
              locateReference={locateReference}
              t={t}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/** Retained submission failure, save feedback, and its frozen question, above the composer. */
export function SideChatSubmissionNotice({
  useSideChat,
  retrySideChat,
  retrySideChatSave,
  exportSideChatRecovery,
  t,
}: SideChatControlsProps) {
  const view = useSideChat((value) => value)
  const active = view?.active ?? null
  if (view === null || view.status === 'disposed') return null
  const saveProblem = view.saveState !== 'saved'
  const failure = active?.failure ?? view.failure
  if (failure === null && active?.outbox == null && !saveProblem) return null
  const frozen =
    active != null &&
    active.outbox !== null &&
    (active.outbox.status === 'failed' ||
      active.outbox.status === 'unknown' ||
      active.failure?.code === 'frozen')
  return (
    <section className="dia-side-chat-references" data-dia-side-chat-notices="">
      {failure !== null && (
        <p className="dia-side-chat-notice" role="alert" data-dia-side-chat-failure={failure.code}>
          {t(`sideChat.failure.${failure.code}`)}
        </p>
      )}
      {frozen && <FrozenQuestion question={active.outbox!.payload.question} t={t} />}
      {failure !== null &&
        (failure.code === 'workspace' || failure.code === 'create' || failure.code === 'load') && (
          <Button size="sm" onClick={retrySideChat}>
            {t('sideChat.retry')}
          </Button>
        )}
      {view.saveState === 'merged' && (
        <p className="dia-side-chat-notice" role="status" data-dia-side-chat-save="merged">
          {t('sideChat.saveMergedNotice')}
        </p>
      )}
      {view.saveState === 'unavailable' && (
        <p className="dia-side-chat-notice" role="alert" data-dia-side-chat-save="unavailable">
          {t('sideChat.storageUnavailable')}
        </p>
      )}
      {view.saveState === 'conflict' && (
        <p className="dia-side-chat-notice" role="alert" data-dia-side-chat-save="conflict">
          {t(view.recoveryAvailable ? 'sideChat.saveConflictRetained' : 'sideChat.saveConflict')}
        </p>
      )}
      {(view.saveState === 'conflict' || view.saveState === 'unavailable') && (
        <div className="dia-side-chat-notice-actions">
          <Button size="sm" data-dia-side-chat-save-retry="" onClick={retrySideChatSave}>
            {t('sideChat.retrySave')}
          </Button>
          <Button size="sm" data-dia-side-chat-recovery-export="" onClick={exportSideChatRecovery}>
            {t('sideChat.exportRecovery')}
          </Button>
        </div>
      )}
    </section>
  )
}

function FrozenQuestion({
  question,
  t,
}: {
  readonly question: string
  readonly t: SideChatControlsProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const questionId = useId()
  return (
    <div className="dia-side-chat-frozen" data-dia-side-chat-frozen-question="" data-expanded={expanded}>
      <Button
        size="sm"
        aria-expanded={expanded}
        aria-controls={questionId}
        icon={
          expanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />
        }
        data-dia-side-chat-frozen-expand=""
        onClick={() => setExpanded(!expanded)}
      >
        {t('sideChat.frozenQuestion')}
      </Button>
      <p id={questionId} className="dia-side-chat-frozen__quote" data-expanded={expanded}>
        {question}
      </p>
    </div>
  )
}

/** Immutable references rendered beside the Host's ordinary submitted question. */
export interface SideChatHistoryReferencesProps {
  readonly references: readonly SideChatReference[]
  readonly onLocate: SideChatInjected['locateReference']
  readonly t: SideChatControlsProps['t']
}

/**
 * Show submitted exact quotes and source navigation without pending-list mutation actions.
 * @param props - Immutable submitted references, source navigation, and localized labels.
 * @returns The submitted reference summary, or absence for an empty batch.
 */
export function SideChatHistoryReferences({ references, onLocate, t }: SideChatHistoryReferencesProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const historyRef = useRef<HTMLElement>(null)
  if (references.length === 0) return null
  return (
    <section ref={historyRef} className="dia-timeline" data-dia-side-chat-history="" data-expanded={expanded}>
      <button
        type="button"
        className="dia-timeline__trigger"
        aria-controls={listId}
        aria-expanded={expanded}
        data-dia-side-chat-history-toggle=""
        onClick={() => setExpanded(!expanded)}
      >
        <IconPaperclipOutlineRegular size={16} aria-hidden="true" />
        <span>{t('sideChat.sentReferences', { count: references.length })}</span>
        <span className="dia-timeline__chevron" aria-hidden="true">
          <IconChevronDownOutlineRegular size={14} />
        </span>
      </button>
      {expanded && (
        <ol id={listId} className="dia-timeline__list">
          {references.map((reference, index) => (
            <li className="dia-timeline-item" key={reference.referenceId}>
              <span className="dia-timeline-item__index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="dia-timeline-item__content">
                <HoverCard
                  inline
                  variant="preview"
                  widthAnchorRef={historyRef}
                  openDelayMs={350}
                  anchor={<q>{quoteSummary(reference)}</q>}
                  content={
                    <div className="dia-composer-chip__preview" role="tooltip">
                      <strong>{t('sideChat.referenceLabel', { ordinal: index + 1 })}</strong>
                      <q>{reference.quote.exact}</q>
                    </div>
                  }
                />
              </div>
              <button
                type="button"
                className="dia-record-action dia-timeline-item__locate"
                aria-label={t('sideChat.locate')}
                data-dia-side-chat-history-locate=""
                onClick={() => void onLocate(reference)}
              >
                <IconLinkOutlineRegular size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** @param chat - One chat's list facts. @param fallbackLabel - Localized unnamed label. @returns Its list label. */
export function sideChatTarget(chat: SideChatChatView, label: string, selected: boolean): SideChatTarget {
  return Object.freeze({
    sideChatId: chat.sideChatId,
    label,
    references: chat.references.length,
    selected,
  })
}
