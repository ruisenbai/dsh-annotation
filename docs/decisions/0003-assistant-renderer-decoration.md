# Decision 0003: Decorate the existing assistant renderer

Status: accepted with compatibility risk

## Context

Exact inline annotation requires a stable DOM root around assistant content, browser Range capture, persistent highlight reconstruction, and quote click handling. DSH 0.1.2-alpha.1 has no additive slot inside the assistant body.

Registering another `conversation.chat.node:assistant-step` entry can collide with a renderer plugin at the same priority. `dsh-smooth-stream` owns that keyed cell at priority `-100`, so two independent replacements cannot load together.

DSH 0.1.2-alpha.1 exposes the registered ledger through `ctx.slots.entries()`. A stored entry keeps mutable `component` and `inject` fields, which allows behavior to be composed without claiming another keyed cell.

## Decision

Do not register an `assistant-step` entry. Decorate every existing assistant entry in place:

1. keep the existing component as the inner renderer;
2. wrap its rendered output with the annotation selection, highlight, and marker layer;
3. compose the existing inject result with the annotation face, including both hook sets;
4. listen for `slots/changed` and decorate assistant entries registered later;
5. restore both fields when the feature is disabled or the plugin unloads, but only when they still point to this plugin's values.

The inner renderer keeps its own locale binding and all runtime props. The annotation layer uses a separately bound translation function. DOM changes inside the renderer trigger range and marker reconstruction, while live-region and Think text do not enter persisted quote offsets.

## Consequences

- `dsh-annotation` no longer occupies `assistant-step`, so it can run with `dsh-smooth-stream` without a same-key, same-priority registration error.
- Markdown, images, Think, streaming, and interruption behavior stay owned by the selected assistant renderer.
- The plugin depends on DSH 0.1.2-alpha.1's stored-entry fields and mutation behavior; every DSH upgrade still needs type checks and a real Web smoke test.
- If another plugin replaces the same stored fields without preserving the current values, cleanup can only restore fields that this decorator still owns.
- A public assistant-body decoration Slot should replace this mechanism when DSH provides one.
