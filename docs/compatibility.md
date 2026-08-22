# Compatibility

## Supported baseline

| Component                | Supported baseline                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| DeepSeek Harness         | `>=0.1.1-rc.2 <0.2.0`                                                               |
| Development declarations | `0.1.1-rc.2`                                                                        |
| Cordis                   | `^4.0.1`                                                                            |
| Node.js                  | `^22.19.0` or `>=24`                                                                |
| React                    | `^18.2.0`                                                                           |
| Browser                  | Current Chromium-based DSH Web target; other modern browsers retain marker fallback |

DSH has no external compatibility promise before `0.2.0`. The peer range expresses the reviewed release window, not an automatic guarantee for every prerelease.

## Plugin configuration integration

The Host half registers the `inline-comments` namespace through `@deepseek-ai/dsh-settings`. The browser half binds the namespace through `ctx.settingsScope` and contributes one keyed `settings.plugin.item:inline-comments` card supplied by `@deepseek-ai/dsh-client-ui-settings-plugins`. A deployment without a settings provider still runs the comment command, while the browser keeps the safe enabled default and renders no writable card.

The card follows the official plugin-configuration lifecycle: edits are staged, Save writes the Host document with the namespace revision, Discard drops local edits, and Reset clears the user-layer field. Conversation integrations change only after the Host accepts a value.

## High-risk integration points

The plugin shadows these shipped renderer cells at priority `-100`:

- `conversation.chat.node:assistant-step`;
- `conversation.chat.node:user`;
- `conversation.chat.node:steering`.

A DSH upgrade is compatible only if the public owner props, `AssistantChatData`, `renderMessageImages` helper, standard Slot hooks, primitives, and queue/session methods used by those replacements remain compatible. The CI type check catches declaration drift; a real Web smoke must catch rendering or lifecycle drift.

The internal command is registered through the public command registry. DSH currently has no non-discoverable command flag, so the transport command can appear in slash-command discovery. Invoking it manually without a valid payload fails validation and does not reach the model.

Composer attachment relies on the `inputTriggers` service and its scoped `slash/input-begin-command` and `slash/input-consume-token` events. An upgrade is compatible only while those bail events keep their current claim-and-span semantics and the input machine accepts a claimed token at draft position zero.

## Upgrade checklist

1. Update every direct `@deepseek-ai/dsh-*` development dependency and the complete `@deepseek-ai/dsh` development environment to one release.
2. Run `pnpm install`, then require `pnpm peers check` to report no issue.
3. Run `pnpm verify`, `pnpm test:browser`, `pnpm test:coverage`, and `pnpm pack`.
4. Install the tarball into a disposable DSH Web profile.
5. Verify finalized Markdown, code, tables, images, reasoning, file mentions, streaming completion, and interruption rendering.
6. Exercise idle, running, blocking confirmation, withdrawal, transport retry, refresh recovery, attach/detach, comment-only submission, and legacy overall-requirement migration.
7. Save the disabled switch under **Settings → Plugins → Plugin configuration**; confirm official renderers return, controls and highlights disappear, an armed claim detaches without changing visible text, an in-flight submission releases its claim once transport settles, and drafts return after saving the enabled switch.
8. Confirm the Slot ledger selects the plugin's three `-100` entries, dispatches the `inline-comments` plugin card only while its Host namespace is served, and restores shipped entries after unload.
9. Record the verified DSH version in this file and the changelog.

## Browser behavior

The CSS Custom Highlight API is an enhancement. Without `CSS.highlights` and `Highlight`, drafts and sent comments remain in the composer list and timeline, numbered source markers remain clickable, and navigation still scrolls and flashes the reply.

`localStorage` availability depends on site permissions and privacy mode. Denial is fail-soft: in-memory drafts work until the page closes, and the UI warns that refresh recovery is unavailable. The enabled preference is Host-backed; browser storage is read only for the one-time pre-0.1.3 preference migration.

## Forward compatibility goal

When DSH exposes an additive assistant-body decoration or selection Slot, replace the `assistant-step` shadow with that Slot. When a typed annotation conversation node or private Client-to-Host transport becomes public, migrate without changing protocol version 1 unless persisted JSON fields change.
