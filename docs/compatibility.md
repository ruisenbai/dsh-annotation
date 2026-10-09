# Compatibility

## Host requirement

Version 1.1.1 uses DSH `0.2.1-alpha.1` as its verification baseline and declares Host `>=0.2.1-alpha.1`. Install the 1.1.1 GitHub Release archive on that Host. Users remaining on the `0.2.0` Host family must keep plugin 1.1.0; see the [upgrade guide](upgrade-guide/v1.1.0/host-baseline/guide.md).

| Component                | Supported baseline                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- |
| DeepSeek Harness host    | `>=0.2.1-alpha.1`                                                                   |
| `engines.dsh`            | `>=0.2.1-alpha.1`                                                                   |
| Development declarations | `0.2.1-alpha.1`                                                                     |
| Cordis                   | `~4.0.5-alpha.1`                                                                    |
| Node.js                  | `^22.19.0` or `>=24`                                                                |
| React                    | `^18.2.0`                                                                           |
| Browser                  | Current Chromium-based DSH Web target; other modern browsers retain marker fallback |

The checkout manifest declares `engines.dsh: ">=0.2.1-alpha.1"`, and its `@deepseek-ai/dsh-*` peers, development dependencies, lockfile, and CI checkout use that release. The strict-peer development environment includes `@deepseek-ai/dsh-llm-deepseek`, required by the official provider packages. Host source and frozen Session recordings are unchanged. New annotation submissions use protocol v5 and browser storage uses v6; protocol v1–v4 and storage v1–v5 remain readable compatibility generations.

## Dependency source

Every DSH dependency used for verification must identify the same `0.2.1-alpha.1` source generation. [source-baseline.json](../source-baseline.json) pins official tag `dsh-v0.2.1-alpha.1` at commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`. The npm family is available and the registry lockfile targets it; verify the complete peer closure with `pnpm install --frozen-lockfile --strict-peer-dependencies`. A matching version string or a regenerated lockfile is not a behavior-test result.

For an unpublished family, use verifiable official source or official artifacts in a disposable directory. Confirm the repository, source commit or artifact URL, package names, and package versions before deriving integrity values. Include the DSH and vendored Cordis package families and the Landlock entry package, and enforce strict peers in the temporary install. Machine-local `file:` URLs, workspace links, and generated overlay lockfiles must never enter the released plugin manifest or checked-in lockfile. Record the actual source and commands in the release verification evidence; an old lockfile or a successful build against a different host does not verify this baseline.

The source verification helper provides independent source checks: it checks the pinned checkout commit, clean tracked files, DSH tarball versions, and required direct official packages before preparing a separate plugin directory. It omits the registry lockfile, supplies all provided official packages as temporary development dependencies, and adds tarball overrides. Restore the source manifest after verification and before packaging so those temporary dependency entries do not enter the release. [Development](development.md#official-source-verification) owns the complete procedure.

## Verification

Release verification targets the published `0.2.1-alpha.1` DSH packages with Cordis `4.0.5-alpha.1`, the group plugin `1.0.5-alpha.1`, and Schemastery `3.18.5-alpha.1`. The removed `@deepseek-ai/dsh-invariants` package is not a development dependency. The plugin's existing no-op `./invariant` export remains available for callers and requires no Host registry.

The registry lockfile and CI source pin identify the same official generation. [Development](development.md) describes the build, strict-peer install, unit/coverage, browser, installed-profile, and archive checks. On 2026-10-09, Linux with Node.js `26.11.1` passed typechecking, lint, formatting, a frozen strict-peer install, the plugin build, and bundle verification. The unit/component coverage run passed **634 tests in 44 files**, with 89.25% line, 93.55% function, 81.07% branch, and 85.64% statement coverage in the configured coverage scope. The wide/light and narrow/dark Chromium fixture passed record ordering, focus/scroll preservation, frost/opaque bubble states, attachment, resend, and recycle-bin interactions.

The complete isolated Web profile passed Settings persistence and archive recovery, frozen Session replay, source selection and ordering, file and official Diff creation/Locate, composer text and image submission, sent-note reattachment, and retry identity. It compares the submitted message with the durable Session log and the deterministic model adapter's input. Seven Chinese Web screenshots were captured from that same Host baseline. The fixture uses the Host's current **显示代码工作视图** setting when opening official Diff views.

Executed commands:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/oxlint --deny-warnings src tests scripts
./node_modules/.bin/prettier --check .
./node_modules/.bin/vitest run --coverage
node scripts/clean.mjs
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsdown
node scripts/verify-bundle.mjs
node scripts/browser-test.mjs
DSH_RELEASE_SCREENSHOTS=1 node scripts/profile-smoke.mjs
```

