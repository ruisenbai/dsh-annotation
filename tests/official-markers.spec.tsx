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
beforeEach(() => {
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
  it('opens each member of a grouped bubble through the shared menu', async () => {
    const annotations = [annotation(1), annotation(2)]
    const open = vi.fn()
    render(
      <AnnotationMarkerButton
        group={{
          annotationIds: annotations.map((item) => item.annotationId),
          top: 40,
          left: 40,
          width: 26,
          height: 26,
        }}
        annotations={annotations}
        t={(key) => key}
        activeId={null}
        detailsOpen={false}
        editorOpen={false}
        onPreview={() => undefined}
        onOpen={open}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'marker.groupLabel' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '#2 Comment 2' }))
    expect(open).toHaveBeenLastCalledWith(annotations[1])
    fireEvent.click(screen.getByRole('button', { name: 'marker.groupLabel' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '#1 Comment 1' }))
    expect(open).toHaveBeenLastCalledWith(annotations[0])
  })

  it('clips bubbles to their source scrollport and never invents a nearer text endpoint', async () => {
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
    expect(document.querySelector('.dia-marker')).toBeNull()
    rectangle = new DOMRect(300, 250, 10, 20)
    document.dispatchEvent(new Event('scroll'))
    await draw()
    expect(document.querySelector('.dia-marker')).not.toBeNull()
    rectangle = new DOMRect(480, 250, 10, 20)
    document.dispatchEvent(new Event('scroll'))
    await draw()
    expect(document.querySelector('.dia-marker')).toBeNull()
    rectangle = new DOMRect(300, 250, 10, 20)
    root.hidden = true
    await draw()
    expect(document.querySelector('.dia-marker')).toBeNull()
  })
})
