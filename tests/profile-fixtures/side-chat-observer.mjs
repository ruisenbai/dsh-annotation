/** Test-only Loader observer; the real Session, input, command, and conversation services stay active. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const inject = [
  'pluginManager',
  'settings',
  'webServer',
  'connection',
  'llm',
  'sessionPersistence',
  'workspaceRegistry',
  'commands',
]

class SideChatAdapter extends LlmAdapter {
  requests = []
  pending = null
  holdNext = false
  barrierWaiters = new Set()

  providerInfo(provider) {
    return { id: provider, name: 'Offline side-chat fixture' }
  }

  async listModels(provider) {
    return [{ provider, id: 'fixture', name: 'Fixture', contextWindow: 128_000 }]
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Fixture', contextWindow: 128_000 }
  }

  release() {
    this.pending?.resolve()
    this.pending = null
    this.holdNext = false
    for (const waiter of this.barrierWaiters) waiter()
  }

  waitForBarrier() {
    if (this.pending !== null) return Promise.resolve(true)
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        this.barrierWaiters.delete(finish)
        resolve(true)
      }
      const timer = setTimeout(() => {
        this.barrierWaiters.delete(finish)
        reject(new Error('The side model did not reach its explicit barrier'))
      }, 30_000)
      this.barrierWaiters.add(finish)
    })
  }

  async *stream(options) {
    const request = structuredClone({ sessionId: options.sessionId, messages: options.messages })
    this.requests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    if (this.holdNext) {
      this.holdNext = false
      await new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason ?? new Error('Fixture model aborted'))
        const finish = () => {
          options.signal?.removeEventListener('abort', abort)
          resolve()
        }
        this.pending = { request, resolve: finish }
        for (const waiter of this.barrierWaiters) waiter()
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      }).finally(() => {
        this.pending = null
      })
    }
    const batch = options.messages.findLast((message) => message.source?.annotationSubmission)?.source
      .annotationSubmission
    const text =
      batch === undefined
        ? 'Side answer: Alpha, Beta, and Gamma are independent confirmed references. This answer stays selectable.'
        : batch.annotations
            .map(
              (annotation) =>
                `<!-- dsh-annotation-reply:${JSON.stringify({ submissionId: batch.submissionId, annotationId: annotation.annotationId, ordinal: annotation.ordinal })} -->\nAnnotation ${annotation.ordinal}: Side note addressed.`,
            )
            .join('\n\n') +
          `\n<!-- dsh-annotation:${JSON.stringify({ submissionId: batch.submissionId, processed: batch.annotations.map((annotation) => annotation.annotationId) })} -->`
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * Install the deterministic adapter and bounded IPC inspection for one private profile.
 * @param ctx - Loader-owned context with the official Host services.
 */
