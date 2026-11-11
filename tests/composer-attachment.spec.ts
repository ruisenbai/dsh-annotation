import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  COMPOSER_ATTACHMENT_TOKEN,
  COMPOSER_TEXT_SEAT,
  detachComposer,
  hasComposerAttachment,
  stripComposerToken,
} from '../src/client/composer-attachment.ts'

type SessionInput = ReturnType<IConversation['input']['for']>
type InputState = ReturnType<SessionInput['state']['getSnapshot']>

interface HarnessOptions {
  readonly phase?: InputState['phase']
  /** What the Host settles the consume edit as, when it differs from removing the span. */
  readonly settlesTo?: (removed: string) => string
  /** Structured editor document carried through both edits. */
  readonly occurrences?: readonly Record<string, unknown>[]
  /** Runtime-only draft attachment identities that must survive the detach. */
  readonly attachmentIds?: readonly string[]
  /** A consume that also drops one structured reference, flattening it into text. */
  readonly dropOccurrence?: boolean
}

/**
 * Detected text separates a claimed command chip (one character) from the
 * user's draft; the published draft expands the chip to its token spelling.
 */
function detectOf(state: InputState): string {
  return state.phase === 'claimed' && state.claim !== undefined
    ? `\uFFFC${state.draft.slice(COMPOSER_ATTACHMENT_TOKEN.length)}`
    : state.draft
}

/** Minimal input whose setDraft and consume-token both publish the next draft. */
function harness(draft: string, options: HarnessOptions = {}) {
  const phase = options.phase ?? 'plain'
  let state = {
    draft,
    draftRev: 4,
    phase,
    ...(phase === 'claimed'
      ? { claim: { name: 'dsh-annotation-attachment', token: COMPOSER_ATTACHMENT_TOKEN } }
      : {}),
    occurrences: options.occurrences ?? [],
    attachmentIds: options.attachmentIds ?? [],
  } as unknown as InputState
  const consume = vi.fn((span: { start: number; end: number }) => {
    // Detect coordinates, exactly as the Host splices them.
    const detect = detectOf(state)
    const removed = detect.slice(span.start, span.end)
    const next = detect.slice(0, span.start) + detect.slice(span.end)
    state = Object.freeze({
      ...state,
      phase: 'plain',
      ...(state.claim === undefined ? {} : { claim: undefined }),
      draft: options.settlesTo === undefined ? next : options.settlesTo(removed),
      occurrences: options.dropOccurrence === true ? state.occurrences.slice(1) : state.occurrences,
      attachmentIds: state.attachmentIds,
      draftRev: state.draftRev + 1,
    }) as InputState
    return true
  })
  const setDraft = vi.fn((text: string) => {
    state = Object.freeze({ ...state, draft: text, draftRev: state.draftRev + 1 }) as InputState
  })
  const input = { state: { getSnapshot: () => state }, setDraft } as unknown as SessionInput
  const insert = vi.fn((text: string, span: { start: number; end: number }) => {
    const next = state.draft.slice(0, span.start) + text + state.draft.slice(span.end)
    state = Object.freeze({ ...state, draft: next, draftRev: state.draftRev + 1 }) as InputState
    return true
  })
  const actx = {
    bail: (
      _actx: unknown,
      event: string,
      payload: {
        guard?: { span: { start: number; end: number } }
        text?: string
        span?: { start: number; end: number }
      },
    ) => {
      if (event === 'slash/input-consume-token' && payload.guard !== undefined)
        return consume(payload.guard.span)
      if (event === 'slash/input-insert-text' && payload.text !== undefined && payload.span !== undefined)
        return insert(payload.text, payload.span)
      return undefined
    },
  } as unknown as ClientContext
  return { input, actx, consume, insert, setDraft, current: () => input.state.getSnapshot() }
}

