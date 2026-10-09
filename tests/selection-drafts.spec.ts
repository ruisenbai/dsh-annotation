import { afterEach, describe, expect, it } from 'vitest'
import {
  AnnotationController,
  SubmissionChangedError,
  editorBufferKey,
  eligibleAnnotations,
  retryEntry,
  selectedAnnotations,
} from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { parseAttachmentIdentities } from '../src/shared/protocol.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type {
  AnnotationConfig,
  AnnotationId,
  MessageIdentity,
  OutboxAttachments,
  SessionIdentity,
} from '../src/shared/types.ts'

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

const controllers: AnnotationController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function harness(
  memory = new MemoryStorage(),
  session = 'selection-session',
  config: AnnotationConfig = DEFAULT_CONFIG,
) {
  const sessionId = session as SessionIdentity
  const storage = new AnnotationStorage(memory, sessionId)
  const controller = new AnnotationController(
    sessionId,
    storage,
    {
      getSnapshot: () => ({ hasMore: false }),
      loadOlder: async () => undefined,
    },
    config,
    () => 1_700_000_000_000,
  )
  controllers.push(controller)
  return { controller, memory, storage }
}

function capture(start: number, length = 5) {
  const messageId = 'source-message' as MessageIdentity
  return {
    messageId,
    messageSeq: 10,
    responseVersion: messageId,
    quote: { exact: 'x'.repeat(length), start, end: start + length, prefix: '', suffix: '' },
    rect: { top: 10, left: 10, bottom: 30, right: 80 },
  }
}

function save(controller: AnnotationController, start: number, text = `Opinion ${start}`): AnnotationId {
  controller.beginSelection(capture(start))
  controller.updateEditorText(text)
  return controller.saveEditor()
}

function sent(
  controller: AnnotationController,
  payload: ReturnType<AnnotationController['createOutbox']>['payload'],
) {
  controller.reconcile({
    chat: {
      nodes: new Map([
        ['submitted', { kind: 'user', data: { source: { kind: 'user', annotationSubmission: payload } } }],
      ]),
    },
    queue: [],
    hasMore: false,
  })
}

