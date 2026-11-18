/** Plugin-owned display adapters for the stock Workspace browser and Chat view. */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ISessions,
  SessionBinding,
  SessionListState,
  SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot, ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createElement, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import { isSideSessionId, sideSessionAddress } from '../shared/side-session-id.ts'
import { ChatSubmissionHandoff } from './chat-submission-handoff.ts'
import { preserveSideChatBlanks } from './side-chat-blank-reuse.ts'

function selectThrough<T>(
  useOriginal: SnapshotSelectorHook<T>,
  project: (value: T) => T,
): SnapshotSelectorHook<T> {
  return (select, equal) => useOriginal((value) => select(project(value)), equal)
}

/** Remove owned side rows only from the Workspace browser's local view of the catalog. */
export function workspaceMainSessions(list: SessionListState): SessionListState {
  if (!Object.keys(list.byId).some(isSideSessionId)) return list
  const byId = { ...list.byId }
  for (const id of Object.keys(byId)) if (isSideSessionId(id)) delete byId[id as SessionId]
  return { ...list, byId, ids: list.ids.filter((id) => !isSideSessionId(id)) }
}

function workspaceBrowser(Inner: ComponentType<WorkspaceBrowserProps>) {
  return function AnnotationWorkspaceBrowser(props: WorkspaceBrowserProps) {
    const useSessions = useMemo(() => {
      const cache = new WeakMap<SessionListState, SessionListState>()
      return selectThrough(props.useSessions, (list) => {
        const previous = cache.get(list)
        if (previous) return previous
        const visible = workspaceMainSessions(list)
        cache.set(list, visible)
        return visible
      })
    }, [props.useSessions])
    return createElement(Inner, { ...props, useSessions })
  }
}

type Outline = readonly { readonly seq: number }[]
const NO_TURNS: Outline = []
function visibleOutline(value: unknown, start: number): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((entry) => entry && typeof entry.seq === 'number' && entry.seq >= start)
}

/** A missing initial projection must not display inherited history while the side pane is opening. */
function SideTranscript({
  Inner,
  view,
  binding,
}: {
  Inner: ComponentType<ChatViewSlotProps>
  view: ChatViewSlotProps
  binding: SessionBinding
}) {
  const face = binding.session.projections.faceOf('chatTranscriptStart')
  const raw = useSyncExternalStore(face.subscribe, face.getSnapshot)
  const start = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : Infinity
  const order = view.useChat((chat) => chat.order)
  const nodes = view.useChat((chat) => chat.nodes)
  const navigation = view.useChat((chat) => chat.navigation.items())
  const keys = useMemo(
    () => new Set(order.filter((key) => (nodes.get(key)?.anchorSeq ?? -1) >= start)),
    [order, nodes, start],
  )
  const useChat = useMemo(() => {
    const visibleOrder = [...keys]
    const turns = navigation.filter((turn) => keys.has(turn.anchorKey))
    return selectThrough<ChatSnapshot>(view.useChat, (chat) => ({
      ...chat,
      order: visibleOrder,
      navigation: { items: () => turns },
    }))
  }, [view.useChat, keys, navigation])
  const grouped = view.useConversation((state) => state.views.grouped('chat'))
  const entries = view.useConversation((state) => state.views.grouped('chat')?.entries)
  const visibleEntries = useMemo(
    () =>
      entries?.filter((entry) =>
        entry.kind === 'node'
          ? keys.has(entry.key)
          : grouped
              ?.groupSource(entry.key)
              .getSnapshot()
              ?.members.some((member) => keys.has(member.key)),
      ),
    [entries, grouped, keys],
  )
  const useConversation = useMemo(
    () =>
      selectThrough<ConversationSnapshot>(view.useConversation, (state) => ({
        ...state,
        views: {
          get: (target) => state.views.get(target),
          grouped: (target) => {
            const current = state.views.grouped(target)
            return target === 'chat' && current && visibleEntries
              ? { entries: visibleEntries, groupSource: (key) => current.groupSource(key) }
              : current
          },
        },
      })),
    [view.useConversation, visibleEntries],
  )
  const outlineSource = binding.session.projections.faceOf('turnOutline')
  const outline = useSyncExternalStore(outlineSource.subscribe, outlineSource.getSnapshot)
  const shownOutline = useMemo(() => visibleOutline(outline, start) ?? NO_TURNS, [outline, start])
  const useProjection = useMemo(() => {
    const scoped = (
      key: string,
      select?: (value: unknown) => unknown,
      equal?: (left: unknown, right: unknown) => boolean,
    ) => {
      if (key === 'turnOutline') return select ? select(shownOutline) : shownOutline
      return Reflect.apply(view.useProjection, undefined, select ? [key, select, equal] : [key])
    }
    return scoped as ChatViewSlotProps['useProjection']
  }, [view.useProjection, shownOutline])
  const events = binding.eventSource
  const earlier = useMemo(() => {
    let revision = -1
    let first = 0
    return {
      subscribe: events.subscribe.bind(events),
      getSnapshot: () => {
        const window = events.getSnapshot()
        if (window.hasMore && revision !== window.revision) {
          const change = window.change
          if (revision + 1 !== window.revision || change.kind === 'replace')
            first = window.entries[0]?.event.seq ?? 0
          else if (change.kind === 'prepend') first = change.entries[0]?.event.seq ?? first
        }
        revision = window.revision
        return window.hasMore && first > start
      },
    }
  }, [events, start])
  const older = useSyncExternalStore(earlier.subscribe, earlier.getSnapshot)
  const useSession = useMemo(
    () =>
      selectThrough<SessionSnapshot>(view.useSession, (session) => ({
        ...session,
        hasMore: older && session.hasMore,
        historyWasPartial: false,
      })),
    [view.useSession, older],
  )
  return createElement(Inner, { ...view, useSession, useChat, useConversation, useProjection })
}

