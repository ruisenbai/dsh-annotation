/** Root-level annotation notices rendered through the official Toast primitive. */
import { useLayoutEffect, useRef } from 'react'
import {
  IconCheckCircleOutlineRegular,
  IconInfoOutlineRegular,
  IconWarningOutlineRegular,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnnotationNotice, AnnotationView } from './controller.ts'
import type { SessionIdentity } from '../shared/types.ts'

interface NoticeController {
  readonly sessionId: SessionIdentity
  readonly getSnapshot: () => Pick<AnnotationView, 'notice'>
  readonly subscribe: (listener: () => void) => () => void
  readonly clearNotice: (id?: number) => void
  readonly undoDelete: () => boolean
}

interface ActiveNotice {
  readonly sessionId: SessionIdentity
  readonly notice: AnnotationNotice | null
  readonly anchor: HTMLElement | null
}

const EMPTY_NOTICE: ActiveNotice = Object.freeze({
  sessionId: '' as SessionIdentity,
  notice: null,
  anchor: null,
})

/** Registration face for the plugin-wide Toast host. */
export interface AnnotationToastInjected {
  readonly hooks: { readonly annotationToast: HostObservable<ActiveNotice> }
  readonly dismissAnnotationNotice: (sessionId: SessionIdentity, id: number) => void
  readonly runAnnotationNoticeAction: (sessionId: SessionIdentity, id: number) => void
}

/** Select the current Session's notice without retaining notices from another Session. */
export class AnnotationNoticeHub implements HostObservable<ActiveNotice> {
  private view: ActiveNotice = EMPTY_NOTICE
  private readonly listeners = new Set<() => void>()
  private readonly retired = new WeakMap<NoticeController, number>()
  private active:
    | {
        readonly token: object
        readonly controller: NoticeController
        readonly sessionId: SessionIdentity
        readonly anchor: HTMLElement | null
        readonly unsubscribe: () => void
      }
    | undefined
  private disposed = false

  getSnapshot = (): ActiveNotice => this.view

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Bind the currently rendered composer so notices stay Session-local and can share its width. */
  activate(controller: NoticeController, anchor: HTMLElement | null): () => void {
    if (this.disposed) return () => undefined
    const token = {}
    this.retireActive()
    const sync = (): void => {
      if (this.active?.token !== token) return
      const notice = controller.getSnapshot().notice
      this.publish({
        sessionId: controller.sessionId,
        notice: notice?.id === this.retired.get(controller) ? null : notice,
        anchor,
      })
    }
    const unsubscribe = controller.subscribe(sync)
    this.active = { token, controller, sessionId: controller.sessionId, anchor, unsubscribe }
    sync()
    return () => {
      if (this.active?.token !== token) return
      const notice = controller.getSnapshot().notice
      if (notice !== null) this.retired.set(controller, notice.id)
      unsubscribe()
      this.active = undefined
      this.publish(EMPTY_NOTICE)
    }
  }

  dismiss = (sessionId: SessionIdentity, id: number): void => {
    const active = this.active
    if (active?.sessionId !== sessionId || active.controller.getSnapshot().notice?.id !== id) return
    this.retired.set(active.controller, id)
    active.controller.clearNotice(id)
  }

  runAction = (sessionId: SessionIdentity, id: number): void => {
    const active = this.active
    const notice = active?.controller.getSnapshot().notice
    if (
      active === undefined ||
      active.sessionId !== sessionId ||
      notice?.id !== id ||
      notice.action === undefined
    )
      return
    switch (notice.action.kind) {
      case 'undo-delete':
        active.controller.undoDelete()
        return
    }
  }