describe('explicit annotation send sets and editor recovery', () => {
  it('sends only first and third and preserves the second as a separately selectable draft', () => {
    const { controller, storage } = harness()
    controller.setSelectionMode(true)
    const ids = [save(controller, 0), save(controller, 20), save(controller, 40)]
    expect(selectedAnnotations(controller.getSnapshot()).map((item) => item.annotationId)).toEqual(ids)
    controller.toggleSelected(ids[1]!)
    const entry = controller.createOutbox('queue', controller.sessionId)
    expect(entry.payload.annotations.map((item) => [item.annotationId, item.ordinal])).toEqual([
      [ids[0], 1],
      [ids[2], 2],
    ])
    expect(entry.payload.processingMode).toBe('answer')
    expect(
      controller
        .getSnapshot()
        .annotations.filter((item) => item.status === 'draft')
        .map((item) => item.annotationId),
    ).toEqual([ids[1]])
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    sent(controller, entry.payload)
    controller.openAnnotation(ids[1]!)
    controller.updateEditorText('Remaining item edited')
    controller.saveEditor()
    expect(controller.getSnapshot().annotations.find((item) => item.annotationId === ids[2])?.ordinal).toBe(2)
    expect(storage.load().outbox[0]?.payload).toEqual(entry.payload)
    expect(selectedAnnotations(controller.getSnapshot())).toEqual([])
  })

  it('limits the selected batch rather than every saved annotation', () => {
    const { controller } = harness(new MemoryStorage(), 'limited', {
      ...DEFAULT_CONFIG,
      maxAnnotationsPerSubmission: 2,
    })
    controller.setSelectionMode(true)
    const ids = [save(controller, 0), save(controller, 20), save(controller, 40)]
    expect(() => controller.createOutbox('queue', controller.sessionId)).toThrow()
    expect(controller.getSnapshot().outbox).toEqual([])
    controller.toggleSelected(ids[1]!)
    expect(controller.createOutbox('queue', controller.sessionId).payload.annotations).toHaveLength(2)
  })

  it('keeps retry annotations, mode, requirement, ordinals and attachment metadata immutable', () => {
    const { controller, memory } = harness()
    controller.setSelectionMode(true)
    save(controller, 0)
    const second = save(controller, 20)
    controller.toggleSelected(second)
    controller.setProcessingMode('rewrite')
    const kinds: Array<'image' | 'file'> = ['image', 'file']
    const mediaTypes = ['image/png', '']
    const names = ['original.png', '']
    const metadata: OutboxAttachments = { count: 2, kinds, mediaTypes, names }
    const initial = controller.createOutbox(
      'queue',
      controller.sessionId,
      'Original requirement',
      metadata,
      'zh',
      controller.getSnapshot(),
      parseAttachmentIdentities([
        {
          type: 'image',
          attachmentId: 'image-original',
          bytes: 5,
          mediaType: 'image/png',
          name: 'original.png',
        },
        { type: 'file', attachmentId: 'file-original', bytes: 8, name: 'notes.txt' },
      ]),
    )
    const frozen = JSON.stringify(initial.payload)
    kinds.reverse()
    names[0] = 'later.png'
    expect(initial.attachments?.kinds).toEqual(['image', 'file'])
    expect(initial.attachments?.names).toEqual(['original.png', ''])
    expect(Object.isFrozen(initial.payload.annotations[0]?.quote)).toBe(true)
    controller.markSending(initial.payload.submissionId)
    controller.markFailed(initial.payload.submissionId, 'offline')
    controller.setProcessingMode('modify')
    controller.toggleSelected(second)
    expect(retryEntry(controller.getSnapshot())).toBeUndefined()
    controller.selectRetry(initial.payload.submissionId)
    const retry = controller.createOutbox('queue', controller.sessionId, 'Later text', undefined, 'en')
    expect(retry).toBe(controller.getSnapshot().outbox[0])
    expect(JSON.stringify(retry.payload)).toBe(frozen)
    const restored = harness(memory).controller
    expect(retryEntry(restored.getSnapshot())?.payload).toEqual(initial.payload)
    expect(restored.getSnapshot().processingMode).toBe('modify')
    expect(restored.createOutbox('queue', restored.sessionId).payload).toEqual(initial.payload)
  })

  it('preserves chosen IDs across reload and restores a deleted annotation without reattaching it', () => {
    const { controller, memory } = harness()
    controller.setSelectionMode(true)
    const first = save(controller, 0)
    const second = save(controller, 20)
    controller.toggleSelected(first)
    const restored = harness(memory).controller
    expect(selectedAnnotations(restored.getSnapshot()).map((item) => item.annotationId)).toEqual([second])
    restored.deleteDraft(second)
    expect(restored.getSnapshot().selectedAnnotationIds).toEqual([])
    restored.undoDelete()
    expect(restored.getSnapshot().annotations.some((item) => item.annotationId === second)).toBe(true)
    expect(restored.getSnapshot().selectedAnnotationIds).toEqual([])
  })

  it('keeps multiple suspended edits, blank changes and new highlight drafts without sending old content', () => {
    const { controller, memory } = harness()
    controller.setSelectionMode(true)
    const original = save(controller, 0, 'Saved opinion')
    controller.toggleSelected(original)
    controller.openAnnotation(original)
    controller.updateEditorText('')
    controller.suspendEditor()
    const savedKey = editorBufferKey(controller.getSnapshot().editorDrafts[0]!)
    expect(selectedAnnotations(controller.getSnapshot())).toEqual([])
    expect(eligibleAnnotations(controller.getSnapshot())).toEqual([])
    controller.beginSelection(capture(20))
    const newDraft = controller.getSnapshot().editor!
    expect(newDraft.kind).toBe('new')
    const newKey = editorBufferKey(newDraft)
    controller.suspendEditor()
    expect(controller.getSnapshot().editorDrafts).toHaveLength(2)
    const elsewhere = harness(memory, 'another-session').controller
    expect(elsewhere.getSnapshot().editorDrafts).toEqual([])
    const restored = harness(memory).controller
    expect(restored.getSnapshot().editorDrafts).toHaveLength(2)
    restored.resumeEditor(savedKey)
    expect(restored.getSnapshot().editor?.text).toBe('')
    restored.closeEditor(true)
    expect(restored.getSnapshot().annotations[0]?.annotation).toBe('Saved opinion')
    expect(restored.getSnapshot().selectedAnnotationIds).toEqual([])
    restored.resumeEditor(newKey)
    const savedNewId = restored.saveEditor()
    expect(newDraft.kind === 'new' && savedNewId === newDraft.draftId).toBe(true)
    expect(restored.getSnapshot().annotations.find((item) => item.annotationId === savedNewId)?.kind).toBe(
      'highlight-only',
    )
    expect(restored.getSnapshot().editorDrafts).toEqual([])
  })

  it('flushes the latest text before the debounce expires and preserves buffers when another editor opens', () => {
    const { controller, memory } = harness()
    const original = save(controller, 0)
    controller.openAnnotation(original)
    controller.updateEditorText('Latest unflushed composition result')
    controller.beginSelection(capture(20))
    controller.updateEditorText('Another unfinished annotation')
    controller.flush()
    const restored = harness(memory).controller
    expect(restored.getSnapshot().editor?.text).toBe('Another unfinished annotation')
    expect(restored.getSnapshot().editorDrafts[0]?.text).toBe('Latest unflushed composition result')
    expect(selectedAnnotations(restored.getSnapshot())).toEqual([])
  })

  it('adds overlapping ranges as independent annotations', () => {
    const { controller } = harness()
    const first = save(controller, 0, 'First opinion')
    controller.beginSelection(capture(2, 5))
    expect(controller.getSnapshot().overlap).toBeNull()
    expect(controller.getSnapshot().editor).toMatchObject({ kind: 'new' })
    controller.updateEditorText('Second opinion')
    const second = controller.saveEditor()
    expect(second).not.toBe(first)
    expect(controller.getSnapshot().annotations).toMatchObject([
      { annotationId: first, annotation: 'First opinion' },
      { annotationId: second, annotation: 'Second opinion' },
    ])
  })

  it('preserves a suspended edit when a new overlapping selection starts', () => {
    const { controller } = harness()
    const original = save(controller, 0)
    controller.openAnnotation(original)
    controller.updateEditorText('Unfinished replacement')
    controller.suspendEditor()
    controller.beginSelection(capture(1, 3))
    expect(controller.getSnapshot().editor).toMatchObject({ kind: 'new' })
    expect(controller.getSnapshot().editorDrafts[0]).toMatchObject({
      kind: 'edit',
      annotationId: original,
      text: 'Unfinished replacement',
    })
  })

  it.each(['unsaved', 'saved', 'deleted'] as const)(
    'rejects a stale preparation snapshot after a later %s change without losing it',
    (change) => {
      const { controller, storage } = harness()
      const id = save(controller, 0, 'Original opinion')
      const snapshot = controller.getSnapshot()
      if (change === 'deleted') {
        controller.deleteDraft(id)
      } else {
        controller.openAnnotation(id)
        controller.updateEditorText('Later change during preparation')
        if (change === 'saved') controller.saveEditor()
      }
      expect(() =>
        controller.createOutbox('queue', controller.sessionId, '', undefined, 'en', snapshot),
      ).toThrow(SubmissionChangedError)
      controller.flush()
      expect(storage.load().outbox).toEqual([])
      if (change === 'unsaved') {
        expect(storage.load().editorDraft?.text).toBe('Later change during preparation')
        expect(storage.load().annotations[0]?.annotation).toBe('Original opinion')
      } else if (change === 'saved') {
        expect(storage.load().annotations[0]).toMatchObject({
          status: 'draft',
          annotation: 'Later change during preparation',
        })
      } else {
        expect(storage.load().annotations).toEqual([])
      }
    },
  )

  it.each(['queued', 'accepted', 'sent', 'withdrawn'] as const)(
    'does not downgrade a retry that becomes %s during preparation',
    (status) => {
      const { controller } = harness()
      save(controller, 0)
      const entry = controller.createOutbox('queue', controller.sessionId)
      controller.markSending(entry.payload.submissionId)
      controller.markFailed(entry.payload.submissionId, 'offline')
      const snapshot = controller.getSnapshot()
      if (status === 'withdrawn') controller.discardOutbox(entry.payload.submissionId)
      else if (status === 'sent') sent(controller, entry.payload)
      else {
        controller.reconcile({
          chat: { nodes: new Map() },
          queue: [{ messageId: entry.messageId }],
          hasMore: false,
        })
        if (status === 'accepted') controller.markQueueClaimed(entry.payload.submissionId)
      }
      if (status === 'withdrawn') {
        expect(() =>
          controller.createOutbox('queue', controller.sessionId, '', undefined, 'en', snapshot),
        ).toThrow(SubmissionChangedError)
      } else {
        expect(
          controller.createOutbox('queue', controller.sessionId, '', undefined, 'en', snapshot).status,
        ).toBe(status)
      }
      controller.markSending(entry.payload.submissionId)
      controller.markFailed(entry.payload.submissionId, 'late transport failure')
      controller.markAccepted(entry.payload.submissionId)
      controller.discardOutbox(entry.payload.submissionId)
      expect(controller.getSnapshot().outbox[0]).toMatchObject({ status, attempts: 1 })
    },
  )

  it('keeps an unfinished edit when switching to a new annotation', () => {
    const { controller, storage } = harness()
    const first = save(controller, 0)
    controller.openAnnotation(first)
    controller.updateEditorText('Unfinished keyboard edit')
    controller.beginSelection(capture(1, 3))
    expect(controller.getSnapshot().overlap).toBeNull()
    expect(controller.getSnapshot().editor).toMatchObject({ kind: 'new' })
    expect(controller.getSnapshot().editorDrafts[0]).toMatchObject({
      kind: 'edit',
      annotationId: first,
      text: 'Unfinished keyboard edit',
    })
    controller.flush()
    expect(storage.load().editorDrafts?.[0]?.text).toBe('Unfinished keyboard edit')
  })

  it('rejects a stale discard when the Host queue already owns the submission', () => {
    const { controller } = harness()
    save(controller, 0)
    const entry = controller.createOutbox('queue', controller.sessionId)
    controller.markSending(entry.payload.submissionId)
    controller.markFailed(entry.payload.submissionId, 'offline')
    controller.reconcile({
      chat: { nodes: new Map() },
      queue: [{ messageId: entry.messageId }],
      hasMore: false,
    })
    controller.discardOutbox(entry.payload.submissionId)
    expect(controller.getSnapshot().outbox[0]?.status).toBe('queued')
    expect(controller.getSnapshot().annotations[0]).toMatchObject({
      status: 'queued',
      submissionId: entry.payload.submissionId,
    })
    sent(controller, entry.payload)
    expect(controller.getSnapshot().annotations[0]?.status).toBe('sent')
    expect(selectedAnnotations(controller.getSnapshot())).toEqual([])
  })

  it.each(['unsaved', 'saved'] as const)(
    'keeps %s changes separate when durable confirmation arrives after a failed batch was discarded',
    (change) => {
      const { controller, storage } = harness()
      controller.setSelectionMode(true)
      const id = save(controller, 0, 'Originally submitted opinion')
      const entry = controller.createOutbox('queue', controller.sessionId)
      controller.markSending(entry.payload.submissionId)
      controller.markFailed(entry.payload.submissionId, 'ambiguous failure')
      controller.discardOutbox(entry.payload.submissionId)
      controller.openAnnotation(id)
      controller.updateEditorText('Later local revision')
      if (change === 'saved') controller.saveEditor()
      sent(controller, entry.payload)
      expect(controller.getSnapshot().annotations.find((item) => item.annotationId === id)).toMatchObject({
        status: 'sent',
        annotation: 'Originally submitted opinion',
        ordinal: 1,
      })
      expect(selectedAnnotations(controller.getSnapshot())).toEqual([])
      if (change === 'saved') {
        const pending = controller.getSnapshot().annotations.find((item) => item.status === 'draft')!
        expect(pending.annotationId).not.toBe(id)
        expect(pending).toMatchObject({ annotation: 'Later local revision', supplementalTo: id })
        sent(controller, entry.payload)
        expect(controller.getSnapshot().annotations).toHaveLength(2)
      } else {
        expect(storage.load().editorDraft).toMatchObject({
          kind: 'new',
          text: 'Later local revision',
          supplementalTo: id,
        })
      }
      expect(controller.getSnapshot().notice?.messageKey).toBe('notice.localEditsPreserved')
    },
  )

  it('restores only historical source fields after a later saved range change', () => {
    const { controller, storage, memory } = harness()
    controller.setSelectionMode(true)
    const id = save(controller, 0, 'Original opinion')
    const entry = controller.createOutbox('queue', controller.sessionId)
    controller.markFailed(entry.payload.submissionId, 'ambiguous failure')
    controller.discardOutbox(entry.payload.submissionId)
    controller.beginSelection({
      ...capture(1, 3),
      structure: { kind: 'code', language: 'ts', startLine: 2, endLine: 3 },
      blockIndex: 4,
    })
    controller.updateEditorText('Later source range')
    controller.saveEditor()

    sent(controller, entry.payload)

    const history = controller.getSnapshot().annotations.find((item) => item.annotationId === id)!
    expect(history.quote).toEqual(entry.payload.annotations[0]!.quote)
    expect(history.annotation).toBe('Original opinion')
    expect(history).not.toHaveProperty('structure')
    expect(history).not.toHaveProperty('blockIndex')
    const pending = controller.getSnapshot().annotations.find((item) => item.status === 'draft')!
    expect(pending).toMatchObject({
      quote: capture(1, 3).quote,
      structure: { kind: 'code', language: 'ts', startLine: 2, endLine: 3 },
    })
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([pending.annotationId])
    expect(storage.load().annotations.find((item) => item.annotationId === id)).not.toHaveProperty(
      'structure',
    )
    const restored = harness(memory).controller
    sent(restored, entry.payload)
    expect(restored.getSnapshot().annotations).toEqual(controller.getSnapshot().annotations)
  })

  it.each(['outbox', 'history'] as const)(
    'calibrates legacy sent ordinals from the immutable %s payload',
    (source) => {
      const { controller, storage, memory } = harness()
      save(controller, 0)
      const entry = controller.createOutbox('queue', controller.sessionId)
      sent(controller, entry.payload)
      const persisted = storage.load()
      storage.save({
        ...persisted,
        annotations: persisted.annotations.map((item) => ({ ...item, ordinal: 7 })),
        outbox: source === 'outbox' ? persisted.outbox : [],
      })
      const restored = harness(memory).controller
      if (source === 'outbox') expect(restored.getSnapshot().annotations[0]?.ordinal).toBe(1)
      else expect(restored.getSnapshot().annotations[0]?.ordinal).toBe(7)
      sent(restored, entry.payload)
      expect(restored.getSnapshot().annotations[0]?.ordinal).toBe(1)
      expect(storage.load().annotations[0]?.ordinal).toBe(1)
    },
  )

  it('requires confirmation for a long independent annotation and preserves sent history', () => {
    const { controller, memory } = harness(new MemoryStorage(), 'long', {
      ...DEFAULT_CONFIG,
      warnSelectionChars: 10,
    })
    const original = save(controller, 0, 'Original opinion')
    controller.beginSelection(capture(0, 20))
    controller.updateEditorText('Second opinion')
    expect(() => controller.saveEditor()).toThrow('long selection is not confirmed')
    controller.confirmLongSelection()
    const second = controller.saveEditor()
    expect(second).not.toBe(original)
    const entry = controller.createOutbox('queue', controller.sessionId)
    sent(controller, entry.payload)
    const originalJSON = JSON.stringify(entry.payload)
    const restored = harness(memory, 'long').controller
    restored.toggleSelected(original)
    const resent = restored.createOutbox('queue', restored.sessionId)
    expect(resent.payload.annotations).toHaveLength(1)
    expect(resent.payload.annotations[0]?.annotationId).toBe(original)
    expect(JSON.stringify(restored.getSnapshot().outbox[0]?.payload)).toBe(originalJSON)
    expect(restored.getSnapshot().annotations).toHaveLength(2)
  })
})
