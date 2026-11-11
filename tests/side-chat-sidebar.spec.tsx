// @vitest-environment jsdom
import * as dockKit from '@deepseek-ai/dsh-client-ui-dockkit'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  FixedSideChatView,
  registerSideChatSidebar,
  SIDE_CHAT_KIND,
  SIDE_CHAT_TAB_ID,
  SideChatConversation,
  SideChatPanel,
  SideChatTabContent,
  type SideChatTabContentProps,
  type SideChatConversationProps,
  type SideChatPanelProps,
  type SideChatSidebarOptions,
} from '../src/client/side-chat-sidebar.tsx'
import {
  SideChatController,
  type SideChatChatView,
  type SideChatView,
} from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import {
  SideChatComposerChip,
  SideChatRecordPanel,
  SideChatSubmissionNotice,
  type SideChatControlsProps,
  type SideChatInjected,
} from '../src/client/components/SideChatReferences.tsx'
import { en } from '../src/client/locales.ts'
import { formatSubmissionMessage } from '../src/shared/protocol.ts'
import { fixturePayload } from './fixtures.ts'
import type { SideChatId, SideChatReference } from '../src/shared/side-chat-types.ts'
import { parallelSideChatFixture, sideChatCapture, sideChatSessionFixture } from './side-chat-fixtures.ts'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mainId = SessionId('main-session')
const sideId = SessionId('side-session')
const chatA = 'side-chat-a' as SideChatId
const chatB = 'side-chat-b' as SideChatId
const copy: Readonly<Record<string, string>> = en
const t = ((key: string, params?: Readonly<Record<string, unknown>>) => {
  const template = copy[key]
  if (template === undefined) throw new Error(`Missing annotation copy: ${key}`)
  return template.replace(/\{([^}]+)\}/gu, (_match: string, name: string) => String(params?.[name] ?? ''))
}) as SideChatPanelProps['t']

function chat(sideChatId: SideChatId, overrides: Partial<SideChatChatView> = {}): SideChatChatView {
  return {
    sideChatId,
    sideSessionId: sideChatId === chatA ? sideId : null,
    title: null,
    archived: false,
    status: 'ready',
    references: [],
    referenceRecords: [],
    failure: null,
    outbox: null,
    panelOpen: false,
    saveState: 'saved',
    ...overrides,
  }
}

function view(chats: readonly SideChatChatView[], active: SideChatId | null = chatA): SideChatView {
  return {
    mainSessionId: mainId,
    chats,
    activeSideChatId: active,
    active: chats.find((item) => item.sideChatId === active) ?? null,
    visible: true,
    storageAvailable: true,
    storageOutdated: false,
    saveState: 'saved',
    recoveryAvailable: true,
    sideSessionId: null,
    status: 'ready',
    references: [],
    failure: null,
    outbox: null,
  }
}

function reference(id: string): SideChatReference {
  return {
    referenceId: id as SideChatReference['referenceId'],
    sourceSessionId: mainId,
    messageId: 'assistant-a' as SideChatReference['messageId'],
    messageSeq: 42,
    responseVersion: 'assistant-a' as SideChatReference['responseVersion'],
    quote: { exact: 'selected source', prefix: '', suffix: '', start: 0, end: 15 },
    createdAt: 1,
  }
}

function panelProps(snapshot: SideChatView, overrides: Record<string, unknown> = {}): SideChatPanelProps {
  const injected = {
    useSideChat: <T,>(selector: (value: SideChatView) => T): T => selector(snapshot),
    removeReference: vi.fn(),
    removeAllReferences: vi.fn(),
    referenceFor: () => undefined,
    locateReference: vi.fn(async () => true),
    retrySideChat: vi.fn(),
    retrySideChatSave: vi.fn(),
    exportSideChatRecovery: vi.fn(),
    openSideChat: vi.fn(),
    closeSideChat: vi.fn(),
    createSideChat: vi.fn(),
    selectSideChat: vi.fn(),
    archiveChat: vi.fn(async () => {}),
    deleteChat: vi.fn(async () => {}),
    retryChat: vi.fn(),
    openSideChatAlone: vi.fn(),
    setReferencePanelOpen: vi.fn(),
    retainVisiblePanel: vi.fn(() => () => {}),
    t,
  }
  const props = {
    ...injected,
    useTabInfo: () => ({ tab: { visible: true } }),
    useSessions: <T,>(selector: (value: unknown) => T): T =>
      selector({
        byId: { [sideId]: { running: true, title: 'Side one', displayTitle: 'Side one', retainedBy: {} } },
      }),
    SessionProvider: ({ children }: { readonly children?: unknown }) => <>{children as never}</>,
    renderSlot: () => <div data-testid="conversation" />,
    ...overrides,
  } as unknown as SideChatPanelProps
  props.renderSlot = (_name, owner) => {
    if ('sideChatId' in owner && typeof owner.sideChatId === 'string')
      return (
        <SideChatTabContent
          {...({ ...props, sideChatId: owner.sideChatId as SideChatId } as SideChatTabContentProps)}
          renderSlot={() => <div data-testid="conversation" />}
        />
      )
    return <div data-testid="conversation" />
  }
  return props
}

