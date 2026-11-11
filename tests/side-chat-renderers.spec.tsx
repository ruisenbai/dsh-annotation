// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderFactories, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { type ComponentType, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { decorateAssistantRenderers } from '../src/client/assistant-renderer-decorator.tsx'
import { AnnotatedUserNode } from '../src/client/components/AnnotatedUserNode.tsx'
import type {
  AnnotationInjected,
  AssistantAnnotationProps,
  UserAnnotationProps,
} from '../src/client/contract.ts'
import { AnnotationController } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import type { MessageQuoteTarget } from '../src/client/selection.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { sideAnnotationCapture } from '../src/client/side-chat-annotations.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'
import { sideChatPayload, SideChatMemoryStorage } from './side-chat-fixtures.ts'
import { userContentFactory } from './user-host-fixture.tsx'

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  cleanup()
})

const translate: UserAnnotationProps<'user'>['t'] = (key, params) =>
  en[key as keyof typeof en].replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))

function userFixture(source: unknown, text: string) {
  const navigate = vi.fn(async () => true)
  const locateSideChatReference = vi.fn(async () => true)
  const factoryCalls = vi.fn()
  const hostContent = userContentFactory()
  const renderFactorySlot: PropsRenderFactories['renderFactorySlot'] = (name, props) => {
    factoryCalls(name, props)
    return hostContent(name, props)
  }
  const props: Partial<UserAnnotationProps<'user'>> = {
    node: {
      key: 'side-question',
      id: 'side-question',
      target: 'chat',
      kind: 'user',
      anchorSeq: 50,
      visibility: 'visible',
      location: { kind: 'session' },
      data: { kind: 'user', seq: 50, time: 1, source, content: [{ type: 'text', text }] },
    },
    navigate,
    locateSideChatReference,
    renderFactorySlot,
    loadImage: vi.fn(async () => 'fixture:image'),
    t: translate,
  } satisfies Pick<
    UserAnnotationProps<'user'>,
    'node' | 'navigate' | 'locateSideChatReference' | 'renderFactorySlot' | 'loadImage' | 't'
  >
  return { props, navigate, locateSideChatReference, renderFactorySlot: factoryCalls }
}

function controller(sessionId: string) {
  const identity = sessionId as SessionIdentity
  const owner = new AnnotationController(
    identity,
    new AnnotationStorage(new SideChatMemoryStorage(), identity),
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => {} },
    DEFAULT_CONFIG,
    () => 1_700_000_000_000,
  )
  onTestFinished(() => owner.dispose())
  return owner
}

function decoratedAssistant() {
  const ctx = new Context()
  const HostAssistant = (props: ChatNodeViewProps<'assistant-step'>) => (
    <>
      {props.node.data.blocks.map((block, index) =>
        block.kind === 'text' ? (
          <MarkdownText
            key={index}
            text={block.text}
            streaming={false}
            labels={{ code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }}
          />
        ) : null,
      )}
    </>
  )
  const entry: Pick<StoredEntry, 'options' | 'component'> = {
    options: { key: 'assistant-step' },
    component: HostAssistant,
  }
  const slots = { entries: () => [entry as StoredEntry] } satisfies Pick<Context['slots'], 'entries'>
  Object.defineProperty(ctx, 'slots', { configurable: true, value: slots })
  const dispose = decorateAssistantRenderers(ctx, () => ({}) as AnnotationInjected, true)
  onTestFinished(async () => {
    dispose()
    await ctx.fiber.dispose()
  })
  return entry.component as ComponentType<AssistantAnnotationProps>
}

function assistantFixture(owner: AnnotationController, text: string) {
  const messageId = 'identical-message-id'
  const useAnnotations: AssistantAnnotationProps['useAnnotations'] = (selector) =>
    selector(useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot))
  const props: Partial<AssistantAnnotationProps> = {
    node: {
      key: `${owner.sessionId}-reply`,
      id: messageId,
      target: 'chat',
      kind: 'assistant-step',
      anchorSeq: 42,
      visibility: 'visible',
      location: { kind: 'session' },
      data: {
        status: 'settled',
        time: 1,
        turn: 1,
        step: 1,
        blocks: [{ kind: 'text', text }],
        finalNode: {
          kind: 'assistant',
          messageId: messageId as MessageId,
          seq: 42,
          time: 1,
          turn: 1,
          step: 1,
          blocks: [{ kind: 'text', text }],
        },
      },
    },
    sessionId: SessionId(owner.sessionId),
    useAnnotations,
    useTurnData: () => undefined,
    beginSelection: vi.fn(),
    openAnnotation: vi.fn(),
    navigate: vi.fn(async () => true),
    registerEndpoint: owner.registerEndpoint.bind(owner),
    updateHighlightRanges: vi.fn(),
    activateHighlight: vi.fn(),
    removeHighlights: vi.fn(),
    t: translate,
    annotationT: translate,
  } satisfies Pick<
    AssistantAnnotationProps,
    | 'node'
    | 'sessionId'
    | 'useAnnotations'
    | 'useTurnData'
    | 'beginSelection'
    | 'openAnnotation'
    | 'navigate'
    | 'registerEndpoint'
    | 'updateHighlightRanges'
    | 'activateHighlight'
    | 'removeHighlights'
    | 't'
    | 'annotationT'
  >
  return props
}

