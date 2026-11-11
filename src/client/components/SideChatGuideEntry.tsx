/** Persistent right-Sidebar guide capsule: pending-count badge and a direct chat switch/new list. */
import {
  Button,
  IconChevronDownOutlineRegular,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  Tooltip,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import type { SideChatView } from '../side-chat-controller.ts'
import type { SideChatInjected } from './SideChatReferences.tsx'

/** Owner props and the plugin's own chat state and controls. */
export type SideChatGuideEntryProps = PropsRuntime<'sidebar.right.tab.guide.entry'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<SideChatInjected>

/**
 * Render the same guide capsule as the Host's stock entry with one fixed-meaning badge.
 *
 * The badge always counts pending references across every chat; it never switches
 * to a chat count. The capsule opens the panel through the plugin's own Host
 * navigation path, while its caret reveals a list of parallel chats for direct
 * switching or a fresh chat without first closing the panel. Hover assists
 * pointer users; keyboard and touch use the caret.
 * @param props - Guide copy, observable chat state, and chat actions.
 * @returns The guide capsule, or nothing once this entry is retired.
 */
export function SideChatGuideEntry({
  title,
  description,
  kind,
  useSideChat,
  useSessions,
  createSideChat,
  selectSideChat,
  openSideChat,
  t,
}: SideChatGuideEntryProps) {
  const view = useSideChat((value) => value)
  const summaries = useSessions((state) => state.byId)
  const [open, setOpen] = useState(false)
  if (view === null || view.status === 'disposed') return null
  const chats = view.chats.filter((chat) => !chat.archived)
  const pending = chats.reduce((total, chat) => total + chat.references.length, 0)
  const label = (chat: SideChatView['chats'][number], ordinal: number): string =>
    (chat.sideSessionId === null ? undefined : summaries[chat.sideSessionId]?.title) ??
    chat.title ??
    t('sideChat.untitled', { ordinal })
  const items: readonly MenuEntry[] = [
    ...(chats.length === 0
      ? [{ type: 'label' as const, id: 'side-chat-guide-empty', text: t('sideChat.guideEmpty') }]
      : []),
    ...chats.map((chat, index): MenuEntry => ({
      id: chat.sideChatId,
      label: label(chat, index + 1),
      ...(chat.references.length > 0
        ? { icon: <span className="dia-side-chat-guide__row-count">{chat.references.length}</span> }
        : {}),
    })),
    ...(chats.length > 0 ? [{ type: 'separator' as const, id: 'side-chat-guide-new-separator' }] : []),
    {
      id: 'side-chat-guide-new',
      label: t('sideChat.guideNew'),
      icon: <IconNewChatOutlineRegular size={14} />,
    },
  ]
  const choose = (id: string): void => {
    setOpen(false)
    if (id === 'side-chat-guide-new') createSideChat()
    else {
      const target = chats.find((chat) => chat.sideChatId === id)
      if (target === undefined) return
      selectSideChat(target.sideChatId)
    }
    openSideChat()
  }
  return (
    <div className="dia-side-chat-guide" data-sidebar-right-guide-entry={kind}>
      <Button
        variant="ghost"
        className="dia-side-chat-guide__main"
        aria-label={description === undefined ? title : `${title} ${description}`}
        onClick={openSideChat}
      />
      <span className="dia-side-chat-guide__icon" aria-hidden="true">
        <IconNewChatOutlineRegular size={description === undefined ? 22 : 26} />
      </span>
      <span className="dia-side-chat-guide__text" aria-hidden="true">
        <span className="dia-side-chat-guide__title-row">
          <span className="dia-side-chat-guide__title">{title}</span>
          {pending > 0 && (
            <span
              className="dia-side-chat-guide__badge"
              aria-label={t('sideChat.guideBadgeLabel', { count: pending })}
              data-dia-side-chat-badge=""
            >
              {pending}
            </span>
          )}
        </span>
        {description !== undefined && <span className="dia-side-chat-guide__description">{description}</span>}
      </span>
      <Tooltip label={t('sideChat.new')} side="top">
        <Button
          variant="ghost"
          size="sm"
          className="dia-side-chat-guide__new"
          aria-label={t('sideChat.new')}
          data-dia-side-chat-guide-new=""
          disabled={view.storageOutdated || !view.storageAvailable}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            createSideChat()
          }}
        >
          <IconPlusOutlineRegular size={14} />
        </Button>
      </Tooltip>
      <Menu
        open={open}
        portal
        align="end"
        minWidthFromAnchor
        className="dia-side-chat-guide__menu"
        items={items}
        selectedId={view.activeSideChatId ?? undefined}
        onClose={() => setOpen(false)}
        onSelect={choose}
        anchor={
          <Button
            variant="ghost"
            className="dia-side-chat-guide__caret"
            aria-label={t('sideChat.guideSwitch')}
            aria-haspopup="menu"
            aria-expanded={open}
            data-dia-side-chat-guide-switch=""
            onClick={() => setOpen((value) => !value)}
          >
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        }
      />
    </div>
  )
}
