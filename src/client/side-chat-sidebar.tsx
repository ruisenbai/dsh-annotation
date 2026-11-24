/** Right-Sidebar tabs and embedded Conversations for chats owned by one main Session. */
import { useLayoutEffect, useState } from 'react'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
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
  Menu,
  MenuItemButton,
  IconNewChatOutlineRegular,
  IconRightUpOutlineRegular,
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
/** Shared kind for side-chat resources and the empty guide destination. */
export const SIDE_CHAT_KIND = 'annotationsidechat'

const SIDE_CHAT_ADDRESS = 'dsh-resource://annotationsidechat/'

function chatAddress(chatId: SideChatId): string {
  return SIDE_CHAT_ADDRESS + encodeURIComponent(chatId)
}

function chatForTab(view: SideChatView | null, address: string): SideChatChatView | undefined {
  return view?.chats.find((chat) => chatAddress(chat.sideChatId) === address)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Embedded side Conversation binds its independent Session through SessionProvider. */
    'annotation.side-chat.conversation': { kind: 'single'; scope: 'session' }
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
  /** @param mainSessionId - Owner of one visible panel occurrence. @returns Its visibility release. */
  readonly retainVisiblePanel: (mainSessionId: SessionId) => () => void
  /** Prepare exactly one chat's Session; the owner's own prepare deduplicates concurrent calls. */
  readonly prepareChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
  /** @param sideSessionId - side Conversation to show as an ordinary full page. */
  readonly openStandalone: (sideSessionId: SessionId) => void
  /** Official confirmation and lifecycle paths, capturing the clicked Tab identity. */
  readonly archiveChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
  readonly restoreChat: (mainSessionId: SessionId, sideChatId: SideChatId) => Promise<void>
}

/** Navigation bridge owned by the plugin's install path. */
export interface SideChatSidebar {
  /** @param mainSessionId - owner whose panel is revealed in the right Sidebar. */
  open(mainSessionId: SessionId): void
  /** @param mainSessionId - owner whose panel presentation is hidden; chat state stays live. */
  hide(mainSessionId: SessionId): void
  /** @param mainSessionId - owner of the archived or deleted chat. @param sideChatId - exact chat to remove from the tab strip. */
  closeChatTab(mainSessionId: SessionId, sideChatId: SideChatId): void
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

const ignoreWorkspaceSelection = (): Promise<void> => Promise.resolve()

/**
 * Render the shared Host conversation content inside one independent Session scope.
 * @param props - Standard Session hooks and the Host Conversation factory.
 * @returns The embedded Conversation with its fixed chat View and bottom composer.
 */
export function SideChatConversation({ useSession, renderFactorySlot }: SideChatConversationProps) {
  const session = useSession((value) => value)
  const phase = session.openState === 'loading' ? 'settling' : 'active'
  const content = {
    variant: 'embedded',
    phase,
    hero: false,
    // The owning conversation fixes the Workspace. Master requires this callback for Hero pickers.
    onWorkspaceSelected: ignoreWorkspaceSelection,
  } as const
  return renderFactorySlot('conversation.content', content, { slots: { views: FixedSideChatView } })
}

/** Observable chat list plus the explicit chat management actions. */
export interface SideChatPanelInjected extends SideChatInjected {
  /** @returns A visibility release for this panel occurrence; call it on hide or unmount. */
  readonly retainVisiblePanel: () => () => void
  /** @param tabId - Host tab occurrence. @returns Whether it is the foreground tab. */
  readonly isActiveTab: (tabId: TabId) => boolean
  /** @param sideChatId - chat whose Session needs to load in a visible pane. */
  readonly retryChat: (sideChatId: SideChatId) => void
  /** @param sideChatId - exact chat to archive through the official Session action. */
  readonly archiveChat: (sideChatId: SideChatId) => Promise<void>
  /** @param sideChatId - archived chat to restore. */
  readonly restoreChat: (sideChatId: SideChatId) => Promise<void>
  /** @param sideChatId - chat whose ready Session reference is wanted. @returns The owner-held reference, without a second lifetime. */
  readonly referenceFor: (sideChatId: SideChatId) => SessionReference | undefined
}

/** Host tab data, the embedded Conversation seat, and localized copy. */
export type SideChatPanelProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsRenderSlots<'annotation.side-chat.conversation'> &
  InjectFace<SideChatPanelInjected> &
  PropsLocale<'dshAnnotation'>

function SideChatTabContent({ chat, ...props }: SideChatPanelProps & { readonly chat: SideChatChatView }) {
  const selected = props.useSideChat((view) => view?.activeSideChatId === chat.sideChatId)
  const retainedInMain = props.useSessions((state) =>
    chat.sideSessionId === null ? 0 : (state.byId[chat.sideSessionId]?.retainedBy.mainView ?? 0),
  )
  // The Session owns one composer editor; its full page holds the DOM binding while open.
  if (retainedInMain > 0) return null
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
          {selected && <SideChatSubmissionNotice {...props} preparationShown />}
        </div>
      ) : (
        <props.SessionProvider session={reference}>
          {props.renderSlot('annotation.side-chat.conversation', {})}
        </props.SessionProvider>
      )}
    </div>
  )
}

