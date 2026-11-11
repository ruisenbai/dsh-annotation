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

interface NoticeBinding {
  readonly controller: NoticeController
  readonly hosts: Map<object, HTMLElement | null>
  readonly unsubscribe: () => void
  notice: AnnotationNotice | null
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

/** Render the latest new notice from mounted composers using its originating Session's anchor. */
export class AnnotationNoticeHub implements HostObservable<ActiveNotice> {
  private view: ActiveNotice = EMPTY_NOTICE
  private readonly listeners = new Set<() => void>()
  private readonly retired = new WeakMap<NoticeController, number>()
  private readonly bindings = new Map<NoticeController, NoticeBinding>()
  private active: NoticeBinding | undefined
  private disposed = false

  getSnapshot = (): ActiveNotice => this.view

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Bind one composer without replacing other mounted Sessions. Its last unmount retires the retained notice.
   * @param controller - Notice owner for the composer's Session.
   * @param anchor - This composer’s position and width anchor; null leaves Toast positioning to the Host.
   * @returns The disposer for this mount; older mount disposers cannot remove a newer mount.
   */
  activate(controller: NoticeController, anchor: HTMLElement | null): () => void {
    if (this.disposed) return () => undefined
    const token = {}
    let binding = this.bindings.get(controller)
    if (binding === undefined) {
      const sync = (): void => this.sync(controller)
      binding = {
        controller,
        hosts: new Map(),
        unsubscribe: controller.subscribe(sync),
        notice: null,
      }
      this.bindings.set(controller, binding)
    }
    binding.hosts.set(token, anchor)
    this.sync(controller)
    if (this.active === binding) this.publishActive(binding)
    return () => {
      const current = this.bindings.get(controller)
      if (current !== binding || !current.hosts.delete(token)) return
      if (current.hosts.size > 0) {
        if (this.active === current) this.publishActive(current)
        return
      }
      const notice = controller.getSnapshot().notice
      if (notice !== null) this.retired.set(controller, notice.id)
      current.unsubscribe()
      this.bindings.delete(controller)
      if (this.active === current) {
        this.active = undefined
        this.publish(EMPTY_NOTICE)
      }
    }
  }

  dismiss = (sessionId: SessionIdentity, id: number): void => {
    const active = this.active
    if (
      this.view.sessionId !== sessionId ||
      this.view.notice?.id !== id ||
      active?.controller.getSnapshot().notice?.id !== id
    )
      return
    this.retired.set(active.controller, id)
    active.controller.clearNotice(id)
  }

  runAction = (sessionId: SessionIdentity, id: number): void => {
    const active = this.active
    const notice = active?.controller.getSnapshot().notice
    if (
      active === undefined ||
      this.view.sessionId !== sessionId ||
      this.view.notice?.id !== id ||
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
    for (const binding of this.bindings.values()) binding.unsubscribe()
    this.bindings.clear()
    this.active = undefined
    this.view = EMPTY_NOTICE
    this.listeners.clear()
  }

  private sync(controller: NoticeController): void {
    const binding = this.bindings.get(controller)
    if (binding === undefined) return
    const notice = controller.getSnapshot().notice
    if (binding.notice === notice) return
    binding.notice = notice
    if (notice === null || notice.id === this.retired.get(controller)) {
      if (this.active === binding) {
        this.active = undefined
        this.publish(EMPTY_NOTICE)
      }
      return
    }
    this.active = binding
    this.publishActive(binding)
  }

  private publishActive(binding: NoticeBinding): void {
    const anchors = [...binding.hosts.values()]
    this.publish({
      sessionId: binding.controller.sessionId,
      notice: binding.notice,
      anchor: anchors[anchors.length - 1] ?? null,
    })
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

/** Match Toast width to its composer and hide it while that retained composer has no visible area. */
function useComposerToastWidth(marker: string | null, anchor: HTMLElement | null): void {
  const attached = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const card = composerCard(anchor)
    if (card === null || marker === null) return undefined
    let disposed = false
    let frame = 0
    const findToast = (): HTMLElement | null =>
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-dsh-annotation-toast-marker]'))
        .find((element) => element.dataset.dshAnnotationToastMarker === marker)
        ?.closest<HTMLElement>('[role="alert"]') ?? null
    const measure = (): void => {
      if (disposed || !card.isConnected) return
      const toast = attached.current ?? findToast()
      if (toast === null) {
        frame = requestAnimationFrame(measure)
        return
      }
      attached.current = toast
      toast.dataset.dshAnnotationToast = marker
      toast.setAttribute('aria-live', 'assertive')
      toast.setAttribute('aria-atomic', 'true')
      toast.style.boxSizing = 'border-box'
      const rect = card.getBoundingClientRect()
      toast.style.visibility =
        rect.width <= 0 || rect.right <= 0 || rect.left >= window.innerWidth ? 'hidden' : ''
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
      if (toast?.dataset.dshAnnotationToast === marker) {
        delete toast.dataset.dshAnnotationToast
        toast.removeAttribute('aria-live')
        toast.removeAttribute('aria-atomic')
        toast.style.removeProperty('box-sizing')
        toast.style.removeProperty('width')
        toast.style.removeProperty('max-width')
        toast.style.removeProperty('left')
        toast.style.removeProperty('visibility')
      }
      attached.current = null
    }
  }, [anchor, marker])
}

type ToastProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<AnnotationToastInjected>

/** Render the newest notice from mounted Sessions at its originating composer. */
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
  const marker = notice === null ? null : `${String(current.sessionId)}:${String(notice.id)}`
  useComposerToastWidth(marker, anchor)
  if (notice === null) return null
  return (
    <Toast
      key={`${String(notice.sessionId)}:${String(notice.id)}`}
      text={text}
      anchor={anchor}
      icon={
        <span
          className={`dia-toast-icon dia-toast-icon--${notice.level}`}
          data-dsh-annotation-toast-marker={marker}
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