The 1.1.1 archive also passed `publint` and installed through `dsh plugin --profile web add` into a fresh temporary DSH home. `why dsh-annotation` resolved exactly one version, and the installed Client bundle hash matched the built bundle. The installed Web Settings card exposed all four enabled controls without browser errors after completing the preview notice and deferring model setup. The CLI reported peer-dependency and cross-filesystem store warnings while installation and loading succeeded.

The published Host primitives package references a missing `index.js.map`; Vitest reported that source-map warning while all tests passed. Browser and profile checks used isolated local state and a deterministic model adapter, not a live provider. macOS, Windows, other browsers, the Node 22/24 matrix, and independent source-build verification remain separate CI/manual evidence.

## Marketplace placement

The catalog submission uses **Sessions & Messages** (`session`). The plugin annotates assistant messages, persists drafts per Session, submits one user message through the official composer, and reconciles queue and durable message state; visual decoration supports that message workflow rather than acting as a theme or general appearance extension.

The repository-owned `screenshots.json` lists seven screenshots from the Chinese Web profile. The catalog uses `https://github.com/ruisenbai/dsh-annotation/releases/latest/download/dsh-annotation.tgz`; every release publishes that stable filename together with its versioned archive.

## Marketplace update API

The plugin configuration card integrates with dsh-market `dsh-market/update-api/v1`, introduced by dsh-market `1.45.0`. This API is optional and currently reports beta stability. The Client discovers capabilities before every first use, validates the schema and all endpoint paths, and only accepts same-origin `/dsh-market/api/v1/*` endpoints. It never imports dsh-market code or calls its legacy private routes.

The card checks only the installed `dsh-annotation` package. Update progress comes from the operation endpoint. Force is offered only after `RELEASE_TOO_FRESH` or `VERSION_UNCHANGED`; rollback remains tied to the originating operation; refresh follows `refreshRequired`; restart is visible only when both `features.restart` and `restart.supported` are true. When discovery is unavailable, users are directed to **Settings → Plugin Market**. Client disposal aborts the active request or polling delay and waits for settlement.

## Main Settings integration

The Host declares editable booleans as `.volatile()` Config fields on the `dsh-annotation` profile entry and registers `settings.configure({ auto: false }, ctx.fiber)` as an optional effect. The browser uses `ctx.configForms.get()` and contributes the existing top-level `settings.section`; it does not use the removed `settingsScope` or register a second settings namespace. The official main Settings shell owns navigation and persistence through the profile Cordis patch.

The active Settings card exposes `enabled`, `autoAttach`, `officialFileAnnotations`, and `officialDiffAnnotations`, all enabled by default, alongside optional dsh-market update controls. Disabling either official source entry removes only its new entry points and retains existing records. Historical `compactSummary`, `individualSelection`, and transcript-visibility values remain readable for stored-profile compatibility but have no controls or effects in the current annotation UI. New annotations are selected for the next message by default; row paperclips explicitly attach or detach individual annotations, including previously sent annotations. The composer chip previews attached source text and note content on hover and opens the downward annotation record on click. The record toggle sits to the left of the model selector; its list stays hidden in a new conversation and closes automatically when every annotation has been sent and none is attached. A deployment without a settings provider still runs the annotation command with safe defaults, while the main Settings section renders no form.

The card follows the official plugin-configuration lifecycle: edits are staged, Save writes the Host document with the namespace revision, Discard drops local edits, and Reset clears the user-layer field. Conversation integrations change only after the Host accepts a value.

DSH imports the removed `settings.yaml` into profile configuration and retains `settings.yaml.imported`. If an earlier plugin could not expose the new form during that import, annotation recovery reads the retained archive through Host filesystem/profile services. Supported booleans from `inline-comments` and then `dsh-annotation` fill only missing user overrides; current overrides win. One revision-fenced mutation writes the values and `archivedPreferencesImported: true`. The marker prevents Reset from importing again. Missing archives are normal; malformed owned data or refused writes leave the archive and marker unchanged. Unrelated sections and retired fields are never submitted as settings operations.

## Protocol, storage, and command compatibility

