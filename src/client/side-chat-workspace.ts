/** Resolve the main Session's Host location before creating its independent side Session. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatFailure } from './side-chat-controller.ts'

/**
 * Preserve Workspace membership, or the recorded directory of an ungrouped main Session.
 * @param workspaces - Public Workspace list; this resolver performs no mutations.
 * @param sessions - Public Session catalog supplying the ungrouped main's recorded directory.
 * @param mainSessionId - Exact main Session whose location the side Session shares.
 * @param signal - Lifetime of this preparation attempt.
 * @returns Creation options naming the main Session's Workspace or recorded directory.
 * @throws SideChatFailure when location is unavailable, the Workspace list fails, or preparation is cancelled.
 */
export function resolveSideChatWorkspace(
  workspaces: Pick<IWorkspaces, 'list'>,
  sessions: Pick<ISessions, 'list'>,
  mainSessionId: SessionId,
  signal: AbortSignal,
): Promise<Parameters<ISessions['create']>[0]> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribeWorkspace: (() => void) | null = null
    let unsubscribeSessions: (() => void) | null = null
    const cleanup = (): void => {
      signal.removeEventListener('abort', abort)
      unsubscribeWorkspace?.()
      unsubscribeWorkspace = null
      unsubscribeSessions?.()
      unsubscribeSessions = null
    }
    const abort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new SideChatFailure('disposed', signal.reason))
    }
    const observe = (): void => {
      if (settled) return
      if (signal.aborted) {
        abort()
        return
      }
      const snapshot = workspaces.list.getSnapshot()
      if (snapshot.state === 'error') {
        settled = true
        cleanup()
        reject(new SideChatFailure('workspace', snapshot.error))
        return
      }
      if (snapshot.phase === 'pending') return
      const workspace = snapshot.items.find((item) => item.sessionIds.includes(mainSessionId))
      if (workspace !== undefined) {
        settled = true
        cleanup()
        resolve({ workspaceId: workspace.workspaceId })
        return
      }
      const catalog = sessions.list.getSnapshot()
      if (catalog.phase === 'pending') return
      settled = true
      cleanup()
      const cwd = catalog.byId[mainSessionId]?.cwd
      if (cwd === undefined || cwd === '') reject(new SideChatFailure('workspace'))
      else resolve({ cwd })
    }
    observe()
    if (settled) return
    signal.addEventListener('abort', abort, { once: true })
    unsubscribeWorkspace = workspaces.list.subscribe(observe)
    if (settled) cleanup()
    else {
      unsubscribeSessions = sessions.list.subscribe(observe)
      if (settled) cleanup()
      else observe()
    }
  })
}
