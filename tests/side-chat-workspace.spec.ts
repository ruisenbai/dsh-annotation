import type {
  IWorkspaces,
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it, vi } from 'vitest'
import { preserveSideChatBlanks } from '../src/client/side-chat-blank-reuse.ts'
import { workspaceActivity } from '../src/client/side-chat-presentation.tsx'
import { sideParentKey, ownedSideSessionId } from '../src/shared/side-session-id.ts'
import { resolveSideChatWorkspace } from '../src/client/side-chat-workspace.ts'

const mainId = SessionId('workspace-main')

function row(id: string, sessionIds: readonly ReturnType<typeof SessionId>[] = [mainId]): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path: `/work/${id}`,
    title: id,
    sessionIds,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  }
}

function state(
  phase: WorkspaceSnapshot['phase'],
  items: readonly WorkspaceView[] = [],
  status: WorkspaceSnapshot['state'] = 'idle',
): WorkspaceSnapshot {
  return { phase, items, state: status, archivedSessionIds: [], pinnedSessionIds: [], error: null }
}

function observable<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const releases: Array<ReturnType<typeof vi.fn>> = []
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    const release = vi.fn(() => {
      listeners.delete(listener)
    })
    releases.push(release)
    return release
  })
  const list = { getSnapshot: () => snapshot, subscribe }
  const publish = (value: T): void => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  return { list, listeners, releases, subscribe, publish }
}

function catalog(
  phase: SessionListState['phase'] = 'ready',
  rows: readonly { id: ReturnType<typeof SessionId>; cwd?: string }[] = [],
): SessionListState {
  return {
    phase,
    ids: rows.map((item) => item.id),
    byId: Object.fromEntries(
      rows.map((item) => [
        item.id,
        {
          ...item,
          displayTitle: item.id,
          running: false,
          blank: false,
          retainedBy: {},
          updatedAt: 1,
        },
      ]),
    ),
    projectionsBySession: {},
  }
}

function source(initial: WorkspaceSnapshot, sessionInitial = catalog()) {
  const workspace = observable(initial)
  const sessionCatalog = observable(sessionInitial)
  const workspaces: Pick<IWorkspaces, 'list'> = { list: workspace.list }
  const sessions: Pick<ISessions, 'list'> = { list: sessionCatalog.list }
  return { ...workspace, workspaces, sessions, catalog: sessionCatalog }
}

describe('workspace side-chat activity', () => {
  it('stays active until the last child settles and leaves the parent’s own status intact', () => {
    const [left, right] = [ownedSideSessionId(mainId, 'left'), ownedSideSessionId(mainId, 'right')] as const
    const list = catalog('ready', [{ id: mainId }, { id: left }, { id: right }])
    const parents = new Map([[sideParentKey(mainId), mainId]])
    const idle = {
      running: false,
      completionUnread: false,
      completionFailed: false,
      pendingInteraction: undefined,
    }
    const busy = { ...idle, running: true }
    for (const [a, b] of [
      [busy, busy],
      [busy, idle],
      [idle, busy],
      [idle, idle],
    ] as const) {
      const input = new Map([
        [mainId, idle],
        [left, a],
        [right, b],
      ])
      const visible = workspaceActivity(list, input, parents)
      expect(visible.get(mainId)?.running).toBe(a.running || b.running)
      expect(input.get(mainId)).toBe(idle)
    }
    const own = new Map([
      [mainId, busy],
      [left, idle],
      [right, idle],
    ])
    expect(workspaceActivity(list, own, parents)).toBe(own)
  })
})

