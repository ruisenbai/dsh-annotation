import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { encodeSubmissionCommand } from '../src/shared/codec.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { createAnnotationCommand, submitAnnotationPayload } from '../src/host/command.ts'
import type { AnnotationSubmissionPayload } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'

function fakeAgent(events: unknown[] = []) {
  const nextTurn: UserMessage[] = []
  const nextStep: UserMessage[] = []
  const followup = vi.fn((message: UserMessage) => nextTurn.push(message))
  const steer = vi.fn((message: UserMessage) => nextStep.push(message))
  const agent = {
    id: 'session-test',
    inbox: { nextTurn, nextStep },
    session: { events },
    followup,
    steer,
  } as unknown as Agent
  return { agent, nextTurn, nextStep, followup, steer }
}

function invocation(agent: Agent, rawInput: string): CommandInvocation {
  return {
    commandId: 'command-test',
    agent,
    rawInput,
    signal: new AbortController().signal,
  } as unknown as CommandInvocation
}

describe('Host inline comment command', () => {
  it('queues a deterministic user message and deduplicates a retry', () => {
    const fake = fakeAgent()
    const payload = fixturePayload()
    expect(submitAnnotationPayload(fake.agent, payload)).toEqual({
      duplicate: false,
      messageId: 'dsh-inline-annotations:sub-test',
    })
    expect(fake.followup).toHaveBeenCalledTimes(1)
    expect(fake.nextTurn[0]).toMatchObject({
      id: 'dsh-inline-annotations:sub-test',
      role: 'user',
      source: { kind: 'user', inlineComments: payload },
    })
    expect(submitAnnotationPayload(fake.agent, payload).duplicate).toBe(true)
    expect(fake.followup).toHaveBeenCalledTimes(1)
  })

  it('steers an active task when requested', () => {
    const fake = fakeAgent()
    submitAnnotationPayload(fake.agent, fixturePayload({ delivery: 'steer' }))
    expect(fake.steer).toHaveBeenCalledTimes(1)
    expect(fake.followup).not.toHaveBeenCalled()
  })

  it('deduplicates a payload already present in durable user history', () => {
    const fake = fakeAgent([
      {
        type: 'user/message',
        data: { id: 'dsh-inline-annotations:sub-test' },
      },
    ])
    expect(submitAnnotationPayload(fake.agent, fixturePayload()).duplicate).toBe(true)
    expect(fake.followup).not.toHaveBeenCalled()
  })

  it('rejects a cross-session payload before enqueueing', () => {
    const fake = fakeAgent()
    const payload = fixturePayload({
      sessionId: 'another-session' as AnnotationSubmissionPayload['sessionId'],
    })
    expect(() => submitAnnotationPayload(fake.agent, payload)).toThrow('not session-test')
    expect(fake.followup).not.toHaveBeenCalled()
  })

  it('decodes the browser command and suppresses raw payload recording', async () => {
    const fake = fakeAgent()
    const payload = fixturePayload()
    const definition = createAnnotationCommand(DEFAULT_CONFIG)
    const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, payload)
    const rawInput = line.slice(line.indexOf(' ') + 1)
    expect(definition.recordInput).toBe(false)
    expect(definition.handler(invocation(fake.agent, rawInput))).toMatchObject({ kind: 'success' })
    expect(fake.nextTurn).toHaveLength(1)
  })

  it('rejects malformed and oversized encoded input', async () => {
    const fake = fakeAgent()
    const malformed = createAnnotationCommand(DEFAULT_CONFIG)
    expect(() => malformed.handler(invocation(fake.agent, '***'))).toThrow('base64url')
    expect(() =>
      malformed.handler(invocation(fake.agent, Buffer.from([0xc3, 0x28]).toString('base64url'))),
    ).toThrow('UTF-8')
    const limited = createAnnotationCommand({ ...DEFAULT_CONFIG, maxPayloadBytes: 8 })
    const line = encodeSubmissionCommand(DEFAULT_CONFIG.commandName, fixturePayload())
    expect(() => limited.handler(invocation(fake.agent, line.split(' ')[1]!))).toThrow('maximum is 8')
  })
})
