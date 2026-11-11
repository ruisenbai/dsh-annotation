// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationMarkerButton } from '../src/client/components/AnnotationMarkerButton.tsx'
import { installOfficialMarkers } from '../src/client/official-markers.tsx'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { AnnotationDraft, AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'

const releases: (() => void)[] = []
let originalFont = ''
beforeEach(() => {
  originalFont = document.body.style.fontSize
  document.body.style.fontSize = '16px'
  vi.stubGlobal('CSS', { ...globalThis.CSS, supports: () => false })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  cleanup()
  act(() => {
    for (const release of releases.splice(0).reverse()) release()
  })
  document.body.replaceChildren()
  document.body.style.fontSize = originalFont
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function annotation(ordinal: number): AnnotationDraft {
  return {
    annotationId: `marker-${ordinal}` as AnnotationId,
    ordinal,
    messageId: 'marker-message' as MessageIdentity,
    messageSeq: 1,
    responseVersion: 'marker-message' as MessageIdentity,
    quote: { exact: 'alpha', prefix: '', suffix: '', start: 0, end: 5 },
    annotation: `Comment ${ordinal}`,
    kind: 'note',
    status: 'draft',
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('official source markers', () => {
  it('opens identical selections as separate numbered buttons without a choice menu', () => {
    const annotations = [annotation(1), annotation(2), annotation(3)]
    const open = vi.fn()
    const preview = vi.fn()
    render(
      <>
        {annotations.map((item, index) => (
          <AnnotationMarkerButton
            key={item.annotationId}
            group={{
              annotationIds: [item.annotationId],
              top: 40 + index * 28,
              left: 40,
              width: 24,
              height: 24,
              fontSize: 12,
            }}
            annotations={annotations}
            t={(key) => key}
            activeId={annotations[1]!.annotationId}
            detailsOpen={false}
            editorOpen={false}
            onPreview={preview}
            onOpen={open}
          />
        ))}
      </>,
    )
    for (const item of annotations) {
      const button = screen.getByRole('button', { name: `#${item.ordinal}: Comment ${item.ordinal}` })
      fireEvent.focus(button)
      expect(preview).toHaveBeenLastCalledWith(item.annotationId)
      fireEvent.click(button)
      expect(open).toHaveBeenLastCalledWith(item)
    }
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.querySelectorAll('.dia-marker')).toHaveLength(3)
    expect(document.querySelector('[data-active="true"]')).toHaveAttribute(
      'data-annotation-id',
      annotations[1]!.annotationId,
    )
  })

  it('removes only the deleted record and retains the other marker identities', () => {
    const annotations = [annotation(1), annotation(2)]
    const buttons = (items: AnnotationDraft[]) => (
      <>
        {items.map((item) => (
          <AnnotationMarkerButton
            key={item.annotationId}
            group={{
              annotationIds: [item.annotationId],
              top: item.ordinal * 28,
              left: 40,
              width: 24,
              height: 24,
              fontSize: 12,
            }}
            annotations={items}
            t={(key) => key}
            activeId={null}
            detailsOpen={false}
            editorOpen={false}
            onPreview={() => undefined}
            onOpen={() => undefined}
          />
        ))}
      </>
    )
    const { rerender, unmount } = render(buttons(annotations))
    rerender(buttons([annotations[1]!]))
    expect(document.querySelectorAll('.dia-marker')).toHaveLength(1)
    expect(document.querySelector('.dia-marker')).toHaveAttribute(
      'data-annotation-id',
      annotations[1]!.annotationId,
    )
    unmount()
    expect(document.querySelector('.dia-marker')).toBeNull()
  })

  it('tracks character endpoints through scrolling without changing source padding', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const draw = async () => {
      await act(async () => {
        await Promise.resolve()
        const queued = [...frames.values()]
        frames.clear()
        queued.forEach((callback) => callback(0))
      })
    }
    const values = new Map<string, string>()
    const session = 'marker-session' as SessionIdentity
    const owner = new AnnotationController(
      session,
      new AnnotationStorage(
        {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => {
            values.set(key, value)
          },
          removeItem: (key) => {
            values.delete(key)
          },
        },
        session,
      ),
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
    )
    releases.push(() => owner.dispose())
    const record = annotation(1)
    owner.beginSelection({
      messageId: record.messageId!,
      messageSeq: 1,
      responseVersion: record.responseVersion!,
      quote: record.quote,
      rect: { top: 150, left: 300, right: 310, bottom: 170 },
    })
    owner.updateEditorText('Comment')
    owner.saveEditor()
    const root = document.createElement('div')
    root.style.overflowY = 'auto'
    root.style.overflowX = 'auto'
    root.getBoundingClientRect = () => new DOMRect(100, 200, 400, 200)
    const target = document.createElement('span')
    let rectangle = new DOMRect(300, 150, 10, 20)
    target.getBoundingClientRect = () => rectangle
    const oldRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rectangle] })
    releases.push(() => {
      if (oldRects === undefined) Reflect.deleteProperty(Range.prototype, 'getClientRects')
      else Object.defineProperty(Range.prototype, 'getClientRects', oldRects)
    })
    target.textContent = 'alpha'
    root.append(target)
    document.body.append(root)
    act(() =>
      releases.push(
        installOfficialMarkers(
          root,
          owner,
          () => true,
          () => target,
          (key) => key,
        ),
      ),
    )
    await draw()
    expect(root.querySelector('.dia-marker')).not.toBeNull()
    expect(root.style.paddingRight).toBe('')
    rectangle = new DOMRect(300, 250, 10, 20)
    document.dispatchEvent(new Event('scroll'))
    await draw()
    expect(document.querySelector('.dia-marker')).not.toBeNull()
    rectangle = new DOMRect(480, 250, 10, 20)
    document.dispatchEvent(new Event('scroll'))
    await draw()
    expect(root.querySelector('.dia-marker')).not.toBeNull()
    rectangle = new DOMRect(300, 250, 10, 20)
    root.hidden = true
    await draw()
    expect(document.querySelector('.dia-marker')).toBeNull()
  })
})
