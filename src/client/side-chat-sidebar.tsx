/** Right-Sidebar navigation entry, per-main chat list, and embedded Conversation assembly. */
import { useLayoutEffect, useRef } from 'react'
import {
  DockLayout,
  type DockIntents,
  type LayoutState,
  type PaneId,
  type TabId,
  type TabRenderer,
} from '@deepseek-ai/dsh-client-ui-dockkit'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRenderFactories,
  PropsRenderSlots,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconNewChatOutlineRegular,
  IconRightUpOutlineRegular,
  IconTrashOutlineRegular,
  IconArchiveOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatId } from '../shared/side-chat-types.ts'
import type { SideChatChatView, SideChatController, SideChatView } from './side-chat-controller.ts'
import {
  SideChatComposerChip,
  SideChatRecordPanel,
  SideChatSubmissionNotice,
  type SideChatInjected,
} from './components/SideChatReferences.tsx'
import { SideChatGuideEntry } from './components/SideChatGuideEntry.tsx'
import { sideChatDisplayTitle } from './side-chat-title.ts'

/** Stable implementation identity used by the Host tab registry. */
export const SIDE_CHAT_TAB_ID = 'dsh-annotation/side-chat'
/** Page kind: the panel is one page per main Session's right Sidebar. */
export const SIDE_CHAT_KIND = 'annotationsidechat'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Embedded side Conversation binds its independent Session through SessionProvider. */
    'annotation.side-chat.conversation': { kind: 'single'; scope: 'session' }
    /** Retained Tab body reads one exact chat while its parent remains scoped to the main Session. */
    'annotation.side-chat.tab': {
      kind: 'single'
      scope: 'session'
      owner: { readonly sideChatId: SideChatId }
    }
  }
}

/** Main-Session-owned state and navigation effects supplied by the plugin. */
export interface SideChatSidebarOptions {
  /** @param mainSessionId - owning main Session. @returns Its controller, or undefined once retired. */
  readonly controllerFor: (mainSessionId: SessionId) => SideChatController | undefined
  /** @param sideSessionId - any side Conversation. @returns The controller owning it. */
  readonly controllerForSide: (sideSessionId: SessionId) => SideChatController | undefined
  readonly locateReference: (
    reference: import('../shared/side-chat-types.ts').SideChatReference,
  ) => Promise<boolean>
  /** @param mainSessionId - owner whose panel becomes visible. */
  readonly openPanel: (mainSessionId: SessionId) => void
  /** @param mainSessionId - Owner of one visible panel occurrence. @returns Its visibility release. */
  readonly retainVisiblePanel: (mainSessionId: SessionId) => () => void
  /** Prepare exactly one chat's Session; the owner's own prepare deduplicates concurrent calls. */
  readonly prepareChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
  /** @param sideSessionId - side Conversation to show as an ordinary full page. */
  readonly openStandalone: (sideSessionId: SessionId) => void
  /** Official confirmation and lifecycle paths, capturing the clicked Tab identity. */
  readonly archiveChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
  readonly deleteChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
}

/** Navigation bridge owned by the plugin's install path. */
export interface SideChatSidebar {
  /** @param mainSessionId - owner whose panel is revealed in the right Sidebar. */
  open(mainSessionId: SessionId): void
  /** @param mainSessionId - owner whose panel presentation is hidden; chat state stays live. */
  hide(mainSessionId: SessionId): void
  /** @param mainSessionId - owner receiving the injected face. @returns Observable state plus explicit chat actions. */
  face(mainSessionId: SessionId): SideChatInjected
  /** @param mainSessionId - removed owner. @returns After its tabs close and every resource observer finished. */
  retire(mainSessionId: SessionId): Promise<void>
  /** @returns Completion of every registration and disposal. */
  dispose(): Promise<void>
}

/** Fixed Chat selection used by an embedded Conversation occurrence. */
export function FixedSideChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Standard Session hooks and the Host Conversation factory supplied by the slot framework. */
export type SideChatConversationProps = PropsRuntime<'annotation.side-chat.conversation'> &
  PropsRenderFactories

/**
 * Render the shared Host conversation content inside one independent Session scope.
 * @param props - Standard Session hooks and the Host Conversation factory.
 * @returns The embedded Conversation with its fixed chat View and bottom composer.
 */