function sidebarHost(
  tabs: readonly { readonly id: string; readonly kind: string; readonly contentId: string }[] = [],
) {
  const ctx = new Context()
  const definitions: SidebarRightTabDefinition[] = []
  const registrations: { options: Record<string, unknown> }[] = []
  const openTabIn = vi.fn()
  const hide = vi.fn()
  const focus = vi.fn()
  const closeIn = vi.fn()
  const openSession = vi.fn()
  Object.defineProperties(ctx, {
    sidebarRightTabs: {
      value: {
        register(definition: SidebarRightTabDefinition) {
          definitions.push(definition)
          return () => definitions.splice(definitions.indexOf(definition), 1)
        },
      },
    },
    sidebarRight: {
      value: {
        mounted: { getSnapshot: () => mainId, subscribe: () => () => {} },
        tabsIn: () => tabs,
        openTabIn,
        hide,
        focus,
        closeIn,
      },
    },
    slots: {
      value: {
        inject(_name: string, install: () => () => void) {
          return install()
        },
        register(options: Record<string, unknown>) {
          const registration = { options }
          registrations.push(registration)
          return () => registrations.splice(registrations.indexOf(registration), 1)
        },
      },
    },
    effect: {
      value: (install: () => void | (() => void)) => install(),
    },
    get: {
      value: (name: string) => (name === 'uiWorkspace' ? { openSession } : undefined),
    },
  })
  return {
    ctx,
    definitions,
    registrations,
    openTabIn,
    hide,
    focus,
    closeIn,
    openSession,
    dispose: () => ctx.fiber.dispose(),
  }
}

function options(overrides: Partial<SideChatSidebarOptions> = {}): SideChatSidebarOptions {
  const openPanel = vi.fn()
  const openStandalone = vi.fn()
  return {
    controllerFor: () => undefined,
    controllerForSide: () => undefined,
    locateReference: async () => true,
    openPanel,
    retainVisiblePanel: vi.fn(() => () => {}),
    prepareChat: vi.fn(async () => {}),
    openStandalone,
    archiveChat: vi.fn(async () => {}),
    deleteChat: vi.fn(async () => {}),
    ...overrides,
  }
}

function composerFace(host: ReturnType<typeof sidebarHost>, sessionId: SessionId): SideChatInjected {
  const inject = host.registrations.find((entry) => entry.options.id === 'dsh-annotation-side-chat-chip')
    ?.options.inject
  if (typeof inject !== 'function') throw new Error('Side-chat composer was not registered')
  return inject(sessionId) as SideChatInjected
}

function boundControls(face: SideChatInjected): SideChatControlsProps {
  const { hooks, ...actions } = face
  return {
    ...actions,
    t,
    useSideChat: (selector) =>
      selector(useSyncExternalStore(hooks.sideChat.subscribe, hooks.sideChat.getSnapshot)),
  }
}

function BoundComposer({ face }: { readonly face: SideChatInjected }) {
  const props = boundControls(face)
  return (
    <>
      <SideChatComposerChip {...props} />
      <SideChatRecordPanel {...props} />
      <SideChatSubmissionNotice {...props} />
    </>
  )
}