export function apply(ctx) {
  if (process.send === undefined) throw new Error('Side-chat observer requires owned child IPC')
  const adapter = new SideChatAdapter()
  let workspace
  const lifecycle = new Map()
  const failures = new Set()
  const lifecycleAttempts = []
  const intercept = async (kind, sessionId, proceed) => {
    const attempt = { kind, sessionId, status: 'pending' }
    lifecycleAttempts.push(attempt)
    if (failures.delete(kind)) {
      attempt.status = 'injected-failure'
      throw new Error(`Injected ${kind} failure`)
    }
    const control = lifecycle.get(kind)
    if (control !== undefined) {
      control.entered.resolve(sessionId)
      await control.release.promise
      lifecycle.delete(kind)
    }
    try {
      const result = await proceed()
      attempt.status = 'completed'
      return result
    } catch (error) {
      attempt.status = 'failed'
      attempt.error = String(error.stack ?? error)
      throw error
    }
  }
  ctx.effect(() => {
    const commands = ctx.commands
    const execute = commands.execute
    commands.execute = (agent, line, attachments, signal) =>
      lifecycle.has('admission')
        ? intercept('admission', agent.session.id, () =>
            execute.call(commands, agent, line, attachments, signal),
          )
        : execute.call(commands, agent, line, attachments, signal)
    const persistence = ctx.sessionPersistence
    const deletion = persistence.delete
    const registry = ctx.workspaceRegistry
    const archival = registry.archiveSession
    const accounting = registry.forgetSession
    persistence.delete = (sessionId) =>
      intercept('delete', sessionId, () => deletion.call(persistence, sessionId))
    registry.archiveSession = (sessionId, options) =>
      intercept('archive', sessionId, () => archival.call(registry, sessionId, options))
    registry.forgetSession = (sessionId) =>
      intercept('cleanup', sessionId, () => accounting.call(registry, sessionId))
    return () => {
      commands.execute = execute
      persistence.delete = deletion
      registry.archiveSession = archival
      registry.forgetSession = accounting
      for (const control of lifecycle.values()) control.release.resolve()
    }
  })
  ctx.effect(() => ctx.llm.registerAdapter(['annotation-side-chat-fixture'], adapter))
  ctx.effect(() => () => adapter.release())
  const receive = (message) => {
    if (message?.type !== 'annotation-side-chat-smoke') return
    void inspect(message.action, message.payload).then(
      (result) => process.send?.({ id: message.id, result }),
      (error) => process.send?.({ id: message.id, error: String(error.stack ?? error) }),
    )
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => process.off('message', receive)
  })

  async function readSession(sessionId) {
    const handle = await ctx.sessionPersistence.open(sessionId, 'read')
    try {
      return {
        header: handle.header,
        inheritedEventCount: handle.inheritedEventCount,
        events: (await handle.read()).events,
      }
    } finally {
      await handle.close()
    }
  }

  async function inspect(action, payload) {
    if (action === 'inspect') {
      return {
        url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
        bundles: await ctx.pluginManager.listBundles(),
        plugins: await ctx.pluginManager.listPlugins(),
        modelRequests: adapter.requests.length,
        modelPending: adapter.pending !== null,
        sessionIds: (await ctx.sessionPersistence.list()).map((record) => record.header.id),
        workspaceSessionIds: workspace?.sessionIds,
        archivedSessionIds: ctx.workspaceRegistry.archivedSessionIds,
        lifecycleAttempts,
      }
    }
    if (action === 'prepare') {
      await ctx.settings.update('ui-settings-general', { welcomeNoticeVersion: '2026-09-28.1' })
      workspace = await ctx.workspaceRegistry.create(process.cwd(), 'Side-chat smoke')
      return true
    }
    if (action === 'seed-session') {
      const handle = await ctx.sessionPersistence.create(payload.header)
      try {
        await handle.append(payload.events)
      } finally {
        await handle.close()
      }
      if (workspace === undefined) throw new Error('The fixture workspace must be prepared before seeding')
      if (payload.attach !== false) await workspace.attachSession(payload.header.id)
      return readSession(payload.header.id)
    }
    if (action === 'fail-next-lifecycle') {
      failures.add(payload.kind)
      return true
    }
    if (action === 'hold-lifecycle') {
      if (lifecycle.has(payload.kind)) throw new Error('Lifecycle barrier already armed')
      lifecycle.set(payload.kind, { entered: Promise.withResolvers(), release: Promise.withResolvers() })
      return true
    }
    if (action === 'wait-lifecycle') return lifecycle.get(payload.kind).entered.promise
    if (action === 'release-lifecycle') {
      lifecycle.get(payload.kind).release.resolve()
      return true
    }
    if (action === 'is-deleted') return ctx.sessionPersistence.isDeleted(payload.sessionId)
    if (action === 'read-session') return readSession(payload.sessionId)
    if (action === 'model-requests') return adapter.requests
    if (action === 'hold-next-model') {
      if (adapter.pending !== null || adapter.holdNext) throw new Error('A model barrier is already armed')
      adapter.holdNext = true
      return true
    }
    if (action === 'wait-model') return adapter.waitForBarrier()
    if (action === 'release-model') {
      if (adapter.pending === null) throw new Error('The model has not reached its barrier')
      adapter.release()
      return true
    }
    throw new Error(`Unknown side-chat observer action: ${action}`)
  }
}