function geometry() {
  const measured: Array<{ text: string; start: number }> = []
  const bounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const fragments = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(100, 220, 120, 20),
  })
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      measured.push({ text: this.toString(), start: this.startOffset })
      return [new DOMRect(100, 220, 120, 20)]
    },
  })
  onTestFinished(() => {
    if (bounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', bounds)
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    if (fragments) Object.defineProperty(Range.prototype, 'getClientRects', fragments)
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  })
  return measured
}

function scroller(element: HTMLElement) {
  element.style.overflowY = 'auto'
  element.getBoundingClientRect = () => new DOMRect(0, 100, 500, 400)
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1200 },
  })
  const scrollBy = vi.fn()
  Object.defineProperty(element, 'scrollBy', { configurable: true, value: scrollBy })
  return scrollBy
}

function target(quote: MessageQuoteTarget['quote']): MessageQuoteTarget {
  return {
    messageId: 'identical-message-id' as MessageIdentity,
    messageSeq: 42,
    responseVersion: 'identical-message-id' as MessageIdentity,
    quote,
  }
}

describe('side-chat submitted message presentation', () => {
  it('keeps the question, side references, and ordinary annotation actions separate in one Host message', async () => {
    const base = sideChatPayload()
    const annotationSubmission = fixturePayload({
      sessionId: String(base.sideSessionId) as SessionIdentity,
      submissionId: base.submissionId,
      protocolLocale: base.protocolLocale,
    })
    const payload = sideChatPayload({ annotationSubmission, question: 'Compare the statements.' })
    const fixture = userFixture(
      { kind: 'user', sideChatSubmission: payload, annotationSubmission },
      'Logged combined request with machine metadata',
    )
    const { container } = render(<AnnotatedUserNode {...(fixture.props as UserAnnotationProps<'user'>)} />)

    expect(screen.getByText(payload.question)).toBeVisible()
    // Submitted references stay compact until the reader asks for them.
    expect(screen.queryByText(payload.references[0]!.quote.exact)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Submitted references \(1\)/u }))
    expect(screen.getByText(payload.references[0]!.quote.exact)).toBeVisible()
    expect(container.querySelector('[data-dia-side-chat-history]')).toBeInTheDocument()
    expect(container.querySelector('.dia-timeline')).toBeInTheDocument()
    expect(screen.queryByText('Logged combined request with machine metadata')).not.toBeInTheDocument()
    expect(fixture.renderFactorySlot).toHaveBeenCalledWith(
      'conversation.chat.user.content',
      expect.objectContaining({ content: expect.objectContaining({ text: payload.question }) }),
    )

    fireEvent.click(screen.getByRole('button', { name: en['sideChat.locate'] }))
    expect(fixture.locateSideChatReference).toHaveBeenCalledWith(payload.references[0])
    expect(fixture.navigate).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('button', { name: en['timeline.singleLocate'] }))
    expect(fixture.navigate).toHaveBeenCalledWith(annotationSubmission.annotations[0]!.annotationId)
    expect(fixture.locateSideChatReference).toHaveBeenCalledOnce()
  })

  it('retains raw logged text and a localized warning for malformed supported side-reference metadata', () => {
    const raw = '<selected> raw **model input** <script>alert(1)</script>'
    const fixture = userFixture(
      { kind: 'user', sideChatSubmission: { ...sideChatPayload(), references: [{ messageId: 'broken' }] } },
      raw,
    )
    const { container } = render(<AnnotatedUserNode {...(fixture.props as UserAnnotationProps<'user'>)} />)
    expect(screen.getByRole('alert')).toHaveTextContent(en['sideChat.invalidSource'])
    expect(screen.getByText(raw)).toBeVisible()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[data-dia-side-chat-history]')).toBeNull()
    expect(fixture.renderFactorySlot).toHaveBeenCalledWith(
      'conversation.chat.user.content',
      expect.objectContaining({ content: expect.objectContaining({ text: raw }) }),
    )
  })
})