/** @param props - One Host tab's owner state. @returns The retained chat, or the guide's empty destination. */
export function SideChatPanel(props: SideChatPanelProps) {
  const view = props.useSideChat((value) => value)
  const { tab } = props.useTabInfo()
  const isChat = tab.contentId.startsWith(SIDE_CHAT_ADDRESS)
  const chat = chatForTab(view, tab.contentId)
  const chatId = chat?.archived === false ? chat.sideChatId : undefined
  const available = view !== null && view.status !== 'disposed'
  const visible = tab.visible && available && (!isChat || chatId !== undefined)
  const focused = visible && props.isActiveTab(tab.id)
  const needsLoad = chat?.status === 'idle'
  const migrate = visible && !isChat && view?.activeSideChatId != null
  useLayoutEffect(() => {
    if (visible) return props.retainVisiblePanel()
    return undefined
  }, [visible, props.retainVisiblePanel])
  useLayoutEffect(() => {
    if (!visible || chatId === undefined) return
    if (focused) props.selectSideChat(chatId)
    else if (needsLoad) props.retryChat(chatId)
  }, [visible, focused, chatId, needsLoad, props.selectSideChat, props.retryChat])
  useLayoutEffect(() => {
    if (migrate) props.openSideChat()
  }, [migrate, props.openSideChat])
  if (view === null || view.status === 'disposed') return null
  if (chat?.archived === true) return null
  return (
    <div
      className="dia-side-chat-root"
      data-dia-side-chat=""
      data-main-session={view.mainSessionId}
      data-side-session={chat?.sideSessionId ?? undefined}
    >
      {chat === undefined ? (
        <EmptySideChatPanel {...props} view={view} />
      ) : (
        <SideChatTabContent {...props} chat={chat} />
      )}
    </div>
  )
}

function EmptySideChatPanel(props: SideChatPanelProps & { readonly view: SideChatView }) {
  const [showArchived, setShowArchived] = useState(false)
  const { view, t } = props
  const summaries = props.useSessions((state) => state.byId)
  const archived = view.chats.flatMap((chat, index) =>
    chat.archived
      ? [
          {
            id: chat.sideChatId,
            label: t('sideChat.restoreChat', {
              title: sideChatDisplayTitle(
                chat.sideSessionId === null ? undefined : summaries[chat.sideSessionId]?.title,
                chat.title ?? t('sideChat.untitled', { ordinal: index + 1 }),
              ),
            }),
          },
        ]
      : [],
  )
  return (
    <div className="dia-side-chat-preparation" data-dia-side-chat-empty="">
      <p className="dia-side-chat-empty">{t('sideChat.guideEmpty')}</p>
      <Button
        size="sm"
        data-dia-side-chat-new=""
        disabled={view.storageOutdated || !view.storageAvailable}
        icon={<IconNewChatOutlineRegular size={14} />}
        onClick={props.createSideChat}
      >
        {t('sideChat.new')}
      </Button>
      {archived.length > 0 && (
        <Menu
          open={showArchived}
          portal
          items={archived}
          onClose={() => setShowArchived(false)}
          onSelect={(id) => {
            setShowArchived(false)
            const entry = archived.find((item) => item.id === id)
            if (entry !== undefined) void props.restoreChat(entry.id)
          }}
          anchor={
            <Button
              size="sm"
              data-dia-side-chat-archives=""
              aria-haspopup="menu"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              {t('sideChat.archivedList')}
            </Button>
          }
        />
      )}
      <SideChatSubmissionNotice {...props} />
    </div>
  )
}

