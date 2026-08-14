# Decision 0001: Standard user message over an internal command bridge

Status: accepted

## Context

The feature needs browser-to-Host admission, replayable model-visible input, retry idempotency, and folded timeline presentation. Current DSH does not provide a package-private static Client RPC helper, a prompt idempotency key, or reload-safe third-party Session event vocabulary. Adding a custom Remote namespace would require a generated transport package and additional host composition for one operation.

## Decision

Use the existing command Remote as the transport and set `recordInput: false`. The command validates one base64url JSON argument, derives a deterministic message id from `submissionId`, checks pending inbox lists and standard user-message history, and admits one ordinary user message through `steer` or `followup`.

Store the complete annotation payload as owned JSON provenance on that standard message. The model-visible text is generated from the same payload. Client rendering recognizes the provenance and presents a folded annotation card instead of the generated transport text.

## Consequences

- Model-visible input has one durable Session-log representation.
- Retry deduplication survives Host process and browser refreshes.
- No custom Session event can make an older DSH reload fail.
- The command may appear in slash-command discovery because the public command definition has no hidden flag. Invalid manual invocation fails validation.
- The plugin must own timeline presentation for user and steering message cells.
- A future private static Client-to-Host API can replace the transport without changing the persisted payload protocol.
