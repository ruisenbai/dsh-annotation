/** Persist the navigation role without changing the Session identity or model history. */
import type { Context } from '@deepseek-ai/cordis'
import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { isSideSessionId, PROMOTE_SIDE_CHAT_COMMAND } from '../shared/side-session-id.ts'

const promoted = 'plugin:dsh-annotation/promoted'
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-annotation/promoted': true
  }
}

/** Ignore promotion records inherited from an earlier fork; null marks this Session as promoted. */
export const promotionProjection = {
  key: 'annotationSideChatPromoted',
  stateVersion: 1,
  stateSchema: z.number().int().nonnegative().nullable(),
  init: (_header, inherited) => Number(inherited),
  apply: (start, event) =>
    start !== null && event.seq >= start && pluginRecordOf(event)?.type === promoted ? null : start,
  wire: { viewSchema: z.boolean(), view: (start) => start === null },
} satisfies ProjectionDefinition<'annotationSideChatPromoted', number | null>

/** Register an idempotent command on the receiving side Session. */
export async function installSideChatPromotion(ctx: Context): Promise<void> {
  const projection = await ctx.sessionProjections.register(promotionProjection)
  ctx.effect(
    () =>
      ctx.commands.register({
        name: PROMOTE_SIDE_CHAT_COMMAND,
        description: 'Move this side conversation to the workspace list',
        recordInput: false,
        handler: ({ agent }) => {
          if (!isSideSessionId(agent.id)) return { kind: 'error', text: 'This is not a side conversation' }
          if (projection.stateOf(agent.session) !== null) appendPluginRecord(agent.session, promoted, true)
          return { kind: 'success', text: agent.id }
        },
      }),
    'dsh-annotation: promote side conversation',
  )
}