- New submissions use protocol v5, require an explicit source type, and include batch-level `processingMode` plus optional annotation-level `supplementalTo`. `message`, official `file`, and official `official-diff` sources are writable; historical Git `diff` sources remain read-only and are rejected for new sends. Accepted modes are `answer`, `rewrite`, and `modify`; legacy v1/v2 payloads without a mode default to `answer`, while an explicit invalid mode is rejected. A supplemental id is nonblank and bounded, cannot self-reference, and may identify an annotation outside the current batch. Existing `comment`, `source`, `kind`, and `protocolLocale` compatibility stays unchanged, and historical messages are never rewritten.
- `protocolLocale` and `processingMode` freeze in the outbox. `answer` produces separate ordered answers, `rewrite` produces a coherent body before per-annotation notes, and `modify` changes the annotated target and reports the result or blocker before those notes. Every mode emits hidden `dsh-annotation-reply` association markers and asks for acknowledgement of only ids actually completed. Reply parsing accepts Chinese, English, and legacy labels; stable hidden ids own association. Marker-window normalization and duplicate-label ambiguity rules remain unchanged.
- An overlapping message selection opens a separate annotation editor directly. The check button and Enter can explicitly save an empty selection note; a whole-file note requires an opinion. The first two outside clicks shake a new editor. A third outside click or composer input cancels it if its trimmed text is empty, or saves it otherwise. Canceling creates no record, source bubble, selected attachment, or trash item. Suspended editor buffers remain recoverable and are not submitted. Historical `supplementalTo` links remain readable; no current-version Diff rebind is available.

