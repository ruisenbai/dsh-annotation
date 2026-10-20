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

/** Remove this plugin's claim token while retaining the user's composer text and references. */
export function detachComposer(actx: ClientContext, input: SessionInput): boolean {
  const state = input.state.getSnapshot()
  const tokenLength = attachmentPrefixLength(state.draft)
  if (tokenLength === 0) return state.claim?.token !== COMPOSER_ATTACHMENT_TOKEN
  const prefixLength =
    tokenLength +
    (state.draft.slice(tokenLength).startsWith(COMPOSER_TEXT_SEAT) ? COMPOSER_TEXT_SEAT.length : 0)
  if (state.phase === 'plain') {
    input.setDraft(state.draft.slice(prefixLength))
    return true
  }
  if (state.phase !== 'claimed' || state.claim?.token !== COMPOSER_ATTACHMENT_TOKEN) return false
  return (
    actx.bail(actx, 'slash/input-consume-token', {
      guard: {
        kind: 'span',
        span: {
          start: 0,
          end: prefixLength,
          draftRev: state.draftRev,
        },
      },
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