export function SideChatConversation({ useSession, renderFactorySlot }: SideChatConversationProps) {
  const session = useSession((value) => value)
  const phase = session.openState === 'loading' ? 'settling' : 'active'
  return renderFactorySlot(
    'conversation.content',
    { variant: 'embedded', phase, hero: false },
    { slots: { views: FixedSideChatView } },
  )
}

/** Observable chat list plus the explicit chat management actions. */
export interface SideChatPanelInjected extends SideChatInjected {
  /** @returns A visibility release for this panel occurrence; call it on hide or unmount. */
  readonly retainVisiblePanel: () => () => void
  /** @param sideChatId - exact Tab to archive through the official Session action. */
  readonly retryChat: (sideChatId: SideChatId) => void
  readonly archiveChat: (sideChatId: SideChatId) => Promise<void>
  /** @param sideChatId - exact Tab to delete through the official Session confirmation. */
  readonly deleteChat: (sideChatId: SideChatId) => Promise<void>
  /** @param sideChatId - chat whose ready Session reference is wanted. @returns The owner-held reference, without a second lifetime. */
  readonly referenceFor: (sideChatId: SideChatId) => SessionReference | undefined
}

/** Parent tab data, the child SessionProvider seat, and localized copy. */
export type SideChatPanelProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsRenderSlots<'annotation.side-chat.tab'> &
  InjectFace<SideChatPanelInjected> &
  PropsLocale<'dshAnnotation'>

/** Main-Session scope, exact chat projection, and the embedded conversation seat. */
export type SideChatTabContentProps = PropsRuntime<'annotation.side-chat.tab'> &
  PropsRenderSlots<'annotation.side-chat.conversation'> &
  InjectFace<SideChatPanelInjected> &
  PropsLocale<'dshAnnotation'>

/** @param props - Exact chat state and its retained Session reference. @returns The official conversation or an actionable preparation state. */
export function SideChatTabContent(props: SideChatTabContentProps) {
  const view = props.useSideChat((value) => value)
  const mainViewSessions = props.useSessions((state) => state.byId)
  if (view === null || view.status === 'disposed') return null
  const chat = view.chats.find((chat) => chat.sideChatId === props.sideChatId)
  if (chat === undefined || chat.archived) return null
  // The Session owns one composer editor; its full page holds the DOM binding while open.
  if (chat.sideSessionId !== null && (mainViewSessions[chat.sideSessionId]?.retainedBy.mainView ?? 0) > 0)
    return null
  const reference = props.referenceFor(chat.sideChatId)
  return (
    <div
      className="dia-side-chat-body"
      data-dia-side-chat-body={chat.sideChatId}
      data-dsh-annotation-session-id={chat.sideSessionId ?? undefined}
    >
      {reference === undefined ? (
        <div className="dia-side-chat-preparation">
          <p
            className="dia-side-chat-notice"
            role={chat.failure === null ? 'status' : 'alert'}
            data-dia-side-chat-preparing={chat.status === 'preparing' ? '' : undefined}
          >
            {chat.status === 'preparing'
              ? props.t('sideChat.preparing')
              : chat.failure === null
                ? props.t('sideChat.preparingIdle')
                : props.t(`sideChat.failure.${chat.failure.code}`)}
          </p>
          {chat.status !== 'preparing' && (
            <Button size="sm" data-dia-side-chat-retry="" onClick={() => props.retryChat(chat.sideChatId)}>
              {props.t('sideChat.retry')}
            </Button>
          )}
          {view.activeSideChatId === chat.sideChatId && <SideChatSubmissionNotice {...props} />}
        </div>
      ) : (
        <props.SessionProvider session={reference}>
          {props.renderSlot('annotation.side-chat.conversation', {})}
        </props.SessionProvider>
      )}
    </div>
  )
}

