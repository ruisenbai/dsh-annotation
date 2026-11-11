import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

type SessionInput = ReturnType<IConversation['input']['for']>
type InputState = ReturnType<SessionInput['state']['getSnapshot']>

/** Hidden command prefix accepted by the Host's persisted slash-command draft parser. */
export const COMPOSER_ATTACHMENT_TOKEN = '/annotation-attachment'
const LEGACY_ATTACHMENT_TOKEN = '\u200B'
/** Legacy invisible text seat, retained only to read drafts saved by older releases. */
export const COMPOSER_TEXT_SEAT = '\u2060'

/** Whether one input snapshot carries this plugin's armed attachment. */
export function hasComposerAttachment(input: InputState): boolean {
  return input.claim?.token === COMPOSER_ATTACHMENT_TOKEN || attachmentPrefixLength(input.draft) > 0
}

function attachmentPrefixLength(text: string): number {
  if (text.startsWith(COMPOSER_ATTACHMENT_TOKEN)) return COMPOSER_ATTACHMENT_TOKEN.length
  return text.startsWith(LEGACY_ATTACHMENT_TOKEN) ? LEGACY_ATTACHMENT_TOKEN.length : 0
}

/** Visible composer text with this plugin's invisible claim prefix removed. */
export function visibleComposerDraft(input: InputState): string {
  return stripComposerToken(input.draft)
}

/** Whether the visible composer content is an official slash-command line. */
export function isSlashCommandLine(input: InputState): boolean {
  return visibleComposerDraft(input).trimStart().startsWith('/')
}

/** Strip this plugin's claim token and optional invisible text seat from composer text or claim arguments. */
export function stripComposerToken(text: string): string {
  const withoutToken = text.slice(attachmentPrefixLength(text))
  return withoutToken.startsWith(COMPOSER_TEXT_SEAT)
    ? withoutToken.slice(COMPOSER_TEXT_SEAT.length)
    : withoutToken
}

/** Enter this plugin's claimed submit mode without changing visible composer text. */
export function attachComposer(actx: ClientContext, input: SessionInput, claim: CommandClaim): boolean {
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain') return false
  const span = {
    start: 0,
    end: attachmentPrefixLength(state.draft),
    draftRev: state.draftRev,
  }
  return actx.bail(actx, 'slash/input-begin-command', { claim, span }) === true
}

/** Whether the editor's structured content — reference chips, quotes, and attachments — is unchanged. */
function sameDocument(before: InputState, after: InputState): boolean {
  if (before.occurrences.length !== after.occurrences.length) return false
  return before.occurrences.every((occurrence, index) => {
    const next = after.occurrences[index]
    return (
      next !== undefined &&
      next.occurrenceId === occurrence.occurrenceId &&
      next.source === occurrence.source &&
      next.ref === occurrence.ref &&
      next.clipboardText === occurrence.clipboardText
    )
  })
}

/**
 * Remove this plugin's leading token without touching the remaining editor document.
 *
 * The consume edits one detect-coordinate span, and that span can settle with the
 * user's first characters still inside the removed range. The document is never
 * replaced: `setDraft` would flatten reference chips and quotes into plain text and
 * drop their identities. Structured references, quote blocks, and draft attachment
 * identities must all survive; when characters go missing the missing prefix is
 * inserted back at the document start, which leaves every chip, quote, and
 * attachment intact.
 * @param actx - Session scope that owns the input.
 * @param input - Official composer whose text, reference chips, and quotes must survive.
 * @returns Whether the token is absent and the settled draft still carries the same document.
 */
export function detachComposer(actx: ClientContext, input: SessionInput): boolean {
  const state = input.state.getSnapshot()
  const tokenLength = attachmentPrefixLength(state.draft)
  if (tokenLength === 0) return state.claim?.token !== COMPOSER_ATTACHMENT_TOKEN
  if (state.phase !== 'plain' && state.phase !== 'claimed') return false
  const claimed = state.phase === 'claimed' && state.claim?.token === COMPOSER_ATTACHMENT_TOKEN
  // Token spans count the command chip as one character; InputState.draft expands its spelling.
  const tokenSpan = {
    start: 0,
    end:
      (claimed ? 1 : tokenLength) +
      (state.draft.slice(tokenLength).startsWith(COMPOSER_TEXT_SEAT) ? COMPOSER_TEXT_SEAT.length : 0),
    draftRev: state.draftRev,
  }
  const visible = stripComposerToken(state.draft)
  const command = visible.trimStart().startsWith('/')
  const applied =
    actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span: tokenSpan } }) === true
  if (!applied) return false
  // Command state: only the token itself may leave, or the whole line stops being a command.
  if (command) return true
  const settledState = input.state.getSnapshot()
  if (settledState.draft === visible && sameDocument(state, settledState)) return true
  if (!sameDocument(state, settledState)) return false
  const settled = settledState.draft
  if (attachmentPrefixLength(settled) > 0) return false
  // Only a swallowed leading range is restorable by insertion; any other edit leaves the document alone.
  if (settled !== visible.slice(visible.length - settled.length)) return false
  const missing = visible.slice(0, visible.length - settled.length)
  if (missing === '') return false
  // Restore only the swallowed characters: an insertion keeps chips, quotes and attachments in place.
  return (
    actx.bail(actx, 'slash/input-insert-text', {
      text: missing,
      span: { start: 0, end: 0, draftRev: settledState.draftRev },
    }) === true
  )
}

/** Replace every official reference display range with its model form while omitting this plugin's invisible claim prefix. */
export async function serializeComposerRequirement(
  input: InputState,
  triggerController: InputTriggerController,
  signal: AbortSignal,
): Promise<string> {
  const start = input.draft.length - stripComposerToken(input.draft).length
  if (input.occurrences.length === 0) return input.draft.slice(start).trim()
  const parts = await Promise.all(
    input.occurrences.map(async (occurrence) => ({
      offset: occurrence.offset,
      length: occurrence.length,
      text: await triggerController.serializeReference(occurrence.source, occurrence.ref, signal),
    })),
  )
  let output = ''
  let cursor = start
  for (const part of parts) {
    output += input.draft.slice(cursor, part.offset) + part.text
    cursor = part.offset + part.length
  }
  return (output + input.draft.slice(cursor)).trim()
}

/** Append a legacy plugin-owned overall request to the official composer draft once. */
export function mergeLegacyRequirement(draft: string, legacy: string): string {
  const migrated = legacy.trim()
  if (migrated === '') return draft
  const visible = stripComposerToken(draft)
  if (visible.trim() === '') return migrated
  return `${visible.trimEnd()}\n\n${migrated}`
}
