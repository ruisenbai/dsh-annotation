# Decision 0002: Shadow assistant and input-message renderers

Status: accepted with compatibility risk

## Context

Exact inline annotation requires a stable DOM root around assistant Markdown, browser Range capture, persistent highlight reconstruction, and quote click handling. Current DSH additive slots exist beside assistant messages and in the composer, but not inside assistant body rendering.

Submitted batches also need a folded timeline row. Standard user and steering renderers display generated model text and do not expose a per-message body slot.

## Decision

Register priority `-100` replacements for the keyed `assistant-step`, `user`, and `steering` cells. Lower priority wins while the shipped priority-0 renderers remain available after plugin disposal.

Build replacements only from public DSH data and primitives. Preserve text Markdown, reasoning disclosure, images, generic blocks, user text/images, file mentions, streaming state, and interruption data where available. Use additive slots for the composer dock and assistant action.

## Consequences

- Exact selection and highlight behavior is possible without patching DSH source.
- Stop or uninstall restores shipped renderers through Slot lifecycle disposal.
- DSH renderer changes can cause visual or behavioral drift even when TypeScript still compiles.
- Every supported DSH upgrade requires the Web smoke matrix in `docs/development.md`.
- An upstream assistant-body decoration slot should replace this shadowing when available.
