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

export interface FocusChatAdapter {
  readonly active: boolean
  subscribe(listener: () => void): () => void
  /** 启动 DOM 观察；未安装聚焦视图时保持被动。 */
  start(): void
  dispose(): void
}

class FocusChatAdapterImpl implements FocusChatAdapter {
  private _active = false
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
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue
        if (mutation.target === document.body || this.liveRoot() !== null) {
          this.refresh()
          return
        }
      }
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
    this.refresh()
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
    this.listeners.clear()
  }

  private liveRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>(FOCUS_ROOT_SELECTOR)
  }

  private refresh(): void {
    const root = this.liveRoot()
    const next = root !== null && root.children.length > 0
    if (next === this._active) return
    this._active = next
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

/** 一个助手节点当前是否参与布局；仅在聚焦视图激活时才启用隐藏判断。 */
export function isFocusViewHidden(element: HTMLElement): boolean {
  const focusRoot = document.querySelector<HTMLElement>(FOCUS_ROOT_SELECTOR)
  if (focusRoot === null || focusRoot.children.length === 0) return false
  if (element.offsetParent === null) return true
  const rect = element.getBoundingClientRect()
  return rect.width === 0 && rect.height === 0
}

/** 当前是否处于聚焦视图，且该节点不在聚焦视图内（普通视图的重复节点）。 */
export function isDuplicatedByFocusView(element: HTMLElement): boolean {
  const root = element.closest<HTMLElement>(FOCUS_ROOT_SELECTOR)
  if (root !== null) return false
  const focusRoot = document.querySelector<HTMLElement>(FOCUS_ROOT_SELECTOR)
  return focusRoot !== null && focusRoot.children.length > 0
}

/** 全局聚焦切换通知：助手节点监听后重新测量标记与芯片。 */
export const FOCUS_CHANGED_EVENT = 'dsh-annotation:focus-changed'

export function createFocusChatAdapter(): FocusChatAdapter {
  return new FocusChatAdapterImpl()
}
