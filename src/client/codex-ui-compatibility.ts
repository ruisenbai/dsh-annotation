/** Optional Codex UI styling follows its live slot registrations, including unloads. */
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

interface CompatibilitySlots {
  readonly entries: (name: 'sidebar' | 'conversation.input.dock') => readonly StoredEntry[]
  readonly subscribe: (listener: (name: string) => void) => () => void
}

const ATTRIBUTE = 'data-dsh-annotation-compatibility'

/**
 * Enable scoped annotation styles while the installed Codex UI client is active.
 * @param slots Live slot entries and change notifications owned by the client context.
 * @param root Document root carrying the annotation-only compatibility attribute.
 * @returns Cleanup that unsubscribes and restores the previous attribute value.
 */
export function installCodexUiCompatibility(slots: CompatibilitySlots, root: HTMLElement): () => void {
  const previous = root.getAttribute(ATTRIBUTE)
  const update = (): void => {
    const active =
      slots.entries('sidebar').some((entry) => entry.registrant === 'michengai-codex-ui') ||
      slots.entries('conversation.input.dock').some((entry) => entry.options.id === 'codex-ui-input-history')
    if (active) {
      if (root.getAttribute(ATTRIBUTE) !== 'codex-ui') root.setAttribute(ATTRIBUTE, 'codex-ui')
    } else if (root.getAttribute(ATTRIBUTE) === 'codex-ui') root.removeAttribute(ATTRIBUTE)
  }
  const unsubscribe = slots.subscribe((name) => {
    if (name === 'sidebar' || name === 'conversation.input.dock') update()
  })
  update()
  return () => {
    unsubscribe()
    if (previous === null) root.removeAttribute(ATTRIBUTE)
    else root.setAttribute(ATTRIBUTE, previous)
  }
}
