import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { createAnnotationCommand, submitAnnotationPayload } from '../src/host/command.ts'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import {
  parseAttachmentIdentities,
  parseSubmissionPayload,
  sameAttachmentIdentities,
} from '../src/shared/protocol.ts'
import { ATTACHMENT_IDENTITY_MISMATCH, ATTACHMENT_PREPARE_INPUT } from '../src/shared/types.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload, fixtureV1Payload } from './fixtures.ts'
import { expectOutboxPayload } from './outbox-test-helpers.ts'

const identities = [
  { type: 'image', attachmentId: 'sha256:image', bytes: 8, name: 'shot.png', mediaType: 'image/png' },
  { type: 'file', attachmentId: 'sha256:file', bytes: 12, name: 'notes.txt' },
]

function invocation(attachments: readonly (ImageBlock | FileBlock)[]) {
  const nextTurn: UserMessage[] = []
  const agent = {
    id: 'session-test',
    inbox: { nextTurn, nextStep: [] },
    session: { snapshotEvents: () => [] },
    followup: vi.fn((message: UserMessage) => nextTurn.push(message)),
    steer: vi.fn(),
  } as unknown as Agent
  return {
    agent,
    nextTurn,
    call: {
      commandId: 'prepare-test',
      agent,
      attachments,
      rawInput: ATTACHMENT_PREPARE_INPUT,
      signal: new AbortController().signal,
    } as unknown as CommandInvocation,
  }
}

function blocks(): readonly (ImageBlock | FileBlock)[] {
  return [
    {
      type: 'image',
      attachment: {
        attachmentId: 'sha256:image' as ImageBlock['attachment']['attachmentId'],
        bytes: 8,
        name: 'shot.png',
        mediaType: 'image/png',
        width: 1,
        height: 1,
      },
    },
    {
      type: 'file',
      attachment: {
        attachmentId: 'sha256:file' as FileBlock['attachment']['attachmentId'],
        bytes: 12,
        name: 'notes.txt',
      },
    },
  ]
}