describe('side-reference navigation through decorated assistant renderers', () => {
  it('places a cross-Session annotation on its source and follows its receiving editor state', () => {
    geometry()
    const Assistant = decoratedAssistant()
    const main = controller('source-main')
    const side = controller('receiving-side')
    side.beginSelection(
      sideAnnotationCapture(
        {
          ...target({ exact: 'selected source', prefix: '', suffix: '', start: 0, end: 15 }),
          rect: { left: 20, right: 100, top: 10, bottom: 28 },
        },
        SessionId(main.sessionId),
      ),
    )
    side.updateEditorText('Explain this passage')
    const id = side.saveEditor()!
    const annotation = side.getSnapshot().annotations[0]!
    const project = () => {
      const view = side.getSnapshot()
      main.setSourceAnnotations([
        {
          annotation,
          targetSessionId: side.sessionId,
          title: 'Side chat 2',
          active: view.activeAnnotationId === id,
          detailsOpen: view.markerAnnotationId !== null || view.editor !== null || view.panelOpen,
          editorOpen: view.editor !== null,
        },
      ])
    }
    project()
    onTestFinished(side.subscribe(project))
    const open = vi.fn(() => side.openAnnotation(id, 'marker-edit'))
    const mainProps = assistantFixture(main, 'selected source') as AssistantAnnotationProps
    const { container } = render(
      <>
        <Assistant {...mainProps} openSourceAnnotation={open} />
        <Assistant {...(assistantFixture(side, 'selected source') as AssistantAnnotationProps)} />
      </>,
    )
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(1)
    expect(
      container.querySelector('[data-dsh-annotation-session-id="receiving-side"] [data-annotation-id]'),
    ).toBeNull()
    const marker = screen.getByRole('button', { name: 'Side chat 2 · #1: Explain this passage' })
    fireEvent.click(marker)
    expect(open).toHaveBeenCalledWith(side.sessionId, id)
    expect(marker).toHaveAttribute('data-active', 'true')
    expect(marker).toHaveAttribute('aria-expanded', 'true')
    expect(marker).toBeDisabled()
    expect(mainProps.activateHighlight).toHaveBeenLastCalledWith('identical-message-id', expect.any(Range))
    act(() => side.closeEditor(true))
    expect(marker).toHaveAttribute('aria-expanded', 'false')
    expect(marker).toBeEnabled()
    expect(main.getSnapshot().annotations).toEqual([])
  })

  it.each(['responseVersion', 'messageSeq'] as const)(
    'refuses a source with a mismatched %s without scrolling or flashing either Conversation',
    async (field) => {
      geometry()
      const Assistant = decoratedAssistant()
      const main = controller('main-navigation')
      const side = controller('side-navigation')
      render(
        <>
          <div data-testid="main-scroll">
            <Assistant {...(assistantFixture(main, 'selected source') as AssistantAnnotationProps)} />
          </div>
          <div data-testid="side-scroll">
            <Assistant {...(assistantFixture(side, 'selected source') as AssistantAnnotationProps)} />
          </div>
        </>,
      )
      const mainScroll = scroller(screen.getByTestId('main-scroll'))
      const sideScroll = scroller(screen.getByTestId('side-scroll'))
      const quote = target({ exact: 'selected source', prefix: '', suffix: '', start: 0, end: 15 })
      const mismatched =
        field === 'messageSeq'
          ? { ...quote, messageSeq: 43 }
          : { ...quote, responseVersion: 'another-version' as MessageIdentity }
      let pending: Promise<string> | undefined
      act(() => {
        pending = main.locateMessageQuote(mismatched)
      })
      await expect(pending).resolves.toBe('unmatched')
      expect(mainScroll).not.toHaveBeenCalled()
      expect(sideScroll).not.toHaveBeenCalled()
      expect(document.querySelector('.dia-quote-flash')).toBeNull()
    },
  )

  it('refuses an ambiguous repeated quote with an invalid saved offset', async () => {
    geometry()
    const Assistant = decoratedAssistant()
    const main = controller('main-ambiguous')
    render(
      <div data-testid="main-scroll">
        <Assistant
          {...(assistantFixture(
            main,
            'before selected source after before selected source after',
          ) as AssistantAnnotationProps)}
        />
      </div>,
    )
    const scroll = scroller(screen.getByTestId('main-scroll'))
    let pending: Promise<string> | undefined
    act(() => {
      pending = main.locateMessageQuote(
        target({ exact: 'selected source', prefix: 'before ', suffix: ' after', start: 0, end: 15 }),
      )
    })
    await expect(pending).resolves.toBe('unmatched')
    expect(scroll).not.toHaveBeenCalled()
    expect(document.querySelector('.dia-quote-flash')).toBeNull()
  })

  it('restores the saved occurrence when repeated quotes have identical context', async () => {
    const measured = geometry()
    const Assistant = decoratedAssistant()
    const main = controller('main-occurrence')
    render(
      <div data-testid="main-scroll">
        <Assistant
          {...(assistantFixture(
            main,
            'before selected source after before selected source after',
          ) as AssistantAnnotationProps)}
        />
      </div>,
    )
    const scroll = scroller(screen.getByTestId('main-scroll'))
    let pending: Promise<string> | undefined
    act(() => {
      pending = main.locateMessageQuote(
        target({ exact: 'selected source', prefix: 'before ', suffix: ' after', start: 36, end: 51 }),
      )
    })
    await expect(pending).resolves.toBe('shown')
    expect(scroll).toHaveBeenCalledOnce()
    const quotes = measured.filter((measurement) => measurement.text === 'selected source')
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes.every((measurement) => measurement.start === 36)).toBe(true)
  })

  it('scrolls and flashes only the owning main Conversation when both Sessions contain the same message identity and text', async () => {
    geometry()
    const Assistant = decoratedAssistant()
    const main = controller('main-owning')
    const side = controller('side-owning')
    render(
      <>
        <div data-testid="main-scroll">
          <Assistant
            {...(assistantFixture(main, 'before selected source after') as AssistantAnnotationProps)}
          />
        </div>
        <div data-testid="side-scroll">
          <Assistant
            {...(assistantFixture(side, 'before selected source after') as AssistantAnnotationProps)}
          />
        </div>
      </>,
    )
    const mainContainer = screen.getByTestId('main-scroll')
    const sideContainer = screen.getByTestId('side-scroll')
    const mainScroll = scroller(mainContainer)
    const sideScroll = scroller(sideContainer)
    let pending: Promise<string> | undefined
    act(() => {
      pending = main.locateMessageQuote(
        target({ exact: 'selected source', prefix: 'before ', suffix: ' after', start: 7, end: 22 }),
      )
    })
    await expect(pending).resolves.toBe('shown')
    expect(mainScroll).toHaveBeenCalledOnce()
    expect(sideScroll).not.toHaveBeenCalled()
    expect(mainContainer.querySelector('.dia-quote-flash')).toBeInTheDocument()
    expect(sideContainer.querySelector('.dia-quote-flash')).toBeNull()
    expect(document.activeElement).toBe(mainContainer.querySelector('.dia-assistant'))
    expect(within(sideContainer).getByText('before selected source after')).toBeVisible()
    expect(main.getSnapshot().annotations).toEqual([])
    expect(side.getSnapshot().annotations).toEqual([])
  })
})