describe('side-chat Workspace creation environment', () => {
  it('uses exact main membership from a ready list without reading cwd or creating a workspace', async () => {
    const fixture = source(state('ready', [row('other', [SessionId('other-main')]), row('main-workspace')]))
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
    ).resolves.toEqual({ workspaceId: 'main-workspace' })
    expect(fixture.subscribe).not.toHaveBeenCalled()
  })

  it('waits through pending loading and releases the subscription when membership arrives', async () => {
    const fixture = source(state('pending', [], 'loading'))
    const resolved = vi.fn()
    const preparation = resolveSideChatWorkspace(
      fixture.workspaces,
      fixture.sessions,
      mainId,
      new AbortController().signal,
    ).then(resolved)
    expect(fixture.listeners.size).toBe(1)
    fixture.publish(state('pending', [row('stale-workspace')], 'loading'))
    expect(resolved).not.toHaveBeenCalled()
    fixture.publish(state('ready', [row('main-workspace')]))
    await preparation
    expect(resolved).toHaveBeenCalledWith({ workspaceId: 'main-workspace' })
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.releases[0]).toHaveBeenCalledOnce()
  })

  it('rejects a failed list and allows a new attempt after the list recovers', async () => {
    const fixture = source(state('pending', [], 'loading'))
    const preparation = resolveSideChatWorkspace(
      fixture.workspaces,
      fixture.sessions,
      mainId,
      new AbortController().signal,
    )
    const refusal = expect(preparation).rejects.toMatchObject({ code: 'workspace' })
    fixture.publish(state('pending', [], 'error'))
    await refusal
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.releases[0]).toHaveBeenCalledOnce()
    fixture.publish(state('ready', [row('recovered-workspace')]))
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
    ).resolves.toEqual({ workspaceId: 'recovered-workspace' })
  })

  it.each([
    state('ready'),
    state('ready', [row('other', [SessionId('other-main')])]),
    state('ready', [row('stale-workspace')], 'error'),
  ])('rejects an unavailable main location or a failed list', async (snapshot) => {
    const fixture = source(snapshot)
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'workspace' })
    expect(fixture.subscribe).not.toHaveBeenCalled()
  })

  it('cancels pending membership resolution and ignores later list publication', async () => {
    const fixture = source(state('pending', [], 'loading'))
    const controller = new AbortController()
    const preparation = resolveSideChatWorkspace(
      fixture.workspaces,
      fixture.sessions,
      mainId,
      controller.signal,
    )
    const refusal = expect(preparation).rejects.toMatchObject({ code: 'disposed' })
    controller.abort()
    await refusal
    fixture.publish(state('ready', [row('late-workspace')]))
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.releases[0]).toHaveBeenCalledOnce()
  })

  it('rejects an already-cancelled attempt without subscribing', async () => {
    const fixture = source(state('ready', [row('main-workspace')]))
    const controller = new AbortController()
    controller.abort()
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, controller.signal),
    ).rejects.toMatchObject({ code: 'disposed' })
    expect(fixture.subscribe).not.toHaveBeenCalled()
  })

  it('rechecks a baseline arriving between its initial read and subscription', async () => {
    const fixture = source(state('pending', [], 'loading'))
    fixture.subscribe.mockImplementationOnce(() => {
      fixture.publish(state('ready', [row('raced-workspace')]))
      return vi.fn()
    })
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
    ).resolves.toEqual({ workspaceId: 'raced-workspace' })
  })

  it('uses only an ungrouped main Session’s recorded cwd without registering a Workspace or choosing another main', async () => {
    const fixture = source(
      state('ready', [row('unrelated', [SessionId('another-main')])]),
      catalog('ready', [
        { id: SessionId('another-main'), cwd: '/other/main' },
        { id: mainId, cwd: '/recorded/main' },
      ]),
    )
    await expect(
      resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
    ).resolves.toEqual({ cwd: '/recorded/main' })
    expect(fixture.subscribe).not.toHaveBeenCalled()
    expect(fixture.catalog.subscribe).not.toHaveBeenCalled()
  })

  it('waits for a ready Workspace list before using the recorded cwd', async () => {
    const fixture = source(
      state('pending', [], 'loading'),
      catalog('ready', [{ id: mainId, cwd: '/recorded/main' }]),
    )
    const resolved = vi.fn()
    const preparation = resolveSideChatWorkspace(
      fixture.workspaces,
      fixture.sessions,
      mainId,
      new AbortController().signal,
    ).then(resolved)
    expect(resolved).not.toHaveBeenCalled()
    fixture.publish(state('ready'))
    await preparation
    expect(resolved).toHaveBeenCalledWith({ cwd: '/recorded/main' })
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.catalog.listeners.size).toBe(0)
    expect(fixture.releases[0]).toHaveBeenCalledOnce()
    expect(fixture.catalog.releases[0]).toHaveBeenCalledOnce()
  })

  it('ignores a pending Session catalog cwd and releases both observers when its authoritative catalog arrives', async () => {
    const fixture = source(state('ready'), catalog('pending', [{ id: mainId, cwd: '/stale/main' }]))
    const resolved = vi.fn()
    const preparation = resolveSideChatWorkspace(
      fixture.workspaces,
      fixture.sessions,
      mainId,
      new AbortController().signal,
    ).then(resolved)
    expect(fixture.catalog.listeners.size).toBe(1)
    expect(resolved).not.toHaveBeenCalled()
    fixture.catalog.publish(catalog('ready', [{ id: mainId, cwd: '/recorded/main' }]))
    await preparation
    expect(resolved).toHaveBeenCalledWith({ cwd: '/recorded/main' })
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.catalog.listeners.size).toBe(0)
    expect(fixture.releases[0]).toHaveBeenCalledOnce()
    expect(fixture.catalog.releases[0]).toHaveBeenCalledOnce()
  })

  it.each([undefined, ''])(
    'refuses an ungrouped main without recorded cwd %s instead of using the Host default',
    async (cwd) => {
      const fixture = source(
        state('ready'),
        catalog('ready', [{ id: mainId, ...(cwd === undefined ? {} : { cwd }) }]),
      )
      await expect(
        resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'workspace' })
    },
  )

  it('cancels pending catalog resolution and ignores its late cwd', async () => {
    const fixture = source(state('ready'), catalog('pending'))
    const abort = new AbortController()
    const preparation = resolveSideChatWorkspace(fixture.workspaces, fixture.sessions, mainId, abort.signal)
    const refusal = expect(preparation).rejects.toMatchObject({ code: 'disposed' })
    abort.abort()
    await refusal
    fixture.catalog.publish(catalog('ready', [{ id: mainId, cwd: '/late/main' }]))
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.catalog.listeners.size).toBe(0)
    expect(fixture.catalog.releases[0]).toHaveBeenCalledOnce()
  })
})

