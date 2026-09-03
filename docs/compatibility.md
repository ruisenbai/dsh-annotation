# Compatibility

## Supported baseline

| Component                | Supported baseline                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| DeepSeek Harness         | `0.1.2-rc.1`                                                                        |
| Development declarations | `0.1.2-rc.1`                                                                        |
| Cordis                   | `^4.0.1`                                                                            |
| Node.js                  | `^22.19.0` or `>=24`                                                                |
| React                    | `^18.2.0`                                                                           |
| Browser                  | Current Chromium-based DSH Web target; other modern browsers retain marker fallback |

DSH has no external compatibility promise before `0.2.0`. The exact peer versions limit this adaptation to the reviewed prerelease because assistant decoration still depends on mutable Slot entries.

The `0.1.2-rc.1` DSH package family is available from npm, so the checked-in lockfile is a registry-resolvable `0.1.2-rc.1` graph: install with `pnpm install --frozen-lockfile --strict-peer-dependencies` and run the normal verification sequence. Machine-local `file:` URLs, workspace links, and overlay lockfiles from earlier unpublished baselines are no longer verification inputs and must never enter the published plugin manifest or lockfile.

## Plugin configuration integration

The Host half registers the `dsh-annotation` namespace through `@deepseek-ai/dsh-settings`. The browser half binds the namespace through `ctx.settingsScope` and contributes one keyed `settings.plugin.item:dsh-annotation` card supplied by `@deepseek-ai/dsh-client-ui-settings-plugins`. The `enabled`, `autoAttach`, and `localTools` fields all default to `true`; the summary box is always compact with a single “注解 ×N” chip whose full list pops upward, and the `localTools` switch hides the local-data controls (storage usage, export, clear drafts). The previous `summaryMode` field no longer exists; upgraded profiles ignore any leftover value. A deployment without a settings provider still runs the annotation command, while the browser keeps all safe defaults and renders no writable card.

The card follows the official plugin-configuration lifecycle: edits are staged, Save writes the Host document with the namespace revision, Discard drops local edits, and Reset clears the user-layer field. Conversation integrations change only after the Host accepts a value.

During the rename upgrade, the Host registers the legacy `inline-comments` namespace temporarily, copies its stored user values into `dsh-annotation`, and clears the legacy section only after the new write succeeds. No plugin card is keyed to the legacy namespace, so it renders nothing in the settings page.

## Protocol, storage, and command compatibility

- New submissions only emit protocol v2 (`protocolVersion: 2`, `source: "dsh-annotation"`, `annotation` field, `kind`, and `protocolLocale`). Legacy v1 payloads (`comment` field, no source, no kind, no protocolLocale) are still parsed and converted into the v2 internal model: `kind` is inferred from the content (`note` for non-empty, `highlight-only` for empty) and `protocolLocale` defaults to `en` (the old protocol language); historical messages are never rewritten.
- The model protocol follows the DSH locale at submission time: `protocolLocale: "zh"` produces the Chinese template (「注解 N：」), `protocolLocale: "en"` the English one ("Annotation N:"), and every reply must carry the hidden `dsh-annotation-reply` marker before its paragraph. Reply parsing accepts 注解 N：/注解 N:/Annotation N: and legacy label formats; association always rides the hidden stable annotation id.
- Optional dsh-focus-chat: the adapter never injects or waits for a focus service; it detects the focus view through its public `[data-focus-flow]` DOM root. Without the plugin everything runs unchanged; with it, hidden-node marker/chip measurement pauses, view switches trigger re-measurement, and normal-view duplicates are hidden by message id. Adapter failures only disable focus enhancements.
- New messages only emit `dsh-annotation` acknowledgement and `dsh-annotation-reply` markers. The legacy `dsh-inline-comments:` and `dsh-inline-annotations:` prefixes (and their reply-marker variants) remain authoritative reads.
- Browser storage uses the `dsh-annotation:v1:<session-id>` namespace. Legacy `dsh-inline-comments:v1:` and `dsh-inline-annotations:v1:` values are validated, converted, and written to the new key before the legacy keys are removed; a failed migration write leaves the legacy data in place.
- The stable submission-derived message id prefix `dsh-inline-annotations:` is retained so persisted retries keep their authoritative queue identity across the rename.
- The legacy internal command names `inline_comments_submit` and `inline_annotations_submit` forward to the new handler through invisible aliases; no second business implementation is retained.

## High-risk integration points

The plugin uses two different integration mechanisms:

- every existing `conversation.chat.node:assistant-step` entry is decorated in place through `ctx.slots.entries()`. The plugin changes neither its key nor its priority, and it does not register another occupant;
- `conversation.chat.node:user` and `conversation.chat.node:steering` are still shadowed at priority `-100` so submitted batches can use a compact timeline row.

