// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import { AnnotationDock } from '../src/client/components/AnnotationDock.tsx'
import type { AnnotationView } from '../src/client/controller.ts'
import type { InputAnnotationProps, UserAnnotationProps } from '../src/client/contract.ts'
import type { InlineAnnotationLocaleKey } from '../src/client/locales.ts'
import { fixturePayload } from './fixtures.ts'

const t = (key: InlineAnnotationLocaleKey, params?: Record<string, unknown>) => {
  const values: Partial<Record<InlineAnnotationLocaleKey, string>> = {
    'timeline.summary': `Added ${String(params?.count)} inline annotations`,
    'list.locate': 'Locate source',
    'status.sent': 'Sent',
    'dock.pending': `${String(params?.count)} ready`,
    'list.title': 'Inline annotations',
  }
  return values[key] ?? key
}

function baseView(): AnnotationView {
  return {
    annotations: [],
    outbox: [],
    overallRequirementDraft: '',
    editor: null,
    panelOpen: false,
    notice: null,
    activeAnnotationId: null,
    latestAssistantMessageId: null,
    storageAvailable: true,
  }
}

describe('annotation presentation', () => {
  it('folds a durable annotation submission and navigates by id', () => {
    const payload = fixturePayload()
    const navigate = vi.fn(async () => true)
    const view: AnnotationView = {
      ...baseView(),
      annotations: payload.annotations.map((item) => ({
        ...item,
        status: 'sent' as const,
        updatedAt: payload.createdAt,
        submissionId: payload.submissionId,
      })),
    }
    const props = {
      node: { data: { source: { kind: 'user', inlineAnnotations: payload }, content: [] } },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      navigate,
      loadImage: vi.fn(),
      t,
    } as unknown as UserAnnotationProps<'user'>
    render(<AnnotatedUserNode {...props} />)
    expect(screen.getByText('Added 1 inline annotations')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Added 1 inline annotations'))
    expect(screen.getByText('Explain this claim.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Locate source' }))
    expect(navigate).toHaveBeenCalledWith(payload.annotations[0]?.annotationId)
  })

  it('shows the composer dock only when recoverable annotation state exists', () => {
    const payload = fixturePayload()
    const setPanelOpen = vi.fn()
    const view: AnnotationView = {
      ...baseView(),
      annotations: [
        {
          ...payload.annotations[0]!,
          status: 'draft',
          updatedAt: payload.createdAt,
        },
      ],
    }
    const props = {
      sessionId: payload.sessionId,
      session: { pending: [], running: false },
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(view),
      useWorkspaces: (selector: (state: { archivedSessionIds: readonly string[] }) => unknown) =>
        selector({ archivedSessionIds: [] }),
      setPanelOpen,
      t,
    } as unknown as InputAnnotationProps
    const { rerender } = render(<AnnotationDock {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /1 ready/u }))
    expect(setPanelOpen).toHaveBeenCalledWith(true)

    const emptyProps = {
      ...props,
      useAnnotations: (selector: (state: AnnotationView) => unknown) => selector(baseView()),
    } as unknown as InputAnnotationProps
    rerender(<AnnotationDock {...emptyProps} />)
    expect(screen.queryByRole('button', { name: /ready/u })).not.toBeInTheDocument()
  })
})
