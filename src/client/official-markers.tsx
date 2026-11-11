import { createRoot } from 'react-dom/client'
import type { AnnotationDraft } from '../shared/types.ts'
import type { InputAnnotationProps } from './contract.ts'
import type { AnnotationController } from './controller.ts'
import type { HighlightManager } from './highlight.ts'
import { layoutMarkers, markerSize } from './marker-layout.ts'
import { AnnotationMarkerButton } from './components/AnnotationMarkerButton.tsx'
import { rendered, visibleBoundary } from './floating.ts'
import { sourceEndpoint, sourceObstacles } from './source-geometry.ts'
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
  nav.dataset.dshAnnotationIgnore = 'true'
  const originalPosition = root.style.position
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative'
  Object.assign(nav.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '8' })
  root.append(nav)
  const react = createRoot(nav)
  const owner = `official:${crypto.randomUUID()}`
  let frame = 0
  let disposed = false
  const sizeCache = new Map<string, ReturnType<typeof markerSize>>()
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
    const anchors: MarkerAnchor[] = []
    const frame = root.getBoundingClientRect()
    const scaleX = root.offsetWidth > 0 && frame.width > 0 ? frame.width / root.offsetWidth : 1
    const scaleY = root.offsetHeight > 0 && frame.height > 0 ? frame.height / root.offsetHeight : 1
    const targetSize = window.matchMedia?.('(pointer: coarse)').matches ? 44 : 24
    const localRect = (rect: MarkerRect): MarkerRect => ({
      left: (rect.left - frame.left) / scaleX + root.scrollLeft,
      right: (rect.right - frame.left) / scaleX + root.scrollLeft,
      top: (rect.top - frame.top) / scaleY + root.scrollTop,
      bottom: (rect.bottom - frame.top) / scaleY + root.scrollTop,
    })
    const boundary = localRect(visibleBoundary(root))
    if (rendered(root))
      for (const item of annotations) {
        const target = resolve(item)
        const selected: Range[] =
          target instanceof Range ? [target] : Array.isArray(target) ? [...target] : []
        if (selected.length > 0) ranges.set(item.annotationId, selected)
        if (target instanceof HTMLElement) {
          const range = document.createRange()
          range.selectNodeContents(target)
          selected.push(range)
        }
        const anchor = selected
          .toReversed()
          .map((range) => sourceEndpoint(range))
          .find((value) => value !== null)
        if (anchor === undefined) continue
        const context = anchor.contextElement
        if (!rendered(context)) continue
        const line = localRect(anchor.rect)
        anchors.push({
          annotationId: item.annotationId,
          ordinal: item.ordinal,
          line,
          ceiling: line.top >= boundary.top ? boundary.top : -targetSize,
          size: markerSize(context, item.ordinal, targetSize, sizeCache),
        })
      }
    highlights?.update(owner, [...ranges.values()].flat())
    const layout = layoutMarkers({
      anchors,
      bounds: {
        left: Math.max(root.scrollLeft, boundary.left),
        top: -targetSize,
        right: Math.min(root.scrollLeft + (root.clientWidth || frame.width), boundary.right),
        bottom: Math.max(...anchors.map((anchor) => anchor.line?.bottom ?? 0), 0),
      },
      targetSize,
      obstacles: sourceObstacles(root).map(localRect),
    })
    const groups: readonly MarkerGroup[] = layout.groups
    nav.style.height = `${layout.contentHeight ?? 0}px`
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
  const observer = new MutationObserver((changes) => {
    if (changes.some((change) => !nav.contains(change.target) && change.target !== nav)) schedule()
  })
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
  const fontsLoaded = () => {
    sizeCache.clear()
    schedule()
  }
  document.fonts?.addEventListener('loadingdone', fontsLoaded)
  void document.fonts?.ready.then(fontsLoaded)
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
    document.fonts?.removeEventListener('loadingdone', fontsLoaded)
    highlights?.remove(owner)
    react.unmount()
    nav.remove()
    root.style.position = originalPosition
  }
}
