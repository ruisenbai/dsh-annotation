/** Protect empty owned side chats when stock Workspace chooses a blank for New Session. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { isSideSessionId } from '../shared/side-session-id.ts'

/** Restore the exact original property, including prototype inheritance, on plugin unload. */
function adaptMethod<T extends object, K extends keyof T>(owner: T, key: K, replacement: T[K]) {
  const previous = Object.getOwnPropertyDescriptor(owner, key)
  Object.defineProperty(owner, key, { configurable: true, writable: true, value: replacement })
  return () => {
    if (Object.getOwnPropertyDescriptor(owner, key)?.value !== replacement) return
    if (previous) Object.defineProperty(owner, key, previous)
    else Reflect.deleteProperty(owner, key)
  }
}

/** Stock rc.4 chooses its candidate synchronously inside these two public workspace operations. */
export function preserveSideChatBlanks(
  workspace: Pick<UiWorkspace, 'connectWorkspace' | 'openWorkspace'>,
  sessions: Pick<ISessions, 'list' | 'create'>,
  workspaces: Pick<IWorkspaces, 'list'>,
): () => void {
  let choosing = false
  function workspaceCall<A extends unknown[], R>(original: (...args: A) => R) {
    return function (this: typeof workspace, ...args: A): R {
      const outer = choosing
      choosing = true
      try {
        return original.apply(this, args)
      } finally {
        choosing = outer
      }
    }
  }
  const create = sessions.create
  const restoreCreate = adaptMethod(sessions, 'create', function (this: typeof sessions, request) {
    if (!choosing || !request?.workspaceId || !request.sessionId || !isSideSessionId(request.sessionId))
      return create.call(this, request)
    const catalog = sessions.list.getSnapshot()
    const { items, archivedSessionIds } = workspaces.list.getSnapshot()
    const target = items.find((item) => item.workspaceId === request.workspaceId)
    const ordinary = catalog.ids.find((id) => {
      const row = catalog.byId[id]
      const preset = row?.projectionValues?.agentPreset
      return (
        !isSideSessionId(id) &&
        row?.blank &&
        target &&
        row.cwd === target.path &&
        target.sessionIds.includes(id) &&
        !archivedSessionIds.includes(id) &&
        (request.agentPreset === undefined || typeof preset !== 'string' || request.agentPreset === preset)
      )
    })
    const options = { ...request }
    if (ordinary) options.sessionId = ordinary
    else delete options.sessionId
    return create.call(this, options)
  })
  const releases = [restoreCreate]
  function dispose() {
    for (const restore of releases.splice(0).reverse()) restore()
  }
  try {
    releases.push(adaptMethod(workspace, 'openWorkspace', workspaceCall(workspace.openWorkspace)))
    releases.push(adaptMethod(workspace, 'connectWorkspace', workspaceCall(workspace.connectWorkspace)))
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}
