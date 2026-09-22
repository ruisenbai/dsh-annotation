import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnnotationController,
  editorBufferKey,
  type AnnotationReconciliationSnapshot,
} from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { diffCapture, diffSnapshot, diffSource } from './diff-fixtures.ts'
import { fixturePayload } from './fixtures.ts'

const controllers: AnnotationController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})
function harness(memory = new Map<string, string>()) {
  const sessionId = 'session-test' as SessionIdentity
  const storage = new AnnotationStorage(
    {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value)
      },
      removeItem: (key) => {
        memory.delete(key)
      },
    },
    sessionId,
  )
  const controller = new AnnotationController(
    sessionId,
    storage,
    { getSnapshot: () => ({ hasMore: false }), loadOlder: vi.fn() },
    DEFAULT_CONFIG,
  )
  controllers.push(controller)
  return { controller, storage, memory }
}
function save(controller: AnnotationController, source = diffSource()) {
  controller.beginDiffSelection(diffCapture(source))
  controller.updateEditorText('A real file opinion')
  return controller.saveEditor()
}

describe('Diff drafts and frozen submission lifecycle', () => {
  it('extends only the same frozen side, preserves unfinished edits and resumes into the Diff panel', () => {
    const { controller, memory } = harness()
    controller.openDiffPanel()
    controller.beginDiffSelection(diffCapture())
    controller.updateEditorText('unfinished')
    const before = controller.getSnapshot().editor
    for (const source of [
      diffSource(diffSnapshot(), 'old'),
      diffSource(diffSnapshot('', 'another\nfile\n')),
      diffSource(diffSnapshot(undefined, undefined, { id: 'e'.repeat(64) })),
    ]) {
      expect(() => controller.beginDiffSelection(diffCapture(source), true)).toThrow('same file')
      expect(controller.getSnapshot().editor).toBe(before)
    }
    controller.beginDiffSelection(diffCapture(diffSource(diffSnapshot(), 'new', 2, 3)), true)
    expect(controller.getSnapshot().editor).toMatchObject({
      capture: { source: { startLine: 2, endLine: 3 } },
      text: 'unfinished',
    })
    controller.closeDiffPanel()
    const restored = harness(memory).controller
    const buffer = restored.getSnapshot().editorDrafts[0]!
    restored.resumeEditor(editorBufferKey(buffer))
    expect(restored.getSnapshot().diffPanel?.snapshot?.id).toBe(diffSnapshot().id)
    expect(restored.getSnapshot().editor?.text).toBe('unfinished')
    const id = restored.saveEditor()
    restored.closeDiffPanel()
    restored.openAnnotation(id)
    expect(restored.getSnapshot()).toMatchObject({
      diffPanel: { annotationId: id },
      editor: { kind: 'edit', annotationId: id },
    })
  })

  it('expands an overlapping draft with a matching source range, not only its quote', () => {
    const { controller } = harness()
    const id = save(controller)
    controller.beginDiffSelection(diffCapture(diffSource(diffSnapshot(), 'new', 1, 3)))
    expect(controller.getSnapshot().overlap?.annotationIds).toEqual([id])
    controller.chooseOverlap(id)
    controller.updateEditorText('Additional context')
    controller.saveEditor()
    const item = controller.getSnapshot().annotations[0]!
    expect(item.source).toMatchObject({ kind: 'diff', startLine: 1, endLine: 3 })
    expect(item.quote.exact).toBe('header\nnew value\nextra value')
    expect(item.annotation).toContain('Additional context')
    expect(item).not.toHaveProperty('messageId')
    controller.beginDiffSelection(diffCapture(diffSource(diffSnapshot(), 'old', 2)))
    expect(controller.getSnapshot().overlap).toBeNull()
  })

  it('freezes only selected mixed annotations through failed retry, reload and durable replay', async () => {
    const { controller, memory } = harness()
    controller.setSelectionMode(true)
    const diffId = save(controller)
    const omitted = save(
      controller,
      diffSource(diffSnapshot('', 'other\nlocation\n', { oldPath: 'other.ts', newPath: 'other.ts' })),
    )
    const legacy = fixturePayload().annotations[0]!
    controller.beginSelection({ ...legacy, rect: { top: 1, left: 1, right: 2, bottom: 2 } })
    controller.updateEditorText('Message opinion')
    const messageId = controller.saveEditor()
    controller.toggleSelected(diffId)
    controller.toggleSelected(messageId)
    controller.setProcessingMode('modify')
    const outbox = controller.createOutbox('queue', controller.sessionId)
    expect(outbox.payload.protocolVersion).toBe(3)
    expect(outbox.payload.annotations.map((item) => item.annotationId)).toEqual([messageId, diffId])
    expect(outbox.payload.annotations.map((item) => item.ordinal)).toEqual([1, 2])
    expect(outbox.payload.annotations.some((item) => item.annotationId === omitted)).toBe(false)
    expect(outbox.payload.processingMode).toBe('modify')
    const frozen = JSON.stringify(outbox.payload)
    controller.markSending(outbox.payload.submissionId)
    controller.markFailed(outbox.payload.submissionId, 'offline')
    const restored = harness(memory).controller
    expect(JSON.stringify(restored.getSnapshot().outbox[0]?.payload)).toBe(frozen)
    restored.selectRetry(outbox.payload.submissionId)
    restored.setProcessingMode('rewrite')
    expect(JSON.stringify(restored.getSnapshot().outbox[0]?.payload)).toBe(frozen)
    const nodes = new Map([
      ['sent', { kind: 'user', data: { source: { kind: 'user', annotationSubmission: outbox.payload } } }],
    ])
    const replay = harness().controller
    replay.reconcile({
      chat: { nodes },
      queue: [],
      hasMore: false,
    } as unknown as AnnotationReconciliationSnapshot)
    expect(replay.getSnapshot().annotations.map((item) => item.status)).toEqual(['sent', 'sent'])
    await replay.navigate(diffId)
    expect(replay.getSnapshot().diffPanel).toMatchObject({ snapshot: diffSnapshot(), annotationId: diffId })
    const original = replay.getSnapshot().annotations.find((item) => item.annotationId === diffId)!
    replay.openAnnotation(diffId)
    expect(replay.getSnapshot().editor).toMatchObject({ kind: 'new', supplementalTo: diffId })
    replay.updateEditorText('Later opinion')
    const supplement = replay.saveEditor()
    expect(supplement).not.toBe(diffId)
    expect(replay.getSnapshot().annotations.find((item) => item.annotationId === diffId)).toEqual(original)
  })
})
