/** Recycle-bin durability and interleaved browser/session lifecycle coverage. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import { compactFileSource, compactOfficialDiffSource } from '../src/client/official-adapters.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { officialDiffHash, sha256Hex } from '../src/shared/snapshot-hash.ts'
import type { AnnotationId, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import type { SelectionCapture } from '../src/client/selection.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
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

const sessionId = 'session-trash' as SessionIdentity
const time = 1_700_000_000_000
const controllers: AnnotationController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.restoreAllMocks()
})

function harness(memory = new MemoryStorage(), id = sessionId) {
  const storage = new AnnotationStorage(memory, id)
  const controller = new AnnotationController(
    id,
    storage,
    {
      getSnapshot: () => ({ hasMore: false }),
      loadOlder: async () => undefined,
    },
    DEFAULT_CONFIG,
    () => time,
  )
  controllers.push(controller)
  return { controller, storage, memory }
}

function selection(index = 0): SelectionCapture {
  const messageId = `message-${index}` as MessageIdentity
  return {
    messageId,
    messageSeq: index + 1,
    responseVersion: messageId,
    quote: { exact: `source-${index}`, prefix: '', suffix: '', start: 0, end: 8 },
    rect: { top: 0, left: 0, bottom: 10, right: 80 },
  }
}

function save(controller: AnnotationController, index = 0, capture = selection(index)): AnnotationId {
  controller.beginSelection(capture)
  controller.updateEditorText(`annotation-${index}`)
  return controller.saveEditor()
}

function durable(controller: AnnotationController) {
  const entry = controller.createOutbox('queue', controller.sessionId)
  const snapshot = {
    chat: {
      nodes: new Map([
        [
          'user',
          {
            kind: 'user',
            data: {
              source: {
                kind: 'user',
                annotationSubmission: entry.payload,
              },
            },
          },
        ],
      ]),
    },
    queue: [],
    hasMore: false,
  }
  controller.reconcile(snapshot)
  return { entry, snapshot }
}

function latest(memory: MemoryStorage) {
  const store = new AnnotationStorage(memory, sessionId)
  const state = store.load(true)
  expect(store.lastError()).toBeNull()
  store.dispose()
  return state
}

describe('annotation recycle bin', () => {
  it('undoes every annotation from the most recent batch deletion', () => {
    const { controller } = harness()
    const first = save(controller, 1)
    const second = save(controller, 2)
    expect(controller.trashAnnotations([first, second])).toBe(true)
    expect(controller.getSnapshot().deletedAnnotationIds).toEqual([first, second])

    controller.undoDelete()

    expect(controller.getSnapshot().annotations.map((item) => item.annotationId)).toEqual([first, second])
    expect(controller.getSnapshot().trash).toHaveLength(0)
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(controller.getSnapshot().deletedAnnotationIds).toEqual([])
  })

  it('retains every batch deletion across reload and restores without attaching', () => {
    const { controller, memory } = harness()
    const first = save(controller, 1)
    const second = save(controller, 2)
    expect(controller.trashAnnotations([first, second])).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ annotations: [], selectedAnnotationIds: [] })
    expect(
      latest(memory)
        .trash?.map((entry) => entry.annotation.annotationId)
        .sort(),
    ).toEqual([first, second].sort())
    const reloaded = harness(memory).controller
    expect(reloaded.restoreAnnotations([first])).toBe(true)
    expect(reloaded.getSnapshot().annotations[0]?.annotationId).toBe(first)
    expect(reloaded.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(reloaded.getSnapshot().trash[0]?.annotation.annotationId).toBe(second)
    expect(reloaded.restoreAnnotations([first])).toBe(true)
    expect(latest(memory).annotations).toHaveLength(1)
  })

  it('keeps current unsaved edit text in the trash and suspends it on restoration', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    controller.openAnnotation(id)
    controller.updateEditorText('unfinished change')
    expect(controller.trashAnnotations([id])).toBe(true)
    expect(controller.getSnapshot().editor).toBeNull()
    expect(latest(memory).trash?.[0]?.editorDrafts[0]?.text).toBe('unfinished change')
    expect(controller.restoreAnnotations([id])).toBe(true)
    expect(controller.getSnapshot().editorDrafts[0]?.text).toBe('unfinished change')
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
  })

  it('detaches a batch without deleting, duplicating, or recycling any annotation', () => {
    const { controller } = harness()
    const id = save(controller)
    expect(controller.detachAnnotations([id])).toBe(true)
    expect(controller.getSnapshot().annotations).toHaveLength(1)
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    expect(controller.getSnapshot().trash).toEqual([])
    expect(controller.getSnapshot().deletionMarks).toEqual([])
  })

  it('keeps visible data and the newest editor buffer when a delete write fails', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    controller.openAnnotation(id)
    controller.updateEditorText('last unsaved keystroke')
    const values = new Map(memory.values)
    const writes = vi.spyOn(memory, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(controller.trashAnnotations([id])).toBe(false)
    expect(controller.getSnapshot().annotations[0]?.annotationId).toBe(id)
    expect(controller.getSnapshot().editor?.text).toBe('last unsaved keystroke')
    expect(controller.getSnapshot().selectedAnnotationIds).toContain(id)
    expect(controller.getSnapshot().trash).toEqual([])
    expect(memory.values).toEqual(values)
    writes.mockRestore()
  })

  it.each(['restore', 'purge'] as const)('retains recycled data when %s cannot persist', (operation) => {
    const { controller, memory } = harness()
    const id = save(controller)
    controller.trashAnnotations([id])
    const writes = vi.spyOn(memory, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(
      operation === 'restore' ? controller.restoreAnnotations([id]) : controller.purgeAnnotations([id]),
    ).toBe(false)
    expect(controller.getSnapshot().trash[0]?.annotation.annotationId).toBe(id)
    expect(controller.getSnapshot().annotations).toEqual([])
    writes.mockRestore()
  })

  it('rejects the entire deletion batch while any target belongs to frozen work', () => {
    const { controller } = harness()
    const frozen = save(controller)
    const entry = controller.createOutbox('queue', sessionId)
    const later = save(controller, 1)
    const payload = entry.payload
    expect(() => controller.trashAnnotations([frozen, later])).toThrow('annotation-submission-locked')
    expect(controller.getSnapshot().annotations).toHaveLength(2)
    expect(controller.getSnapshot().trash).toEqual([])
    expect(controller.getSnapshot().outbox[0]?.payload).toEqual(payload)
    controller.discardOutbox(entry.payload.submissionId)
    expect(controller.trashAnnotations([frozen, later])).toBe(true)
  })

  it('keeps sent annotations recycled or purged through history replay and reload', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    const { entry, snapshot } = durable(controller)
    expect(controller.trashAnnotations([id])).toBe(true)
    controller.reconcile(snapshot)
    expect(controller.getSnapshot().annotations).toEqual([])
    expect(controller.getSnapshot().trash[0]?.annotation.status).toBe('sent')
    expect(controller.purgeAnnotations([id])).toBe(true)
    controller.reconcile(snapshot)
    const reloaded = harness(memory).controller
    reloaded.reconcile(snapshot)
    expect(reloaded.getSnapshot().annotations).toEqual([])
    expect(reloaded.getSnapshot().trash).toEqual([])
    expect(reloaded.getSnapshot().deletionMarks[0]?.state).toBe('purged')
    expect(reloaded.getSnapshot().outbox[0]?.payload).toEqual(entry.payload)
  })

  it('updates recycled history status without restoring the record', () => {
    const { controller } = harness()
    const id = save(controller)
    const { entry, snapshot } = durable(controller)
    controller.trashAnnotations([id])
    snapshot.chat.nodes.set('reply', {
      kind: 'assistant-step',
      data: {
        source: {
          kind: 'user',
          annotationSubmission: entry.payload,
        },
      },
    })
    controller.reconcile({
      ...snapshot,
      chat: {
        nodes: new Map<string, unknown>([
          ...snapshot.chat.nodes,
          [
            'ack',
            {
              kind: 'assistant-step',
              data: {
                blocks: [
                  {
                    kind: 'text',
                    text: `<!-- dsh-annotation:{"submissionId":"${entry.payload.submissionId}","processed":["${id}"]} -->`,
                  },
                ],
              },
            },
          ],
        ]),
      },
    })
    expect(controller.getSnapshot().annotations).toEqual([])
    expect(controller.getSnapshot().trash[0]?.annotation.status).toBe('processed')
    controller.restoreAnnotations([id])
    expect(controller.getSnapshot().annotations[0]?.status).toBe('processed')
  })

  it('ignores a stale tab saving and replaying content after another tab deleted it', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    const stale = harness(memory).controller
    stale.openAnnotation(id)
    stale.updateEditorText('edited on stale page')
    controller.trashAnnotations([id])
    stale.saveEditor()
    const state = latest(memory)
    expect(state.annotations).toEqual([])
    expect(state.trash?.[0]?.annotation.annotationId).toBe(id)
    expect(state.annotations.some((annotation) => annotation.annotationId.startsWith('ann-conflict-'))).toBe(
      false,
    )
    stale.synchronizeStorage()
    expect(stale.getSnapshot().editor).toBeNull()
    expect(stale.getSnapshot().annotations).toEqual([])
  })

  it('does not restore a purged entry from a stale recycle-bin view', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    controller.trashAnnotations([id])
    const stale = harness(memory).controller
    controller.purgeAnnotations([id])
    stale.restoreAnnotations([id])
    expect(latest(memory).annotations).toEqual([])
    expect(latest(memory).trash).toEqual([])
    expect(latest(memory).deletionMarks?.[0]?.state).toBe('purged')
  })

  it('enumerates unmounted and renamed session stores without treating journal ids as sessions', () => {
    const { controller, memory } = harness()
    controller.trashAnnotations([save(controller)])
    const other = harness(memory, 'another-session' as SessionIdentity).controller
    other.trashAnnotations([save(other)])
    memory.values.set('dsh-inline-comments:v1:legacy-session', JSON.stringify(emptyPersistedState()))
    memory.values.set('unrelated-key', 'value')
    expect(AnnotationStorage.listSessionIds(memory)).toEqual(['another-session', 'legacy-session', sessionId])
  })

  it.each([1, 2, 3, 4, 5])('reads storage v%s without inventing previously deleted content', (version) => {
    const memory = new MemoryStorage()
    memory.values.set(
      `dsh-annotation:v1:${sessionId}`,
      JSON.stringify({ ...emptyPersistedState(), storageVersion: version }),
    )
    const { controller } = harness(memory)
    expect(controller.getSnapshot().trash).toEqual([])
    expect(controller.getSnapshot().deletionMarks).toEqual([])
    expect(latest(memory).storageVersion).toBe(6)
  })
})

describe('durable annotation sending', () => {
  it('marks all three sources sent before a model reply and preserves later attachments', () => {
    const { controller } = harness()
    save(controller)
    const empty = { exact: '', prefix: '', suffix: '', start: 0, end: 0 }
    save(controller, 1, {
      source: compactFileSource({
        kind: 'file',
        sessionId,
        resourceAddress: `dsh-resource://file/session/${sessionId}/%2Fworkspace%2Fa.ts`,
        path: '/workspace/a.ts',
        resourceVersion: 'v1',
        format: 'text',
        wholeFile: true,
        entry: 'sidebar',
        snapshot: { version: 1, hash: sha256Hex('source'), bytes: 6, format: 'text', text: 'source' },
      }),
      quote: empty,
      rect: selection().rect,
    })
    const diff = {
      version: 1,
      sessionId,
      seq: 8,
      turn: 1,
      fileIndex: 0,
      path: 'a.ts',
      display: 'a.ts',
      kind: 'text',
      before: true,
      after: true,
      coarse: false,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
    } as const
    save(controller, 2, {
      source: compactOfficialDiffSource({
        kind: 'official-diff',
        snapshot: { ...diff, hash: officialDiffHash(diff) },
        side: 'new',
        wholeFile: true,
        entry: 'hover',
      }),
      quote: empty,
      rect: selection().rect,
    })
    const entry = controller.createOutbox('queue', sessionId)
    const later = save(controller, 3)
    controller.reconcile({
      chat: {
        nodes: new Map([
          [
            'message',
            {
              kind: 'user',
              data: {
                source: { kind: 'user', annotationSubmission: entry.payload },
              },
            },
          ],
        ]),
      },
      queue: [],
      hasMore: false,
    })
    expect(controller.getSnapshot().annotations.filter((item) => item.status === 'sent')).toHaveLength(3)
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([later])
  })

  it('consumes selection when another browser delivers a locally selected draft, then permits deliberate reattachment', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    const other = harness(memory).controller
    const entry = other.createOutbox('queue', sessionId)
    const snapshot = {
      chat: {
        nodes: new Map([
          [
            'message',
            {
              kind: 'user',
              data: {
                source: { kind: 'user', annotationSubmission: entry.payload },
              },
            },
          ],
        ]),
      },
      queue: [],
      hasMore: false,
    }
    controller.reconcile(snapshot)
    expect(controller.getSnapshot().annotations[0]?.status).toBe('sent')
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    controller.toggleSelected(id)
    controller.reconcile(snapshot)
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([id])
    expect(latest(memory).annotations).toHaveLength(1)
  })
  it('consumes a stale selection when the storage event arrives before chat reconciliation', () => {
    const { controller, memory } = harness()
    const id = save(controller)
    const other = harness(memory).controller
    const { snapshot } = durable(other)
    controller.synchronizeStorage()
    expect(controller.getSnapshot().annotations[0]?.status).toBe('sent')
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([])
    controller.reconcile(snapshot)
    controller.toggleSelected(id)
    controller.synchronizeStorage()
    expect(controller.getSnapshot().selectedAnnotationIds).toEqual([id])
  })
})
