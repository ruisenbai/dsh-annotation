import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnnotationController,
  editorBufferKey,
  eligibleAnnotations,
  isReadOnlyEditor,
  retryEntry,
  selectedAnnotations,
} from '../src/client/controller.ts'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { submissionMessageId } from '../src/shared/ids.ts'
import type {
  AnnotationDraft,
  AnnotationId,
  MessageIdentity,
  OutboxEntry,
  PersistedEditorDraft,
  PersistedSessionState,
  SessionIdentity,
} from '../src/shared/types.ts'
import { diffCapture, legacyDiffPayload } from './diff-fixtures.ts'

const controllers: AnnotationController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function harness(state: Partial<PersistedSessionState> = {}) {
  const values = new Map<string, string>()
  const sessionId = 'session-test' as SessionIdentity
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
    sessionId,
  )
  storage.save({ ...emptyPersistedState(), ...state })
  const navigation = { getSnapshot: () => ({ hasMore: true }), loadOlder: vi.fn(async () => undefined) }
  const controller = new AnnotationController(
    sessionId,
    storage,
    navigation,
    DEFAULT_CONFIG,
    () => 1_700_000_000_010,
  )
  controllers.push(controller)
  return { controller, storage, navigation }
}

function drafts(): AnnotationDraft[] {
  return legacyDiffPayload().annotations.map((item) => ({
    ...item,
    status: 'draft',
    updatedAt: item.createdAt,
  }))
}

function saveMessage(controller: AnnotationController) {
  controller.beginSelection({
    messageId: 'new-source' as MessageIdentity,
    responseVersion: 'new-source' as MessageIdentity,
    messageSeq: 50,
    quote: { exact: 'New message quote', start: 0, end: 17, prefix: '', suffix: '' },
    rect: { top: 0, left: 0, bottom: 0, right: 0 },
  })
  controller.updateEditorText('New message opinion')
  return controller.saveEditor()
}

function oldBatch(status: 'ready' | 'failed'): OutboxEntry {
  const payload = legacyDiffPayload()
  return {
    payload,
    messageId: submissionMessageId(payload.submissionId),
    targetSessionId: payload.sessionId,
    status,
    attempts: 2,
    lastError: 'Saved transport failure',
  }
}

