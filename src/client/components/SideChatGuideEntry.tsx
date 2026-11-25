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
import { useEffect, useState } from 'react'
import type { SideChatId } from '../../shared/side-chat-types.ts'
import type { SideChatView } from '../side-chat-controller.ts'
import { sideChatDisplayTitle } from '../side-chat-title.ts'
import type { SideChatInjected } from './SideChatReferences.tsx'

/** Owner props and the plugin's own chat state and controls. */
export type SideChatGuideEntryProps = PropsRuntime<'sidebar.right.tab.guide.entry'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<SideChatInjected & { readonly restoreChat: (id: SideChatId) => Promise<void> }>

/**
 * Render the same guide capsule as the Host's stock entry with one fixed-meaning badge.
 *
 * The badge always counts pending references across every chat; it never switches
 * to a chat count. The capsule opens the panel through the plugin's own Host
 * navigation path. The trailing plus opens a fresh chat, and the switch menu
 * appears when there are chats to choose from.
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
  restoreChat,
  t,
}: SideChatGuideEntryProps) {
  const view = useSideChat((value) => value)
  const summaries = useSessions((state) => state.byId)
  const [open, setOpen] = useState(false)
  const chats = view?.chats.filter((chat) => !chat.archived) ?? []
  const hasChats = (view?.chats.length ?? 0) > 0
  useEffect(() => {
    if (!hasChats) setOpen(false)
  }, [hasChats])
  if (view === null || view.status === 'disposed') return null
  const pending = chats.reduce((total, chat) => total + chat.references.length, 0)
  const archived = view.chats.filter((chat) => chat.archived)
  const canCreate = view.storageAvailable && !view.storageOutdated
  const label = (chat: SideChatView['chats'][number]): string =>
    sideChatDisplayTitle(
      chat.sideSessionId === null ? undefined : summaries[chat.sideSessionId]?.title,
      chat.title ?? t('sideChat.untitled', { ordinal: view.chats.indexOf(chat) + 1 }),
    )
  const items: readonly MenuEntry[] = [
    ...chats.map((chat): MenuEntry => ({
      id: chat.sideChatId,
      label: label(chat),
      ...(chat.references.length > 0
        ? { icon: <span className="dia-side-chat-guide__row-count">{chat.references.length}</span> }
        : {}),
    })),
    ...(archived.length === 0
      ? []
      : [
          { type: 'label', id: 'side-chat-guide-archived', text: t('sideChat.archivedList') } as const,
          ...archived.map((chat) => ({
            id: chat.sideChatId,
            label: t('sideChat.restoreChat', { title: label(chat) }),
          })),
        ]),
    { type: 'separator', id: 'side-chat-guide-new-separator' },
    {
      id: 'side-chat-guide-new',
      label: t('sideChat.guideNew'),
      icon: <IconNewChatOutlineRegular size={14} />,
      disabled: !canCreate,
    },
  ]
  const choose = (id: string): void => {
    setOpen(false)
    if (id === 'side-chat-guide-new') {
      createSideChat()
      return
    }
    const target = view.chats.find((chat) => chat.sideChatId === id)
    if (target === undefined) return
    if (target.archived) void restoreChat(target.sideChatId)
    else {
      selectSideChat(target.sideChatId)
      openSideChat()
    }
  }
  return (
    <div className="dia-side-chat-guide" data-sidebar-right-guide-entry={kind}>
      <button
        type="button"
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
      <span className="dia-side-chat-guide__actions">
        {hasChats && (
          <Menu
            open={open}
            portal
            align="end"
            minWidthFromAnchor
            items={items}
            selectedId={view.activeSideChatId ?? undefined}
            onClose={() => setOpen(false)}
            onSelect={choose}
            anchor={
              <Button
                variant="ghost"
                size="sm"
                className="dia-side-chat-guide__action"
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
        )}
        <Tooltip portal label={t('sideChat.new')} side="bottom" delayMs={500}>
          <Button
            variant="ghost"
            size="sm"
            className="dia-side-chat-guide__action"
            aria-label={t('sideChat.new')}
            data-dia-side-chat-guide-new=""
            disabled={!canCreate}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              createSideChat()
            }}
          >
            <IconPlusOutlineRegular size={14} />
          </Button>
        </Tooltip>
      </span>
    </div>
  )
}
