import { createRoot } from 'react-dom/client'
import type { AnnotationDraft } from '../shared/types.ts'
import type { InputAnnotationProps } from './contract.ts'
import type { AnnotationController } from './controller.ts'
import type { HighlightManager } from './highlight.ts'
import { layoutMarkers } from './marker-layout.ts'
import { AnnotationMarkerButton } from './components/AnnotationMarkerButton.tsx'
import { rangeAnchor, rendered, visibleBoundary } from './floating.ts'
import type { MarkerAnchor, MarkerGroup, MarkerRect } from './marker-layout.ts'

/** Derive official-source markers and CSS highlights from saved records on every mount or reflow. */
export function installOfficialMarkers(
  root: HTMLElement,
  controller: AnnotationController,
  matches: (item: AnnotationDraft) => boolean,
  resolve: (item: AnnotationDraft) => Range | readonly Range[] | HTMLElement | null,
  t: InputAnnotationProps['t'],
  highlights?: HighlightManager,
): () => void {
  const nav = document.createElement('nav')
  nav.className = 'dia-markers'
  nav.dataset.dshOfficialMarkers = ''
  nav.setAttribute('aria-label', t('list.title'))
  Object.assign(nav.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1100' })
  document.body.append(nav)
  const react = createRoot(nav)
  const owner = `official:${crypto.randomUUID()}`
  let frame = 0
  let disposed = false
  const schedule = (): void => {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      draw()
    })
  }
  const draw = (): void => {
    if (disposed) return
    if (!root.isConnected) {
      highlights?.update(owner, [])
      react.render(null)
      return
    }
    const view = controller.getSnapshot()
    const annotations = view.annotations.filter(matches)
    const ranges = new Map<string, readonly Range[]>()
    const regions = new Map<string, { bounds: MarkerRect; anchors: MarkerAnchor[] }>()
    if (rendered(root))
      for (const item of annotations) {
        const target = resolve(item)
        const selected = Array.isArray(target) ? target : target instanceof Range ? [target] : []
        if (selected.length > 0) ranges.set(item.annotationId, selected)
        const final = selected.at(-1)
        const anchor =
          final === undefined ? (target instanceof HTMLElement ? target : null) : rangeAnchor(final)
        if (anchor === null) continue
        const context = anchor instanceof HTMLElement ? anchor : anchor.contextElement
        if (!rendered(context)) continue
        const line = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor.rect
        const clipped = visibleBoundary(context)
        const frame = root.getBoundingClientRect()
        const bounds = {
          left: Math.max(clipped.left, frame.left) + 4,
          right: Math.min(clipped.right, frame.right) - 4,
          top: Math.max(clipped.top, frame.top) + 4,
          bottom: Math.min(clipped.bottom, frame.bottom) - 4,
        }
        if (
          line.bottom <= bounds.top ||
          line.top >= bounds.bottom ||
          line.right <= bounds.left ||
          line.left >= bounds.right
        )
          continue
        const key = `${bounds.left}:${bounds.top}:${bounds.right}:${bounds.bottom}`
        const region = regions.get(key) ?? { bounds, anchors: [] }
        region.anchors.push({ annotationId: item.annotationId, ordinal: item.ordinal, line })
        regions.set(key, region)
      }
    highlights?.update(owner, [...ranges.values()].flat())
    const groups: MarkerGroup[] = [...regions.values()].flatMap(
      ({ bounds, anchors }) => layoutMarkers({ anchors, bounds, targetSize: 26 }).groups,
    )
    react.render(
      groups.map((group) => (
        <AnnotationMarkerButton
          key={group.annotationIds[0]}
          group={group}
          annotations={annotations}
          t={t}
          activeId={view.activeAnnotationId}
          detailsOpen={false}
          editorOpen={view.editor !== null}
          onPreview={(id) => highlights?.activate(owner, id === null ? null : (ranges.get(id) ?? null))}
          onOpen={(item) =>
            controller.openAnnotation(item.annotationId, item.status === 'draft' ? 'marker-edit' : 'marker')
          }
        />
      )),
    )
  }
  const unsubscribe = controller.subscribe(schedule)
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
  for (let parent = root.parentElement; parent !== null; parent = parent.parentElement)
    observer.observe(parent, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'],
    })
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resize?.observe(root)
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
  void document.fonts?.ready.then(schedule)
  schedule()
  return () => {
    disposed = true
    if (frame !== 0) cancelAnimationFrame(frame)
    unsubscribe()
    observer.disconnect()
    resize?.disconnect()
    document.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('scroll', schedule)
    highlights?.remove(owner)
    react.unmount()
    nav.remove()
  }
}