/** Host title props with the exact chat's management actions. */
export type SideChatTabTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'> &
  InjectFace<SideChatPanelInjected> &
  PropsLocale<'dshAnnotation'>

/** @param props - Sidebar tab identity, current title and actions. @returns The title and its inline controls. */
export function SideChatTabTitle(props: SideChatTabTitleProps) {
  const { tab } = props.useTabInfo()
  const view = props.useSideChat((value) => value)
  const chat = chatForTab(view, tab.contentId)
  const summary = props.useSessions((state) =>
    chat?.sideSessionId == null ? undefined : state.byId[chat.sideSessionId]?.title,
  )
  useLayoutEffect(() => {
    if (chat?.archived === true) tab.actions.close()
  }, [chat?.archived, tab.actions])
  const { t } = props
  if (chat === undefined || chat.archived)
    return (
      <>
        <IconNewChatOutlineRegular size={14} className="dia-side-chat-tab-icon" />
        {t('sideChat.title')}
      </>
    )
  const id = chat.sideChatId
  const ordinal = (view?.chats.indexOf(chat) ?? 0) + 1
  const title = sideChatDisplayTitle(summary, chat.title ?? t('sideChat.untitled', { ordinal }))
  return (
    <span
      className="dia-side-chat-tab-title"
      onPointerDown={(event) => {
        // Let a touch swipe scroll the strip without starting a dock drag.
        if (event.pointerType === 'touch') event.stopPropagation()
      }}
    >
      <span className="dia-side-chat-tab-label" title={title} data-dia-side-chat-select={id}>
        {title}
      </span>
      <span
        className="dia-side-chat-tab-actions"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Tooltip portal label={t('sideChat.archiveChat')} side="bottom">
          <button
            type="button"
            className="dia-side-chat-tab-action"
            aria-label={t('sideChat.archiveChat')}
            data-dia-side-chat-archive={id}
            onClick={() => void props.archiveChat(id)}
          >
            <IconArchiveOutlineRegular size={16} />
          </button>
        </Tooltip>
        <Tooltip portal label={t('sideChat.openAlone')} side="bottom">
          <button
            type="button"
            className="dia-side-chat-tab-action"
            aria-label={t('sideChat.openAlone')}
            data-dia-side-chat-open-alone={id}
            onClick={() => props.openSideChatAlone(id)}
          >
            <IconRightUpOutlineRegular size={16} />
          </button>
        </Tooltip>
      </span>
    </span>
  )
}

type SideChatTabMenuProps = PropsRuntime<'sidebar.right.tab.menu.item'> &
  InjectFace<SideChatPanelInjected> &
  PropsLocale<'dshAnnotation'>

