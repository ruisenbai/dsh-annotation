/**
 * 可选兼容层：dsh-focus-chat（聚焦会话视图）。
 *
 * 兼容原则：只作为可选增强，绝不成为依赖。
 * - 通过公开的 DOM 标记检测聚焦视图根节点，不注入、不等待任何服务；
 * - 未安装或检测失败时适配层保持被动，核心注解功能不受影响；
 * - 任何适配错误只关闭聚焦增强，不阻止插件启动。
 */

/** 聚焦视图根节点的公开 DOM 标记（dsh-focus-chat 挂载其会话视图于此）。 */
const FOCUS_ROOT_SELECTOR = '[data-focus-flow]'

function sessionIdentity(element: HTMLElement): string | undefined {
  const owner = element.closest<HTMLElement>('[data-dsh-annotation-session-id], [data-conversation-session]')
  return owner?.dataset.dshAnnotationSessionId ?? owner?.dataset.conversationSession
}

function focusedCopy(element: HTMLElement): HTMLElement | null {
  const sessionId = sessionIdentity(element)
  const messageId = element.dataset.dshAnnotationMessageId
  if (sessionId === undefined || messageId === undefined) return null
  return (
    Array.from(
      element.ownerDocument.querySelectorAll<HTMLElement>(
        `${FOCUS_ROOT_SELECTOR} [data-dsh-annotation-message-id]`,
      ),
    ).find(
      (candidate) =>
        sessionIdentity(candidate) === sessionId && candidate.dataset.dshAnnotationMessageId === messageId,
    ) ?? null
  )
}

export interface FocusChatAdapter {
  readonly active: boolean
  subscribe(listener: () => void): () => void
  /** 启动 DOM 观察；未安装聚焦视图时保持被动。 */
  start(): void
  dispose(): void
}

class FocusChatAdapterImpl implements FocusChatAdapter {
  private _active = false
  private copies = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private observer: MutationObserver | null = null

  get active(): boolean {
    return this._active
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 启动 DOM 观察；聚焦根出现或消失时通知订阅者重新测量。 */
  start(): void {
    if (this.observer !== null || typeof MutationObserver === 'undefined') return
    this.observer = new MutationObserver(() => this.refresh())
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-focus-flow',
        'data-dsh-annotation-message-id',
        'data-dsh-annotation-session-id',
        'data-conversation-session',
      ],
    })
    this.refresh()
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
    this.copies.clear()
    this.listeners.clear()
  }

  private liveRoot(): HTMLElement | null {
    return (
      Array.from(document.querySelectorAll<HTMLElement>(FOCUS_ROOT_SELECTOR)).find(
        (root) => root.children.length > 0,
      ) ?? null
    )
  }

  private refresh(): void {
    const root = this.liveRoot()
    const next = root !== null && root.children.length > 0
    const copies = new Set(
      Array.from(
        document.querySelectorAll<HTMLElement>(`${FOCUS_ROOT_SELECTOR} [data-dsh-annotation-message-id]`),
      )
        .map((element) => {
          const sessionId = sessionIdentity(element)
          const messageId = element.dataset.dshAnnotationMessageId
          return sessionId === undefined || messageId === undefined
            ? null
            : JSON.stringify([sessionId, messageId])
        })
        .filter((identity) => identity !== null),
    )
    if (
      next === this._active &&
      copies.size === this.copies.size &&
      [...copies].every((identity) => this.copies.has(identity))
    )
      return
    this._active = next
    this.copies = copies
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[dsh-annotation] focus adapter listener failed:', error)
      }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FOCUS_CHANGED_EVENT))
    }
  }
}

/** 聚焦视图根节点的公开选择器；页面适配使用，核心逻辑不直接依赖它。 */
export const FOCUS_ROOT_SELECTOR_VALUE = FOCUS_ROOT_SELECTOR

/** 仅当同一 Session 的同一消息存在聚焦副本时，检查该节点是否参与布局。 */
export function isFocusViewHidden(element: HTMLElement): boolean {
  if (focusedCopy(element) === null) return false
  if (element.offsetParent === null) return true
  const rect = element.getBoundingClientRect()
  return rect.width === 0 && rect.height === 0
}

/** 同一 Session 的同一消息存在聚焦副本时，普通视图节点才是重复节点。 */
export function isDuplicatedByFocusView(element: HTMLElement): boolean {
  const root = element.closest<HTMLElement>(FOCUS_ROOT_SELECTOR)
  if (root !== null) return false
  return focusedCopy(element) !== null
}

/** 聚焦活动或 Session/消息副本集合变化时，助手节点重新测量标记与芯片。 */
export const FOCUS_CHANGED_EVENT = 'dsh-annotation:focus-changed'

export function createFocusChatAdapter(): FocusChatAdapter {
  return new FocusChatAdapterImpl()
}
