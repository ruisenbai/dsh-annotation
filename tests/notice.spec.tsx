// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationNoticeHub, AnnotationToastHost } from '../src/client/notice.tsx'
import type { AnnotationNotice, AnnotationView } from '../src/client/controller.ts'
import type { AnnotationLocaleKey } from '../src/client/locales.ts'
import type { SessionIdentity } from '../src/shared/types.ts'

class NoticeControllerFixture {
  private view: Pick<AnnotationView, 'notice'> = { notice: null }
  private readonly listeners = new Set<() => void>()
  private sequence = 0
  readonly clearNotice = vi.fn((id?: number) => {
    if (id !== undefined && this.view.notice?.id !== id) return
    this.view = { notice: null }
    this.publish()
  })
  readonly undoDelete = vi.fn(() => {
    this.show('error', 'trash.error.write')
    return false
  })

  constructor(readonly sessionId: SessionIdentity) {}

  readonly getSnapshot = (): Pick<AnnotationView, 'notice'> => this.view

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  show(
    level: AnnotationNotice['level'],
    messageKey: AnnotationLocaleKey,
    action?: AnnotationNotice['action'],
  ): AnnotationNotice {
    const notice: AnnotationNotice = {
      id: ++this.sequence,
      sessionId: this.sessionId,
      level,
      messageKey,
      ...(action === undefined ? {} : { action }),
    }
    this.view = { notice }
    this.publish()
    return notice
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

const messages: Partial<Record<AnnotationLocaleKey, string>> = {
  'notice.saved': 'Annotation saved',
  'notice.deleted': 'Annotations moved to the recycle bin',
  'trash.error.write': 'Saving failed. The annotations have been retained.',
  'list.undo': 'Undo',
}

const t = ((key: AnnotationLocaleKey) => messages[key] ?? key) as Parameters<
  typeof AnnotationToastHost
>[0]['t']

function appendComposer(
  left = 120,
  width = 420,
): { readonly card: HTMLElement; readonly anchor: HTMLElement } {
  const seat = document.createElement('div')
  seat.dataset.composerSeat = ''
  const anchor = document.createElement('span')
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  Object.defineProperty(card, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(left, 500, width, 80),
  })
  seat.append(anchor, card)
  document.body.append(seat)
  return { card, anchor }
}

function hostProps(hub: AnnotationNoticeHub): Parameters<typeof AnnotationToastHost>[0] {
  const injected = hub.inject()
  function useAnnotationToast<Selected>(
    selector: (view: ReturnType<AnnotationNoticeHub['getSnapshot']>) => Selected,
  ): Selected {
    return selector(useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot))
  }
  return {
    useAnnotationToast,
    dismissAnnotationNotice: injected.dismissAnnotationNotice,
    runAnnotationNoticeAction: injected.runAnnotationNoticeAction,
    t,
  } as unknown as Parameters<typeof AnnotationToastHost>[0]
}