describe('independent side-chat Host integration', () => {
  it.each([
    { openState: 'open', phase: 'active' },
    { openState: 'loading', phase: 'settling' },
  ] as const)(
    'keeps the retained side Session composer out of Hero while $openState',
    ({ openState, phase }) => {
      const fixture = sideChatSessionFixture(mainId)
      onTestFinished(fixture.dispose)
      fixture.snapshot.set({ ...fixture.snapshot.getSnapshot(), openState })
      const useSession: SideChatConversationProps['useSession'] = (selector) =>
        selector(fixture.snapshot.getSnapshot())
      const factory = vi.fn(() => null)
      SideChatConversation({ useSession, renderFactorySlot: factory } as unknown as SideChatConversationProps)
      expect(factory).toHaveBeenCalledExactlyOnceWith(
        'conversation.content',
        { variant: 'embedded', phase, hero: false },
        { slots: { views: FixedSideChatView } },
      )
    },
  )

  it('keeps the embedded Conversation in the ordinary chat View', () => {
    const renderSlot = vi.fn(() => null)
    FixedSideChatView({ renderSlot } as never)
    expect(renderSlot).toHaveBeenCalledExactlyOnceWith('conversation.session', { view: 'chat' })
  })

  it('uses the Session title and selects only the current official Tab', () => {
    const snapshot = view([chat(chatA, { references: [reference('a'), reference('b')] }), chat(chatB)])
    render(<SideChatPanel {...panelProps(snapshot)} />)
    const rows = screen.getAllByRole('tab')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).toHaveTextContent('Side one')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveTextContent('Side chat 2')
  })

  it('releases visible panel ownership when the retained Host tab is hidden or unmounted', () => {
    const release = vi.fn()
    const retainVisiblePanel = vi.fn(() => release)
    let visible = true
    const props = panelProps(view([chat(chatA)]), {
      retainVisiblePanel,
      useTabInfo: () => ({ tab: { visible } }),
    })
    const mounted = render(<SideChatPanel {...props} />)
    expect(retainVisiblePanel).toHaveBeenCalledOnce()
    visible = false
    mounted.rerender(<SideChatPanel {...props} />)
    expect(release).toHaveBeenCalledOnce()
    visible = true
    mounted.rerender(<SideChatPanel {...props} />)
    expect(retainVisiblePanel).toHaveBeenCalledTimes(2)
    mounted.unmount()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it.each(['zh', 'en'] as const)(
    'keeps a readable chat name when the title contains a %s submission',
    (protocolLocale) => {
      const snapshot = view([chat(chatA, { title: 'Side chat 7' })])
      let title = formatSubmissionMessage(fixturePayload({ protocolLocale }))
        .split('\n')
        .slice(0, 2)
        .join(' ')
      const props = panelProps(snapshot, {
        useSessions: (selector: (value: unknown) => unknown) =>
          selector({ byId: { [sideId]: { title, displayTitle: title, retainedBy: {} } } }),
      })
      const mounted = render(<SideChatPanel {...props} />)
      expect(screen.getByRole('tab')).toHaveTextContent('Side chat 7')
      expect(screen.getByRole('tab')).not.toHaveTextContent('Submission ID')
      title = 'Review the deployment steps'
      mounted.rerender(<SideChatPanel {...props} />)
      expect(screen.getByRole('tab')).toHaveTextContent(title)
    },
  )

  it('ignores directory display names while following explicit titles, including a title equal to the directory', () => {
    const snapshot = view([chat(chatA, { title: 'Side chat 7' })])
    let title: string | undefined
    const props = panelProps(snapshot, {
      useSessions: (selector: (value: unknown) => unknown) =>
        selector({
          byId: { [sideId]: { title, displayTitle: 'project', retainedBy: {} } },
        }),
    })
    const mounted = render(<SideChatPanel {...props} />)
    expect(screen.getByRole('tab')).toHaveTextContent('Side chat 7')
    title = 'project'
    mounted.rerender(<SideChatPanel {...props} />)
    expect(screen.getByRole('tab')).toHaveTextContent('project')
    title = 'Updated title'
    mounted.rerender(<SideChatPanel {...props} />)
    expect(screen.getByRole('tab')).toHaveTextContent('Updated title')
  })

  it('switches and creates chats without closing the panel', () => {
    const snapshot = view([chat(chatA), chat(chatB)])
    const props = panelProps(snapshot)
    render(<SideChatPanel {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /Side chat 2/u }))
    expect(props.selectSideChat).toHaveBeenCalledExactlyOnceWith(chatB)
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.new'] }))
    expect(props.createSideChat).toHaveBeenCalledOnce()
    expect(props.closeSideChat).not.toHaveBeenCalled()
  })

  it('binds enhanced Host tab actions to the clicked tab, independently of the active chat', () => {
    vi.spyOn(dockKit, 'DockLayout').mockImplementation((layout) => {
      const enhanced = layout as typeof layout & { renderTabActions: dockKit.TabRenderer }
      return (
        <>
          {Object.values(layout.state.tabs).map((tab) => (
            <div key={tab.id}>{enhanced.renderTabActions(tab)}</div>
          ))}
        </>
      )
    })
    const props = panelProps(view([chat(chatA), chat(chatB)], chatB))
    render(<SideChatPanel {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: en['sideChat.deleteChat'] })[0]!)
    expect(props.deleteChat).toHaveBeenCalledExactlyOnceWith(chatA)
    expect(props.closeSideChat).not.toHaveBeenCalled()
  })

  it('opens the selected chat as an ordinary full Conversation page', () => {
    const props = panelProps(view([chat(chatA)]))
    render(<SideChatPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.openAlone'] }))
    expect(props.openSideChatAlone).toHaveBeenCalledExactlyOnceWith(chatA)
  })

  it('releases only the embedded editor occurrence while its Session has a full page', async () => {
    const fixture = sideChatSessionFixture(mainId, sideId)
    onTestFinished(fixture.dispose)
    const created = fixture.owner.createChat()
    await fixture.owner.prepare(created.sideChatId)
    fixture.owner.show()
    const snapshot = fixture.owner.getSnapshot()
    const referenceFor = () => fixture.reference
    const mounted = render(<SideChatPanel {...panelProps(snapshot, { referenceFor })} />)
    expect(screen.getByTestId('conversation')).toBeInTheDocument()
    mounted.rerender(
      <SideChatPanel
        {...panelProps(snapshot, {
          referenceFor,
          useSessions: (selector: (value: unknown) => unknown) =>
            selector({
              byId: {
                [sideId]: { displayTitle: 'Side one', retainedBy: { mainView: 1 } },
              },
            }),
        })}
      />,
    )
    expect(screen.queryByTestId('conversation')).toBeNull()
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'true')
    expect(fixture.owner.getReference(created.sideChatId)).toBe(fixture.reference)
    mounted.rerender(<SideChatPanel {...panelProps(snapshot, { referenceFor })} />)
    expect(screen.getByTestId('conversation')).toBeInTheDocument()
  })

  it('shows the preparation state and the retry action while a chat has no Session yet', () => {
    const snapshot = view([chat(chatB, { status: 'preparing', sideSessionId: null })], chatB)
    const props = panelProps(snapshot)
    render(<SideChatPanel {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent(en['sideChat.preparing'])
    expect(screen.queryByTestId('conversation')).toBeNull()
  })

  it('registers the navigation entry, panel body, chip, and record panel for the plugin lifetime', async () => {
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(host.ctx, t, options())
    onTestFinished(() => sidebar.dispose())
    expect(host.definitions).toHaveLength(1)
    expect(host.definitions[0]).toMatchObject({
      id: SIDE_CHAT_TAB_ID,
      kind: SIDE_CHAT_KIND,
      keepMounted: true,
    })
    expect(host.definitions[0]?.guide?.[0]).toMatchObject({ id: 'side-chat' })
    expect(host.registrations.map((entry) => entry.options.name)).toEqual(
      expect.arrayContaining([
        'sidebar.right.pane.tab',
        'sidebar.right.pane.tab.title',
        'annotation.side-chat.conversation',
        'conversation.input.overlay',
        'conversation.input.dock',
      ]),
    )
    expect(
      host.registrations.some((entry) => entry.options.name === 'conversation.session.header.actions'),
    ).toBe(false)
    expect(
      host.registrations.some((entry) => entry.options.id === 'dsh-annotation-blank-side-chat-identity'),
    ).toBe(false)
    // The main composer's own action row never hosts the side-chat entry.
    expect(host.registrations.some((entry) => entry.options.name === 'conversation.input.right')).toBe(false)
    await sidebar.dispose()
    expect(host.registrations).toEqual([])
    expect(host.definitions).toEqual([])
  })

  it('routes the panel-open action through the host navigation owner', () => {
    const openPanel = vi.fn()
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(host.ctx, t, options({ openPanel }))
    onTestFinished(() => sidebar.dispose())
    sidebar.face(mainId).openSideChat()
    expect(openPanel).toHaveBeenCalledExactlyOnceWith(mainId)
    expect(host.openTabIn).not.toHaveBeenCalled()
  })

  it('closes only the side-chat tabs of a deleted main Session and keeps other chats available', async () => {
    const otherId = SessionId('other-main')
    const host = sidebarHost([
      { id: 'side-tab', kind: SIDE_CHAT_KIND, contentId: 'session' },
      { id: 'file-tab', kind: 'file', contentId: 'session' },
      { id: 'other-side-tab', kind: SIDE_CHAT_KIND, contentId: 'other' },
    ])
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(host.ctx, t, options())
    onTestFinished(() => sidebar.dispose())
    await sidebar.retire(mainId)
    expect(host.closeIn).toHaveBeenCalledTimes(2)
    expect(host.closeIn).toHaveBeenCalledWith(mainId, 'side-tab')
    expect(host.closeIn).toHaveBeenCalledWith(mainId, 'other-side-tab')
    expect(host.closeIn).not.toHaveBeenCalledWith(mainId, 'file-tab')
    expect(host.closeIn).not.toHaveBeenCalledWith(otherId, expect.anything())
  })

  it('reports a retirement failure instead of claiming the interface was released', async () => {
    const host = sidebarHost([{ id: 'side-tab', kind: SIDE_CHAT_KIND, contentId: 'session' }])
    onTestFinished(host.dispose)
    host.closeIn.mockImplementation(() => {
      throw new Error('Tab close failed')
    })
    const sidebar = registerSideChatSidebar(host.ctx, t, options())
    onTestFinished(() => sidebar.dispose())
    await expect(sidebar.retire(mainId)).rejects.toThrow('Could not retire the side-chat interface')
  })

  it('retries only retryable preparation failures and keeps collected references', async () => {
    const fixture = sideChatSessionFixture(mainId)
    onTestFinished(fixture.dispose)
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const collected = fixture.owner.collect(sideChatCapture())
    const sidebar = registerSideChatSidebar(
      host.ctx,
      t,
      options({
        controllerFor: () => fixture.owner,
        controllerForSide: () => undefined,
        prepareChat: async (_main, id) => {
          await fixture.owner.prepare(id)
        },
      }),
    )
    onTestFinished(() => sidebar.dispose())
    await expect(fixture.owner.prepare()).resolves.toBeDefined()
    sidebar.face(mainId).retrySideChat()
    await vi.waitFor(() => expect(fixture.owner.chatView()?.status).toBe('ready'))
    expect(fixture.owner.chatView()?.references).toEqual([collected])
    expect(host.openTabIn).not.toHaveBeenCalled()
    expect(host.closeIn).not.toHaveBeenCalled()
  })

  it('prepares the first and second chats without a text selection and deduplicates each entrance', async () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const create = vi.spyOn(fixture.sessions, 'create')
    const prepareChat = vi.fn(async (_main: SessionId, id: SideChatId) => {
      await fixture.owner.prepare(id)
    })
    const sidebar = registerSideChatSidebar(
      host.ctx,
      t,
      options({
        controllerFor: () => fixture.owner,
        prepareChat,
      }),
    )
    onTestFinished(() => sidebar.dispose())
    const face = sidebar.face(mainId)
    face.createSideChat()
    const first = fixture.owner.chatView()!
    face.selectSideChat(first.sideChatId)
    await vi.waitFor(() => expect(fixture.owner.chatView(first.sideChatId)?.status).toBe('ready'))
    face.createSideChat()
    const second = fixture.owner.chatView()!
    face.selectSideChat(second.sideChatId)
    await vi.waitFor(() => expect(fixture.owner.chatView(second.sideChatId)?.status).toBe('ready'))
    expect(create).toHaveBeenCalledTimes(2)
    expect(first.sideChatId).not.toBe(second.sideChatId)
    expect(fixture.owner.chatView(first.sideChatId)).toMatchObject({
      sideSessionId: fixture.first.sideId,
      references: [],
      referenceRecords: [],
    })
    expect(fixture.owner.chatView(second.sideChatId)).toMatchObject({
      sideSessionId: fixture.second.sideId,
      references: [],
      referenceRecords: [],
    })
    expect(prepareChat.mock.calls.map((call) => call[1])).toEqual([
      first.sideChatId,
      first.sideChatId,
      second.sideChatId,
      second.sideChatId,
    ])
  })

  it('loads an unselected restored chat when selected and opens the explicit chat alone', async () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const first = fixture.owner.createChat()
    await fixture.owner.prepare(first.sideChatId)
    const second = fixture.owner.createChat()
    await fixture.owner.prepare(second.sideChatId)
    fixture.owner.suspend()
    const restored = new SideChatController(
      mainId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, mainId),
    )
    onTestFinished(() => restored.dispose())
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const opened = vi.fn()
    const create = vi.spyOn(fixture.sessions, 'create')
    const sidebar = registerSideChatSidebar(
      host.ctx,
      t,
      options({
        controllerFor: () => restored,
        prepareChat: async (_main, id) => {
          await restored.prepare(id)
        },
        openStandalone: opened,
      }),
    )
    onTestFinished(() => sidebar.dispose())
    expect(restored.chatView(first.sideChatId)?.status).toBe('idle')
    sidebar.face(mainId).selectSideChat(first.sideChatId)
    sidebar.face(mainId).selectSideChat(second.sideChatId)
    sidebar.face(mainId).openSideChatAlone(first.sideChatId)
    await vi.waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith(fixture.first.sideId))
    expect(restored.chatView(first.sideChatId)?.status).toBe('ready')
    expect(restored.chatView(second.sideChatId)?.status).toBe('ready')
    expect(restored.getSnapshot().activeSideChatId).toBe(second.sideChatId)
    expect(create).not.toHaveBeenCalled()
  })

  it('renders and mutates only standalone A while the main receiving target stays B', async () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const a = fixture.owner.createChat()
    const a1 = fixture.owner.collect(sideChatCapture('A first'), a.sideChatId)
    const a2 = fixture.owner.collect(sideChatCapture('A second'), a.sideChatId)
    await fixture.owner.prepare(a.sideChatId)
    const b = fixture.owner.createChat()
    const b1 = fixture.owner.collect(sideChatCapture('B only'), b.sideChatId)
    await fixture.owner.prepare(b.sideChatId)
    fixture.owner.setReferencePanelOpen(true, a.sideChatId)
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(
      host.ctx,
      t,
      options({
        controllerFor: () => fixture.owner,
        controllerForSide: (id) =>
          fixture.owner.chatForSideSession(id) === null ? undefined : fixture.owner,
        prepareChat: async (_main, id) => {
          await fixture.owner.prepare(id)
        },
      }),
    )
    onTestFinished(() => sidebar.dispose())
    const face = composerFace(host, fixture.first.sideId)
    const mainFace = composerFace(host, mainId)
    const { container } = render(
      <>
        <div data-testid="main-composer">
          <BoundComposer face={mainFace} />
        </div>
        <div data-testid="standalone-a">
          <BoundComposer face={face} />
        </div>
      </>,
    )
    expect(screen.getByTestId('main-composer')).toBeEmptyDOMElement()
    expect(within(screen.getByTestId('standalone-a')).getAllByRole('listitem')).toHaveLength(2)
    expect(container).toHaveTextContent('A first')
    expect(container).toHaveTextContent('A second')
    expect(container).not.toHaveTextContent('B only')
    act(() => face.removeReference(a2.referenceId))
    expect(fixture.owner.chatView(a.sideChatId)?.references).toEqual([a1])
    expect(fixture.owner.chatView(b.sideChatId)?.references).toEqual([b1])
    const payload = fixture.owner.snapshotSubmission(
      { question: 'Question for A', protocolLocale: 'en', attachmentIdentities: [] },
      a.sideChatId,
    )
    expect(payload.sideSessionId).toBe(fixture.first.sideId)
    expect(payload.references).toEqual([a1])
    act(() => fixture.owner.markAccepted(payload.submissionId, a.sideChatId))
    expect(fixture.owner.chatView(b.sideChatId)?.references).toEqual([b1])
    act(() => {
      fixture.owner.collect(sideChatCapture('A next'), a.sideChatId)
      face.removeAllReferences()
    })
    expect(fixture.owner.chatView(a.sideChatId)?.references).toEqual([])
    expect(fixture.owner.chatView(b.sideChatId)?.references).toEqual([b1])
    expect(fixture.owner.getSnapshot().activeSideChatId).toBe(b.sideChatId)
  })

  it('keeps A snapshots and subscriptions stable through B expansion, errors, and async results', async () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const a = fixture.owner.createChat()
    fixture.owner.collect(sideChatCapture('A reference'), a.sideChatId)
    await fixture.owner.prepare(a.sideChatId)
    const b = fixture.owner.createChat()
    fixture.owner.collect(sideChatCapture('B reference'), b.sideChatId)
    await fixture.owner.prepare(b.sideChatId)
    const source = fixture.owner.observableFor(a.sideChatId)
    expect(fixture.owner.observableFor(a.sideChatId)).toBe(source)
    const unchanged = source.getSnapshot()
    const changed = vi.fn()
    const unsubscribe = source.subscribe(changed)
    fixture.owner.setReferencePanelOpen(true, b.sideChatId)
    const request = fixture.owner.snapshotSubmission(
      { question: 'B request', protocolLocale: 'en', attachmentIdentities: [] },
      b.sideChatId,
    )
    fixture.owner.markUnknown(request.submissionId, new Error('B went offline'), b.sideChatId)
    fixture.owner.selectChat(b.sideChatId)
    expect(source.getSnapshot()).toBe(unchanged)
    expect(source.getSnapshot().active?.panelOpen).toBe(false)
    expect(source.getSnapshot().failure).toBeNull()
    expect(changed).not.toHaveBeenCalled()
    fixture.owner.setReferencePanelOpen(true, a.sideChatId)
    expect(changed).toHaveBeenCalledOnce()
    const stable = source.getSnapshot()
    expect(source.getSnapshot()).toBe(stable)
    unsubscribe()
    fixture.owner.removeAllReferences(a.sideChatId)
    expect(changed).toHaveBeenCalledOnce()
    fixture.owner.removeChat(a.sideChatId)
    const removed = source.getSnapshot()
    expect(source.getSnapshot()).toBe(removed)
    expect(removed.active).toBeNull()
    fixture.owner.dispose()
    expect(source.getSnapshot().status).toBe('disposed')
  })

  it('shows retained save failures in a ready standalone composer and retries the local addition', async () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const a = fixture.owner.createChat()
    fixture.owner.collect(sideChatCapture('A saved'), a.sideChatId)
    await fixture.owner.prepare(a.sideChatId)
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(
      host.ctx,
      t,
      options({ controllerFor: () => fixture.owner, controllerForSide: () => fixture.owner }),
    )
    onTestFinished(() => sidebar.dispose())
    const face = composerFace(host, fixture.first.sideId)
    render(<BoundComposer face={face} />)
    const write = vi.spyOn(fixture.memory, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    act(() => {
      fixture.owner.collect(sideChatCapture('A retained in memory'), a.sideChatId)
    })
    expect(fixture.owner.chatView(a.sideChatId)?.status).toBe('ready')
    expect(screen.getByRole('alert')).toHaveTextContent(en['sideChat.storageUnavailable'])
    expect(screen.getByRole('button', { name: en['sideChat.removeAll'] })).toBeDisabled()
    expect(fixture.owner.exportStorageRecovery()).toContain('A retained in memory')
    expect(() => fixture.owner.collect(sideChatCapture('Unsafe next'), a.sideChatId)).toThrow('storage')
    write.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.retrySave'] }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fixture.owner.chatView(a.sideChatId)?.references.map((item) => item.quote.exact)).toEqual([
      'A saved',
      'A retained in memory',
    ])
  })

  it('offers save retry and recovery export when an unavailable association has no active chat', () => {
    const fixture = parallelSideChatFixture(mainId)
    onTestFinished(fixture.dispose)
    const denied = vi.spyOn(fixture.memory, 'getItem').mockImplementation(() => {
      throw new Error('Site storage denied')
    })
    const owner = new SideChatController(
      mainId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, mainId),
    )
    onTestFinished(() => owner.dispose())
    const host = sidebarHost()
    onTestFinished(host.dispose)
    const sidebar = registerSideChatSidebar(host.ctx, t, options({ controllerFor: () => owner }))
    onTestFinished(() => sidebar.dispose())
    const injected = sidebar.face(mainId)
    function EmptyPanel() {
      return <SideChatPanel {...panelProps(owner.getSnapshot())} {...boundControls(injected)} />
    }
    render(<EmptyPanel />)
    expect(screen.getByRole('button', { name: en['sideChat.new'] })).toBeDisabled()
    expect(screen.getByRole('button', { name: en['sideChat.exportRecovery'] })).toBeVisible()
    expect(screen.getByText(en['sideChat.storageUnavailable'])).toBeVisible()
    denied.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: en['sideChat.retrySave'] }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: en['sideChat.new'] })).toBeEnabled()
  })
})
