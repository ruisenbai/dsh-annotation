# Decision 0001: Official composer submission over an internal command bridge

Status: accepted

## Context

The feature needs one official composer transaction, browser-to-Host admission, replayable model-visible input, retry idempotency, and folded timeline presentation. DSH `0.1.0-rc.6` publishes scoped input-machine events that allow a plugin to enter claimed submit mode without replacing the composer. DSH does not provide a prompt idempotency key or reload-safe third-party Session event vocabulary.

## Decision

The annotation header arms the current Session's official composer through `slash/input-begin-command` with a zero-width, non-whitespace claim token. The token keeps annotation-only submission eligible without visible protocol text. The same official Enter key and Send button submit ordinary composer text and the live set of unsent annotations. Shift+Enter and the composer's remaining keyboard behavior stay unchanged.

The claim rejects mixed image and annotation drafts because the DSH command submit API does not carry composer image ids. On submission, the Client freezes the current draft set, uses the visible composer text as `overallRequirement`, and calls the existing internal command. A failed transaction retains the claim, official draft, immutable payload, and submission id for retry.

The command uses `recordInput: false`, validates one base64url JSON argument, derives a deterministic message id from `submissionId`, checks pending inbox lists and standard user-message history, and admits one ordinary user message through `followup`. The complete annotation payload remains owned JSON provenance on that message; model-visible text is generated from the same payload. Client rendering presents the ordinary composer text followed by a folded annotation card.

## Consequences

- The plugin list manages annotations but owns no task textarea or Send button.
- Attachment state is Session-scoped and follows the official composer draft lifetime.
- One official submit creates one durable user task and one model execution.
- Annotation-only submission works because the invisible claim token keeps the official Send action eligible.
- Retry deduplication survives Host process and browser refreshes.
- Authoritative queue and durable history remain the only sources for queued and sent states.
- Existing plugin-owned overall text migrates once into the official composer on first attachment.
- Images must be removed before annotations can be attached; refusal retains both drafts.
- The command may appear in slash-command discovery because the public command definition has no hidden flag. Invalid manual invocation fails validation.
