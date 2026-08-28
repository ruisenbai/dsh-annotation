import { describe, expect, it, vi } from 'vitest'
import { AnnotationController, type AnnotationReconciliationSnapshot } from '../src/client/controller.ts'
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

function snapshot(
  nodes: unknown[] = [],
  queue: unknown[] = [],
  hasMore = false,
): AnnotationReconciliationSnapshot {
  return {
    chat: { nodes: new Map(nodes.map((node, index) => [String(index), node])) },
    queue,
    hasMore,
  } as unknown as AnnotationReconciliationSnapshot
}

function harness(memory = new MemoryStorage(), sessionId = 'session-test' as SessionIdentity) {
  const navigation = {
    state: { hasMore: false },
    getSnapshot() {
      return this.state
    },
    loadOlder: vi.fn(async () => undefined),
  }
  const controller = new AnnotationController(
    sessionId,
    new AnnotationStorage(memory, sessionId),
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
  it('saves an empty annotation as highlight-only and whitespace counts as empty', () => {
    const { controller } = harness()
    controller.beginSelection(capture())
    controller.updateEditorText('   \n  ')
    const id = controller.saveEditor()
    expect(controller.getSnapshot().annotations[0]).toMatchObject({
      annotationId: id,
      annotation: '',
      kind: 'highlight-only',
      status: 'draft',
    })

    // 编辑已有注解时清空内容：转成仅标记原文，而不是删除。
    controller.openAnnotation(id)
    controller.updateEditorText('Add a real note.')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations[0]).toMatchObject({
      annotationId: id,
      annotation: 'Add a real note.',
      kind: 'note',
    })
    controller.openAnnotation(id)
    controller.updateEditorText('')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations[0]).toMatchObject({
      annotationId: id,
      annotation: '',
      kind: 'highlight-only',
    })
  })

  it('still requires a valid selection before saving an empty annotation', () => {
    const { controller } = harness()
    controller.beginSelection(capture())
    controller.updateEditorText('')
    expect(() => controller.saveEditor()).not.toThrow()
    // 没有选区时不能保存。
    const second = harness()
    expect(() => second.controller.saveEditor()).toThrow('no annotation editor is open')
  })

  it('freezes the protocol locale into a fresh outbox entry', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity, '', undefined, 'en')
    expect(entry.payload.protocolLocale).toBe('en')
    expect(entry.payload.annotations[0]).toMatchObject({ kind: 'note' })
    const zh = harness()
    saveDraft(zh.controller)
    const zhEntry = zh.controller.createOutbox(
      'queue',
      'session-test' as SessionIdentity,
      '',
      undefined,
      'zh',
    )
    expect(zhEntry.payload.protocolLocale).toBe('zh')
  })
  it('keeps a draft editable until explicit batch creation', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    expect(controller.getSnapshot().annotations).toMatchObject([
      {
        annotationId: id,
        status: 'draft',
        annotation: 'Please revise this sentence.',
      },
    ])
    controller.openAnnotation(id)
    controller.updateEditorText('Use a concrete example.')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations[0]?.annotation).toBe('Use a concrete example.')
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    expect(outbox.payload.annotations[0]?.annotationId).toBe(id)
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
  })

  it('distinguishes transport acceptance from authoritative queue and durable history', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.markSending(entry.payload.submissionId)
    controller.markAccepted(entry.payload.submissionId)
    expect(controller.getSnapshot().outbox[0]?.status).toBe('accepted')

    controller.reconcile(snapshot([], [{ messageId: entry.messageId }]))
    expect(controller.getSnapshot().outbox[0]?.status).toBe('queued')
    controller.markAccepted(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'late transport failure')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('queued')

    controller.reconcile(snapshot([]))
    expect(controller.getSnapshot().outbox[0]?.status).toBe('accepted')
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
    controller.reconcile(snapshot([], [{ messageId: entry.messageId }]))
    expect(controller.getSnapshot().outbox[0]?.status).toBe('queued')

    controller.reconcile(
      snapshot([{ kind: 'user', data: { source: { kind: 'user', inlineComments: entry.payload } } }]),
    )
    expect(controller.getSnapshot().outbox[0]?.status).toBe('sent')
    controller.markAccepted(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'late transport failure')
    expect(controller.getSnapshot().outbox[0]?.status).toBe('sent')
  })

  it('lets authoritative queue observation supersede an ambiguous transport failure', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.markSending(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'connection closed')
    controller.reconcile(snapshot([], [{ messageId: entry.messageId }]))
    expect(controller.getSnapshot().outbox[0]?.status).toBe('queued')
  })

  it('keeps marker previews and marker-anchored editors outside the summary panel', () => {
    const { controller } = harness()
    const id = saveDraft(controller)

    controller.openAnnotation(id, 'marker')
    expect(controller.getSnapshot()).toMatchObject({
      editor: null,
      panelOpen: false,
      activeAnnotationId: id,
      markerAnnotationId: id,
    })

    controller.openAnnotation(id, 'marker-edit')
    expect(controller.getSnapshot()).toMatchObject({
      editor: { kind: 'edit', annotationId: id },
      panelOpen: false,
      markerAnnotationId: id,
    })
    expect(controller.closeEditor()).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      editor: null,
      activeAnnotationId: id,
      markerAnnotationId: id,
    })

    controller.openAnnotation(id, 'marker')
    expect(controller.getSnapshot()).toMatchObject({
      activeAnnotationId: null,
      markerAnnotationId: null,
    })

    controller.openAnnotation(id)
    expect(controller.getSnapshot()).toMatchObject({
      editor: { kind: 'edit', annotationId: id },
      markerAnnotationId: null,
    })
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

  it('autosaves unfinished editor text after 400ms and restores it', () => {
    vi.useFakeTimers()
    const { controller, memory } = harness()
    try {
      controller.beginSelection(capture())
      controller.updateEditorText('Recovered after refresh')
      expect(controller.getSnapshot().editorSaveStatus).toBe('saving')
      expect([...memory.values.values()].join('')).not.toContain('Recovered after refresh')

      vi.advanceTimersByTime(399)
      expect([...memory.values.values()].join('')).not.toContain('Recovered after refresh')
      vi.advanceTimersByTime(1)
      expect(controller.getSnapshot()).toMatchObject({
        editorSaveStatus: 'saved',
        storageAvailable: true,
      })
      expect(controller.getSnapshot().storageBytes).toBeGreaterThan(0)

      const restored = harness(memory).controller
      expect(restored.getSnapshot().editor).toMatchObject({
        kind: 'new',
        text: 'Recovered after refresh',
      })
      restored.dispose()
    } finally {
      controller.dispose()
      vi.useRealTimers()
    }
  })

  it('flushes pending editor text when its Session controller disposes', () => {
    vi.useFakeTimers()
    const { controller, memory } = harness()
    try {
      controller.beginSelection(capture())
      controller.updateEditorText('Saved during Session switch')
      controller.dispose()

      const restored = harness(memory).controller
      expect(restored.getSnapshot().editor).toMatchObject({
        kind: 'new',
        text: 'Saved during Session switch',
      })
      restored.dispose()
    } finally {
      vi.useRealTimers()
    }
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
      data: { source: { kind: 'user', inlineComments: outbox.payload } },
    }
    const assistant = {
      kind: 'assistant-step',
      data: {
        finalNode: { messageId: 'assistant-2', seq: 30 },
        blocks: [
          {
            kind: 'text',
            text: `done <!-- dsh-inline-comments:{"submissionId":"${outbox.payload.submissionId}","processed":["${outbox.payload.annotations[0]?.annotationId}"]} -->`,
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

  it('restores a supplemental editor without mutating sent history', () => {
    vi.useFakeTimers()
    const { controller, memory } = harness()
    try {
      const id = saveDraft(controller)
      const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
      controller.reconcile(
        snapshot([
          {
            kind: 'user',
            data: { source: { kind: 'user', inlineComments: outbox.payload } },
          },
        ]),
      )
      controller.openAnnotation(id)
      controller.updateEditorText('One more requirement.')
      vi.advanceTimersByTime(400)

      const restored = harness(memory).controller
      expect(restored.getSnapshot().editor).toMatchObject({ kind: 'new', supplementalTo: id })
      const supplementalId = restored.saveEditor()
      expect(supplementalId).not.toBe(id)
      expect(restored.getSnapshot().annotations).toHaveLength(2)
      expect(restored.getSnapshot().annotations.find((item) => item.annotationId === id)?.annotation).toBe(
        'Please revise this sentence.',
      )
      expect(
        restored.getSnapshot().annotations.find((item) => item.annotationId === supplementalId)
          ?.supplementalTo,
      ).toBe(id)
      restored.dispose()
    } finally {
      controller.dispose()
      vi.useRealTimers()
    }
  })

  it('turns an overlapping submitted selection into a supplement instead of an edit', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([{ kind: 'user', data: { source: { kind: 'user', inlineComments: outbox.payload } } }]),
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
                text: `<!-- dsh-inline-comments:{"submissionId":"${outbox.payload.submissionId}","processed":["${outbox.payload.annotations[0]?.annotationId}"]} -->`,
              },
            ],
          },
        },
      ]),
    )
    expect(controller.getSnapshot().annotations[0]?.status).toBe('queued')
  })

  it('mirrors queue placement, departure, and durable status from an archived fork target', () => {
    const childSessionId = 'child-session' as SessionIdentity
    const origin = harness().controller
    const target = harness(new MemoryStorage(), childSessionId).controller
    saveDraft(origin)
    const outbox = origin.createOutbox('queue', childSessionId)
    target.adoptOutbox(outbox)
    const annotationId = outbox.payload.annotations[0]!.annotationId

    target.reconcile(snapshot([], [{ messageId: outbox.messageId }]))
    origin.syncSubmissionState(target.getSnapshot(), outbox.payload.submissionId, childSessionId)
    expect(origin.getSnapshot().outbox[0]?.status).toBe('queued')
    const reconnectTarget = harness(new MemoryStorage(), childSessionId).controller
    reconnectTarget.adoptOutbox(outbox)
    reconnectTarget.syncSubmissionState(
      origin.getSnapshot(),
      outbox.payload.submissionId,
      'session-test' as SessionIdentity,
    )
    expect(reconnectTarget.getSnapshot().outbox[0]?.status).toBe('ready')

    target.reconcile(snapshot([]))
    expect(target.getSnapshot().outbox[0]?.status).toBe('accepted')
    origin.syncSubmissionState(target.getSnapshot(), outbox.payload.submissionId, childSessionId)
    expect(origin.getSnapshot().outbox[0]?.status).toBe('accepted')

    target.reconcile(
      snapshot([
        { kind: 'user', data: { source: { kind: 'user', inlineComments: outbox.payload } } },
        {
          kind: 'assistant-step',
          data: {
            finalNode: { messageId: 'assistant-2', seq: 30 },
            blocks: [
              {
                kind: 'text',
                text: `<!-- dsh-inline-comments:{"submissionId":"${outbox.payload.submissionId}","processed":["${annotationId}"]} -->`,
              },
            ],
          },
        },
      ]),
    )
    origin.syncSubmissionState(target.getSnapshot(), outbox.payload.submissionId, childSessionId)
    expect(origin.getSnapshot().annotations[0]?.status).toBe('processed')
    expect(origin.getSnapshot().outbox[0]?.status).toBe('sent')
  })

  it('locates mounted replies and pages older history when necessary', async () => {
    const { controller } = harness()
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

  it('waits for the mounted endpoint after a history page lands instead of failing a sync check', async () => {
    const missing = harness()
    const missingId = saveDraft(missing.controller)
    const reveal = vi.fn()
    const annotateAll = vi.fn()
    missing.navigation.state.hasMore = true
    missing.navigation.loadOlder.mockImplementation(async () => {
      // 官方 loadOlder 只保证数据取回；端点由随后的一次 React 提交注册（异步）。
      setTimeout(() => {
        missing.controller.registerEndpoint('assistant-1' as MessageIdentity, { reveal, annotateAll })
        missing.navigation.state.hasMore = false
      }, 30)
    })
    await expect(missing.controller.navigate(missingId)).resolves.toBe(true)
    expect(reveal).toHaveBeenCalledWith(missingId)
  })

  it('fails closed when the target message never mounts within the history window', async () => {
    const missing = harness()
    const missingId = saveDraft(missing.controller)
    missing.navigation.state.hasMore = true
    missing.navigation.loadOlder.mockImplementation(async () => {
      missing.navigation.state.hasMore = false
    })
    await expect(missing.controller.navigate(missingId)).resolves.toBe(false)
    expect(missing.controller.getSnapshot()).toMatchObject({
      notice: { level: 'error', text: 'locate' },
    })
  })

  it('offers one-step undo after deleting a draft', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    controller.deleteDraft(id)
    expect(controller.getSnapshot().annotations).toHaveLength(0)
    expect(controller.getSnapshot().deletedDraft?.annotationId).toBe(id)

    controller.undoDelete()
    expect(controller.getSnapshot().annotations[0]?.annotationId).toBe(id)
    expect(controller.getSnapshot().deletedDraft).toBeNull()

    controller.deleteDraft(id)
    controller.dismissDeleteUndo()
    expect(controller.getSnapshot().deletedDraft).toBeNull()
  })

  it('exports local recovery state and clears only unsubmitted drafts', () => {
    const { controller } = harness()
    saveDraft(controller)
    controller.setOverallRequirementDraft('Rewrite all examples.')
    const exported = JSON.parse(controller.exportLocalData()) as Record<string, unknown>
    expect(exported).toMatchObject({ storageVersion: 2, overallRequirementDraft: 'Rewrite all examples.' })
    expect(exported.annotations).toHaveLength(1)

    controller.clearLocalDrafts()
    expect(controller.getSnapshot()).toMatchObject({
      annotations: [],
      overallRequirementDraft: '',
      editor: null,
      deletedDraft: null,
    })
    expect(controller.getSnapshot().storageBytes).toBeGreaterThan(0)
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

  it('discards a never-queued retry record and restores its annotations to draft', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.markSending(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'offline')
    controller.discardOutbox(entry.payload.submissionId)
    expect(controller.getSnapshot().outbox[0]?.status).toBe('withdrawn')
    expect(controller.getSnapshot().annotations[0]).toMatchObject({ status: 'draft' })
    expect(controller.getSnapshot().annotations[0]).not.toHaveProperty('submissionId')
  })

  it('records non-base64 image metadata on a fresh outbox entry', () => {
    const { controller } = harness()
    saveDraft(controller)
    const entry = controller.createOutbox('queue', 'session-test' as SessionIdentity, '', {
      count: 2,
      mediaTypes: ['image/png', 'image/jpeg'],
      names: ['shot.png'],
    })
    expect(entry.images).toEqual({ count: 2, mediaTypes: ['image/png', 'image/jpeg'], names: ['shot.png'] })
  })
})
