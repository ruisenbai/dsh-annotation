# Compatibility

## Supported baseline

| Component                | Supported baseline                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| DeepSeek Harness         | `>=0.1.0-rc.8 <0.2.0`                                                               |
| Development declarations | `0.1.0-rc.8`                                                                        |
| Cordis                   | `^4.0.1`                                                                            |
| Node.js                  | `^22.19.0` or `>=24`                                                                |
| React                    | `^18.2.0`                                                                           |
| Browser                  | Current Chromium-based DSH Web target; other modern browsers retain marker fallback |

DSH has no external compatibility promise before `0.2.0`. The peer range expresses the intended review window, not an automatic guarantee for every prerelease.

The `0.1.0-rc.8` upgrade changed three integration points used by this plugin. Chat-node owner props now expose `renderMessageImages` through the `conversation.message.images` Slot instead of passing `loadImage` to renderers that import attachment components directly. Composer reference occurrences now cover their complete inline display text instead of one placeholder character, so submission serialization replaces each declared range with its model form. `CommandClaim.submit` now receives serialized image attachments and requires an explicit `images` capability to accept them. The plugin delegates image rendering to the Slot, advances serialization by each reference range length, and leaves image support disabled to preserve its refusal of mixed image and comment drafts.

## High-risk integration points

The plugin shadows these shipped renderer cells at priority `-100`:

- `conversation.chat.node:assistant-step`;
- `conversation.chat.node:user`;
- `conversation.chat.node:steering`.

A DSH upgrade is compatible only if the public owner props, `AssistantChatData`, `renderMessageImages` helper, standard Slot hooks, primitives, and queue/session methods used by those replacements remain compatible. The CI type check catches declaration drift; a real Web smoke must catch rendering or lifecycle drift.

The internal command is registered through the public command registry. DSH currently has no non-discoverable command flag, so the transport command can appear in slash-command discovery. Invoking it manually without a valid payload fails validation and does not reach the model.

Composer attachment relies on the `inputTriggers` service and its scoped `slash/input-begin-command` / `slash/input-consume-token` events. An upgrade is compatible only while those bail events keep their current claim-and-span semantics and the input machine keeps accepting a claimed token at draft position zero.

The enabled preference contributes through `settings.general.item` and persists with Client Runtime's `createSnapshotStore`. It does not use a Host settings namespace because Web configuration clients expose only product-owned allowlisted namespaces.

## Upgrade checklist

1. Update all `@deepseek-ai/dsh-*` development dependencies to one release.
2. Run `pnpm install` and inspect peer warnings.
3. Run `pnpm verify` and `pnpm pack`.
4. Install the tarball into a disposable DSH Web profile.
5. Verify finalized Markdown, code, tables, images, reasoning, file mentions, streaming completion, and interruption rendering.
6. Exercise idle, running, blocking confirmation, withdrawal, transport retry, refresh recovery, attach/detach, comment-only submission, and legacy overall-requirement migration.
7. Turn DSH Inline Comments off in General Settings; confirm official renderers return, controls and highlights disappear, an armed claim detaches without changing visible text, an in-flight submission releases its claim once the transport settles, and drafts return after re-enabling.
8. Confirm the Slot ledger still selects the plugin's three `-100` entries and restores shipped entries after unload.
9. Record the verified DSH version in this file and the changelog.

## Browser behavior

The CSS Custom Highlight API is an enhancement. Without `CSS.highlights` and `Highlight`, drafts and sent comments remain in the composer list and timeline, numbered source markers remain clickable, and navigation still scrolls and flashes the reply.

`localStorage` availability depends on site permissions and privacy mode. Denial is fail-soft: in-memory drafts work until the page closes, and the UI warns that refresh recovery is unavailable.

## Forward compatibility goal

When DSH exposes an additive assistant-body decoration/selection slot, replace the `assistant-step` shadow with that slot. When a typed annotation conversation node or private Client-to-Host transport becomes public, migrate without changing protocol version 1 unless persisted JSON fields change.