describe('composer attachment token', () => {
  it('treats the token and the legacy seat as hidden prefixes', () => {
    expect(stripComposerToken(`${COMPOSER_ATTACHMENT_TOKEN}hello`)).toBe('hello')
    expect(stripComposerToken(`${COMPOSER_ATTACHMENT_TOKEN}${COMPOSER_TEXT_SEAT}hello`)).toBe('hello')
    expect(stripComposerToken('hello')).toBe('hello')
  })

  it('detects an armed composer through either the claim or the draft token', () => {
    expect(hasComposerAttachment({ draft: 'plain' } as unknown as InputState)).toBe(false)
    expect(hasComposerAttachment({ draft: `${COMPOSER_ATTACHMENT_TOKEN}x` } as unknown as InputState)).toBe(
      true,
    )
  })

  it('keeps every visible character when detaching from a plain draft', () => {
    const { input, actx, current } = harness(`${COMPOSER_ATTACHMENT_TOKEN}Keep the draft.`)
    expect(detachComposer(actx, input)).toBe(true)
    expect(current().draft).toBe('Keep the draft.')
  })

  it('keeps every visible character when detaching a claimed composer', () => {
    const { input, actx, current } = harness(`${COMPOSER_ATTACHMENT_TOKEN}Keep the draft.`, {
      phase: 'claimed',
    })
    expect(detachComposer(actx, input)).toBe(true)
    expect(current().draft).toBe('Keep the draft.')
  })

  it('restores swallowed leading characters by insertion instead of replacing the document', () => {
    // A consume that settles one character into the user's text leaves a draft
    // without the token prefix; the missing character is inserted back, which
    // keeps every reference chip and quote in place.
    const occurrences = Object.freeze([
      Object.freeze({ occurrenceId: 'chip-1', source: 'file', ref: 'notes.md', offset: 3, length: 1 }),
    ]) as unknown as readonly Record<string, unknown>[]
    const { input, actx, insert, setDraft, current } = harness(
      `${COMPOSER_ATTACHMENT_TOKEN}Keep the draft.`,
      {
        phase: 'claimed',
        occurrences: occurrences as never,
        settlesTo: () => 'eep the draft.',
      },
    )
    expect(detachComposer(actx, input)).toBe(true)
    expect(setDraft).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledExactlyOnceWith('K', expect.objectContaining({ start: 0, end: 0 }))
    expect(current().draft).toBe('Keep the draft.')
    expect(current().occurrences).toBe(occurrences)
  })

  it('keeps structured references, quotes, and attachment identities when the last pending reference leaves the composer', () => {
    // The final pending reference is removed by the reference panel, not by a
    // text replacement. The hidden command token still has to leave the draft
    // without flattening reference chips, quote blocks, or attachment ids.
    const occurrences = Object.freeze([
      Object.freeze({ occurrenceId: 'chip-1', source: 'file', ref: 'notes.md', offset: 3, length: 1 }),
      Object.freeze({ occurrenceId: 'chip-2', source: 'session', ref: 'session-2', offset: 9, length: 1 }),
    ]) as unknown as readonly Record<string, unknown>[]
    const attachmentIds = Object.freeze(['attachment-a', 'attachment-b'])
    const { input, actx, setDraft, current } = harness(`${COMPOSER_ATTACHMENT_TOKEN}Compare both sources`, {
      phase: 'claimed',
      occurrences: occurrences as never,
      attachmentIds: attachmentIds as never,
    })
    expect(detachComposer(actx, input)).toBe(true)
    expect(setDraft).not.toHaveBeenCalled()
    expect(current().draft).toBe('Compare both sources')
    expect(current().occurrences).toBe(occurrences)
    expect(current().attachmentIds).toBe(attachmentIds)
  })

  it('refuses to edit when the consume discards a structured reference', () => {
    const occurrences = Object.freeze([
      Object.freeze({ occurrenceId: 'chip-1', source: 'file', ref: 'notes.md', offset: 3, length: 1 }),
    ]) as unknown as readonly Record<string, unknown>[]
    const { input, actx, insert, setDraft } = harness(`${COMPOSER_ATTACHMENT_TOKEN}Keep the draft.`, {
      phase: 'claimed',
      occurrences: occurrences as never,
      dropOccurrence: true,
    })
    // The Host edit removed a structured reference; repairing plain text here would
    // flatten the remaining document, so the plugin leaves the editor alone.
    expect(detachComposer(actx, input)).toBe(false)
    expect(setDraft).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('preserves an empty draft instead of inventing content', () => {
    const { input, actx, current } = harness(COMPOSER_ATTACHMENT_TOKEN)
    expect(detachComposer(actx, input)).toBe(true)
    expect(current().draft).toBe('')
  })

  it('removes only the token in command state so the line stays a command', () => {
    const { input, actx, consume, setDraft, current } = harness(`${COMPOSER_ATTACHMENT_TOKEN}/model fast`)
    expect(detachComposer(actx, input)).toBe(true)
    expect(consume).toHaveBeenCalledOnce()
    expect(setDraft).not.toHaveBeenCalled()
    expect(current().draft).toBe('/model fast')
  })

  it('reports a plain composer without a token as already detached', () => {
    const { input, actx } = harness('just text')
    expect(detachComposer(actx, input)).toBe(true)
  })

  it('refuses to detach while the composer is submitting', () => {
    const { input, actx, consume, current } = harness(`${COMPOSER_ATTACHMENT_TOKEN}text`, {
      phase: 'submitting',
    })
    expect(detachComposer(actx, input)).toBe(false)
    expect(consume).not.toHaveBeenCalled()
    expect(current().draft).toBe(`${COMPOSER_ATTACHMENT_TOKEN}text`)
  })
})