/** A Tab's operation state survives hover and follows that Tab's captured identity. */
function ChatTabActions({
  chatId,
  archiveChat,
  deleteChat,
  t,
}: {
  readonly chatId: SideChatId
  readonly archiveChat: SideChatPanelInjected['archiveChat']
  readonly deleteChat: SideChatPanelInjected['deleteChat']
  readonly t: SideChatPanelProps['t']
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const actions = ref.current
    const tab = actions?.closest<HTMLElement>('[data-dockkit-tab]')
    if (actions == null || tab == null) return undefined
    // The overlay's measured width also owns the title mask; icon sizes remain UI-owned.
    const measure = (): void => {
      tab.style.setProperty('--dia-tab-actions-width', `${actions.offsetWidth}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(actions)
    return () => {
      observer.disconnect()
      tab.style.removeProperty('--dia-tab-actions-width')
    }
  }, [])
  return (
    <span ref={ref} className="dia-side-chat-tab-actions">
      <Tooltip portal label={t('sideChat.archiveChat')} side="bottom">
        <Button
          size="sm"
          variant="ghost"
          className="dia-side-chat-tab-action"
          aria-label={t('sideChat.archiveChat')}
          data-dia-side-chat-archive={chatId}
          onClick={() => {
            void archiveChat(chatId)
          }}
        >
          <IconArchiveOutlineRegular size={14} />
        </Button>
      </Tooltip>
      <Tooltip portal label={t('sideChat.deleteChat')} side="bottom">
        <Button
          size="sm"
          variant="ghost"
          className="dia-side-chat-tab-action"
          aria-label={t('sideChat.deleteChat')}
          data-dia-side-chat-delete={chatId}
          onClick={() => {
            void deleteChat(chatId)
          }}
        >
          <IconTrashOutlineRegular size={14} />
        </Button>
      </Tooltip>
    </span>
  )
}

/** @param props - Per-main chat state and official Session actions. @returns Official retained Tabs, or an empty state with a new-chat action. */
export function SideChatPanel(props: SideChatPanelProps) {
  const view = props.useSideChat((value) => value)
  const summaries = props.useSessions((state) => state.byId)
  const visible = props.useTabInfo().tab.visible
  const available = view !== null && view.status !== 'disposed'
  useLayoutEffect(() => {
    if (visible && available) return props.retainVisiblePanel()
    return undefined
  }, [visible, available, props.retainVisiblePanel])
  if (view === null || view.status === 'disposed') return null
  const chats = view.chats.filter((chat) => !chat.archived)
  const paneId = `annotation-side-pane:${view.mainSessionId}` as PaneId
  const tabId = (id: SideChatId): TabId => `annotation-side-tab:${id}` as TabId
  const label = (chat: SideChatChatView, index: number): string =>
    sideChatDisplayTitle(
      chat.sideSessionId === null ? undefined : summaries[chat.sideSessionId]?.title,
      chat.title ?? props.t('sideChat.untitled', { ordinal: index + 1 }),
    )
  const tabs = chats.map((chat, index) => ({
    id: tabId(chat.sideChatId),
    kind: SIDE_CHAT_KIND,
    contentId: chat.sideChatId,
    title: label(chat, index),
  }))
  const state: LayoutState = {
    nodes: {
      [paneId]: {
        kind: 'pane',
        id: paneId,
        host: 'dock',
        tabs: tabs.map((tab) => tab.id),
        activeTabId: view.activeSideChatId === null ? undefined : tabId(view.activeSideChatId),
        rect: undefined,
      },
    },
    tabs: Object.fromEntries(tabs.map((tab) => [tab.id, tab])),
    rootId: paneId,
    activePaneId: paneId,
    floats: [],
    expanded: view.visible,
    mode: 'push',
  }
  // This embedder has one fixed pane; layout gestures are disabled by the kit's admission props.
  const noLayoutChange = (): void => {}
  const intents: DockIntents = {
    focusTab: (id) => {
      const tab = tabs.find((item) => item.id === id)
      if (tab !== undefined) props.selectSideChat(tab.contentId as SideChatId)
    },
    focusPane: noLayoutChange,
    duplicateTab: noLayoutChange,
    addTab: props.createSideChat,
    closeTab: noLayoutChange,
    splitPane: noLayoutChange,
    floatTab: noLayoutChange,
    unfloatPane: noLayoutChange,
    placeTab: noLayoutChange,
    dropTab: noLayoutChange,
    moveFloat: noLayoutChange,
    resizeFloat: noLayoutChange,
    resizeSplit: noLayoutChange,
  }
  const labels = {
    emptyPane: props.t('sideChat.guideEmpty'),
    addTab: props.t('sideChat.new'),
    closeTab: props.t('sideChat.close'),
    splitPane: props.t('sideChat.openAlone'),
    splitPaneDisabled: props.t('sideChat.openAlone'),
    splitPaneNarrow: props.t('sideChat.openAlone'),
    dockFloat: props.t('sideChat.open'),
    closeFloat: props.t('sideChat.close'),
    dropZone: {
      center: props.t('sideChat.open'),
      top: props.t('sideChat.open'),
      bottom: props.t('sideChat.open'),
      left: props.t('sideChat.open'),
      right: props.t('sideChat.open'),
    },
  }
  // Stock DockKit omits inline tab actions; enhanced hosts consume both optional props.
  const renderTabActions: TabRenderer = (tab) => (
    <ChatTabActions
      chatId={tab.contentId as SideChatId}
      archiveChat={props.archiveChat}
      deleteChat={props.deleteChat}
      t={props.t}
    />
  )
  const enhancedTabControls = { canDragTab: () => false, renderTabActions }
  return (
    <div
      className="dia-side-chat-root"
      data-dia-side-chat=""
      data-main-session={view.mainSessionId}
      data-side-session={view.active?.sideSessionId ?? undefined}
    >
      {chats.length === 0 ? (
        <div className="dia-side-chat-preparation" data-dia-side-chat-empty="">
          <p className="dia-side-chat-empty">{props.t('sideChat.guideEmpty')}</p>
          <Button
            size="sm"
            data-dia-side-chat-new=""
            disabled={view.storageOutdated || !view.storageAvailable}
            icon={<IconNewChatOutlineRegular size={14} />}
            onClick={props.createSideChat}
          >
            {props.t('sideChat.new')}
          </Button>
          <SideChatSubmissionNotice {...props} />
        </div>
      ) : (
        <DockLayout
          state={state}
          intents={intents}
          labels={labels}
          canSplit={false}
          hideSplitWhenBlocked
          canCloseTab={() => false}
          canAddTab={() => !view.storageOutdated && view.storageAvailable}
          {...enhancedTabControls}
          keepMounted={() => true}
          active={view.visible}
          renderTab={(tab) =>
            props.renderSlot('annotation.side-chat.tab', { sideChatId: tab.contentId as SideChatId })
          }
          renderTabTitle={(tab) => (
            <span className="dia-side-chat-tab-title" data-dia-side-chat-select={tab.contentId}>
              {tab.title}
            </span>
          )}
          chrome={
            <Tooltip portal label={props.t('sideChat.openAlone')} side="bottom">
              <Button
                size="sm"
                variant="ghost"
                className="dia-side-chat-tab-action"
                aria-label={props.t('sideChat.openAlone')}
                data-dia-side-chat-open-alone=""
                disabled={view.active?.sideSessionId == null}
                onClick={() => {
                  if (view.active !== null) props.openSideChatAlone(view.active.sideChatId)
                }}
              >
                <IconRightUpOutlineRegular size={14} />
              </Button>
            </Tooltip>
          }
        />
      )}
    </div>
  )
}

/**
 * Render the tab chip's glyph and localized title.
 * @param props - Typed annotation namespace translator.
 * @returns The side-chat glyph and label.
 */
export function SideChatTabTitle({ t }: PropsLocale<'dshAnnotation'>) {
  return (
    <>
      <IconNewChatOutlineRegular size={14} className="dia-side-chat-tab-icon" />
      {t('sideChat.title')}
    </>
  )
}

/**
 * Register the navigation entry, the tab body, and the composer chip/panel seats.
 * @param ctx - Client root carrying the public slot, Sidebar, and Session registries.
 * @param t - Typed annotation namespace translator.
 * @param options - Session owners and navigation effects.
 * @returns Navigation and disposal operations; disposal never releases a controller-held Session.
 */
export function registerSideChatSidebar(
  ctx: Context,
  t: PropsLocale<'dshAnnotation'>['t'],
  options: SideChatSidebarOptions,
): SideChatSidebar {
  const effects: Array<() => void> = []
  let disposed = false
  const absent: HostObservable<SideChatView | null> = {
    getSnapshot: () => null,
    subscribe: () => () => {},
  }

  const face = (mainSessionId: SessionId): SideChatPanelInjected => {
    const controller = (): SideChatController | undefined =>
      disposed ? undefined : options.controllerFor(mainSessionId)
    const run = (act: (owner: SideChatController) => void): void => {
      const owner = controller()
      if (owner === undefined) return
      try {
        act(owner)
      } catch (_unavailableChat) {
        void _unavailableChat
      }
    }
    return {
      hooks: {
        sideChat: controller() ?? absent,
      },
      removeReference: (referenceId) => run((owner) => owner.removeReference(referenceId)),
      referenceFor: (sideChatId) => controller()?.getReference(sideChatId),
      retainVisiblePanel: () => options.retainVisiblePanel(mainSessionId),
      removeAllReferences: () => run((owner) => owner.removeAllReferences()),
      locateReference: options.locateReference,
      retrySideChat: () =>
        run((owner) => {
          const snapshot = owner.getSnapshot()
          const target = snapshot.active?.sideChatId ?? snapshot.activeSideChatId
          if (target === null) return
          void options.prepareChat(mainSessionId, target)
        }),
      openSideChat: () => options.openPanel(mainSessionId),
      closeSideChat: () => {
        const tab = ctx.sidebarRight.tabsIn(mainSessionId).find((item) => item.kind === SIDE_CHAT_KIND)
        if (tab !== undefined) ctx.sidebarRight.hide(tab.id)
      },
      createSideChat: () =>
        run((owner) => {
          const created = owner.createChat()
          options.openPanel(mainSessionId)
          void options.prepareChat(mainSessionId, created.sideChatId)
        }),
      selectSideChat: (sideChatId) =>
        run((owner) => {
          owner.selectChat(sideChatId)
          void options.prepareChat(mainSessionId, sideChatId)
        }),
      retryChat: (sideChatId) => {
        void options.prepareChat(mainSessionId, sideChatId)
      },
      archiveChat: (sideChatId) => options.archiveChat(mainSessionId, sideChatId),
      deleteChat: (sideChatId) => options.deleteChat(mainSessionId, sideChatId),
      openSideChatAlone: (sideChatId) =>
        run((owner) => {
          const snapshot = owner.getSnapshot()
          const target = sideChatId ?? snapshot.activeSideChatId
          if (target === null || owner.chatView(target) === null) return
          void options.prepareChat(mainSessionId, target).then(() => {
            if (disposed) return
            const chat = owner.chatView(target)
            if (chat?.status === 'ready' && chat.sideSessionId !== null)
              options.openStandalone(chat.sideSessionId)
          })
        }),
      setReferencePanelOpen: (open) => run((owner) => owner.setReferencePanelOpen(open)),
      retrySideChatSave: () =>
        run((owner) => {
          owner.retryStorage()
        }),
      exportSideChatRecovery: () =>
        run((owner) => {
          const url = URL.createObjectURL(
            new Blob([owner.exportStorageRecovery()], { type: 'application/json' }),
          )
          const link = document.createElement('a')
          link.href = url
          link.download = `side-chat-recovery-${mainSessionId}.json`
          link.click()
          URL.revokeObjectURL(url)
        }),
    }
  }

  /**
   * Bind one composer to the exact side chat that owns its Session.
   *
   * The chip, record panel, and save notice read a per-chat projection instead of the
   * panel's currently selected chat. A composer that is not a known side Session gets
   * the empty observable, so a main conversation never renders another chat's references.
   */
  const sideFace = (sideSessionId: SessionId): SideChatPanelInjected => {
    const owner = options.controllerForSide(sideSessionId)
    const chat = owner?.chatForSideSession(sideSessionId) ?? null
    if (owner === undefined || chat === null) {
      return {
        retainVisiblePanel: () => () => {},
        hooks: { sideChat: absent },
        removeReference: () => {},
        referenceFor: () => undefined,
        removeAllReferences: () => {},
        locateReference: options.locateReference,
        retrySideChat: () => {},
        retrySideChatSave: () => {},
        exportSideChatRecovery: () => {},
        openSideChat: () => {},
        closeSideChat: () => {},
        createSideChat: () => {},
        selectSideChat: () => {},
        retryChat: () => {},
        archiveChat: async () => {},
        deleteChat: async () => {},
        openSideChatAlone: () => {},
        setReferencePanelOpen: () => {},
      }
    }
    const base = face(owner.mainSessionId)
    const id = chat.sideChatId
    return {
      ...base,
      hooks: { sideChat: owner.observableFor(id) },
      removeReference: (referenceId) => owner.removeReference(referenceId, id),
      referenceFor: (sideChatId) => owner.getReference(sideChatId),
      removeAllReferences: () => owner.removeAllReferences(id),
      setReferencePanelOpen: (open) => owner.setReferencePanelOpen(open, id),
      retrySideChat: () => {
        void options.prepareChat(owner.mainSessionId, id)
      },
      openSideChatAlone: (sideChatId) => {
        const target = sideChatId ?? id
        void options.prepareChat(owner.mainSessionId, target).then(() => {
          if (disposed) return
          const view = owner.chatView(target)
          if (view?.status === 'ready' && view.sideSessionId !== null)
            options.openStandalone(view.sideSessionId)
        })
      },
    }
  }

  effects.push(
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: SIDE_CHAT_TAB_ID,
          kind: SIDE_CHAT_KIND,
          priority: 'extension',
          keepMounted: true,
          title: () => t('sideChat.title'),
          guide: [
            {
              id: 'side-chat',
              order: 5,
              title: () => t('sideChat.title'),
              description: () => t('sideChat.guideDescription'),
              icon: IconNewChatOutlineRegular,
            },
          ],
        } satisfies SidebarRightTabDefinition),
      'dsh-annotation: side-chat tab type',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: SIDE_CHAT_TAB_ID,
              locale: 'dshAnnotation',
              children: { 'annotation.side-chat.tab': { kind: 'single', scope: 'session' } },
              inject: (mainSessionId: SessionId) => face(mainSessionId),
            },
            SideChatPanel,
          ),
        ),
      'dsh-annotation: side-chat tab body',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: SIDE_CHAT_TAB_ID, locale: 'dshAnnotation' },
            SideChatTabTitle,
          ),
        ),
      'dsh-annotation: side-chat tab title',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.guide.entry', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.guide.entry',
              key: SIDE_CHAT_TAB_ID,
              locale: 'dshAnnotation',
              inject: (mainSessionId: SessionId) => face(mainSessionId),
            },
            SideChatGuideEntry,
          ),
        ),
      'dsh-annotation: side-chat guide entry',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('annotation.side-chat.tab', () =>
          ctx.slots.register(
            {
              name: 'annotation.side-chat.tab',
              locale: 'dshAnnotation',
              children: { 'annotation.side-chat.conversation': { kind: 'single', scope: 'session' } },
              inject: (mainSessionId: SessionId) => face(mainSessionId),
            },
            SideChatTabContent,
          ),
        ),
      'dsh-annotation: retained side-chat body',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('annotation.side-chat.conversation', () =>
          ctx.slots.register({ name: 'annotation.side-chat.conversation' }, SideChatConversation),
        ),
      'dsh-annotation: embedded side Conversation',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'dsh-annotation-side-chat-chip',
              order: -30,
              locale: 'dshAnnotation',
              inject: (sideSessionId: SessionId) => sideFace(sideSessionId),
            },
            SideChatComposerChip,
          ),
        ),
      'dsh-annotation: side-chat reference chip',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'dsh-annotation-side-chat-record',
              order: -30,
              locale: 'dshAnnotation',
              inject: (sideSessionId: SessionId) => sideFace(sideSessionId),
            },
            SideChatRecordPanel,
          ),
        ),
      'dsh-annotation: side-chat record panel',
    ),
  )
  effects.push(
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'dsh-annotation-side-chat-notice',
              order: -25,
              locale: 'dshAnnotation',
              inject: (sideSessionId: SessionId) => sideFace(sideSessionId),
            },
            SideChatSubmissionNotice,
          ),
        ),
      'dsh-annotation: side-chat save notice',
    ),
  )
  return {
    open: (mainSessionId) => {
      if (disposed) return
      options.openPanel(mainSessionId)
    },
    hide: (mainSessionId) => {
      if (disposed) return
      const tab = ctx.sidebarRight.tabsIn(mainSessionId).find((item) => item.kind === SIDE_CHAT_KIND)
      if (tab !== undefined) ctx.sidebarRight.hide(tab.id)
    },
    face,
    async retire(mainSessionId) {
      const failures: unknown[] = []
      for (const tab of ctx.sidebarRight.tabsIn(mainSessionId)) {
        if (tab.kind !== SIDE_CHAT_KIND) continue
        try {
          ctx.sidebarRight.closeIn(mainSessionId, tab.id)
        } catch (cause: unknown) {
          failures.push(cause)
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Could not retire the side-chat interface')
    },
    async dispose() {
      disposed = true
      const results = await Promise.allSettled(
        effects
          .splice(0)
          .reverse()
          .map(async (release) => release()),
      )
      const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
      if (failures.length > 0) throw new AggregateError(failures, 'Could not release the side-chat interface')
    },
  }
}
