/** Layout measurements for annotation and reference capsules inside the official input overlay. */
import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Reserve only the capsule height rendered in this composer, including container wrapping.
 * @param visible - Whether this occurrence has a capsule; false releases all observers and padding.
 * @returns The capsule element ref. No draft, selection or input focus is changed.
 */
export function useComposerChipLayout(visible: boolean): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!visible) return undefined
    const chip = ref.current
    const overlay = chip?.closest<HTMLElement>('[data-composer-overlay]')
    const card = overlay?.closest<HTMLElement>('[data-composer-card]')
    if (chip == null || overlay == null || card == null) return undefined
    const measure = (): void => {
      const capsules = [...overlay.querySelectorAll<HTMLElement>('.dia-composer-chip')]
      const slotWidth =
        (overlay.clientWidth - Math.max(0, capsules.length - 1) * 6) / Math.max(1, capsules.length)
      for (const capsule of capsules) {
        const actions = capsule.querySelector<HTMLElement>('.dia-composer-chip__actions-inner')
        const width = `${Math.max(36, slotWidth - (actions?.scrollWidth ?? 0))}px`
        if (capsule.style.getPropertyValue('--dia-chip-main-width') !== width)
          capsule.style.setProperty('--dia-chip-main-width', width)
      }
      const bounds = overlay.getBoundingClientRect()
      const chips = [
        ...overlay.querySelectorAll<HTMLElement>('[data-dia-annotation-chip], [data-dia-side-chat-chip-row]'),
      ]
      const bottom = Math.max(
        bounds.top,
        ...chips
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.getBoundingClientRect().bottom),
      )
      // DOMRects include zoom; CSS padding uses the element's unzoomed coordinates.
      const zoom = overlay.offsetWidth > 0 ? bounds.width / overlay.offsetWidth : 1
      // CSS-pixel rounding keeps fractional measurements from feeding height changes
      // back into the sticky composer and the record rows above it.
      const height = Math.max(0, Math.round((bottom - bounds.top) / (zoom || 1))) + 4
      const space = `${height}px`
      if (card.style.getPropertyValue('--dia-composer-chip-space') !== space)
        card.style.setProperty('--dia-composer-chip-space', space)
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(overlay)
    resize?.observe(card)
    const changed = new MutationObserver(measure)
    changed.observe(overlay, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      resize?.disconnect()
      changed.disconnect()
      window.removeEventListener('resize', measure)
      if (!overlay.querySelector('[data-dia-annotation-chip], [data-dia-side-chat-chip-row]'))
        card.style.removeProperty('--dia-composer-chip-space')
    }
  }, [visible])
  return ref
}