describe('workspace selection of an empty session', () => {
  const owned = ownedSideSessionId(mainId, 'side-chat-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  const ordinary = SessionId('empty-main')
  const archived = SessionId('archived-main')
  const differentPreset = SessionId('other-preset')
  const outside = SessionId('other-workspace')
  const fresh = SessionId('fresh-main')
  function blanks(includeOrdinary: boolean) {
    const workspace = row('folder', [
      owned,
      archived,
      differentPreset,
      ...(includeOrdinary ? [ordinary] : []),
    ])
    const snapshot = catalog(
      'ready',
      [owned, outside, archived, differentPreset, ordinary].map((id) => ({ id, cwd: workspace.path })),
    )
    const list = observable<SessionListState>({
      ...snapshot,
      byId: Object.fromEntries(
        Object.entries(snapshot.byId).map(([id, entry]) => [
          id,
          {
            ...entry,
            blank: true,
            projectionValues: { agentPreset: id === differentPreset ? 'other' : 'chat' },
          },
        ]),
      ),
    }).list
    const workspaces = observable({ ...state('ready', [workspace]), archivedSessionIds: [archived] })
    const create = vi.fn<ISessions['create']>(async (options) => options?.sessionId ?? fresh)
    const sessions = { list, create }
    class Navigation {
      connectWorkspace(target: WorkspaceId) {
        return sessions.create({ workspaceId: target, sessionId: owned, agentPreset: 'chat' })
      }
      async openWorkspace(target: WorkspaceId) {
        await this.connectWorkspace(target)
      }
    }
    const navigation = new Navigation()
    return { navigation, sessions, workspaces, create, target: workspace.workspaceId }
  }

  it('keeps an ordinary blank with the same workspace and preset when the first candidate is owned', async () => {
    const { navigation, sessions, workspaces, create, target } = blanks(true)
    const dispose = preserveSideChatBlanks(navigation, sessions, workspaces)
    await navigation.openWorkspace(target)
    expect(create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: target,
      sessionId: ordinary,
      agentPreset: 'chat',
    })
    expect(sessions.list.getSnapshot().ids).toContain(owned)
    dispose()
  })

  it('creates a fresh blank while allowing an explicit open of the owned chat in the same tick', async () => {
    const { navigation, sessions, workspaces, create, target } = blanks(false)
    const dispose = preserveSideChatBlanks(navigation, sessions, workspaces)
    const automatic = navigation.connectWorkspace(target)
    const direct = sessions.create({ workspaceId: target, sessionId: owned })
    await expect(automatic).resolves.toBe(fresh)
    await expect(direct).resolves.toBe(owned)
    expect(create.mock.calls[0]).toEqual([{ workspaceId: target, agentPreset: 'chat' }])
    dispose()
    expect(sessions.create).toBe(create)
    expect(Object.hasOwn(navigation, 'openWorkspace')).toBe(false)
    expect(Object.hasOwn(navigation, 'connectWorkspace')).toBe(false)
    await expect(navigation.connectWorkspace(target)).resolves.toBe(owned)
  })

  it('releases already installed methods if the workspace service cannot be decorated', () => {
    const { navigation, sessions, workspaces, create } = blanks(false)
    Object.preventExtensions(navigation)
    expect(() => preserveSideChatBlanks(navigation, sessions, workspaces)).toThrow(TypeError)
    expect(sessions.create).toBe(create)
  })
})
