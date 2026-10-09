import { describe, expect, it, vi } from 'vitest'
import { AnnotationController, type AnnotationReconciliationSnapshot } from '../src/client/controller.ts'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { DEFAULT_PROCESSING_MODE } from '../src/shared/types.ts'
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import type { SelectionCapture } from '../src/client/selection.ts'
import type { FileAnnotationSource } from '../src/shared/annotation-source.ts'
import { sha256Hex } from '../src/shared/snapshot-hash.ts'

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

function capture(start = 5, end = 11, messageId = 'assistant-1' as MessageIdentity): SelectionCapture {
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
  it('keeps damaged session data and the storage warning through reconciliation and flush', () => {
    const memory = new MemoryStorage()
    const original = harness(memory).controller
    saveDraft(original)
    original.beginSelection(capture(20, 26))
    original.updateEditorText('Second valid draft')
    original.saveEditor()
    const storage = new AnnotationStorage(memory, original.sessionId)
    const damaged = JSON.parse(memory.values.get(storage.key)!) as {
      annotations: Array<{ status: string }>
    }
    damaged.annotations[0]!.status = 'invalid'
    const raw = JSON.stringify(damaged)
    memory.values.set(storage.key, raw)
    original.dispose()

    const restored = harness(memory).controller
    try {
      expect(restored.getSnapshot().annotations).toMatchObject([
        { annotation: 'Second valid draft', status: 'draft' },
      ])
      expect(restored.getSnapshot()).toMatchObject({
        storageAvailable: false,
        notice: { level: 'error', messageKey: 'error.storage' },
      })
      restored.reconcile(snapshot())
      restored.clearNotice()
      restored.flush()
      expect(memory.values.get(storage.key)).toBe(raw)
      expect(restored.getSnapshot()).toMatchObject({
        storageAvailable: false,
        notice: { level: 'error', messageKey: 'error.storage' },
      })
    } finally {
      restored.dispose()
    }
    expect(memory.values.get(storage.key)).toBe(raw)
  })

  it.each(['{broken', JSON.stringify({ ...emptyPersistedState(), storageVersion: 99 })])(
    'does not overwrite unreadable or future-version storage on ordinary sync: %s',
    (raw) => {
      const memory = new MemoryStorage()
      const storage = new AnnotationStorage(memory, 'session-test' as SessionIdentity)
      memory.values.set(storage.key, raw)
      const controller = harness(memory).controller
      try {
        controller.reconcile(snapshot())
        controller.flush()
        expect(memory.values.get(storage.key)).toBe(raw)
        expect(controller.getSnapshot()).toMatchObject({
          storageAvailable: false,
          notice: { level: 'error', messageKey: 'error.storage' },
        })
      } finally {
        controller.dispose()
      }
      expect(memory.values.get(storage.key)).toBe(raw)
    },
  )

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

  it('retains an official annotation when its Host resource expires', () => {
    const memory = new MemoryStorage()
    const { controller } = harness(memory)
    const source: FileAnnotationSource = {
      kind: 'file',
      resourceVersion: 'file-v1',
      sessionId: controller.sessionId,
      resourceAddress: 'dsh-resource://file/session/session-test/%2Fworkspace%2Fnotes.md',
      path: '/workspace/notes.md',
      format: 'markdown',
      snapshot: { version: 1, hash: sha256Hex('notes'), bytes: 5, format: 'markdown', text: 'notes' },
      wholeFile: true,
      entry: 'sidebar',
    }
    controller.beginSelection({
      source,
      quote: { exact: '', prefix: '', suffix: '', start: 0, end: 0 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    controller.updateEditorText('Keep this file note.')
    const id = controller.saveEditor()
    controller.markSourceExpired(id)
    expect(controller.getSnapshot().annotations[0]?.source).toMatchObject({ kind: 'file', expired: true })
    controller.dispose()

    const restored = harness(memory).controller
    try {
      expect(restored.getSnapshot().annotations[0]?.source).toMatchObject({ kind: 'file', expired: true })
    } finally {
      restored.dispose()
    }
  })

  it('requires a written opinion for a whole-file annotation', () => {
    const { controller } = harness()
    const source: FileAnnotationSource = {
      kind: 'file',
      resourceVersion: 'file-v1',
      sessionId: controller.sessionId,
      resourceAddress: 'dsh-resource://file/session/session-test/%2Fworkspace%2Fnotes.md',
      path: '/workspace/notes.md',
      format: 'text',
      snapshot: { version: 1, hash: sha256Hex('notes'), bytes: 5, format: 'text', text: 'notes' },
      wholeFile: true,
      entry: 'sidebar',
    }
    controller.beginSelection({
      source,
      quote: { exact: '', prefix: '', suffix: '', start: 0, end: 0 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    expect(() => controller.saveEditor()).toThrow('whole-file-opinion-required')
    controller.updateEditorText('Review this file.')
    expect(() => controller.saveEditor()).not.toThrow()
    controller.dispose()
  })

  it('cancels an older file Locate and keeps an unmatched source retryable', async () => {
    const { controller } = harness()
    const source: FileAnnotationSource = {
      kind: 'file',
      resourceVersion: 'file-v1',
      sessionId: controller.sessionId,
      resourceAddress: 'dsh-resource://file/session/session-test/%2Fworkspace%2Fnotes.md',
      path: '/workspace/notes.md',
      format: 'text',
      snapshot: { version: 1, hash: sha256Hex('notes'), bytes: 5, format: 'text', text: 'notes' },
      wholeFile: true,
      entry: 'sidebar',
    }
    controller.beginSelection({
      source,
      quote: { exact: '', prefix: '', suffix: '', start: 0, end: 0 },
      rect: { top: 1, left: 2, right: 3, bottom: 4 },
    })
    controller.updateEditorText('Review this file.')
    const id = controller.saveEditor()
    let finishOld!: (opened: boolean) => void
    const oldOpen = new Promise<boolean>((resolve) => {
      finishOld = resolve
    })
    let opens = 0
    controller.setSourceNavigator(async () => (++opens === 1 ? oldOpen : true))
    const stop = controller.registerSourceEndpoint(
      { source },
      {
        reveal: () => undefined,
        annotateAll: () => undefined,
        revealSource: () => 'unmatched',
      },
    )
    const oldLocate = controller.locateSource(id)
    await expect(controller.locateSource(id)).resolves.toBe('unmatched')
    finishOld(false)
    await expect(oldLocate).resolves.toBe('cancelled')
    expect(controller.getSnapshot().annotations[0]?.source).not.toHaveProperty('expired', true)
    stop()
    controller.setSourceNavigator(async () => false)
    await expect(controller.locateSource(id)).resolves.toBe('unavailable')
    expect(controller.getSnapshot().annotations[0]?.source).not.toHaveProperty('expired', true)
    controller.dispose()
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

  it('clears marker transient state when a marker-anchored editor closes', () => {
    const { controller } = harness()
    const id = saveDraft(controller)

    controller.openAnnotation(id, 'marker')
    expect(controller.getSnapshot()).toMatchObject({
      editor: null,
      panelOpen: false,
      activeAnnotationId: id,
      markerAnnotationId: id,
    })
    controller.openAnnotation(id, 'marker')
    expect(controller.getSnapshot()).toMatchObject({
      activeAnnotationId: null,
      markerAnnotationId: null,
    })

    controller.openAnnotation(id, 'marker')
    controller.openAnnotation(id, 'marker-edit')
    expect(controller.getSnapshot()).toMatchObject({
      editor: { kind: 'edit', annotationId: id },
      panelOpen: false,
      markerAnnotationId: id,
    })
    expect(controller.closeEditor()).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      editor: null,
      activeAnnotationId: null,
      markerAnnotationId: null,
      editorDrafts: [],
    })

    controller.openAnnotation(id)
    expect(controller.getSnapshot()).toMatchObject({
      editor: { kind: 'edit', annotationId: id },
      markerAnnotationId: null,
    })
  })

  it('collapses changed edits for later resume and discards only the edit buffer', () => {
    const { controller } = harness()
    const id = saveDraft(controller)

    controller.openAnnotation(id)
    expect(controller.closeEditor()).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ editor: null, editorDrafts: [] })

    controller.openAnnotation(id)
    controller.updateEditorText('Changed but unsaved')
    expect(controller.closeEditor()).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      editor: null,
      editorDrafts: [{ kind: 'edit', annotationId: id, text: 'Changed but unsaved' }],
    })
    expect(controller.getSnapshot().annotations).toMatchObject([
      { annotationId: id, annotation: 'Please revise this sentence.' },
    ])

    controller.resumeEditor(`edit:${id}`)
    expect(controller.getSnapshot().editor).toMatchObject({
      kind: 'edit',
      annotationId: id,
      text: 'Changed but unsaved',
    })
    expect(controller.closeEditor(true)).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ editor: null, editorDrafts: [] })
    expect(controller.getSnapshot().annotations).toMatchObject([
      { annotationId: id, annotation: 'Please revise this sentence.' },
    ])
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
      expect([...memory.values.values()].join('')).toContain('Recovered after refresh')

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

  it('keeps the active editor and text when the explicit save cannot persist', () => {
    const { controller, memory } = harness()
    controller.beginSelection(capture())
    controller.updateEditorText('Keep this failed save')
    const before = new Map(memory.values)
    const writes = vi.spyOn(memory, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => controller.saveEditor()).toThrow('annotation-storage-failed')

    expect(controller.getSnapshot()).toMatchObject({
      annotations: [],
      editor: { kind: 'new', text: 'Keep this failed save' },
      editorSaveStatus: 'error',
      storageAvailable: false,
      notice: { level: 'error', messageKey: 'error.storage' },
    })
    expect(memory.values).toEqual(before)
    writes.mockRestore()
    controller.dispose()
  })

  it('retains unsaved edits and storage feedback until a later write recovers', () => {
    const { controller, memory } = harness()
    const setItem = vi.spyOn(memory, 'setItem')
    vi.useFakeTimers()
    try {
      const id = saveDraft(controller)
      controller.openAnnotation(id)
      const stored = new Map(memory.values)
      setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded')
      })
      controller.updateEditorText('Retained while storage is unavailable')
      vi.advanceTimersByTime(400)
      expect(controller.getSnapshot()).toMatchObject({
        editor: { kind: 'edit', annotationId: id, text: 'Retained while storage is unavailable' },
        editorSaveStatus: 'error',
        storageAvailable: false,
        notice: { level: 'error', messageKey: 'error.storage' },
      })
      expect(memory.values).toEqual(stored)

      controller.setPanelOpen(true)
      expect(controller.getSnapshot().notice).toMatchObject({ level: 'error', messageKey: 'error.storage' })
      expect(memory.values).toEqual(stored)
      controller.updateEditorText('Recovered after storage retry')
      vi.advanceTimersByTime(400)
      expect(controller.getSnapshot()).toMatchObject({
        editorSaveStatus: 'saved',
        storageAvailable: true,
        notice: null,
      })
      expect(new AnnotationStorage(memory, controller.sessionId).load().editorDraft).toMatchObject({
        kind: 'edit',
        annotationId: id,
        text: 'Recovered after storage retry',
      })
      expect(controller.getSnapshot().annotations[0]?.annotation).toBe('Please revise this sentence.')
    } finally {
      setItem.mockRestore()
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

  it('reuses unchanged history and view state during unrelated assistant streaming', () => {
    const { controller, memory } = harness()
    saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    const source = { kind: 'user', inlineComments: outbox.payload }
    const userData = { source }
    let userReads = 0
    const user = {
      kind: 'user',
      get data() {
        userReads += 1
        return userData
      },
    }
    const assistant = (text: string) => ({
      kind: 'assistant-step',
      data: { finalNode: { messageId: 'assistant-stream' }, blocks: [{ kind: 'text', text }] },
    })
    controller.reconcile(snapshot([user, assistant('baseline')]))
    const before = controller.getSnapshot()
    const writes = vi.spyOn(memory, 'setItem')
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    for (let index = 0; index < 20; index += 1)
      controller.reconcile(snapshot([user, assistant(`ordinary stream ${index}`)]))

    expect(userReads).toBe(1)
    expect(writes).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toBe(before)
    expect(controller.getSnapshot().annotations).toBe(before.annotations)
    expect(controller.getSnapshot().outbox).toBe(before.outbox)
    expect(controller.getSnapshot().replyAssociations).toBe(before.replyAssociations)

    const acknowledgement = `<!-- dsh-inline-comments:{"submissionId":"${outbox.payload.submissionId}","processed":["${outbox.payload.annotations[0]?.annotationId}"]} -->`
    controller.reconcile(snapshot([user, assistant(acknowledgement)]))
    expect(controller.getSnapshot().annotations[0]?.status).toBe('processed')
    unsubscribe()
    controller.dispose()
  })

  it('reconciles queue-only changes without reading the chat history again', () => {
    const { controller } = harness()
    controller.reconcile(snapshot())
    controller.reconcile(
      {
        chat: {
          nodes: {
            values: () => {
              throw new Error('chat history was rescanned')
            },
          },
        },
        queue: [],
        hasMore: false,
      },
      false,
    )
    controller.dispose()
  })

  it('adds overlapping selections as independent annotations', () => {
    const { controller } = harness()
    const original = saveDraft(controller)
    controller.beginSelection(capture(3, 15))
    expect(controller.getSnapshot()).toMatchObject({
      editor: { kind: 'new', capture: { quote: { start: 3, end: 15 } } },
      overlap: null,
    })
    controller.updateEditorText('Expanded comment')
    const second = controller.saveEditor()
    expect(second).not.toBe(original)
    expect(controller.getSnapshot().annotations).toHaveLength(2)
    expect(
      controller.getSnapshot().annotations.find((item) => item.annotationId === original)?.annotation,
    ).toBe('Please revise this sentence.')
    expect(controller.getSnapshot().annotations.find((item) => item.annotationId === second)).toMatchObject({
      annotationId: second,
      annotation: 'Expanded comment',
      quote: { start: 3, end: 15 },
    })
  })

  it('reattaches a sent annotation without creating a new record or bubble', () => {
    const { controller, memory } = harness()
    const id = saveDraft(controller)
    const first = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([{ kind: 'user', data: { source: { kind: 'user', inlineComments: first.payload } } }]),
    )
    controller.openAnnotation(id)
    expect(controller.getSnapshot().editor).toBeNull()
    controller.toggleSelected(id)
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([id])
    const restored = harness(memory).controller
    expect(restored.getSnapshot().selectedAnnotationIds).toEqual([id])
    const second = restored.createOutbox('queue', 'session-test' as SessionIdentity)
    expect(second.payload.submissionId).not.toBe(first.payload.submissionId)
    expect(second.payload.annotations[0]?.annotationId).toBe(id)
    expect(restored.getSnapshot().annotations).toHaveLength(1)
    expect(restored.getSnapshot().annotations[0]?.status).toBe('sent')
    expect(restored.getSnapshot().selectedAnnotationIds).toEqual([])

    const sentMessages = [first, second].map((entry) => ({
      kind: 'user',
      data: { source: { kind: 'user', inlineComments: entry.payload } },
    }))
    restored.reconcile(snapshot(sentMessages))
    expect(restored.getSnapshot().annotations).toHaveLength(1)
    expect(restored.getSnapshot().replyAssociations).toEqual([
      { submissionId: first.payload.submissionId, annotationId: id },
      { submissionId: second.payload.submissionId, annotationId: id },
    ])

    const reloaded = harness(new MemoryStorage()).controller
    reloaded.reconcile(snapshot(sentMessages))
    expect(reloaded.getSnapshot().annotations).toHaveLength(1)
    expect(reloaded.getSnapshot().replyAssociations).toEqual(restored.getSnapshot().replyAssociations)
  })

  it('closes the record only after durable history consumes its last selected annotation', () => {
    const { controller } = harness()
    const first = saveDraft(controller)
    controller.beginSelection(capture(20, 26))
    controller.updateEditorText('Second opinion')
    const second = controller.saveEditor()
    controller.setPanelOpen(true)
    const rows = controller.getSnapshot().annotations
    const message = (id: AnnotationId, submissionId: string) => ({
      kind: 'user',
      data: {
        source: {
          kind: 'user',
          annotationSubmission: {
            protocolVersion: 5,
            source: 'dsh-annotation',
            submissionId,
            sessionId: controller.sessionId,
            delivery: 'queue',
            protocolLocale: 'en',
            processingMode: 'answer',
            createdAt: 1_700_000_000_000,
            annotations: [{ ...rows.find((row) => row.annotationId === id)!, ordinal: 1 }],
          },
        },
      },
    })
    const firstMessage = message(first, 'sub-first')
    const secondMessage = message(second, 'sub-second')

    controller.reconcile(snapshot([firstMessage]))
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([second])
    expect(controller.getSnapshot().panelOpen).toBe(true)
    controller.reconcile(snapshot([firstMessage, secondMessage]))
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(controller.getSnapshot().annotations.map((row) => row.status)).toEqual(['sent', 'sent'])
    expect(controller.getSnapshot().panelOpen).toBe(false)
    controller.dispose()
  })

  it('adds a fresh annotation over submitted text without linking it to the original', () => {
    const { controller } = harness()
    const id = saveDraft(controller)
    const outbox = controller.createOutbox('queue', 'session-test' as SessionIdentity)
    controller.reconcile(
      snapshot([{ kind: 'user', data: { source: { kind: 'user', inlineComments: outbox.payload } } }]),
    )
    controller.beginSelection(capture(4, 12))
    expect(controller.getSnapshot().editor).toMatchObject({
      kind: 'new',
      capture: { quote: { start: 4, end: 12 } },
    })
    controller.updateEditorText('Clarify the submitted note.')
    const second = controller.saveEditor()
    expect(second).not.toBe(id)
    expect(controller.getSnapshot().annotations.find((item) => item.annotationId === second)).toMatchObject({
      annotation: 'Clarify the submitted note.',
      status: 'draft',
    })
    expect(
      controller.getSnapshot().annotations.find((item) => item.annotationId === second),
    ).not.toHaveProperty('supplementalTo')
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
    controller.openAnnotation(id, 'marker')
    expect(controller.getSnapshot().activeAnnotationId).toBe(id)
    controller.setPanelOpen(true)
    await expect(controller.navigate(id)).resolves.toBe(true)
    expect(reveal).toHaveBeenCalledWith(id, 1)
    expect(controller.getSnapshot()).toMatchObject({
      activeAnnotationId: null,
      navigationEpoch: 1,
      panelOpen: true,
      recordExpanded: true,
    })
    controller.setRecordExpanded(false)
    await expect(controller.navigate(id)).resolves.toBe(true)
    expect(reveal).toHaveBeenLastCalledWith(id, 2)
    expect(controller.getSnapshot()).toMatchObject({
      navigationEpoch: 2,
      panelOpen: true,
      recordExpanded: false,
    })

    const missing = harness()
    const missingId = saveDraft(missing.controller)
    missing.navigation.state.hasMore = true
    missing.navigation.loadOlder.mockImplementationOnce(async () => {
      missing.controller.registerEndpoint('assistant-1' as MessageIdentity, { reveal, annotateAll })
      missing.navigation.state.hasMore = false
    })
    await expect(missing.controller.navigate(missingId)).resolves.toBe(true)
  })

  it('lets a newer navigation supersede an older history load without a stale reveal', async () => {
    const { controller, navigation } = harness()
    const firstId = saveDraft(controller)
    controller.beginSelection(capture(5, 11, 'assistant-2' as MessageIdentity))
    controller.updateEditorText('Revise the second source.')
    const secondId = controller.saveEditor()
    const revealFirst = vi.fn()
    const revealSecond = vi.fn()
    controller.registerEndpoint('assistant-2' as MessageIdentity, {
      reveal: revealSecond,
      annotateAll: vi.fn(),
    })
    let releaseOlder!: () => void
    const olderLoaded = new Promise<void>((resolve) => {
      releaseOlder = resolve
    })
    navigation.state.hasMore = true
    navigation.loadOlder.mockImplementationOnce(async () => {
      await olderLoaded
      return undefined
    })

    const firstNavigation = controller.navigate(firstId)
    expect(navigation.loadOlder).toHaveBeenCalledOnce()
    await expect(controller.navigate(secondId)).resolves.toBe(true)
    expect(revealSecond).toHaveBeenCalledWith(secondId, 2)
    controller.registerEndpoint('assistant-1' as MessageIdentity, {
      reveal: revealFirst,
      annotateAll: vi.fn(),
    })
    releaseOlder()

    await expect(firstNavigation).resolves.toBe(false)
    expect(revealFirst).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ navigationEpoch: 2 })
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
    expect(reveal).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledWith(missingId, 1)
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
      notice: { level: 'error', messageKey: 'error.locate' },
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

  it('restores drafts, editor text, queued work, and history without local-data management APIs', () => {
    const { controller, memory } = harness()
    try {
      saveDraft(controller)
      const sent = controller.createOutbox('queue', controller.sessionId)
      const sentNode = { kind: 'user', data: { source: { kind: 'user', inlineComments: sent.payload } } }
      controller.reconcile(snapshot([sentNode]))

      controller.beginSelection(capture(20, 26))
      controller.updateEditorText('Queued annotation')
      controller.saveEditor()
      const queued = controller.createOutbox('queue', controller.sessionId)
      controller.reconcile(snapshot([sentNode], [{ messageId: queued.messageId }]))

      controller.beginSelection(capture(30, 36))
      controller.updateEditorText('Independent draft')
      const draftId = controller.saveEditor()
      controller.beginSelection(capture(40, 46))
      controller.updateEditorText('Unfinished editor text')
      controller.setOverallRequirementDraft('Rewrite all examples.')
      const expected = controller.getSnapshot()
      const stored = new Map(memory.values)
      expect(expected.annotations.map((item) => item.status)).toEqual(['sent', 'queued', 'draft'])

      const restored = harness(memory).controller
      try {
        expect(restored).not.toHaveProperty('exportLocalData')
        expect(restored).not.toHaveProperty('clearLocalDrafts')
        expect(restored.getSnapshot()).not.toHaveProperty('storageBytes')
        expect(restored.getSnapshot()).toMatchObject({
          annotations: expected.annotations,
          outbox: expected.outbox,
          editor: expected.editor,
          editorDrafts: [],
          selectionMode: 'individual',
          selectedAnnotationIds: expected.selectedAnnotationIds,
          processingMode: DEFAULT_PROCESSING_MODE,
          retrySubmissionId: null,
          overallRequirementDraft: expected.overallRequirementDraft,
          storageAvailable: true,
        })
        expect(memory.values).toEqual(stored)

        restored.deleteDraft(draftId)
        expect(restored.getSnapshot()).toMatchObject({
          annotations: expected.annotations.filter((item) => item.annotationId !== draftId),
          outbox: expected.outbox,
          editor: expected.editor,
          editorDrafts: [],
          selectionMode: 'individual',
          selectedAnnotationIds: [],
          processingMode: DEFAULT_PROCESSING_MODE,
          retrySubmissionId: null,
          overallRequirementDraft: expected.overallRequirementDraft,
        })
        restored.undoDelete()
        expect(restored.getSnapshot().annotations).toEqual(expected.annotations)
        expect(new AnnotationStorage(memory, controller.sessionId).load()).toEqual({
          storageVersion: 6,
          trash: [],
          deletionMarks: [expect.objectContaining({ annotationId: draftId, state: 'restored', revision: 2 })],
          annotations: expected.annotations,
          outbox: expected.outbox,
          editorDraft: expected.editor,
          editorDrafts: [],
          selectionMode: 'individual',
          selectedAnnotationIds: [],
          processingMode: DEFAULT_PROCESSING_MODE,
          retrySubmissionId: null,
          overallRequirementDraft: expected.overallRequirementDraft,
        })
      } finally {
        restored.dispose()
      }
    } finally {
      controller.dispose()
    }
  })

  it.each(['queued', 'sent', 'processed'] as const)(
    'rejects per-item deletion of %s annotations without changing persisted records',
    (status) => {
      const { controller, memory } = harness()
      try {
        const id = saveDraft(controller)
        const entry = controller.createOutbox('queue', controller.sessionId)
        if (status !== 'queued') {
          const nodes: unknown[] = [
            { kind: 'user', data: { source: { kind: 'user', inlineComments: entry.payload } } },
          ]
          if (status === 'processed') {
            nodes.push({
              kind: 'assistant-step',
              data: {
                blocks: [
                  {
                    kind: 'text',
                    text: `<!-- dsh-inline-comments:{"submissionId":"${entry.payload.submissionId}","processed":["${id}"]} -->`,
                  },
                ],
              },
            })
          }
          controller.reconcile(snapshot(nodes))
        }
        const before = controller.getSnapshot()
        const stored = new Map(memory.values)
        expect(before.annotations[0]?.status).toBe(status)
        expect(() => controller.deleteDraft(id)).toThrow('only draft annotations can be deleted')
        expect(controller.getSnapshot()).toBe(before)
        expect(memory.values).toEqual(stored)
      } finally {
        controller.dispose()
      }
    },
  )

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
      kinds: ['image', 'image'],
      mediaTypes: ['image/png', 'image/jpeg'],
      names: ['shot.png'],
    })
    expect(entry.attachments).toEqual({
      count: 2,
      kinds: ['image', 'image'],
      mediaTypes: ['image/png', 'image/jpeg'],
      names: ['shot.png'],
    })
  })
})