  inject(): AnnotationToastInjected {
    return {
      hooks: { annotationToast: this },
      dismissAnnotationNotice: this.dismiss,
      runAnnotationNoticeAction: this.runAction,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.retireActive()
    this.view = EMPTY_NOTICE
    this.listeners.clear()
  }

  private retireActive(): void {
    const active = this.active
    if (active === undefined) return
    const notice = active.controller.getSnapshot().notice
    if (notice !== null) this.retired.set(active.controller, notice.id)
    active.unsubscribe()
    this.active = undefined
  }

  private publish(next: ActiveNotice): void {
    if (this.disposed || this.view === next) return
    if (
      this.view.sessionId === next.sessionId &&
      this.view.notice === next.notice &&
      this.view.anchor === next.anchor
    )
      return
    this.view = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
}

function composerCard(anchor: HTMLElement | null): HTMLElement | null {
  if (anchor === null) return null
  const direct = anchor.closest<HTMLElement>('[data-composer-card]')
  if (direct !== null) return direct
  const seat = anchor.closest<HTMLElement>('[data-composer-seat]')
  return seat?.querySelector<HTMLElement>('[data-composer-card]') ?? seat ?? anchor
}

/** Match the body-portaled Toast to the composer width without changing Host layout. */
function useComposerToastWidth(id: number, anchor: HTMLElement | null): void {
  const attached = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const card = composerCard(anchor)
    if (card === null) return undefined
    let disposed = false
    let frame = 0
    const findToast = (): HTMLElement | null =>
      document.body
        .querySelector<HTMLElement>(`[data-dsh-annotation-toast-marker="${String(id)}"]`)
        ?.closest<HTMLElement>('[role="alert"]') ?? null
    const measure = (): void => {
      if (disposed || !card.isConnected) return
      const toast = attached.current ?? findToast()
      if (toast === null) {
        frame = requestAnimationFrame(measure)
        return
      }
      attached.current = toast
      toast.dataset.dshAnnotationToast = String(id)
      toast.setAttribute('aria-live', 'assertive')
      toast.setAttribute('aria-atomic', 'true')
      toast.style.boxSizing = 'border-box'
      const rect = card.getBoundingClientRect()
      const width = Math.max(0, Math.min(rect.width, window.innerWidth - 48))
      toast.style.width = `${width}px`
      toast.style.maxWidth = `${width}px`
      toast.style.left = `${rect.left + rect.width / 2}px`
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(card)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      const toast = attached.current
      if (toast?.dataset.dshAnnotationToast === String(id)) {
        delete toast.dataset.dshAnnotationToast
        toast.removeAttribute('aria-live')
        toast.removeAttribute('aria-atomic')
        toast.style.removeProperty('box-sizing')
        toast.style.removeProperty('width')
        toast.style.removeProperty('max-width')
        toast.style.removeProperty('left')
      }
      attached.current = null
    }
  }, [anchor, id])
}

type ToastProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<AnnotationToastInjected>

/** Render one deduplicated notice for the currently mounted Session. */
export function AnnotationToastHost({
  useAnnotationToast,
  dismissAnnotationNotice,
  runAnnotationNoticeAction,
  t,
}: ToastProps) {
  const current = useAnnotationToast((value) => value)
  const notice = current.notice
  const text = notice === null ? '' : t(notice.messageKey, notice.params)
  const anchor = composerCard(current.anchor)
  useComposerToastWidth(notice?.id ?? 0, anchor)
  if (notice === null) return null
  return (
    <Toast
      key={`${String(notice.sessionId)}:${String(notice.id)}`}
      text={text}
      anchor={anchor}
      icon={
        <span
          className={`dia-toast-icon dia-toast-icon--${notice.level}`}
          data-dsh-annotation-toast-marker={notice.id}
        >
          {notice.level === 'success' ? (
            <IconCheckCircleOutlineRegular />
          ) : notice.level === 'error' ? (
            <IconWarningOutlineRegular />
          ) : (
            <IconInfoOutlineRegular />
          )}
        </span>
      }
      {...(notice.action === undefined
        ? {}
        : {
            holdMs: 6000,
            actions: [
              {
                label: t(notice.action.labelKey),
                onClick: () => runAnnotationNoticeAction(current.sessionId, notice.id),
              },
            ],
          })}
      onDone={() => dismissAnnotationNotice(current.sessionId, notice.id)}
    />
  )
}
