// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AnnotationController } from '../src/client/controller.ts'
import { AnnotationStorage } from '../src/client/storage.ts'
import { SideChatController } from '../src/client/side-chat-controller.ts'
import { SideChatStorage } from '../src/client/side-chat-storage.ts'
import {
  migrateSideReferences,
  referenceAnnotation,
  sideAnnotationCapture,
} from '../src/client/side-chat-annotations.ts'
import { messageSourceSession, sourceKey } from '../src/shared/annotation-source.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'
import { formatSubmissionMessage, parseSubmissionPayload } from '../src/shared/protocol.ts'
import type { SessionIdentity } from '../src/shared/types.ts'
import { fixturePayload } from './fixtures.ts'
import { sideChatCapture, sideChatSessionFixture, SideChatMemoryStorage } from './side-chat-fixtures.ts'

function annotations(sessionId: string, memory = new SideChatMemoryStorage()) {
  const controller = new AnnotationController(
    sessionId as SessionIdentity,
    new AnnotationStorage(memory, sessionId as SessionIdentity),
    { getSnapshot: () => ({ hasMore: false }), loadOlder: async () => {} },
    DEFAULT_CONFIG,
  )
  onTestFinished(() => controller.dispose())
  return { controller, memory }
}

describe('side annotations', () => {
  it('keeps source and receiving Sessions distinct across draft recovery and submission', () => {
    const target = annotations('side-a')
    const capture = sideAnnotationCapture(sideChatCapture(), SessionId('main-a'))
    target.controller.beginSelection(capture)
    target.controller.updateEditorText('Explain this assumption')
    const id = target.controller.saveEditor()
    const restored = annotations('side-a', target.memory)
    expect(restored.controller.getSnapshot().annotations[0]).toMatchObject({
      annotationId: id,
      source: { kind: 'message', sessionId: 'main-a' },
      annotation: 'Explain this assumption',
    })
    const entry = restored.controller.createOutbox('queue', 'side-a' as SessionIdentity)
    expect(entry.payload).toMatchObject({ protocolVersion: 6, sessionId: 'side-a' })
    expect(messageSourceSession(entry.payload.annotations[0]!, 'side-a')).toBe('main-a')
    expect(sourceKey(capture)).not.toBe(
      sourceKey(sideAnnotationCapture(sideChatCapture(), SessionId('main-b'))),
    )
    expect(annotations('side-b', target.memory).controller.getSnapshot().annotations).toEqual([])
  })

  it('requires protocol v6 for an explicit source Session and retains historical implicit sources', () => {
    const capture = sideAnnotationCapture(sideChatCapture(), SessionId('main-a'))
    const payload = fixturePayload({
      protocolVersion: 6,
      annotations: [{ ...fixturePayload().annotations[0]!, ...capture }],
    })
    const decoded = parseSubmissionPayload(payload)
    expect(decoded.annotations[0]?.source).toMatchObject({ sessionId: 'main-a' })
    expect(formatSubmissionMessage(decoded)).toContain('Source session: main-a')
    expect(() => parseSubmissionPayload({ ...payload, protocolVersion: 5 })).toThrow('protocol v6')
    expect(() =>
      parseSubmissionPayload({
        ...payload,
        annotations: [{ ...payload.annotations[0], source: { ...capture.source, sessionId: '' } }],
      }),
    ).toThrow('source.sessionId')
    expect(
      messageSourceSession(parseSubmissionPayload(fixturePayload()).annotations[0]!, 'legacy-owner'),
    ).toBe('legacy-owner')
  })

  it('converts pending references once and never recreates an edited or deleted annotation', async () => {
    const fixture = sideChatSessionFixture()
    onTestFinished(fixture.dispose)
    const first = fixture.owner.collect(sideChatCapture('Alpha'))
    const second = fixture.owner.collect(sideChatCapture('Beta', 20))
    await fixture.owner.prepare()
    const chatId = fixture.owner.getSnapshot().activeSideChatId!
    const target = annotations(fixture.sideId)
    expect(migrateSideReferences(fixture.owner, chatId, target.controller)).toBe(true)
    expect(fixture.owner.chatView(chatId)?.references).toEqual([])
    expect(
      target.controller.getSnapshot().annotations.map((item) => [item.quote.exact, item.kind, item.source]),
    ).toEqual([
      ['Alpha', 'highlight-only', expect.objectContaining({ sessionId: fixture.owner.mainSessionId })],
      ['Beta', 'highlight-only', expect.objectContaining({ sessionId: fixture.owner.mainSessionId })],
    ])
    const originals = [first, second].map((item) => referenceAnnotation(item, target.controller.sessionId))
    target.controller.openAnnotation(originals[0]!.annotationId)
    target.controller.updateEditorText('Keep my opinion')
    target.controller.saveEditor()
    target.controller.detachAnnotations([originals[0]!.annotationId])
    target.controller.trashAnnotations([originals[1]!.annotationId])
    expect(target.controller.importPendingAnnotations(originals)).toBe(true)
    expect(target.controller.getSnapshot().annotations).toHaveLength(1)
    expect(target.controller.getSnapshot().annotations[0]?.annotation).toBe('Keep my opinion')
    expect(target.controller.getSnapshot().selectedAnnotationIds).toEqual([])
  })

  it('retains every old reference if annotation storage fails, then completes a safe retry', async () => {
    const fixture = sideChatSessionFixture()
    onTestFinished(fixture.dispose)
    const reference = fixture.owner.collect(sideChatCapture())
    await fixture.owner.prepare()
    const target = annotations(fixture.sideId)
    const writes = vi.spyOn(target.memory, 'setItem').mockImplementation(() => {
      throw new Error('Storage full')
    })
    const chatId = fixture.owner.getSnapshot().activeSideChatId!
    expect(migrateSideReferences(fixture.owner, chatId, target.controller)).toBe(false)
    expect(fixture.owner.chatView(chatId)?.references).toEqual([reference])
    expect(target.controller.getSnapshot().annotations).toEqual([])
    writes.mockRestore()
    expect(migrateSideReferences(fixture.owner, chatId, target.controller)).toBe(true)
    expect(target.controller.getSnapshot().annotations).toHaveLength(1)
    expect(fixture.owner.chatView(chatId)?.references).toEqual([])
  })

  it('recovers a conversion interrupted between the two durable writes without duplicating records', async () => {
    const fixture = sideChatSessionFixture()
    onTestFinished(fixture.dispose)
    fixture.owner.collect(sideChatCapture())
    await fixture.owner.prepare()
    const chatId = fixture.owner.getSnapshot().activeSideChatId!
    const target = annotations(fixture.sideId)
    const writes = vi.spyOn(fixture.memory, 'setItem').mockImplementation(() => {
      throw new Error('Storage interrupted')
    })
    expect(migrateSideReferences(fixture.owner, chatId, target.controller)).toBe(false)
    expect(target.controller.getSnapshot().annotations).toHaveLength(1)
    writes.mockRestore()
    const recovered = new SideChatController(
      fixture.owner.mainSessionId,
      fixture.sessions,
      new SideChatStorage(fixture.memory, fixture.owner.mainSessionId),
    )
    onTestFinished(() => recovered.dispose())
    expect(recovered.chatView(chatId)?.references).toHaveLength(1)
    expect(migrateSideReferences(recovered, chatId, target.controller)).toBe(true)
    expect(recovered.chatView(chatId)?.references).toEqual([])
    expect(target.controller.getSnapshot().annotations).toHaveLength(1)
  })

  it('leaves the exact legacy request frozen while its delivery outcome is unknown', async () => {
    const fixture = sideChatSessionFixture()
    onTestFinished(fixture.dispose)
    const reference = fixture.owner.collect(sideChatCapture())
    await fixture.owner.prepare()
    const payload = fixture.owner.snapshotSubmission({
      question: 'Original question',
      protocolLocale: 'en',
      attachmentIdentities: [],
    })
    fixture.owner.markSending(payload.submissionId)
    fixture.owner.markUnknown(payload.submissionId, new Error('Connection lost'))
    const target = annotations(fixture.sideId)
    expect(
      migrateSideReferences(fixture.owner, fixture.owner.getSnapshot().activeSideChatId!, target.controller),
    ).toBe(true)
    expect(target.controller.getSnapshot().annotations).toEqual([])
    expect(fixture.owner.getSnapshot().outbox).toMatchObject({ status: 'unknown', payload })
    expect(fixture.owner.getSnapshot().references).toEqual([reference])
  })
})
