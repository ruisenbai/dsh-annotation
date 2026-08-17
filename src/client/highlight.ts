const BASE_NAME = 'dsh-inline-comment'
const ACTIVE_NAME = 'dsh-inline-comment-active'

interface HighlightRegistry {
  set(name: string, value: unknown): void
  delete(name: string): void
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown
}

function registry(): { highlights: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const css = globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistry }) | undefined
  const Highlight = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor }).Highlight
  return css?.highlights === undefined || Highlight === undefined
    ? null
    : { highlights: css.highlights, Highlight }
}

/** One plugin-wide CSS Custom Highlight owner; mounted message components contribute ranges. */
export class HighlightManager {
  private readonly ranges = new Map<string, readonly Range[]>()
  private active: { messageId: string; range: Range } | null = null

  update(messageId: string, ranges: readonly Range[]): void {
    this.ranges.set(messageId, ranges)
    this.publish()
  }

  remove(messageId: string): void {
    this.ranges.delete(messageId)
    if (this.active?.messageId === messageId) this.active = null
    this.publish()
  }

  activate(messageId: string, range: Range | null): void {
    this.active = range === null ? null : { messageId, range }
    this.publish()
  }

  dispose(): void {
    this.ranges.clear()
    this.active = null
    const target = registry()
    target?.highlights.delete(BASE_NAME)
    target?.highlights.delete(ACTIVE_NAME)
  }

  supported(): boolean {
    return registry() !== null
  }

  private publish(): void {
    const target = registry()
    if (target === null) return
    const all = [...this.ranges.values()].flat()
    if (all.length === 0) target.highlights.delete(BASE_NAME)
    else target.highlights.set(BASE_NAME, new target.Highlight(...all))
    if (this.active === null) target.highlights.delete(ACTIVE_NAME)
    else target.highlights.set(ACTIVE_NAME, new target.Highlight(this.active.range))
  }
}
