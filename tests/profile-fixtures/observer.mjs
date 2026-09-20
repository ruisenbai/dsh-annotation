/** Test-only IPC observer and deterministic provider loaded by the official profile's Loader. */
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'

export const inject = [
  'pluginManager',
  'settings',
  'webServer',
  'connection',
  'llm',
  'agents',
  'agentPresets',
  'commands',
  'workspaceRegistry',
  'sessionPersistence',
]

class FixtureAdapter extends LlmAdapter {
  requests = []
  providerInfo(provider) {
    return { id: provider, name: 'Offline profile fixture' }
  }
  async listModels(provider) {
    return [{ provider, id: 'fixture', name: 'Fixture', contextWindow: 128_000 }]
  }
  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Fixture', contextWindow: 128_000 }
  }
  async *stream(options) {
    this.requests.push(options.messages)
    const text =
      this.requests.length === 1
        ? 'Review the [local notes](./notes.md). Selected source needs clarification.'
        : 'Annotation received and revision completed.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Observe real services; only the LLM provider is replaced. */
export function apply(ctx) {
  if (process.send === undefined) throw new Error('Profile observer requires child IPC')
  const adapter = new FixtureAdapter()
  ctx.effect(() => ctx.llm.registerAdapter(['annotation-fixture'], adapter))
  const receive = (message) => {
    if (message?.type !== 'annotation-smoke') return
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
    if (action === 'seed-session') {
      const handle = await ctx.sessionPersistence.create(payload.header)
      try {
        await handle.append(payload.events)
      } finally {
        await handle.close()
      }
      return readSession(payload.header.id)
    }
    if (action === 'read-session') return readSession(payload.sessionId)
    if (action === 'prepare') {
      await ctx.settings.update('ui-onboarding', { welcomeNoticeVersion: '2026-08-13.1' })
      return true
    }
    if (action === 'inspect') {
      return {
        url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
        bundles: await ctx.pluginManager.listBundles(),
        plugins: await ctx.pluginManager.listPlugins(),
        settings: ctx.settings.describe().find((item) => item.ns === 'dsh-annotation'),
        chatSettings: ctx.settings.describe().find((item) => item.ns === 'ui-chat'),
        modelRequests: adapter.requests.length,
      }
    }
    if (action === 'submit') {
      await ctx.workspaceRegistry.create(process.cwd(), 'Annotation smoke')
      const handle = await ctx.agents.create({
        sessionId: 'annotation-profile-smoke',
        meta: { cwd: process.cwd(), agentPreset: 'standard' },
        agentOptions: { provider: 'annotation-fixture', model: 'fixture' },
        setup: (scope) => ctx.agentPresets.mount(scope, 'standard').then(() => undefined),
      })
      try {
        const agent = handle.agent
        const initial = createUserMessage({
          content: [{ type: 'text', text: 'Please review [local notes](./notes.md).' }],
          source: { kind: 'user' },
        })
        agent.followup(initial)
        await agent.whenIdle()
        const assistant = agent.session.snapshotEvents().find((event) => event.type === 'assistant/message')
        if (!assistant)
          throw new Error(
            `Initial AgentLoop turn did not persist an assistant message: ${JSON.stringify(agent.session.snapshotEvents())}`,
          )
        const payload = {
          protocolVersion: 2,
          source: 'dsh-annotation',
          submissionId: 'profile-submission',
          sessionId: agent.id,
          delivery: 'queue',
          protocolLocale: 'en',
          createdAt: 1_700_000_000_000,
          overallRequirement: 'Clarify the local document.',
          annotations: [
            {
              annotationId: 'profile-note',
              ordinal: 1,
              messageId: assistant.data.message.id,
              responseVersion: assistant.data.message.id,
              messageSeq: assistant.seq,
              quote: {
                exact: 'Selected source',
                prefix: 'Review the local notes. ',
                suffix: ' needs clarification.',
                start: 'Review the local notes. '.length,
                end: 'Review the local notes. Selected source'.length,
              },
              annotation: 'Explain this claim.',
              kind: 'note',
              createdAt: 1_700_000_000_000,
            },
          ],
        }
        const command = `/annotation_submit ${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
        const first = await ctx.commands.execute(agent, command, [], new AbortController().signal)
        await agent.whenIdle()
        const retry = await ctx.commands.execute(agent, command, [], new AbortController().signal)
        await agent.whenIdle()
        return {
          first,
          retry,
          requests: adapter.requests,
          events: agent.session.snapshotEvents(),
          sessionId: agent.id,
        }
      } finally {
        await handle.dispose()
      }
    }
    throw new Error(`Unknown observer action: ${action}`)
  }
}
