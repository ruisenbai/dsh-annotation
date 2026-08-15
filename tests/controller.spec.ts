import { describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import type { SelectionCapture } from '../src/client/selection.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function capture(start = 5, end = 11): SelectionCapture {
  const messageId = 'assistant-1' as MessageIdentity
  return {
    messageId,
    messageSeq: 20,
    responseVersion: messageId,
    quote: { exact: 'source'.padEnd(end - start, '.'), prefix: 'some ', suffix: ' text', start, end },
    rect: { top: 1, left: 2, right: 3, bottom: 4 },
  }
}

function snapshot(nodes: unknown[] = [], queue: unknown[] = [], hasMore = false): ConversationSnapshot {
  return {
    chat: { nodes: new Map(nodes.map((node, index) => [String(index), node])) },
    queue,
    hasMore,
  } as unknown as ConversationSnapshot
}

function harness(memory = new MemoryStorage()) {
  const navigation = {
    state: { hasMore: false },
    getSnapshot() {
      return this.state
    },
    loadOlder: vi.fn(async () => undefined),
  }
  const controller = new AnnotationController(
    'session-test' as SessionIdentity,
    new AnnotationStorage(memory, 'session-test' as SessionIdentity),
    navigation,
    DEFAULT_CONFIG,
    () => 1_700_000_000_000,
  )
  return { controller, navigation, memory }
}

function saveDraft(controller: AnnotationController): AnnotationId {
  controller.beginSelection(capture())
  controller.updateEditorText('Please revise this sentence.')
  return controller.saveEditor()
}