function renderHost(hub: AnnotationNoticeHub) {
  return render(<AnnotationToastHost {...hostProps(hub)} />)
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('annotation notice host', () => {
  it('shows a new event once and ignores completion from an older event with the same text', async () => {
    const hub = new AnnotationNoticeHub()
    const controller = new NoticeControllerFixture('session-a' as SessionIdentity)
    const { anchor } = appendComposer()
    hub.activate(controller, anchor)
    renderHost(hub)

    const first = controller.show('success', 'notice.saved')
    expect(await screen.findByRole('alert')).toHaveTextContent('Annotation saved')
    const second = controller.show('success', 'notice.saved')
    expect(second.id).toBe(first.id + 1)
    hub.dismiss(controller.sessionId, first.id)
    expect(controller.clearNotice).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole('alert').querySelector('[data-dsh-annotation-toast-marker="2"]'),
      ).not.toBeNull(),
    )

    hub.dismiss(controller.sessionId, second.id)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(controller.clearNotice).toHaveBeenCalledExactlyOnceWith(second.id)
    hub.dispose()
  })

  it('isolates Sessions and does not replay a notice after its composer is remounted', async () => {
    const hub = new AnnotationNoticeHub()
    const first = new NoticeControllerFixture('session-a' as SessionIdentity)
    const second = new NoticeControllerFixture('session-b' as SessionIdentity)
    const { anchor } = appendComposer()
    const deactivateFirst = hub.activate(first, anchor)
    renderHost(hub)

    first.show('success', 'notice.saved')
    expect(await screen.findByText('Annotation saved')).toBeInTheDocument()
    const deactivateSecond = hub.activate(second, anchor)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    second.show('error', 'trash.error.write')
    expect(await screen.findByText('Saving failed. The annotations have been retained.')).toBeInTheDocument()

    deactivateSecond()
    hub.activate(first, anchor)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    deactivateFirst()
    hub.dispose()
  })

  it('ignores stale completion and action callbacks from another Session with the same notice id', () => {
    const hub = new AnnotationNoticeHub()
    const first = new NoticeControllerFixture('session-a' as SessionIdentity)
    const second = new NoticeControllerFixture('session-b' as SessionIdentity)
    const { anchor } = appendComposer()
    hub.activate(first, anchor)
    const oldNotice = first.show('success', 'notice.deleted', {
      kind: 'undo-delete',
      labelKey: 'list.undo',
    })
    hub.activate(second, anchor)
    const currentNotice = second.show('success', 'notice.deleted', {
      kind: 'undo-delete',
      labelKey: 'list.undo',
    })
    expect(currentNotice.id).toBe(oldNotice.id)

    hub.dismiss(first.sessionId, oldNotice.id)
    hub.runAction(first.sessionId, oldNotice.id)
    expect(second.clearNotice).not.toHaveBeenCalled()
    expect(second.undoDelete).not.toHaveBeenCalled()

    hub.runAction(second.sessionId, currentNotice.id)
    expect(second.undoDelete).toHaveBeenCalledOnce()
    hub.dispose()
  })

  it('keeps the root toast mounted when the originating panel closes and exposes live-region semantics', async () => {
    const hub = new AnnotationNoticeHub()
    const controller = new NoticeControllerFixture('session-a' as SessionIdentity)
    const { anchor } = appendComposer()
    hub.activate(controller, anchor)
    const host = renderHost(hub)
    const panel = document.createElement('aside')
    panel.dataset.sourcePanel = ''
    document.body.append(panel)

    controller.show('success', 'notice.saved')
    const alert = await screen.findByRole('alert')
    panel.remove()
    host.rerender(<AnnotationToastHost {...hostProps(hub)} />)
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(alert).toHaveAttribute('aria-atomic', 'true')
    hub.dispose()
  })

  it('runs undo through the active Session and replaces a failed undo with its error event', async () => {
    const hub = new AnnotationNoticeHub()
    const controller = new NoticeControllerFixture('session-a' as SessionIdentity)
    const { anchor } = appendComposer()
    hub.activate(controller, anchor)
    renderHost(hub)

    controller.show('success', 'notice.deleted', { kind: 'undo-delete', labelKey: 'list.undo' })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(controller.undoDelete).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saving failed. The annotations have been retained.',
    )
    hub.dispose()
  })

  it('aligns the Toast width and center to the composer card without changing its layout', async () => {
    const hub = new AnnotationNoticeHub()
    const controller = new NoticeControllerFixture('session-a' as SessionIdentity)
    const { card, anchor } = appendComposer(80, 480)
    const before = card.getBoundingClientRect()
    hub.activate(controller, anchor)
    renderHost(hub)

    controller.show('success', 'notice.saved')
    const alert = await screen.findByRole('alert')
    await waitFor(() => {
      expect(alert.style.boxSizing).toBe('border-box')
      expect(alert.style.width).toBe('480px')
      expect(alert.style.maxWidth).toBe('480px')
      expect(alert.style.left).toBe('320px')
    })
    expect(card.getBoundingClientRect()).toEqual(before)
    hub.dispose()
  })
})
