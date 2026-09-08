# Compatibility

## Host requirement

| Component                | Supported baseline                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| DeepSeek Harness host    | `0.1.3-alpha.2` exactly                                                             |
| `engines.dsh`            | `0.1.3-alpha.2`                                                                     |
| Development declarations | `0.1.3-alpha.2`                                                                     |
| Cordis                   | `^4.0.2`                                                                            |
| Node.js                  | `^22.19.0` or `>=24`                                                                |
| React                    | `^18.2.0`                                                                           |
| Browser                  | Current Chromium-based DSH Web target; other modern browsers retain marker fallback |

The release manifest declares `engines.dsh: "0.1.3-alpha.2"`, and every lockstep `@deepseek-ai/dsh-*` peer uses the same exact version. DSH has no external compatibility promise before `0.2.0`, so this plugin does not claim compatibility with a different prerelease. Desktop clients must embed the same DSH host version. When the installed host differs, select the matching plugin release from the README compatibility map or change hosts; forced installation and disabled peer checks are not supported.

## Dependency source

Every DSH dependency used for verification must identify the same `0.1.3-alpha.2` source generation. [source-baseline.json](../source-baseline.json) pins the official repository, release tag, and commit. The checked-in lockfile resolves the published npm family, and `pnpm install --frozen-lockfile --strict-peer-dependencies` verifies its complete peer closure. A local checkout reporting that version is not sufficient evidence that its npm packages exist.

For an unpublished family, use verifiable official source or official artifacts in a disposable directory. Confirm the repository, source commit or artifact URL, package names, and package versions before deriving integrity values. Include the DSH and vendored Cordis package families and the Landlock entry package, and enforce strict peers in the temporary install. Machine-local `file:` URLs, workspace links, and generated overlay lockfiles must never enter the released plugin manifest or checked-in lockfile. Record the actual source and commands in the release verification evidence; an old lockfile or a successful build against a different host does not verify this baseline.