it('assembles independent reference markers from the owning Session observable without changing another view', async () => {
  geometry()
  const Assistant = decoratedAssistant()
  const makeOwner = (id: string) =>
    new AnnotationController(
      id as SessionIdentity,
      new AnnotationStorage(new SideChatMemoryStorage(), id as SessionIdentity),
      { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => undefined },
      DEFAULT_CONFIG,
    )
  const main = makeOwner('main-test')
  const side = makeOwner('side-test')
  onTestFinished(() => {
    main.dispose()
    side.dispose()
  })
  const records = Array.from({ length: 3 }, (_, index) => ({
    sideChatId: `owner-${index}` as import('../src/shared/side-chat-types.ts').SideChatId,
    ordinal: index + 1,
    disabled: false,
    reference: {
      ...sideChatPayload().references[0]!,
      referenceId: `source-${index}` as import('../src/shared/side-chat-types.ts').SideChatReferenceId,
      messageId: 'identical-message-id' as MessageIdentity,
      messageSeq: 42,
      responseVersion: 'identical-message-id' as MessageIdentity,
      quote: { exact: 'selected source', prefix: '', suffix: '', start: 0, end: 15 },
    },
  }))
  main.setSourceReferences(records)
  const remove = vi.fn((chatId, refId) => {
    expect(chatId).toBe(records[1]!.sideChatId)
    main.setSourceReferences(records.filter((item) => item.reference.referenceId !== refId))
  })
  const { container } = render(
    <>
      <Assistant
        {...(assistantFixture(main, 'selected source') as AssistantAnnotationProps)}
        removeSourceReference={remove}
      />
      <Assistant {...(assistantFixture(side, 'selected source') as AssistantAnnotationProps)} />
    </>,
  )
  expect(container.querySelectorAll('[data-reference-id]')).toHaveLength(3)
  expect(
    container.querySelector('[data-dsh-annotation-session-id="side-test"] [data-reference-id]'),
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reference 2' }))
  const dialog = await screen.findByRole('dialog', { name: 'Reference 2' })
  expect(dialog).toHaveTextContent('selected source')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove reference' }))
  expect(remove).toHaveBeenCalledOnce()
  await waitFor(() => expect(container.querySelectorAll('[data-reference-id]')).toHaveLength(2))
  expect(container.querySelector('[data-reference-id="source-1"]')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})
