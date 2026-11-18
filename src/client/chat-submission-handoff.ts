/** Keep the accepted input visible across a replacement of the live Session window. */
import type {
  PendingSubmission,
  SessionBinding,
  SessionEventLikeEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'

type Target = keyof Pick<InboxState, 'next-turn' | 'next-step'>
type Receipt = { target: Target; index: number | null; seq: number }
interface Tracked {
  echo: PendingSubmission
  receipt?: Receipt
  admitted?: number
  rendered?: boolean
  bridging: boolean
}
const EMPTY: readonly PendingSubmission[] = []
interface RenderedInputs {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): { kind: string; data: unknown } | undefined }
}

/** Follow one local request through inserts, positional edits, claims, cancellation and durable admission. */
function observe(input: Tracked, entry: SessionEventLikeEntry): boolean {
  const event = entry.event
  if (event.type === 'user/message') {
    const source = event.data.source
    if (source.kind === 'user' && 'rpcId' in source && source.rpcId === input.echo.requestId)
      input.admitted = event.seq
  }
  if (input.admitted !== undefined) return true
  const receipt = input.receipt
  if (receipt && event.seq <= receipt.seq) return true
  if (event.type === 'request/context' || event.type === 'turn/end') return receipt?.index !== null
  if (event.type !== 'agent/inbox/spliced') return true
  const { target, start, removedCount = 0, inserted, outcome } = event.data
  const offset = inserted.findIndex(
    (message) =>
      message.source.kind === 'user' &&
      'rpcId' in message.source &&
      message.source.rpcId === input.echo.requestId,
  )
  if (offset !== -1) {
    input.receipt = { target, index: start + offset, seq: event.seq }
    return true
  }
  if (!receipt || receipt.target !== target || receipt.index === null || receipt.index < start) return true
  const removed = receipt.index < start + removedCount
  input.receipt = {
    target,
    index: removed ? null : receipt.index + inserted.length - removedCount,
    seq: event.seq,
  }
  return !(removed && outcome === 'canceled')
}

/** Extra display rows only. The native Session owns submission, attachments, failures and queue operations. */
export class ChatSubmissionHandoff {
  private readonly tracked = new Map<string, Tracked>()
  private seen = new WeakSet<PendingSubmission>()
  private readonly listeners = new Set<() => void>()
  private extra = EMPTY
  private stops: (() => void)[] = []
  constructor(
    private readonly binding: SessionBinding,
    private readonly chat: ObservableSnapshot<RenderedInputs | undefined>,
    private readonly lifetime: AbortSignal,
  ) {}
  getSnapshot = (): readonly PendingSubmission[] => this.extra
  subscribe = (listener: () => void): (() => void) => {
    if (this.lifetime.aborted) return () => {}
    this.listeners.add(listener)
    if (!this.stops.length) {
      this.lifetime.addEventListener('abort', this.dispose, { once: true })
      this.stops = [
        this.binding.eventSource.subscribe(this.onEvents),
        this.binding.session.subscribe(this.publish),
        this.chat.subscribe(this.onChat),
        this.binding.session.projections.faceOf('inbox').subscribe(this.publish),
      ]
      this.publish()
    }
    return () => {
      this.listeners.delete(listener)
      this.releaseIfIdle()
    }
  }
  dispose = (): void => {
    this.lifetime.removeEventListener('abort', this.dispose)
    for (const stop of this.stops) stop()
    this.stops = []
    this.tracked.clear()
    this.seen = new WeakSet()
    this.extra = EMPTY
  }
  private releaseIfIdle(): void {
    if (!this.listeners.size && !this.tracked.size) this.dispose()
  }
  private capture(native: readonly PendingSubmission[]): void {
    for (const echo of native) {
      if (echo.placement === 'queued' || this.seen.has(echo)) continue
      this.seen.add(echo)
      const input: Tracked = { echo, bridging: false }
      const entries = this.binding.eventSource.getSnapshot().entries
      // Accepted echoes normally follow their insertion in the same live batch.
      const index = entries.findLastIndex(
        ({ event }) =>
          event.type === 'agent/inbox/spliced' &&
          event.data.inserted.some(
            (message) =>
              message.source.kind === 'user' &&
              'rpcId' in message.source &&
              message.source.rpcId === echo.requestId,
          ),
      )
      if (index >= 0 && !entries.slice(index).every((entry) => observe(input, entry))) continue
      this.tracked.set(echo.requestId, input)
    }
  }
  private onEvents = (): void => {
    const window = this.binding.eventSource.getSnapshot()
    if (window.change.kind === 'prepend' || window.change.kind === 'settle-assistant') return
    const replaced = window.change.kind === 'replace'
    const native = this.binding.session.getSnapshot().pendingSubmissions
    this.capture(native)
    if (!this.tracked.size) return
    const entries = window.change.entries
    for (const [id, input] of this.tracked) {
      if (!entries.every((entry) => observe(input, entry))) {
        this.tracked.delete(id)
        continue
      }
      if (!replaced) continue
      const first = entries[0]?.event.seq ?? 0
      if (window.hasMore && input.admitted !== undefined && input.admitted < first) {
        this.tracked.delete(id)
        continue
      }
      // A paged baseline can omit the receipt and claim. Its current Inbox distinguishes queued work from a finished earlier turn.
      if (window.hasMore && input.receipt && input.receipt.seq < first && input.admitted === undefined) {
        const inbox = this.binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
        if (inbox) {
          const index = inbox[input.receipt.target].findIndex(
            (message) =>
              message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === id,
          )
          if (
            index < 0 &&
            entries.some(({ event }) => event.type === 'request/context' || event.type === 'turn/end')
          ) {
            this.tracked.delete(id)
            continue
          }
          input.receipt = { ...input.receipt, index: index < 0 ? null : index }
        }
      }
      input.bridging = input.receipt !== undefined || input.admitted !== undefined
    }
    this.publish()
  }
  private onChat = (): void => {
    const chat = this.chat.getSnapshot()
    if (chat && this.tracked.size) {
      for (const input of this.tracked.values()) {
        if (input.admitted === undefined || input.rendered) continue
        // The Chat assembler publishes on a different frame from the durable event stream.
        if (
          chat.order.some((key) => {
            const node = chat.nodes.get(key)
            if (node?.kind !== 'user' && node?.kind !== 'steering') return false
            const data = node.data
            if (typeof data !== 'object' || data === null || !('source' in data)) return false
            const source = data.source
            return (
              typeof source === 'object' &&
              source !== null &&
              'kind' in source &&
              source.kind === 'user' &&
              'rpcId' in source &&
              source.rpcId === input.echo.requestId
            )
          })
        )
          input.rendered = true
      }
    }
    this.publish()
  }
  private publish = (): void => {
    const session = this.binding.session.getSnapshot()
    const native = session.pendingSubmissions
    if (session.removed) this.tracked.clear()
    else this.capture(native)
    const extra: PendingSubmission[] = []
    for (const [id, input] of this.tracked) {
      if (input.rendered) {
        const inbox = this.binding.session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
        const staleSteering = inbox?.['next-step'].some(
          (message) =>
            message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === id,
        )
        if (!staleSteering) {
          this.tracked.delete(id)
          continue
        }
      }
      if (native.some((echo) => echo.requestId === id)) continue
      if (input.bridging) extra.push(input.echo)
      else this.tracked.delete(id)
    }
    if (extra.length !== this.extra.length || extra.some((echo, index) => echo !== this.extra[index])) {
      this.extra = extra.length ? extra : EMPTY
      for (const listener of this.listeners) listener()
    }
    this.releaseIfIdle()
  }
}
