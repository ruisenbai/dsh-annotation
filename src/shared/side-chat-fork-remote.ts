/** Session-addressed side chat creation works with persisted and live sources. */
import { z } from 'zod'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const id = z
  .string()
  .min(1)
  .transform((value) => value as SessionId)
const request = z.strictObject({
  sessionId: id,
  target: id,
  at: z.number().int().min(-1).optional(),
  title: z.string().trim().min(1).max(256).optional(),
})

export type SideChatForkRequest = z.output<typeof request>
type Fork = (request: SideChatForkRequest, signal?: AbortSignal) => Promise<RemoteResult<SessionId>>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'annotationSideChats/fork': Fork
  }
  interface TypertRemoteNamespaceMap {
    annotationSideChats: { fork: Fork }
  }
}

const requestCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-annotation#SideChatForkRequest',
  create: () => request,
}

/** Shared wire codecs for the Host loader and Client Remote mount. */
export const sideChatForkRemote = createTypertRemoteInfo(
  {
    package: 'dsh-annotation',
    methods: {
      'annotationSideChats/fork': {
        service: 'annotationSideChats',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'request', source: 'json', codec: requestCodec, strictCodec: requestCodec }],
        cancellation: { parameter: 'signal' },
        result: { mode: 'strict', typeSymbol: 'SessionId', create: () => id },
      },
    },
  },
  z,
)