- Optional dsh-focus-chat: the adapter never injects or waits for a focus service; it detects the focus view through its public `[data-focus-flow]` DOM root. Without the plugin everything runs unchanged; with it, hidden-node marker/chip measurement pauses, view switches trigger re-measurement, and normal-view duplicates are hidden by message id. Adapter failures only disable focus enhancements.
- New messages only emit `dsh-annotation` acknowledgement and `dsh-annotation-reply` markers. The legacy `dsh-inline-comments:` and `dsh-inline-annotations:` prefixes (and their reply-marker variants) remain authoritative reads.
- Browser storage keeps the `dsh-annotation:v1:<session-id>` namespace and writes `storageVersion: 6`, reading and migrating versions 1 through 6. Frozen v2 outbox payloads remain v2; v1 continues the existing normalization to v2. Older payloads are not rewritten, while validated storage state is written in the current v6 envelope. Optional `trash`, `deletionMarks`, `editorDrafts`, `selectionMode`, `selectedAnnotationIds`, `processingMode`, and `retrySubmissionId` default compatibly when absent. Compact v2 official file and turn-Diff sources first required storage v5; older message and historical Diff records remain readable. Only older records with no retry-selection field use the first retryable-entry fallback; current snapshots persist an explicit id or `null`. Legacy namespace migration retains its validate-write-delete order.
- The stable submission-derived message id prefix `dsh-inline-annotations:` is retained so persisted retries keep their authoritative queue identity across the rename.
- Outbox records freeze the selected annotations and ordinals, processing mode, overall requirement, locale, target Session, and ordered attachment metadata. Retry cannot adopt a new current selection, mode, or attachment order. Only `ready` and `failed` records send; stale actions against `queued`, `accepted`, or `sent` skip transmission, and `withdrawn` aborts. Late retry or transport outcomes cannot demote authority already established by queue or durable history. Durable history discovered after an ambiguous failed record was discarded restores the frozen id and ordinal, preserving a later saved change as a new linked draft or an unfinished change as an independent supplemental buffer; neither is selected automatically. Legacy `images` metadata remains readable; [Data model](data-model.md#browser-persistence) owns the exact recovery rules.
- The legacy internal command names `inline_comments_submit` and `inline_annotations_submit` forward to the new handler through invisible aliases; no second business implementation is retained.

## High-risk integration points

The plugin uses two different integration mechanisms:

- every existing `conversation.chat.node:assistant-step` entry is decorated in place through `ctx.slots.entries()`. The plugin changes neither its key nor its priority, and it does not register another occupant;
- `conversation.chat.node:user` and `conversation.chat.node:steering` are still shadowed at priority `-100` so submitted batches can show a compact comment count above the ordinary message body.

For assistant rows, the decorator keeps the existing component as the body renderer, composes the existing `inject` face with the annotation face, and restores both fields when the feature is disabled or unloaded. It also watches `slots/changed`, so an assistant renderer registered later, including `dsh-smooth-stream`, is decorated without a same-key registration.

The decorator removes this plugin's acknowledgement and reply comments, including legacy prefixes, from the text and reasoning blocks sent to the inner renderer. The outer annotation parser and persisted Session content retain the raw markers. Unmarked nodes keep their original references, and the Host's Markdown policy is unchanged. [Decision 0003](decisions/0003-assistant-renderer-decoration.md) defines the streaming and incomplete-marker rules.

Source navigation consumes the injected `TurnProcessOwnerProps` fields `foldable`, `open`, and `setOpen`, and recognizes actual folded wrappers through `[data-turn-process-hidden]` or `[hidden="until-found"]`. It expands before measuring only when both signals show a folded source. The quote flash uses positioned DOM rectangles rather than the CSS Custom Highlight registry, and a Session-wide navigation epoch cancels stale local overlays and stale history-load continuations.

Reconciliation independently subscribes to Chat nodes from `ctx.uiConversation.binding(binding).target('chat')`, the Inbox projection from `binding.session.projections.faceOf('inbox')`, and the Session snapshot for older-history availability. `SessionSnapshot` does not carry queue membership. The Inbox adapter selects only `next-turn` items and maps their `id` to the controller's `messageId`; `next-step` items never authorize withdrawal. An `undefined` Inbox snapshot means not yet synchronized and must remain unknown rather than become an empty queue. A synchronized snapshot that omits a previously queued id returns the outbox to `accepted` until durable Chat history establishes `sent`. A projection update must reconcile even when the Session and Chat snapshot identities are unchanged.

The user and steering renderers pass `openFile` and `openSkill` from their owner props to `projectUserText`, including the overall requirement on annotation submissions. File attachments use the official `FileTypeIcon`. Assistant selection capture and range restoration include Markdown file-link button labels but exclude action buttons, hidden icons, reasoning, and plugin controls. DSH exposes no semantic DOM hook for these links, so the adapter identifies a button by its `title` attribute and both CSS Module local names `fileMention` and `fileLink`, without depending on generated hashes. This is an exact-version DOM dependency that must be rechecked when the renderer changes.

A DSH upgrade must preserve the Slot entry fields, assistant owner props, Chat and Inbox projections, input-trigger claim semantics, and queue/session methods used above. The type check catches declaration drift; a real Web smoke catches rendering and lifecycle drift.

Composer attachment relies on the `inputTriggers` service and its scoped `slash/input-begin-command` and `slash/input-consume-token` events, on `CommandClaim.name` and `CommandClaim.attachments`, and on the root `commands/execute(sessionId, line, attachments)` Remote. A newly saved annotation is selected for the next message; explicit paperclip selection can attach a previously sent annotation without creating another record or source bubble. Manual detachment stays detached until the user selects an annotation again. The token remains zero-width and non-whitespace. On an empty draft, an additional invisible word-joiner creates an editable Lexical leaf after the styled token; it is removed before serialization, detachment, focus offsets, and model input. Existing composer text and reference chips are not rewritten when the claim begins. `claim.submit()` captures one selected or retry snapshot; later selections do not rewrite that snapshot. Preparation aborts when a captured annotation is deleted, changed, or made ineligible before outbox creation. Slash-command release observes the input store and installs no global listeners.

Focus restoration locates the Lexical contenteditable through DSH composer DOM markers and uses browser Selection offsets that exclude the annotation token. It restores only the same editable element with unchanged visible text and no subsequent user focus change; file-reference chips remain editor-owned. The plugin does not import Lexical internals or rewrite the editor document. [Decision 0004](decisions/0004-dsh-0.1.3-composer-and-attachments.md) records these obligations.

The internal command is registered through the public command registry. DSH currently has no non-discoverable command flag, so the transport command can appear in slash-command discovery. Invalid payloads fail without reaching the model. The exact `prepare-attachments` input returns only admitted attachment identities, never a user message. Identity-aware Client and Host builds must be deployed together; an older Host cannot answer preflight, so attachment-bearing new sends fail without creating outbox state. DSH must preserve content identity across fresh file-upload receipts. Legacy payloads without identities remain readable but enforce only their recorded count and kinds; [Data model](data-model.md#submission-payload) owns that limitation.

## Upgrade checklist

1. Update every direct `@deepseek-ai/dsh-*` development dependency and the complete `@deepseek-ai/dsh` development environment to one release.
2. Regenerate the lockfile and run `pnpm install --frozen-lockfile --strict-peer-dependencies` when that release is on npm. For an unpublished DSH release, follow the [source verification procedure](development.md#install-and-verify) with the complete DSH and vendor families and the Landlock entry package, then run the disposable install with strict peer enforcement without committing its overrides or generated lockfile.
3. Run `pnpm verify`, `pnpm test:browser`, `pnpm test:profile`, and `pnpm test:coverage` against that installed release. The profile smoke requires the built artifacts produced by `pnpm verify` or `pnpm build`. Follow [Packaging](development.md#packaging) to restore the release manifest and produce the tarball from a source verification directory.
4. Install the tarball into a disposable DSH Web profile.
5. Verify finalized Markdown, code, tables, images, reasoning, file mentions, streaming completion, and interruption rendering, plus reply targets after streaming settles. Exercise at least four marker-linked headings separated by normalized blank lines, repeated ordinals from multiple batches, and a duplicated earliest heading followed by a unique translated citation; every unambiguous heading must navigate, while the ambiguous window remains plain. Navigate from a genuinely folded Turn and confirm it expands before measurement, centers the complete quote, fades the quote-range overlay, and cancels an older message's transient overlay without clearing a persistent marker/editor highlight. Select file-link button labels alone and within surrounding text, restore their ranges after remount, and confirm action buttons and hidden icons remain excluded. Exercise `openFile` and `openSkill` in ordinary user/steering text and annotation submission requirements.
6. Verify Inbox-only reconciliation, withdrawal, transport retry, refresh recovery, composer-text and annotation-only submission, mixed attachment order, immutable retry metadata, slash-command release, and legacy overall-requirement migration.
7. Disable automatic attachment and confirm explicit paperclip attachment still works. Add an annotation with automatic attachment enabled and confirm the composer chip updates without opening the record. Detach it, type in the composer, and confirm it stays detached. Send it, reattach the same sent id, and confirm neither the record count nor the source bubble count increases.
8. Confirm the Slot ledger has no plugin-owned `assistant-step` entry, the existing assistant component and inject face are decorated exactly once, the two `-100` user/steering entries win their cells, and disable or unload restores the original assistant fields. Repeat with `dsh-smooth-stream` enabled.
9. Open **Settings → Annotations** and confirm `enabled`, `autoAttach`, `officialFileAnnotations`, `officialDiffAnnotations`, and the optional market controls appear. Toggle each official source independently and confirm disabling an entry removes only its new action while retaining existing records. In a new conversation, confirm no empty annotation copy appears above the composer. Check the model-adjacent record toggle, source filters (`All`, `Body`, `Diff`, `File`), row paperclip and Locate buttons, composer chip preview and click-to-open behavior, quick editor, source bubble clipping, and empty note display. Confirm transcript visibility controls are absent and ordinary transcript content remains visible.

10. With dsh-market `1.45.0` or later installed, verify capability discovery, version check, progress, eligible force, rollback, refresh, and capability-gated restart. Remove the public API and confirm no legacy update route is called.
11. Record the verified DSH version in this file and the changelog.

## Historical Diff compatibility and persistence acknowledgement

DSH `0.2.1-alpha.1` writes Session format v4. Plugin protocol v5 and browser storage v6 are independent version domains. The profile smoke restores frozen Session v3 recordings through the official migration catalog, compares them with adjacent v4 fixtures, and verifies that reading preserves the migrated events. Existing v3 fixture generations remain unchanged.

The current plugin emits v5 annotations from message, official file, and official turn-Diff sources. Protocol v1/v2 messages, code-block selections, tables, old source namespaces, acknowledgement/reply markers, and failed message-source retries remain readable. Historical protocol v3 Git Diff sources and complete snapshots in standard `user/message` metadata remain parseable and visible as read-only history. Browser-local official source drafts, suspended editors, and failed batches are preserved without automatic migration, retry, or deletion. Historical Git Diff remains excluded from new submission admission.

Use matching Host and Client plugin builds. Old plugins cannot consume v5 submissions or storage envelopes containing compact official file/Diff sources; downgrading after creating them is unsupported. Protocol v1–v4 and storage v1–v4 records remain readable by the current plugin. Invalid or incomplete historical records do not become current-file anchors.

## Browser behavior

The source text has no permanent underline or background for annotations. Hovering or opening its numbered bubble highlights the selected text; navigation renders a separate transient quote-range overlay. The bubble follows its source during scrolling and disappears when the selected text leaves the visible scroll area.

`localStorage` availability depends on site permissions and privacy mode. Denial is fail-soft: in-memory drafts work until the page closes, and the UI warns that refresh recovery is unavailable. Enablement, automatic attachment, and the two official-source switches are Host-backed. Browser storage holds per-Session annotations, editor buffers, explicit selection, and outbox records; historical selection and processing preferences remain readable for compatibility.

## Forward compatibility goal

When DSH exposes an additive assistant-body decoration or selection Slot, replace the in-place assistant decorator with that Slot. A future typed annotation node or private Client-to-Host transport can retain protocol v5 while fields are additive and old records have defined defaults; an incompatible semantic or structural change requires an explicit successor version.
