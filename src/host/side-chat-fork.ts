/** Persist an ordinary, independently resumable conversation at the parent's selected cut. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { SideChatForkRequest } from '../shared/side-chat-fork-remote.ts'
import { z } from 'zod'
import { buildForkSeed, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import { FORK_SIDE_CHAT_COMMAND, isOwnedSideSession, sideSessionAddress } from '../shared/side-session-id.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** First event displayed in the Chat transcript. Zero displays the full history. */
    chatTranscriptStart: SessionProjectionSummaryExcluded<number>
  }
}

const sequence = z.number().int().nonnegative()

/** Fork repair can append synthetic endings immediately after the inherited prefix. */
export const sideChatTranscriptStart = {
  key: 'chatTranscriptStart',
  stateVersion: 1,
  stateSchema: sequence,
  init: (header, count) => (count > 0 && sideSessionAddress(header.id) ? count + 1 : 0),
  apply: (start, event) => {
    if (start === 0 || event.seq !== start) return start
    switch (event.type) {
      case 'tool/result':
      case 'step/end':
      case 'turn/end':
        return start + 1
      default:
        return start
    }
  },
  wire: { viewSchema: sequence, view: (start) => start, summary: false },
} satisfies ProjectionDefinition<'chatTranscriptStart', number>

const forkRequest = z.strictObject({
  target: z.string(),
  at: z.number().int().min(-1).optional(),
  title: z.string().trim().min(1).max(256).optional(),
})

async function fork(
  ctx: Context,
  { sessionId, target: id, at, title }: SideChatForkRequest,
  signal: AbortSignal,
  commandId?: CommandInvocation['commandId'],
): Promise<void> {
  const persistence = ctx.sessionPersistence
  const existing = await persistence.stat(id, { signal })
  let delegated: boolean
  if (existing === undefined) {
    using source = await ctx.sessionQuery.observeSession(sessionId, { signal })
    delegated = source.header.origin === 'subagent'
    const events = source.events
    let latest = events.length - 1
    if (commandId !== undefined) {
      const invoked = events.findLast(
        (event) => event.type === 'command/run' && event.data.commandId === commandId,
      )
      if (!invoked) throw new Error('The fork command is absent from its source Session')
      latest = invoked.seq - 1
    }
    const cut = at ?? latest
    if (cut > latest)
      throw new RemoteError('gateway/bad-request', 'The source event is outside this conversation', {})
    const last = events[cut]
    const seed = last === undefined ? [] : buildForkSeed(events, last.seq)
    // Like a named Workspace fork, the child starts with its own editable title.
    if (title !== undefined)
      seed.push({
        type: 'session/title',
        seq: SessionSeq(seed.length),
        time: Date.now(),
        data: { title, messageSeqs: [], source: { kind: 'user' } },
      })
    const handle = await persistence.create(
      {
        id,
        version: source.header.version,
        createdAt: Date.now(),
        isSeeded: cut >= 0,
        ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
        ...(source.header.agentPreset === undefined ? {} : { agentPreset: source.header.agentPreset }),
      },
      { signal, inheritedEventCount: SessionLogOffset(cut + 1) },
    )
    try {
      if (seed.length) await handle.append(seed)
      await handle.flush()
    } finally {
      await handle.close()
    }
  } else {
    delegated = (await persistence.stat(sessionId, { signal }))?.header.origin === 'subagent'
    await using handle = await persistence.open(id, 'read', { signal })
    if (
      handle.header.isSeeded &&
      (await handle.read(handle.inheritedEventCount, 1)).events[0]?.type !== 'session/end-seed'
    )
      throw new Error('The saved side conversation has an incomplete inherited prefix')
  }
  const workspaces = ctx.workspaceRegistry.list()
  let workspace = workspaces.find((item) => item.sessionIds.includes(sessionId))
  if (!workspace && delegated) {
    const trace = await ctx.sessionQuery.traceSession(sessionId, signal)
    if (trace.target.header.origin === 'subagent') {
      for (const ancestor of trace.ancestors) {
        workspace = workspaces.find((item) => item.sessionIds.includes(ancestor.header.id))
        if (workspace) break
      }
    }
  }
  if (workspace && !workspace.sessionIds.includes(id)) await workspace.attachSession(id)
}

/** The source Session owns the target namespace, independently of its Agent lifecycle. */
export class AnnotationSideChats extends TypertRemoteService {
  static inject = ['sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'commands']
  private readonly pending = new Map<SessionId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'annotationSideChats')
    ctx.effect(
      () =>
        ctx.commands.register({
          name: FORK_SIDE_CHAT_COMMAND,
          description: 'Create a side conversation from this conversation’s saved history',
          recordInput: false,
          handler: async (invocation) => {
            const { target, at, title } = forkRequest.parse(JSON.parse(invocation.rawInput))
            if (!isOwnedSideSession(invocation.agent.id, target))
              return { kind: 'error', text: 'The target does not belong to this conversation' }
            const id = SessionId(target)
            await this.create(
              { sessionId: invocation.agent.id, target: id, at, title },
              invocation.signal,
              invocation.commandId,
            )
            return { kind: 'success', text: id }
          },
        }),
      'dsh-annotation: create owned side conversation',
    )
  }

  /** @param request - Source Session, retry-stable target and historical cut.
   * @param signal - Request cancellation.
   * @returns The created or previously committed side conversation.
   */
  @Remote
  async fork(request: SideChatForkRequest, signal: AbortSignal): Promise<SessionId> {
    if (!isOwnedSideSession(request.sessionId, request.target))
      throw new RemoteError('gateway/bad-request', 'The target does not belong to this conversation', {})
    await this.create(request, signal)
    return request.target
  }

  private create(
    request: SideChatForkRequest,
    signal: AbortSignal,
    commandId?: CommandInvocation['commandId'],
  ): Promise<void> {
    let attempt = this.pending.get(request.target)
    if (!attempt) {
      attempt = fork(this.ctx, request, signal, commandId).finally(() => this.pending.delete(request.target))
      this.pending.set(request.target, attempt)
    }
    return attempt
  }
}
