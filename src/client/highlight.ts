const BASE_NAME = 'dsh-annotation'
const ACTIVE_NAME = 'dsh-annotation-active'

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
  private readonly active = new Map<string, Range>()

  update(messageId: string, ranges: readonly Range[]): void {
    const previous = this.ranges.get(messageId)
    if (
      previous !== undefined &&
      previous.length === ranges.length &&
      previous.every((range, index) => range === ranges[index])
    )
      return
    this.ranges.set(messageId, ranges)
    this.publishBase()
  }

  remove(messageId: string): void {
    const removedBase = this.ranges.delete(messageId)
    const removedActive = this.active.delete(messageId)
    if (removedBase) this.publishBase()
    if (removedActive) this.publishActive()
  }

  activate(messageId: string, range: Range | null): void {
    if ((this.active.get(messageId) ?? null) === range) return
    if (range === null) this.active.delete(messageId)
    else this.active.set(messageId, range)
    this.publishActive()
  }

  dispose(): void {
    this.ranges.clear()
    this.active.clear()
    const target = registry()
    target?.highlights.delete(BASE_NAME)
    target?.highlights.delete(ACTIVE_NAME)
  }

  supported(): boolean {
    return registry() !== null
  }

  private publishBase(): void {
    const target = registry()
    if (target === null) return
    const all = [...this.ranges.values()].flat()
    if (all.length === 0) target.highlights.delete(BASE_NAME)
    else target.highlights.set(BASE_NAME, new target.Highlight(...all))
  }

  private publishActive(): void {
    const target = registry()
    if (target === null) return
    if (this.active.size === 0) target.highlights.delete(ACTIVE_NAME)
    else target.highlights.set(ACTIVE_NAME, new target.Highlight(...this.active.values()))
  }
}
