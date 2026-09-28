import { describe, expect, it } from 'vitest'
import { AnnotationStorage, emptyPersistedState } from '../src/client/storage.ts'
import type { StorageCoordination } from '../src/client/storage.ts'
import type { AnnotationDraft, MessageIdentity, SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  failCanonical = false
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failCanonical && key.startsWith('dsh-annotation:v1:') && !key.includes(':journal:'))
      throw new Error('quota')
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function environment() {
  const memory = new MemoryStorage()
  let tail = Promise.resolve()
  const coordination: StorageCoordination = {
    keys: () => [...memory.values.keys()],
    runExclusive(_name, task) {
      const running = tail.then(task)
      tail = running.then(
        () => undefined,
        () => undefined,
      )
      return running
    },
  }
  const sessionId = 'multi-tab-session' as SessionIdentity
  const open = () => new AnnotationStorage(memory, sessionId, coordination)
  return { memory, open, coordination, sessionId }
}

function draft(annotation: string): AnnotationDraft {
  const submitted = fixturePayload().annotations[0]!
  return {
    ...submitted,
    status: 'draft',
    updatedAt: submitted.createdAt,
    annotation,
  }
}

describe('same-session browser pages', () => {
  it('keeps both independently added annotations after overlapping writes', async () => {
    const { open, memory } = environment()
    const first = open()
    const second = open()
    const base = first.load()
    second.load()
    const one = draft('First page')
    const two = { ...draft('Second page'), annotationId: 'ann-second' as AnnotationDraft['annotationId'] }

    expect(first.save({ ...base, annotations: [one] })).toBe(true)
    expect(second.save({ ...base, annotations: [two] })).toBe(true)
    expect([...memory.values.keys()].filter((key) => key.includes(':journal:'))).toHaveLength(2)
    await Promise.all([first.whenIdle(), second.whenIdle()])

    expect(
      open()
        .load()
        .annotations.map((item) => item.annotation)
        .sort(),
    ).toEqual(['First page', 'Second page'])
    first.dispose()
    second.dispose()
  })

  it("does not revive a deleted draft from a second page's stale unrelated save", async () => {
    const { open } = environment()
    const seed = open()
    expect(seed.save({ ...emptyPersistedState(), annotations: [draft('Delete me')] })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const second = open()
    const before = first.load()
    second.load()

    expect(first.save({ ...before, annotations: [] })).toBe(true)
    expect(second.save({ ...before, overallRequirementDraft: 'Unrelated text' })).toBe(true)
    await Promise.all([first.whenIdle(), second.whenIdle()])

    expect(open().load().annotations).toEqual([])
    first.dispose()
    second.dispose()
    seed.dispose()
  })

  it('retains both concurrent edits of one draft with distinct identities', async () => {
    const { open } = environment()
    const seed = open()
    expect(seed.save({ ...emptyPersistedState(), annotations: [draft('Original')] })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const second = open()
    const before = first.load()
    second.load()

    expect(
      first.save({ ...before, annotations: [{ ...before.annotations[0]!, annotation: 'First edit' }] }),
    ).toBe(true)
    expect(
      second.save({ ...before, annotations: [{ ...before.annotations[0]!, annotation: 'Second edit' }] }),
    ).toBe(true)
    await Promise.all([first.whenIdle(), second.whenIdle()])

    const result = open().load().annotations
    expect(result.map((item) => item.annotation).sort()).toEqual(['First edit', 'Second edit'])
    expect(new Set(result.map((item) => item.annotationId)).size).toBe(2)
    first.dispose()
    second.dispose()
    seed.dispose()
  })

  it('retains both versions of a concurrent unfinished editor buffer', async () => {
    const { open } = environment()
    const source = fixturePayload().annotations[0]!
    const editor = {
      kind: 'new' as const,
      draftId: 'ann-unfinished' as AnnotationDraft['annotationId'],
      capture: {
        messageId: source.messageId,
        messageSeq: source.messageSeq,
        responseVersion: source.responseVersion,
        quote: source.quote,
        rect: { top: 1, left: 2, right: 3, bottom: 4 },
      },
      text: 'Original buffer',
      longSelectionConfirmed: true,
    }
    const seed = open()
    expect(seed.save({ ...emptyPersistedState(), editorDraft: editor })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const second = open()
    const before = first.load()
    second.load()

    expect(first.save({ ...before, editorDraft: { ...editor, text: 'First buffer' } })).toBe(true)
    expect(second.save({ ...before, editorDraft: { ...editor, text: 'Second buffer' } })).toBe(true)
    await Promise.all([first.whenIdle(), second.whenIdle()])

    const restored = open().load()
    const editors = [restored.editorDraft, ...(restored.editorDrafts ?? [])].filter(
      (item) => item !== undefined,
    )
    expect(editors.map((item) => item.text).sort()).toEqual(['First buffer', 'Second buffer'])
    expect(new Set(editors.map((item) => item.kind === 'new' && item.draftId)).size).toBe(2)
    first.dispose()
    second.dispose()
    seed.dispose()
  })

  it('keeps an unfinished edit when another page deletes its original draft', async () => {
    const { open } = environment()
    const annotation = draft('Original note')
    const editor = { kind: 'edit' as const, annotationId: annotation.annotationId, text: 'Working text' }
    const seed = open()
    expect(seed.save({ ...emptyPersistedState(), annotations: [annotation], editorDraft: editor })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const second = open()
    const before = first.load()
    second.load()
    const { editorDraft: _removedEditor, ...withoutEditor } = before

    expect(first.save({ ...withoutEditor, annotations: [], editorDrafts: [] })).toBe(true)
    expect(second.save({ ...before, editorDraft: { ...editor, text: 'Concurrent unfinished text' } })).toBe(
      true,
    )
    await Promise.all([first.whenIdle(), second.whenIdle()])

    const restored = open().load()
    expect(restored.annotations).toHaveLength(1)
    expect(restored.annotations[0]?.annotationId).not.toBe(annotation.annotationId)
    expect([restored.editorDraft, ...(restored.editorDrafts ?? [])].map((item) => item?.text)).toContain(
      'Concurrent unfinished text',
    )
    first.dispose()
    second.dispose()
    seed.dispose()
  })

  it('removes an ordinary draft and its unfinished editor together', async () => {
    const { open } = environment()
    const annotation = draft('Delete both')
    const editor = { kind: 'edit' as const, annotationId: annotation.annotationId, text: 'Unfinished' }
    const storage = open()
    storage.load()
    expect(storage.save({ ...emptyPersistedState(), annotations: [annotation], editorDraft: editor })).toBe(
      true,
    )
    await storage.whenIdle()
    const before = storage.load()
    const { editorDraft: _removedEditor, ...withoutEditor } = before
    expect(storage.save({ ...withoutEditor, annotations: [], editorDrafts: [] })).toBe(true)
    await storage.whenIdle()

    const restored = open().load()
    expect(restored.annotations).toEqual([])
    expect(restored.editorDraft).toBeUndefined()
    expect(restored.editorDrafts).toEqual([])
    storage.dispose()
  })

  it('keeps a sent outbox result and its frozen payload over a stale failure', async () => {
    const { open } = environment()
    const seed = open()
    const payload = fixturePayload({ sessionId: 'multi-tab-session' as SessionIdentity })
    const entry = {
      payload,
      targetSessionId: payload.sessionId,
      messageId: 'dsh-inline-annotations:sub-test' as MessageIdentity,
      status: 'ready' as const,
      attempts: 0,
    }
    expect(seed.save({ ...emptyPersistedState(), outbox: [entry] })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const second = open()
    const before = first.load()
    second.load()

    expect(first.save({ ...before, outbox: [{ ...entry, status: 'sent', attempts: 1 }] })).toBe(true)
    expect(second.save({ ...before, outbox: [{ ...entry, status: 'failed', attempts: 1 }] })).toBe(true)
    await Promise.all([first.whenIdle(), second.whenIdle()])

    const result = open().load().outbox[0]
    expect(result?.status).toBe('sent')
    expect(result?.payload).toEqual(payload)
    first.dispose()
    second.dispose()
    seed.dispose()
  })

  it('retains a journal and the original frozen payload when the same submission id has different content', async () => {
    const { open, memory } = environment()
    const seed = open()
    const payload = fixturePayload({ sessionId: 'multi-tab-session' as SessionIdentity })
    const entry = {
      payload,
      targetSessionId: payload.sessionId,
      messageId: 'dsh-inline-annotations:sub-test' as MessageIdentity,
      status: 'ready' as const,
      attempts: 0,
    }
    expect(seed.save({ ...emptyPersistedState(), outbox: [entry] })).toBe(true)
    await seed.whenIdle()
    const first = open()
    const before = first.load()
    const conflictingPayload = {
      ...payload,
      annotations: [{ ...payload.annotations[0]!, annotation: 'Different frozen text' }],
    }

    expect(first.save({ ...before, outbox: [{ ...entry, payload: conflictingPayload }] })).toBe(true)
    await first.whenIdle()

    expect(first.lastError()).toContain('conflicting frozen submission payload')
    expect(memory.values.get(first.key)).toContain(payload.annotations[0]!.annotation)
    expect([...memory.values.keys()].some((key) => key.includes(':journal:'))).toBe(true)
    first.dispose()
    seed.dispose()
  })

  it('recovers independent writes without Web Locks from append-only journal entries', () => {
    const { memory, sessionId } = environment()
    const coordination: StorageCoordination = { keys: () => [...memory.values.keys()] }
    const first = new AnnotationStorage(memory, sessionId, coordination)
    const second = new AnnotationStorage(memory, sessionId, coordination)
    const before = first.load()
    second.load()
    const one = draft('First page')
    const two = { ...draft('Second page'), annotationId: 'ann-second' as AnnotationDraft['annotationId'] }

    expect(first.save({ ...before, annotations: [one] })).toBe(true)
    expect(second.save({ ...before, annotations: [two] })).toBe(true)
    expect(memory.values.has(first.key)).toBe(false)
    const reloaded = new AnnotationStorage(memory, sessionId, coordination)
    expect(
      reloaded
        .load()
        .annotations.map((item) => item.annotation)
        .sort(),
    ).toEqual(['First page', 'Second page'])
    first.dispose()
    second.dispose()
    reloaded.dispose()
  })

  it('keeps a synchronous journal when a waiting page is disposed', async () => {
    const { memory, sessionId, coordination } = environment()
    let release: (() => void) | undefined
    const blocked: StorageCoordination = {
      keys: coordination.keys,
      runExclusive(_name, task, signal) {
        return new Promise<void>((resolve) => {
          release = () => {
            if (!signal.aborted) task()
            resolve()
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }
    const first = new AnnotationStorage(memory, sessionId, blocked)
    first.load()
    expect(first.save({ ...emptyPersistedState(), annotations: [draft('Survives page close')] })).toBe(true)
    first.dispose()
    release?.()
    await first.whenIdle()
    expect([...memory.values.keys()].some((key) => key.includes(':journal:'))).toBe(true)

    const recovered = new AnnotationStorage(memory, sessionId, coordination)
    expect(recovered.load().annotations[0]?.annotation).toBe('Survives page close')
    await recovered.whenIdle()
    expect([...memory.values.keys()].some((key) => key.includes(':journal:'))).toBe(false)
    recovered.dispose()
  })

  it('retains journal data and reports a canonical write failure', async () => {
    const { memory, open } = environment()
    const first = open()
    first.load()
    memory.failCanonical = true
    expect(first.save({ ...emptyPersistedState(), annotations: [draft('Durable before merge')] })).toBe(true)
    await first.whenIdle()
    expect(first.lastError()).toBe('quota')
    expect([...memory.values.keys()].some((key) => key.includes(':journal:'))).toBe(true)

    const pending = first.load()
    expect(first.save({ ...pending, overallRequirementDraft: 'More text while merge is blocked' })).toBe(true)
    await first.whenIdle()
    expect(first.lastError()).toBe('quota')

    memory.failCanonical = false
    const recovered = open()
    expect(recovered.load().annotations[0]?.annotation).toBe('Durable before merge')
    expect(recovered.load().overallRequirementDraft).toBe('More text while merge is blocked')
    await recovered.whenIdle()
    expect(recovered.lastError()).toBeNull()
    expect([...memory.values.keys()].some((key) => key.includes(':journal:'))).toBe(false)
    first.dispose()
    recovered.dispose()
  })
})
