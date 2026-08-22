# Decision 0001: Official composer submission over an internal command bridge

Status: accepted

## Context

The feature needs one official composer transaction, browser-to-Host admission, replayable model-visible input, retry idempotency, and folded timeline presentation. DSH `0.1.0-rc.6` publishes scoped input-machine events that allow a plugin to enter claimed submit mode without replacing the composer. DSH does not provide a prompt idempotency key or reload-safe third-party Session event vocabulary.

## Decision

The annotation header arms the current Session's official composer through `slash/input-begin-command` with a zero-width, non-whitespace claim token. The token keeps annotation-only submission eligible without visible protocol text. The same official Enter key and Send button submit ordinary composer text and the live set of unsent annotations. Shift+Enter and the composer's remaining keyboard behavior stay unchanged.

The claim declares `CommandClaim.images = true`, so composer images ride the rc.2 standard command attachments alongside the annotation batch. The serialized `SubmitImageAttachment[]` travels through the mounted `commands/execute` Remote together with the internal command line; base64 never enters the annotation JSON or the command string. On submission, the Client freezes the current draft set, uses the visible composer text as `overallRequirement`, records non-base64 image metadata on the outbox entry, and calls the internal command. A failed transaction retains the claim, official draft, images, immutable payload, and submission id for retry.

Slash commands are released automatically: while attached, composer content starting with `/` releases the claim and removes the zero-width token so the rc.2 official pipeline handles the command; leaving command state re-attaches. `claim.submit()` re-checks for a leading `/` to defeat the Enter race and routes a raced command through the official Session command interface without creating an outbox, sending annotations, or marking them sent.

The command uses `recordInput: false`, declares `input.images = true`, validates one base64url JSON argument, appends the admitted durable image blocks to the user message after the annotation text, derives a deterministic message id from `submissionId`, checks pending inbox lists and standard user-message history, and admits one ordinary user message through `followup`. The complete annotation payload remains owned JSON provenance on that message; model-visible text is generated from the same payload. Client rendering presents the ordinary composer text followed by a folded annotation card and the official image thumbnails.

## Consequences

- The plugin list manages annotations but owns no task textarea or Send button.
- Attachment state is Session-scoped and follows the official composer draft lifetime.
- One official submit creates one durable user task and one model execution.
- Annotation-only submission works because the invisible claim token keeps the official Send action eligible.
- Retry deduplication survives Host process and browser refreshes.
- Authoritative queue and durable history remain the only sources for queued and sent states.
- Existing plugin-owned overall text migrates once into the official composer on first attachment.
- A refresh loses browser-owned composer images; a recorded image batch refuses to resubmit without images and asks the user to re-select the same images or discard the pending record.
- Slash commands never carry annotations, and a raced command never creates an outbox or marks annotations sent.
- The command may appear in slash-command discovery because the public command definition has no hidden flag. Invalid manual invocation fails validation. Legacy command aliases forward to the new handler and appear nowhere in the plugin settings page.
