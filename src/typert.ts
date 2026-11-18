/** Host-side Remote manifest consumed by the standard Typert loader. */
import { sideChatForkRemote } from './shared/side-chat-fork-remote.ts'

export const TYPERT = {
  package: sideChatForkRemote.package,
  face: 'host',
  schemas: [],
  get invocations() {
    return sideChatForkRemote.descriptors
  },
  model: { services: [], events: [], objects: [] },
}