function withHandoff(
  Inner: ComponentType<ChatViewSlotProps>,
  ctx: Context,
  sessions: ISessions,
  lifetime: AbortSignal,
) {
  const stores = new WeakMap<SessionBinding, ChatSubmissionHandoff>()
  function BoundChat({ binding, view }: { binding: SessionBinding; view: ChatViewSlotProps }) {
    let handoff = stores.get(binding)
    if (!handoff) {
      handoff = new ChatSubmissionHandoff(
        binding,
        ctx.uiConversation.binding(binding).target('chat'),
        lifetime,
      )
      stores.set(binding, handoff)
    }
    const extra = useSyncExternalStore(handoff.subscribe, handoff.getSnapshot)
    const useSession = useMemo(() => {
      if (!extra.length) return view.useSession
      const cache = new WeakMap<SessionSnapshot, SessionSnapshot>()
      return selectThrough<SessionSnapshot>(view.useSession, (session) => {
        const previous = cache.get(session)
        if (previous) return previous
        const missing = extra.filter(
          (echo) => !session.pendingSubmissions.some((row) => row.requestId === echo.requestId),
        )
        const result = missing.length
          ? { ...session, pendingSubmissions: [...session.pendingSubmissions, ...missing] }
          : session
        cache.set(session, result)
        return result
      })
    }, [view.useSession, extra])
    const props = { ...view, useSession }
    return sideSessionAddress(binding.sessionId)
      ? createElement(SideTranscript, { Inner, view: props, binding })
      : createElement(Inner, props)
  }
  return function AnnotationChatView(props: ChatViewSlotProps) {
    const binding = sessions.binding(props.sessionId)
    return binding ? createElement(BoundChat, { binding, view: props }) : createElement(Inner, props)
  }
}

/** Keep the original entry's children, hooks, locale and store while adapting its rendered props. */
function decorate<P extends object>(
  ctx: Context,
  slot: 'conversation.view' | 'sidebar.workspaces',
  accepts: (entry: StoredEntry) => boolean,
  wrap: (inner: ComponentType<P>) => ComponentType<P>,
) {
  const current = new Map<StoredEntry, { inner: unknown; wrapper: ComponentType<P> }>()
  const registry: { entries(name: string): readonly StoredEntry[] } = ctx.slots
  const sync = () => {
    const entries = registry.entries(slot)
    for (const [entry, record] of current) {
      if (entries.includes(entry)) continue
      if (entry.component === record.wrapper) entry.component = record.inner
      current.delete(entry)
    }
    for (const entry of entries) {
      if (!accepts(entry) || current.get(entry)?.wrapper === entry.component) continue
      const inner = entry.component
      if (
        typeof inner !== 'function' &&
        !(typeof inner === 'object' && inner !== null && '$$typeof' in inner)
      )
        continue
      const wrapper = wrap(inner as ComponentType<P>)
      current.set(entry, { inner, wrapper })
      entry.component = wrapper
    }
  }
  sync()
  const stop = ctx.on('slots/changed', (key) => {
    if (key === slot) sync()
  })
  return {
    ready: () => current.size > 0,
    dispose: () => {
      stop()
      for (const [entry, record] of current)
        if (entry.component === record.wrapper) entry.component = record.inner
      current.clear()
    },
  }
}

/** Install the stock-client adapters for this plugin's lifetime. Native Workspace filtering may own the list. */
export function installSideChatPresentation(ctx: Context, sessions: ISessions, nativeFilter: boolean) {
  const lifetime = new AbortController()
  const navigation = ctx.get('uiWorkspace')
  const restoreNavigation =
    nativeFilter || !navigation ? undefined : preserveSideChatBlanks(navigation, sessions, ctx.workspaces)
  const workspace = nativeFilter
    ? undefined
    : decorate(ctx, 'sidebar.workspaces', () => true, workspaceBrowser)
  const chat = decorate<ChatViewSlotProps>(
    ctx,
    'conversation.view',
    (entry) => entry.options.id === 'chat',
    (inner) => withHandoff(inner, ctx, sessions, lifetime.signal),
  )
  return {
    listReady: () => nativeFilter || workspace?.ready() === true,
    dispose: () => {
      lifetime.abort()
      restoreNavigation?.()
      chat.dispose()
      workspace?.dispose()
    },
  }
}