describe('retired Diff write paths', () => {
  it.each(['all', 'individual'] as const)(
    'only sends message drafts in %s mode and leaves the old Diff draft untouched',
    (selectionMode) => {
      const annotations = drafts()
      const original = annotations[1]!
      const { controller, storage } = harness({
        annotations,
        selectionMode,
        selectedAnnotationIds: annotations.map((item) => item.annotationId),
      })
      expect(eligibleAnnotations(controller.getSnapshot()).map((item) => item.annotationId)).toEqual([
        annotations[0]!.annotationId,
      ])
      expect(selectedAnnotations(controller.getSnapshot()).map((item) => item.annotationId)).toEqual([
        annotations[0]!.annotationId,
      ])
      expect(controller.getSnapshot().selectedAnnotationIds).not.toContain(original.annotationId)
      controller.toggleSelected(original.annotationId)
      const entry = controller.createOutbox('queue', controller.sessionId)
      expect(entry.payload.annotations).toHaveLength(1)
      expect(entry.payload.annotations[0]).toMatchObject({
        annotationId: annotations[0]!.annotationId,
        ordinal: 1,
        source: { kind: 'message' },
      })
      expect(
        controller.getSnapshot().annotations.find((item) => item.annotationId === original.annotationId),
      ).toEqual(original)
      expect(storage.load().annotations.find((item) => item.annotationId === original.annotationId)).toEqual(
        original,
      )
    },
  )

  it('does not create, edit, locate or delete a Diff annotation, or renumber it after normal edits', async () => {
    const original: AnnotationDraft = { ...drafts()[1]!, ordinal: 12 }
    const { controller, navigation, storage } = harness({ annotations: [original] })
    expect(() => controller.beginSelection(diffCapture())).toThrow('read-only')
    expect(() => controller.createOutbox('queue', controller.sessionId)).toThrow('no annotations to submit')
    controller.openAnnotation(original.annotationId)
    expect(controller.getSnapshot().editor).toBeNull()
    expect(await controller.navigate(original.annotationId)).toBe(false)
    expect(navigation.loadOlder).not.toHaveBeenCalled()
    controller.deleteDraft(original.annotationId)
    expect(controller.getSnapshot().annotations).toEqual([original])
    const fresh = saveMessage(controller)
    controller.deleteDraft(fresh)
    expect(controller.getSnapshot().annotations).toEqual([original])
    expect(storage.load().annotations).toEqual([original])
  })

  it.each(['new', 'edit'] as const)(
    'retains a restored %s Diff editor as a read-only buffer when another draft is saved',
    (kind) => {
      const annotations = drafts()
      const editorDraft: PersistedEditorDraft =
        kind === 'new'
          ? {
              kind: 'new',
              draftId: 'legacy-buffer' as AnnotationId,
              capture: diffCapture(),
              text: 'Unfinished Diff opinion',
              longSelectionConfirmed: true,
            }
          : { kind: 'edit', annotationId: annotations[1]!.annotationId, text: 'Unfinished Diff opinion' }
      const { controller, storage } = harness({ annotations, editorDraft })
      expect(controller.getSnapshot().editor).toBeNull()
      expect(controller.getSnapshot().editorDrafts).toEqual([editorDraft])
      const key = editorBufferKey(editorDraft)
      controller.resumeEditor(key)
      controller.discardEditorDraft(key)
      expect(controller.getSnapshot().editor).toBeNull()
      expect(controller.getSnapshot().editorDrafts).toEqual([editorDraft])
      saveMessage(controller)
      expect(storage.load().editorDraft).toBeUndefined()
      expect(storage.load().editorDrafts).toEqual([editorDraft])
      expect(
        storage.load().annotations.find((item) => item.annotationId === annotations[1]!.annotationId),
      ).toEqual(annotations[1])
    },
  )

  it('recognizes retained Diff supplements and expanded selections without treating ordinary editors as read-only', () => {
    const annotations = drafts()
    const diffId = annotations[1]!.annotationId
    const message = annotations[0]!
    const messageCapture = { ...message, rect: { top: 0, left: 0, bottom: 0, right: 0 } }
    expect(
      isReadOnlyEditor(
        {
          kind: 'new',
          capture: messageCapture,
          text: '',
          supplementalTo: diffId,
          longSelectionConfirmed: true,
        },
        annotations,
      ),
    ).toBe(true)
    expect(
      isReadOnlyEditor(
        { kind: 'edit', annotationId: message.annotationId, text: '', expandedCapture: diffCapture() },
        annotations,
      ),
    ).toBe(true)
    expect(
      isReadOnlyEditor(
        { kind: 'new', capture: messageCapture, text: '', longSelectionConfirmed: true },
        annotations,
      ),
    ).toBe(false)
    expect(
      isReadOnlyEditor({ kind: 'edit', annotationId: message.annotationId, text: '' }, annotations),
    ).toBe(false)
  })

  it.each(['ready', 'failed'] as const)(
    'keeps a %s mixed batch frozen and never converts it into a message-only retry',
    (status) => {
      const entry = oldBatch(status)
      const annotations: AnnotationDraft[] = entry.payload.annotations.map((item) => ({
        ...item,
        status: 'queued',
        submissionId: entry.payload.submissionId,
        updatedAt: item.createdAt,
      }))
      const { controller, storage } = harness({
        annotations,
        outbox: [entry],
        retrySubmissionId: entry.payload.submissionId,
      })
      const before = JSON.stringify(storage.load().outbox)
      expect(controller.getSnapshot().retrySubmissionId).toBeNull()
      expect(retryEntry(controller.getSnapshot())).toBeUndefined()
      controller.selectRetry(entry.payload.submissionId)
      controller.discardOutbox(entry.payload.submissionId)
      expect(controller.getSnapshot().retrySubmissionId).toBeNull()
      expect(() => controller.markSending(entry.payload.submissionId)).toThrow('read-only')
      expect(() =>
        controller.createOutbox('queue', controller.sessionId, '', undefined, 'en', {
          ...controller.getSnapshot(),
          retrySubmissionId: entry.payload.submissionId,
        }),
      ).toThrow('read-only')
      expect(JSON.stringify(storage.load().outbox)).toBe(before)
      const freshId = saveMessage(controller)
      const fresh = controller.createOutbox('queue', controller.sessionId)
      expect(fresh.payload.annotations.map((item) => item.annotationId)).toEqual([freshId])
      expect(controller.getSnapshot().outbox[0]).toEqual(entry)
      expect(
        controller
          .getSnapshot()
          .annotations.filter((item) => item.submissionId === entry.payload.submissionId),
      ).toEqual(annotations)
    },
  )

  it('does not automatically select a pre-removal failed retry when older storage lacks retry intent', () => {
    const { controller } = harness({ outbox: [oldBatch('failed')] })
    expect(retryEntry(controller.getSnapshot())).toBeUndefined()
    expect(controller.getSnapshot().retrySubmissionId).toBeNull()
  })

  it('replays a durable mixed batch and acknowledgement with its frozen sources, opinions and ordinals', () => {
    const entry = oldBatch('failed')
    const { controller, storage, navigation } = harness({ outbox: [entry] })
    const payload = entry.payload
    const nodes = new Map<string, unknown>([
      ['user', { kind: 'user', data: { source: { kind: 'user', annotationSubmission: payload } } }],
      [
        'assistant',
        {
          kind: 'assistant-step',
          data: {
            blocks: [
              {
                kind: 'text',
                text: `Done.\n<!-- dsh-annotation:${JSON.stringify({ submissionId: payload.submissionId, processed: payload.annotations.map((item) => item.annotationId) })} -->`,
              },
            ],
          },
        },
      ],
    ])
    controller.reconcile({ chat: { nodes }, queue: [], hasMore: false })
    expect(
      controller
        .getSnapshot()
        .annotations.map(({ status, updatedAt: _updatedAt, submissionId: _submissionId, ...item }) => {
          expect(status).toBe('processed')
          return item
        }),
    ).toEqual(payload.annotations)
    expect(storage.load().outbox[0]).toMatchObject({ payload, status: 'sent', attempts: 2 })
    expect(navigation.loadOlder).not.toHaveBeenCalled()
  })
})