The source verification helper provides independent provenance checks: it checks the pinned checkout commit, clean tracked files, DSH tarball versions, and required direct official packages before preparing a separate plugin directory. It omits the registry lockfile, supplies all provided official packages as temporary development dependencies, and adds tarball overrides. Restore the source manifest after verification and before packaging so those temporary dependency entries do not enter the release. [Development](development.md#official-source-verification) owns the complete procedure.

## Marketplace placement

The catalog submission uses **Sessions & Messages** (`session`). The plugin annotates assistant messages, persists drafts per Session, submits one user message through the official composer, and reconciles queue and durable message state; visual decoration supports that message workflow rather than acting as a theme or general appearance extension.

The repository-owned `screenshots.json` lists the five curated images that storefronts should present. The catalog entry uses the stable `dsh-annotation.tgz` GitHub Release alias, so installation never depends on a local source build.

## Marketplace update API

The plugin configuration card integrates with dsh-market `dsh-market/update-api/v1`, introduced by dsh-market `1.45.0`. This API is optional and currently reports beta stability. The Client discovers capabilities before every first use, validates the schema and all endpoint paths, and only accepts same-origin `/dsh-market/api/v1/*` endpoints. It never imports dsh-market code or calls its legacy private routes.

The card checks only the installed `dsh-annotation` package. Update progress comes from the operation endpoint. Force is offered only after `RELEASE_TOO_FRESH` or `VERSION_UNCHANGED`; rollback remains tied to the originating operation; refresh follows `refreshRequired`; restart is visible only when both `features.restart` and `restart.supported` are true. When discovery is unavailable, users are directed to **Settings → Plugin Market**. Client disposal aborts the active request or polling delay and waits for settlement.

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
- Outbox `attachments` records carry the count and ordered image/file kinds without bytes or temporary upload receipts. Legacy `images` metadata remains readable and requires image attachments on retry. The storage key and `storageVersion: 2` remain unchanged; [Data model](data-model.md#browser-persistence) owns the retry fields and recovery rules.
- The legacy internal command names `inline_comments_submit` and `inline_annotations_submit` forward to the new handler through invisible aliases; no second business implementation is retained.

## High-risk integration points

The plugin uses two different integration mechanisms:

- every existing `conversation.chat.node:assistant-step` entry is decorated in place through `ctx.slots.entries()`. The plugin changes neither its key nor its priority, and it does not register another occupant;
- `conversation.chat.node:user` and `conversation.chat.node:steering` are still shadowed at priority `-100` so submitted batches can use a compact timeline row.

For assistant rows, the decorator keeps the existing component as the body renderer, composes the existing `inject` face with the annotation face, and restores both fields when the feature is disabled or unloaded. It also watches `slots/changed`, so an assistant renderer registered later, including `dsh-smooth-stream`, is decorated without a same-key registration.

DSH `0.1.3-alpha.2` renders HTML as literal text. The decorator removes this plugin's acknowledgement and reply comments, including legacy prefixes, from the text and reasoning blocks sent to the inner renderer. The outer annotation parser and persisted Session content retain the raw markers. Unmarked nodes keep their original references, and the Host's Markdown policy is unchanged. [Decision 0003](decisions/0003-assistant-renderer-decoration.md) defines the streaming and incomplete-marker rules.

Reconciliation reads Chat nodes from `ctx.uiConversation.binding(binding).target('chat')`, while queue membership and older-history availability come from `binding.session.getSnapshot()`. The controller subscribes to both sources and reconciles only when either snapshot identity changes.

A DSH upgrade is compatible only if `StoredEntry.component`, `StoredEntry.inject`, `ctx.slots.entries()`, the public owner props, standard Slot hooks, Chat target snapshots, primitives, and queue/session methods used by these integrations remain compatible. The CI type check catches declaration drift; a real Web smoke must catch rendering or lifecycle drift.

The internal command is registered through the public command registry. DSH currently has no non-discoverable command flag, so the transport command can appear in slash-command discovery. Invoking it manually without a valid payload fails validation and does not reach the model.

Composer attachment relies on the `inputTriggers` service and its scoped `slash/input-begin-command` and `slash/input-consume-token` events, on `CommandClaim.attachments`, and on the root `commands/execute(sessionId, line, attachments)` Remote. The `binding.session.command` fallback supports attachment-free commands only. An upgrade is compatible only while those bail events keep their claim-and-span semantics, the input machine accepts a claimed token at draft position zero, `claim.submit()` receives ordered `SubmitAttachment[]` values, and the command Remote admits image and file attachments into durable blocks. Slash-command release observes the input state store and installs no global keyboard listeners.

Focus restoration locates the Lexical contenteditable through DSH's composer DOM markers and uses browser Selection offsets that exclude the annotation token. It restores only the same editable element with unchanged visible text and no subsequent user focus change; file-reference chips remain editor-owned. The plugin does not import Lexical internals or rewrite the editor document. [Decision 0004](decisions/0004-dsh-0.1.3-composer-and-attachments.md) records these obligations.

## Upgrade checklist

1. Update every direct `@deepseek-ai/dsh-*` development dependency and the complete `@deepseek-ai/dsh` development environment to one release.
2. Regenerate the lockfile and run `pnpm install --frozen-lockfile --strict-peer-dependencies` when that release is on npm. For an unpublished DSH release, follow the [source verification procedure](development.md#install-and-verify) with the complete DSH and vendor families and the Landlock entry package, then run the disposable install with strict peer enforcement without committing its overrides or generated lockfile.
3. Run `pnpm verify`, `pnpm test:browser`, and `pnpm test:coverage` against that installed release. Follow [Packaging](development.md#packaging) to restore the release manifest and produce the tarball from a source verification directory.
4. Install the tarball into a disposable DSH Web profile.
5. Verify finalized Markdown, code, tables, images, reasoning, file mentions, streaming completion, and interruption rendering, plus reply-chip overlay after streaming settles.
6. Exercise idle, running, blocking confirmation, withdrawal, transport retry, refresh recovery, default automatic attachment, manual attach/detach, Enter submission with composer text, annotation-only submission, mixed image/file submission in original order, retry refusal for missing or mismatched attachments, legacy image-only outbox recovery, slash-command release and the Enter race, and legacy overall-requirement migration.
7. Save the disabled automatic-attachment switch and confirm new annotations remain detached while the paperclip still attaches them manually, and that Lexical focus and the caret return after saving without altering text or reference chips. Confirm a Session switch, text change, or deliberate focus change cancels a pending restore. Then save the disabled plugin switch; confirm official renderers return, controls and highlights disappear, an armed claim detaches without changing visible text, an in-flight submission releases its claim once transport settles, and drafts return after saving the enabled switch.
8. Confirm the Slot ledger has no plugin-owned `assistant-step` entry, the existing assistant component and inject face are decorated exactly once, the two `-100` user/steering entries win their cells, and disable or unload restores the original assistant fields. Repeat with `dsh-smooth-stream` enabled.
9. Confirm the settings page shows exactly one annotation card (visible title 注解/Annotations, keyed `settings.plugin.item:dsh-annotation` with the three switches `enabled`, `autoAttach`, and `localTools`), the switches use the official alpha.2 primitive, legacy namespaces render nothing, and the profile contains exactly one runtime entry named `dsh-annotation`.
10. With dsh-market `1.45.0` or later installed, verify capability discovery, version check, progress, eligible force, rollback, refresh, and capability-gated restart. Remove the public API and confirm no legacy update route is called.
11. Record the verified DSH version in this file and the changelog.

## Browser behavior

The CSS Custom Highlight API is an enhancement. Without `CSS.highlights` and `Highlight`, drafts and sent annotations remain in the composer list and timeline, numbered source markers remain clickable, and navigation still scrolls and flashes the reply.

`localStorage` availability depends on site permissions and privacy mode. Denial is fail-soft: in-memory drafts work until the page closes, and the UI warns that refresh recovery is unavailable. Enablement and automatic attachment are Host-backed; browser storage is read only for the one-time pre-0.1.3 enablement migration and the per-Session draft records.

## Forward compatibility goal

When DSH exposes an additive assistant-body decoration or selection Slot, replace the in-place assistant decorator with that Slot. When a typed annotation conversation node or private Client-to-Host transport becomes public, migrate without changing protocol version 2 unless persisted JSON fields change.
