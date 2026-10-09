/** DOM readiness for a mounted file or Diff whose pages can arrive after navigation. */
import type { AnnotationController } from './controller.ts'

/** Result of inspecting a mounted source while its content can still arrive. */
export type SourceTargetRead<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'pending' }
  | { readonly status: 'unmatched' }

/** Target or terminal reason for a source navigation. */
export type SourceTargetResult<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'unmatched' | 'unavailable' | 'cancelled' }

/**
 * Wait for a source target while retaining why its range could not be shown.
 * @param root - Mounted source view.
 * @param read - Inspect its current content and report whether the reference can be matched.
 * @param controller - Owner of the current navigation epoch.
 * @param epoch - Navigation that requested this range.
 * @param signal - Lifetime of this mounted source.
 * @returns Target or terminal navigation result.
 */
export function waitForSourceTargetResult<T>(
  root: HTMLElement,
  read: () => SourceTargetRead<T>,
  controller: AnnotationController,
  epoch: number,
  signal: AbortSignal,
): Promise<SourceTargetResult<T>> {
  const inspect = (): SourceTargetResult<T> | null => {
    if (controller.getSnapshot().navigationEpoch !== epoch) return { status: 'cancelled' }
    if (signal.aborted || !root.isConnected) return { status: 'unavailable' }
    const current = read()
    return current.status === 'pending' ? null : current
  }
  const current = inspect()
  if (current !== null) return Promise.resolve(current)
  return new Promise((resolve) => {
    let finished = false
    const complete = (value: SourceTargetResult<T>): void => {
      if (finished) return
      finished = true
      observer.disconnect()
      unsubscribe()
      clearTimeout(limit)
      signal.removeEventListener('abort', check)
      resolve(value)
    }
    const check = (): void => {
      const value = inspect()
      if (value !== null) complete(value)
    }
    const observer = new MutationObserver(check)
    const unsubscribe = controller.subscribe(check)
    const limit = setTimeout(() => complete({ status: 'unavailable' }), 10_000)
    signal.addEventListener('abort', check, { once: true })
    observer.observe(root.ownerDocument.body, { childList: true, subtree: true, characterData: true })
    check()
  })
}

/**
 * Wait for the complete source range, cancelling when its view or navigation disappears.
 * @param root - Mounted source view.
 * @param read - Rebuild the complete range; null means its DOM is not ready.
 * @param controller - Owner of the current navigation epoch.
 * @param epoch - Navigation that requested this range.
 * @param signal - Lifetime of this mounted source.
 * @returns Resolved target, or null after cancellation, removal, or an unavailable range.
 */
export function waitForSourceTarget<T>(
  root: HTMLElement,
  read: () => T | null,
  controller: AnnotationController,
  epoch: number,
  signal: AbortSignal,
): Promise<T | null> {
  return waitForSourceTargetResult(
    root,
    () => {
      const value = read()
      return value === null ? { status: 'pending' } : { status: 'ready', value }
    },
    controller,
    epoch,
    signal,
  ).then((result) => (result.status === 'ready' ? result.value : null))
}