describe('immutable attachment identities', () => {
  it('retains validated identities in wire and durable payloads without byte or receipt fields', () => {
    const raw = identities.map((item) => ({
      ...item,
      data: 'secret bytes',
      receiptId: 'temporary credential',
    }))
    const payload = parseSubmissionPayload({ ...fixturePayload(), attachmentIdentities: raw })
    expect(payload.attachmentIdentities).toEqual(identities)
    expect(Object.isFrozen(payload.attachmentIdentities)).toBe(true)
    expect(Object.isFrozen(payload.attachmentIdentities?.[0])).toBe(true)
    raw[0]!.name = 'later.png'
    expect(payload.attachmentIdentities?.[0]?.name).toBe('shot.png')
    expect(JSON.stringify(payload)).not.toContain('secret bytes')
    expect(JSON.stringify(payload)).not.toContain('temporary credential')
  })

  it('leaves missing legacy identities absent instead of inventing an empty attachment set', () => {
    for (const payload of [fixturePayload(), fixtureV1Payload()]) {
      expect(parseSubmissionPayload(payload)).not.toHaveProperty('attachmentIdentities')
    }
    expect(
      parseSubmissionPayload({ ...fixturePayload(), attachmentIdentities: [] }).attachmentIdentities,
    ).toEqual([])
  })

  it.each([
    null,
    {},
    'image',
    [null],
    [{ ...identities[0], type: 'audio' }],
    [{ ...identities[0], attachmentId: '' }],
    [{ ...identities[0], attachmentId: 'x'.repeat(257) }],
    [{ ...identities[0], bytes: -1 }],
    [{ ...identities[0], bytes: 0.5 }],
    [{ ...identities[0], mediaType: 'text/plain' }],
    [{ ...identities[0], name: 7 }],
    [{ ...identities[1], name: '' }],
    [{ ...identities[1], name: undefined }],
  ])('rejects malformed identity data %#', (attachmentIdentities) => {
    expect(() => parseSubmissionPayload({ ...fixturePayload(), attachmentIdentities })).toThrow(
      'attachmentIdentities',
    )
  })

  it('compares content identity, names, sizes, image types, and order', () => {
    const original = parseAttachmentIdentities(identities)
    expect(sameAttachmentIdentities(original, parseAttachmentIdentities(identities))).toBe(true)
    for (const actual of [
      [],
      [...identities].reverse(),
      [...identities, identities[0]],
      [{ ...identities[0], attachmentId: 'sha256:replacement' }, identities[1]],
      [{ ...identities[0], name: 'renamed.png' }, identities[1]],
      [{ ...identities[0], bytes: 99 }, identities[1]],
      [{ ...identities[0], mediaType: 'image/jpeg' }, identities[1]],
      [identities[0], { ...identities[1], attachmentId: 'sha256:other-file' }],
    ])
      expect(sameAttachmentIdentities(original, parseAttachmentIdentities(actual))).toBe(false)
  })

  it('prepares metadata without queueing a user message and enforces it on every submission', async () => {
    const h = invocation(blocks())
    const command = createAnnotationCommand(DEFAULT_CONFIG)
    const prepared = await command.handler(h.call)
    expect(prepared).toMatchObject({ kind: 'success' })
    if (prepared === undefined) throw new Error('Missing preflight result')
    expect(JSON.parse(prepared.text ?? 'null')).toEqual(identities)
    expect(h.nextTurn).toEqual([])
    expect(h.agent.steer).not.toHaveBeenCalled()
    expect(command.recordInput).toBe(false)
    const payload = fixturePayload({ attachmentIdentities: parseAttachmentIdentities(identities) })
    expect(submitAnnotationPayload(h.agent, payload, blocks()).duplicate).toBe(false)
    expect(submitAnnotationPayload(h.agent, payload, blocks()).duplicate).toBe(true)
    for (const changed of [
      [],
      [...blocks()].reverse(),
      [
        blocks()[0]!,
        {
          type: 'file' as const,
          attachment: {
            ...blocks()[1]!.attachment,
            attachmentId: 'sha256:different' as FileBlock['attachment']['attachmentId'],
            name: 'notes.txt',
          },
        },
      ],
    ]) {
      expect(() => submitAnnotationPayload(h.agent, payload, changed)).toThrow(ATTACHMENT_IDENTITY_MISMATCH)
    }
    expect(h.agent.followup).toHaveBeenCalledOnce()
  })

  it('rejects added attachments for an explicitly empty batch and preserves legacy submission behavior', () => {
    const h = invocation([])
    expect(() =>
      submitAnnotationPayload(h.agent, fixturePayload({ attachmentIdentities: [] }), blocks()),
    ).toThrow(ATTACHMENT_IDENTITY_MISMATCH)
    expect(submitAnnotationPayload(h.agent, fixturePayload(), blocks()).duplicate).toBe(false)
  })

  it('bounds preflight output and honors cancellation without queueing', async () => {
    const h = invocation(blocks())
    expect(() => createAnnotationCommand({ ...DEFAULT_CONFIG, maxPayloadBytes: 1 }).handler(h.call)).toThrow(
      'submission-size limit',
    )
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    expect(() =>
      createAnnotationCommand(DEFAULT_CONFIG).handler({ ...h.call, signal: abort.signal }),
    ).toThrow('cancelled')
    expect(h.nextTurn).toEqual([])
  })

  it('restores identities from outbox storage and rejects contradictory attachment metadata', () => {
    const values = new Map<string, string>()
    const storage = new AnnotationStorage(
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value)
        },
        removeItem: (key) => {
          values.delete(key)
        },
      },
      'session-test' as SessionIdentity,
    )
    const payload = fixturePayload({ attachmentIdentities: parseAttachmentIdentities(identities) })
    const entry = {
      payload,
      targetSessionId: payload.sessionId,
      messageId: 'dsh-inline-annotations:sub-test',
      status: 'failed',
      attempts: 1,
      attachments: { count: 2, kinds: ['image', 'file'], mediaTypes: ['image/png'], names: ['shot.png'] },
    }
    values.set(storage.key, JSON.stringify({ ...emptyPersistedState(), outbox: [entry] }))
    expect(expectOutboxPayload(storage.load().outbox[0]).payload.attachmentIdentities).toEqual(identities)
    for (const attachments of [
      undefined,
      { ...entry.attachments, kinds: ['file', 'image'] },
      { count: 1, kinds: ['image'], mediaTypes: ['image/png'], names: [] },
    ]) {
      values.set(
        storage.key,
        JSON.stringify({ ...emptyPersistedState(), outbox: [{ ...entry, attachments }] }),
      )
      expect(storage.load().outbox).toEqual([])
      expect(storage.lastError()).toContain('attachment identities do not match metadata')
    }
  })
})