For assistant rows, the decorator keeps the existing component as the body renderer, composes the existing `inject` face with the annotation face, and restores both fields when the feature is disabled or unloaded. It also watches `slots/changed`, so an assistant renderer registered later, including `dsh-smooth-stream`, is decorated without a same-key registration.

Reconciliation combines two `0.1.2` sources without changing annotation state rules: Chat nodes come from `ctx.uiConversation.binding(binding).target('chat')`, while queue membership and older-history availability come from `binding.session.getSnapshot()`. The controller subscribes to both sources and reconciles only when either snapshot identity changes.

A DSH upgrade is compatible only if `StoredEntry.component`, `StoredEntry.inject`, `ctx.slots.entries()`, the public owner props, standard Slot hooks, Chat target snapshots, primitives, and queue/session methods used by these integrations remain compatible. The CI type check catches declaration drift; a real Web smoke must catch rendering or lifecycle drift.

The internal command is registered through the public command registry. DSH currently has no non-discoverable command flag, so the transport command can appear in slash-command discovery. Invoking it manually without a valid payload fails validation and does not reach the model.

Composer attachment relies on the `inputTriggers` service and its scoped `slash/input-begin-command` and `slash/input-consume-token` events, on `CommandClaim.images` and the composer image serialization path, and on the root `commands/execute(sessionId, line, images)` Remote (with the `binding.session.command` fallback for image-free commands). An upgrade is compatible only while those bail events keep their current claim-and-span semantics, the input machine accepts a claimed token at draft position zero, image-carrying claims deliver `SubmitImageAttachment[]` to `claim.submit()`, and the command Remote admits image attachments into durable blocks. Slash-command release observes the input state store; it never installs global keyboard listeners, so it does not interfere with other plugins.

## Upgrade checklist

1. Update every direct `@deepseek-ai/dsh-*` development dependency and the complete `@deepseek-ai/dsh` development environment to one release.
2. Regenerate the lockfile and run `pnpm install --frozen-lockfile --strict-peer-dependencies` when that release is on npm. For an unpublished DSH release, pack the complete DSH, vendor, and Landlock families, apply every tarball through a disposable override, and run the disposable install with strict peer enforcement without committing the override or generated lockfile.
3. Run `pnpm verify`, `pnpm test:browser`, `pnpm test:coverage`, and `pnpm pack` against that installed release.
4. Install the tarball into a disposable DSH Web profile.
5. Verify finalized Markdown, code, tables, images, reasoning, file mentions, streaming completion, and interruption rendering, plus reply-chip overlay after streaming settles.
6. Exercise idle, running, blocking confirmation, withdrawal, transport retry, refresh recovery, default automatic attachment, manual attach/detach, Enter submission with composer text, annotation-only submission, text+annotation+image submission, image-retry refusal after refresh, slash-command release and the Enter race, and legacy overall-requirement migration.
7. Save the disabled automatic-attachment switch and confirm new annotations remain detached while the paperclip still attaches them manually, and that the composer focus still returns after saving. Then save the disabled plugin switch; confirm official renderers return, controls and highlights disappear, an armed claim detaches without changing visible text, an in-flight submission releases its claim once transport settles, and drafts return after saving the enabled switch.
8. Confirm the Slot ledger has no plugin-owned `assistant-step` entry, the existing assistant component and inject face are decorated exactly once, the two `-100` user/steering entries win their cells, and disable or unload restores the original assistant fields. Repeat with `dsh-smooth-stream` enabled.
9. Confirm the settings page shows exactly one annotation card (visible title 注解/Annotations, keyed `settings.plugin.item:dsh-annotation` with the three switches `enabled`, `autoAttach`, and `localTools`), legacy namespaces render nothing, and the profile contains exactly one runtime entry named `dsh-annotation`.
10. Record the verified DSH version in this file and the changelog.

## Browser behavior

The CSS Custom Highlight API is an enhancement. Without `CSS.highlights` and `Highlight`, drafts and sent annotations remain in the composer list and timeline, numbered source markers remain clickable, and navigation still scrolls and flashes the reply.

`localStorage` availability depends on site permissions and privacy mode. Denial is fail-soft: in-memory drafts work until the page closes, and the UI warns that refresh recovery is unavailable. Enablement and automatic attachment are Host-backed; browser storage is read only for the one-time pre-0.1.3 enablement migration and the per-Session draft records.

## Forward compatibility goal

When DSH exposes an additive assistant-body decoration or selection Slot, replace the in-place assistant decorator with that Slot. When a typed annotation conversation node or private Client-to-Host transport becomes public, migrate without changing protocol version 2 unless persisted JSON fields change.