describe('annotation controller', () => {
  it('keeps a draft editable until explicit batch creation', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    expect(controller.getSnapshot().annotations).toMatchObject([
      {
        annotationId: id,
        status: 'draft',
        comment: 'Please revise this sentence.',
      },
    ])
    controller.openAnnotation(id)
    controller.updateEditorText('Use a concrete example.')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations[0]?.comment).toBe('Use a concrete example.')
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    expect(outbox.payload.annotations[0]?.annotationId).toBe(id)
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
  })

  it('closes an unchanged edit directly and requires confirmation only after changes', () => {
    const { controller } = harness()
    const id = saveDraft(controller)

    controller.openAnnotation(id)
    expect(controller.closeEditor()).toBe(true)
    expect(controller.getSnapshot().editor).toBeNull()

    controller.openAnnotation(id)
    controller.updateEditorText('Changed but unsaved')
    expect(controller.closeEditor()).toBe(false)
    expect(controller.getSnapshot().editor).not.toBeNull()
    expect(controller.closeEditor(true)).toBe(true)
    expect(controller.getSnapshot().editor).toBeNull()
  })

  it('freezes one retry payload and preserves its submission id', () => {
    const { controller } = harness()
    saveDraft(controller)
    const first = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.markSending(first.payload.submissionId)
    controller.markFailed(first.payload.submissionId, 'network down')
    const retry = controller.createOutbox('steer', 'session-test' as SessionIdentity)
    expect(retry).toBe(controller.getSnapshot().outbox[0])
    expect(retry.payload).toBe(first.payload)
    expect(retry.payload.submissionId).toBe(first.payload.submissionId)
  })

  it('rebuilds sent and processed status from standard durable messages', () => {
    const { controller, memory } = harness()
    saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    const user = {
      kind: 'user',
      data: { source: { kind: 'user', inlineAnnotations: outbox.payload } },
    }
    const assistant = {
      kind: 'assistant-step',
      data: {
        finalNode: { messageId: 'assistant-2', seq: 30 },
        blocks: [
          {
            kind: 'text',
            text: `done <!-- dsh-inline-annotations:{"submissionId":"${outbox.payload.submissionId}","processed":["${outbox.payload.annotations[0]?.annotationId}"]} -->`,
          },
        ],
      },
    }
    controller.reconcile(snapshot([user, assistant]))
    expect(controller.getSnapshot().annotations[0]?.status).toBe('processed')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('sent')

    const restored = harness(memory).controller
    expect(restored.getSnapshot().annotations[0]?.status).toBe('processed')
  })

  it('merges overlapping selections into the existing editable annotation', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    controller.beginSelection(capture(3, 15))
    expect(controller.getSnapshot().editor).toMatchObject({ kind: 'edit', annotationId: id })
    controller.updateEditorText('Expanded comment')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations).toHaveLength(1)
    expect(controller.getSnapshot().annotations[0]?.quote).toMatchObject({ start: 3, end: 15 })
  })

  it('creates a supplemental draft instead of mutating sent history', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([
        {
          kind: 'user',
          data: { source: { kind: 'user', inlineAnnotations: outbox.payload } },
        },
      ]),
    )
    controller.openAnnotation(id)
    controller.updateEditorText('One more requirement.')
    const supplementalId = controller.saveEditor()
    expect(supplementalId).not.toBe(id)
    expect(controller.getSnapshot().annotations).toHaveLength(2)
    expect(controller.getSnapshot().annotations.find((item) => item.annotationId === id)?.comment).toBe(
      'Please revise this sentence.',
    )
    expect(
      controller.getSnapshot().annotations.find((item) => item.annotationId === supplementalId)
        ?.supplementalTo,
    ).toBe(id)
  })

  it('turns an overlapping submitted selection into a supplement instead of an edit', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([{ kind: 'user', data: { source: { kind: 'user', inlineAnnotations: outbox.payload } } }]),
    )
    controller.beginSelection(capture(4, 12))
    expect(controller.getSnapshot().editor).toMatchObject({ kind: 'new' })
    controller.updateEditorText('Clarify the submitted note.')
    const supplement = controller.saveEditor()
    expect(
      controller.getSnapshot().annotations.find((item) => item.annotationId === supplement)?.supplementalTo,
    ).toBe(id)
  })

  it('requires a durable submission before an acknowledgement can process ids', () => {
    const { controller } = harness()
    saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([
        {
          kind: 'assistant-step',
          data: {
            finalNode: { messageId: 'assistant-2', seq: 30 },
            blocks: [
              {
                kind: 'text',
                text: `<!-- dsh-inline-annotations:{"submissionId":"${outbox.payload.submissionId}","processed":["${outbox.payload.annotations[0]?.annotationId}"]} -->`,
              },
            ],
          },
        },
      ]),
    )
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
  })

  it('mirrors sent and processed status from an archived fork target', () => {
    const origin = harness().controller
    const target = harness().controller
    saveDraft(origin)
    const outbox = origin.createOutbox('queue', 'child-session' as SessionIdentity)
    target.adoptOutbox(outbox)
    const annotationId = outbox.payload.annotations[0]!.annotationId
    target.reconcile(
      snapshot([
        { kind: 'user', data: { source: { kind: 'user', inlineAnnotations: outbox.payload } } },
        {
          kind: 'assistant-step',
          data: {
            finalNode: { messageId: 'assistant-2', seq: 30 },
            blocks: [
              {
                kind: 'text',
                text: `<!-- dsh-inline-annotations:{"submissionId":"${outbox.payload.submissionId}","processed":["${annotationId}"]} -->`,
              },
            ],
          },
        },
      ]),
    )
    origin.syncSubmissionState(target.getSnapshot(), outbox.payload.submissionId)
    expect(origin.getSnapshot().annotations[0]?.status).toBe('processed')
    expect(origin.getSnapshot().outbox[0]?.status).toBe('sent')
  })

  it('locates mounted replies and pages older history when necessary', async () => {
    const { controller, navigation } = harness()
    const id = saveDraft(controller)
    const reveal = vi.fn()
    const annotateAll = vi.fn()
    controller.registerEndpoint('assistant-1' as MessageIdentity, { reveal, annotateAll })
    await expect(controller.navigate(id)).resolves.toBe(true)
    expect(reveal).toHaveBeenCalledWith(id)

    const missing = harness()
    const missingId = saveDraft(missing.controller)
    missing.navigation.state.hasMore = true
    missing.navigation.loadOlder.mockImplementationOnce(async () => {
      missing.controller.registerEndpoint('assistant-1' as MessageIdentity, { reveal, annotateAll })
      missing.navigation.state.hasMore = false
    })
    await expect(missing.controller.navigate(missingId)).resolves.toBe(true)
  })

  it('withdraws queued work back to editable drafts', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.markWithdrawn(entry.payload.submissionId)
    expect(controller.getSnapshot().annotations[0]).toMatchObject({ status: 'draft' })
    expect(controller.getSnapshot().annotations[0]).not.toHaveProperty('submissionId')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('withdrawn')
  })
})