function SideChatTabMenu({ tab, dismiss, useSideChat, createSideChat, t }: SideChatTabMenuProps) {
  const canCreate = useSideChat((view) => view !== null && view.storageAvailable && !view.storageOutdated)
  if (tab.kind !== SIDE_CHAT_KIND) return null
  return (
    <MenuItemButton
      icon={<IconNewChatOutlineRegular size={16} />}
      disabled={!canCreate}
      onSelect={() => {
        dismiss()
        createSideChat()
      }}
    >
      {t('sideChat.new')}
    </MenuItemButton>
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

  const tabsFor = (mainSessionId: SessionId) =>
    ctx.sidebarRight.tabsIn(mainSessionId).filter((tab) => tab.kind === SIDE_CHAT_KIND)

  const open = (mainSessionId: SessionId): void => {
    const owner = disposed ? undefined : options.controllerFor(mainSessionId)
    if (owner === undefined) return
    owner.show()
    const { chats, active } = owner.getSnapshot()
    if (active === null || active.archived) {
      ctx.sidebarRight.openTabIn(mainSessionId, SIDE_CHAT_KIND)
      return
    }
    const tabs = tabsFor(mainSessionId)
    const pages = tabs.filter((tab) => !tab.contentId.startsWith(SIDE_CHAT_ADDRESS))
    const openChat = (chat: SideChatChatView): void =>
      ctx.sidebarRight.openResourceIn(mainSessionId, chatAddress(chat.sideChatId), { kind: SIDE_CHAT_KIND })
    // On first open or upgrade, admit the saved chats in creation order.
    // Subsequent opens reveal just the requested chat, including an explicitly closed tab.
    if (tabs.length === 0 || pages.length > 0) {
      const saved = chats.filter((chat) => !chat.archived)
      if (saved.at(-1) === active) saved.pop()
      for (const chat of saved) openChat(chat)
    }
    openChat(active)
    for (const tab of pages) ctx.sidebarRight.closeIn(mainSessionId, tab.id)
    void options.prepareChat(mainSessionId, active.sideChatId)
  }

  const hide = (mainSessionId: SessionId): void => {
    if (disposed || ctx.sidebarRight.mounted.getSnapshot() !== mainSessionId) return
    const active = ctx.sidebarRight.active()
    const tab = active?.kind === SIDE_CHAT_KIND ? active : tabsFor(mainSessionId)[0]
    if (tab !== undefined) ctx.sidebarRight.hide(tab.id)
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
      isActiveTab: (tabId) => ctx.sidebarRight.active()?.id === tabId,
      removeAllReferences: () => run((owner) => owner.removeAllReferences()),
      locateReference: options.locateReference,
      retrySideChat: () =>
        run((owner) => {
          const snapshot = owner.getSnapshot()
          const target = snapshot.active?.sideChatId ?? snapshot.activeSideChatId
          if (target === null) return
          void options.prepareChat(mainSessionId, target)
        }),
      openSideChat: () => open(mainSessionId),
      closeSideChat: () => hide(mainSessionId),
      createSideChat: () =>
        run((owner) => {
          owner.createChat()
          open(mainSessionId)
        }),
      selectSideChat: (sideChatId) =>
        run((owner) => {
          owner.selectChat(sideChatId)
          if (owner.chatView(sideChatId)?.status === 'idle')
            void options.prepareChat(mainSessionId, sideChatId)
        }),
      retryChat: (sideChatId) => {
        void options.prepareChat(mainSessionId, sideChatId)
      },
      archiveChat: (sideChatId) => options.archiveChat(mainSessionId, sideChatId),
      restoreChat: (sideChatId) => options.restoreChat(mainSessionId, sideChatId),
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
        isActiveTab: () => false,
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
        restoreChat: async () => {},
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
          patterns: [SIDE_CHAT_ADDRESS + '*'],
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
              children: { 'annotation.side-chat.conversation': { kind: 'single', scope: 'session' } },
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
            {
              name: 'sidebar.right.pane.tab.title',
              key: SIDE_CHAT_TAB_ID,
              locale: 'dshAnnotation',
              inject: (mainSessionId: SessionId) => face(mainSessionId),
            },
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
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.menu.item',
              id: 'dsh-annotation-side-chat-new',
              locale: 'dshAnnotation',
              inject: (mainSessionId: SessionId) => face(mainSessionId),
            },
            SideChatTabMenu,
          ),
        ),
      'dsh-annotation: side-chat tab menu',
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
    open,
    hide,
    closeChatTab: (mainSessionId, sideChatId) => {
      if (disposed) return
      const address = chatAddress(sideChatId)
      for (const tab of tabsFor(mainSessionId)) {
        if (tab.contentId === address) ctx.sidebarRight.closeIn(mainSessionId, tab.id)
      }
    },
    face,
    async retire(mainSessionId) {
      const failures: unknown[] = []
      for (const tab of tabsFor(mainSessionId)) {
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
