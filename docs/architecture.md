# Architecture

## Scope

`dsh-annotation` is one installable Cordis row with two runtime halves:

- the **Host half** registers the `dsh-annotation` settings namespace and internal `annotation_submit` command (plus invisible legacy aliases), captures session-scoped Git comparisons through public filesystem/subprocess services, validates a base64url JSON payload and attested Diff sources, admits official image and file attachments, creates one standard user message, deduplicates retries, and calls `Agent.followup()`;
- the **Web Client half** owns message selection and the plugin-owned Git Diff panel, overlap decisions, saved annotations and multiple editor buffers, aggregate or individual batch selection, processing-mode choice, the official-composer claim, immutable retry selection, status reconstruction, reply-chip rendering, queue withdrawal, and source navigation.

The package does not add a custom durable Session event. Every model-visible batch is represented by the existing `user/message` event and therefore survives replay and persistence without extending DSH's closed reload vocabulary.

## Real Git Diff entry point

The **Annotate code Diff** button in the annotation/composer area opens a plugin-owned unified Diff modal. It does not add controls to better-sidebar or the built-in deliverables review. The modal has independent old/new line-number gutters, keyboard-focusable `+` buttons, Shift-click/Shift+Enter continuous ranges, a separate marker column, and the existing annotation editor. File changes, range changes, closing, and history navigation retain unfinished edits through the existing buffer lifecycle.

The candidate-source review determines which coordinates can be trusted:

| Candidate                                                | Repository/file and coordinates                                                                      | Actual comparison and version data                                                                      | Interaction extension                              | Integration                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Host `ui-primitives/src/DiffBlock.tsx`                   | Text fragments do not identify full-file coordinates or a repository                                 | No complete version pair                                                                                | No public line action                              | Not a precise Diff source                                    |
| Host `ui-deliverables` changes and ReviewTab             | Hunks contain real line numbers; Client summaries omit cwd/snapshot identities                       | Turn-start → turn-end; Host snapshots are Session-lifetime data                                         | Unified/split renderer without an annotation hook  | Not workspace/index Diff; not adapted                        |
| better-sidebar DiffTab/DiffFiles and Git Diff references | Repository/path references and genuine old/new hunk counters                                         | Git references can fall back to the other staged/unstaged range; fold expansion rereads mutable content | No public annotation hook                          | Reference only; no source or installed-package modifications |
| Annotation Host and Diff panel                           | Session cwd, validated repository-relative paths, independent one-based counters from complete sides | Explicit index → working snapshot or HEAD → index blob pair                                             | Plugin-owned line buttons and frozen-context folds | Implemented                                                  |

`AnnotationDiffHost` derives the repository from the receiving Session's cwd. It uses `ctx.fs` for resolution, containment, regular-file checks and bounded text reads, and `ctx.subprocess` for literal-path, read-only Git commands with external diff, text conversion and filesystem-monitor hooks disabled. Worktree and staged requests never fall back to one another. The Host validates a fresh Git listing before capture, reads immutable blobs by object id, and rechecks HEAD/index/file observations to reject a changing capture. Binary data (including Git-declared binary attributes/drivers), special, oversized and incomplete sources do not acquire line anchors.

The optional `fs`, `subprocess` and `storageDomain` injection owns the reader lifetime and a version-1 `dsh_annotation_diff_key` domain. Its private global signing key persists before reads become available; unload aborts and joins pending reads before closing the domain. Missing capabilities leave message annotations usable and produce an explicit Diff error. No Host package, installed sidebar, Git file or index is modified.

Both complete sides travel in the frozen source rather than a process-local snapshot cache. The Client derives display rows with `diff.structuredPatch`; expanding context never reads live files. Locate source opens that snapshot, unfolds its rows and focuses the recorded side and line. Checking a current version does not navigate or mutate the original. A unique quote/context match offers an explicit supplemental annotation; no match or multiple matches reports that the original location changed. The Host independently validates the candidate before rebinding. [Data model](data-model.md#diff-source) owns the source fields and version rules.

Diff preview uses the existing internal command transport without enqueueing a user message. The Host records preview results in standard `command/done` events; annotation opinions remain local until submission. Only the selected batch enters the model-visible `user/message`, including the frozen sources needed for replay. [Privacy](privacy.md) describes retained code snapshots.

## Submission sequence

```mermaid
sequenceDiagram
  participant U as User
  participant C as Web Client
  participant H as Host command
  participant A as Agent inbox
  participant L as Session log
  participant M as Model

  U->>C: Select reply text or a real Diff line/range
  Note over C: Opinions and editor buffers remain browser-local
  U->>C: Save or suspend editors; resolve overlaps explicitly
  U->>C: Choose aggregate/individual batch and processing mode
  Note over C: Only selected saved annotations without unfinished edits are eligible
  U->>C: Official Enter or Send (text + annotations + attachments)
  opt New or identity-aware attachment batch
    C->>H: commands/execute /annotation_submit prepare-attachments + attachments
    H-->>C: Ordered admitted attachment identities (no message)
  end
  C->>C: Validate captured selection; freeze payload, mode, id, attachment identities
  C->>H: commands/execute /annotation_submit <base64url JSON> + attachments
  H->>H: Admit blocks; validate schema, limits, session, and frozen attachment identities
  H->>A: followup() with deterministic message id
  H-->>C: Command admitted
  A->>L: Standard user/message at claim time
  C->>C: Reconstruct authoritative queue and sent status
  L->>M: Complete annotation message + image/file blocks
  M->>L: Mode-specific result + per-annotation markers + acknowledgement
  C->>C: Process only acknowledged ids; preserve original reply labels
```

## Composer attachment claim

The Host-backed `individualSelection` setting defaults to `false`. In aggregate mode, every saved draft without an unfinished edit is eligible; the default-on `autoAttach` arms the current Session's official composer after a new save, and the header paperclip remains a manual toggle. In individual mode, no annotation is selected implicitly, `autoAttach` is ignored, and the paperclip is absent. Toggling an eligible item updates the explicit send set and arms or releases the claim as needed. Both modes use the scoped `slash/input-begin-command` event with a zero-width, non-whitespace token, so annotation-only submission uses the official Enter key and Send button.

A Host-accepted switch between aggregate and individual selection clears `selectedAnnotationIds` and `retrySubmissionId`, detaches any claim, and presents a reselect notice. It does not delete annotations, editor buffers, or outbox entries. Unfinished new editors are not saved annotations, and a saved annotation with an unfinished edit is ineligible until that edit is saved or discarded. The processing-mode selector remains independent of selection; an active retry displays and uses the mode frozen in its payload.

The claim declares the configured command `name` and `attachments: true`; `claim.submit()` receives ordered `SubmitAttachment[]` values and captures one controller snapshot for preparation. The selected annotations are renumbered contiguously inside the batch, and the payload freezes the mode, overall requirement, protocol locale, target Session, and attachment identities. Later next-batch selection or Host-setting changes do not rewrite that clicked snapshot. Before outbox creation, `createOutbox()` re-resolves every captured id against current eligible annotations and compares annotation text, quote, structure, supplemental link, and source identity; a deletion, unfinished edit, or content change aborts without replacing the newer state.

For a new attachment-bearing send, the Client invokes `/<commandName> prepare-attachments` through the existing `commands/execute` Remote. DSH admits the official attachments first; the plugin returns only their ordered stable ids, byte counts, names, and image media types, without enqueueing a message. The validated result becomes `payload.attachmentIdentities`; an attachment-free new send freezes an empty array without a preflight request. A retry preflights reselected attachments and compares them with the frozen identities. The final command independently compares the admitted blocks before queueing or deduplication. This adds one round trip to attachment-bearing sends and requires matching Host and Client plugin builds; malformed or failed preflight preserves the composer and creates no outbox. A queue confirmation during preflight prevents a second submission. Raw bytes and temporary upload receipts never enter the annotation JSON or command string.

### Slash-command release

While attached, the Client watches the composer input state (no global keyboard listeners). When the visible content — after removing the plugin's own zero-width token — starts with `/`, the plugin enters command-release state: it releases the claim and removes the token while annotations stay logically attached. Leaving command state re-arms the claim and restores the attachment. `claim.submit()` re-checks for a leading `/` to defeat the Enter race: a raced command is executed through the root `commands/execute(sessionId, line, attachments)` Remote, without creating an outbox, sending annotations, or marking them sent. A failed command keeps its text, attachments, and annotations because the Client returns an error outcome, which retains the composer draft.

## Durable representation

The Host attaches this structured annotation data to the standard user message:

```ts
{
  kind: 'user',
  annotationSubmission: AnnotationSubmissionPayload
}
```

`kind: 'user'` is intentional: every quote and annotation comes from an explicit human gesture, and DSH should treat the input with ordinary human authority. The extra field is an owned JSON value preserved by standard message cloning. It contains the exact submitted batch, so a fresh browser can rebuild timeline cards without a plugin sidecar. Replay also accepts the pre-rename `inlineComments` and `inlineAnnotations` source fields on durable messages.

The model-visible text is generated from the same payload. The overall requirement remains the user's goal and constraints, while `processingMode` selects the output form: `answer` returns separate ordered answers without merging, `rewrite` produces one coherent rewritten body that may integrate related annotations, and `modify` performs changes on the annotated target, preserves unaffected parts, and reports either the result or a concrete execution blocker. Every mode retains brief `Annotation N:` / `注解 N：` handling notes and one hidden `dsh-annotation-reply` marker per annotation. The text also carries `supplementalTo` when present and requests a final acknowledgement containing only ids actually completed under the selected mode.

## Protocol and storage compatibility

New submissions emit protocol v3 with explicit message/Diff sources and batch-level `processingMode` plus optional annotation-level `supplementalTo`. The parser accepts only `answer`, `rewrite`, or `modify`; an absent mode in old v1/v2 records defaults to `answer`, while an explicit invalid value fails. A supplemental id uses the normal nonblank bounded-id validation, cannot equal its own annotation id, and need not name an annotation in the current batch. The v1 `comment` conversion, missing `kind` inference, missing `protocolLocale` English fallback, legacy marker prefixes, and no-rewrite rule for historical messages remain unchanged.

Browser storage keeps the `dsh-annotation:v1:<session-id>` namespace and writes `storageVersion: 3`, migrating v1/v2 state without changing frozen legacy payload versions. `editorDrafts`, `selectionMode`, `selectedAnnotationIds`, `processingMode`, and `retrySubmissionId` are optional additions; absent values recover as no suspended buffers, aggregate selection, no selected ids, `answer`, and the legacy retry fallback. A new persisted snapshot writes an explicit retry id or `null`, so no current pending record becomes active merely because it is first in the outbox. Legacy storage namespaces, Host settings, and internal command names retain their existing migration paths.

## Idempotency

The stable inbox/message id is `dsh-inline-annotations:<submissionId>` for both current and migrated outbox records. This durable protocol namespace preserves retry identity across package-name changes. Before admission, the Host synchronously checks:

1. `agent.inbox.nextTurn`;
2. `agent.inbox.nextStep`;
3. logged `user/message` events.

A match returns success without another enqueue, so the Host keeps only the first successful result per submission id. This is plugin-owned idempotency; DSH's generic prompt path does not provide an idempotency key. The Client freezes the selected annotations, their contiguous batch ordinals, processing mode, overall requirement, locale, target Session, and ordered attachment metadata on the first attempt. Retry reuses that payload and submission id rather than adopting the current selection or mode. A selected `ready` or `failed` record may send; `queued`, `accepted`, or `sent` authority makes a stale retry action a no-op, while `withdrawn` aborts it.

An item observed in the Inbox projection's `next-turn` entries may be withdrawn through `SessionFace.updateQueue(messageId, { kind: 'remove' })`; the entry's `id` is the stable message id. `next-step` entries are not withdrawable. An `undefined` projection is unsynchronized and establishes neither admission nor departure. Withdrawal returns only that batch's annotations to editable drafts. Direct discard applies only to a failed/ready record that queue authority has never established; queued and sent authority cannot be downgraded by a stale retry, discard, or transport failure. A durable payload restores its original annotation id, status, fields, and ordinal instead of inheriting later browser-local state. This also applies when durable history arrives after an ambiguous failed record was discarded. A changed saved draft is preserved under a new id linked to the restored annotation; an unfinished edit becomes an independent new supplemental buffer. Both preserved values remain unselected by default. Sent history is immutable.

## Client state owner

One `AnnotationController` exists per Session encountered by the Client plugin. The controller is an identity-stable observable supplied through the Slot `inject.hooks` compartment. Components receive the framework-bound `useAnnotations` selector hook and plain action callbacks; they do not subscribe manually or receive `ctx`.

The controller combines three sources:

- browser-local `PersistedSessionState` for saved annotations, active and suspended editor buffers, selection and processing state, and immutable outbox records;
- the independently subscribed `session.projections.faceOf('inbox')` snapshot for authoritative `next-turn` placement, mapping each `id` to the controller's `messageId` and preserving `undefined` as unsynchronized;
- replayed nodes from the Chat conversation target for sent submissions and model acknowledgements.

Durable state changes publish one frozen snapshot and write persisted fields immediately. Editor keystrokes publish immediately and coalesce `localStorage` writes behind a 400 ms timer. Each editor buffer has a stable key: `edit:<annotationId>` for an unfinished change and `new:<draftId>` for an unfinished annotation. Outside clicks and Escape suspend the active editor without consuming the action, and another editor can open while the prior buffer remains recoverable. Saving consumes only that buffer; explicit discard removes only the unfinished buffer and never deletes a previously saved annotation. A storage failure leaves the in-memory snapshot usable and presents a warning.

The composer compares live outbox snapshots only after its initial baseline. A confirmed queue transition shows an official queued Toast and keeps withdrawal available, a durable transition shows sent and removes withdrawal, and a failed transition presents the retained batch for retry. Internal ids remain inside expandable diagnostics. Reloaded recovery state does not replay stale Toasts.

## Selection anchoring

A selector stores:

- finalized assistant `messageId` and event `seq`;
- rendered-text half-open offsets `[start, end)`;
- exact text plus 32-character prefix and suffix;
- optional code language/line range or table row/column range.

Offsets are relative to selectable text nodes inside the decorated assistant body. Markdown file-link button labels are included in capture and restoration; other buttons, scripts, styles, `aria-hidden` content, live regions, status text, Think content, and plugin controls are excluded. Link recognition depends on the exact-version DOM described in [Compatibility](compatibility.md#high-risk-integration-points). The assistant message id is the reply version identity; highlights are never transferred silently to another reply version.

When a new capture overlaps one or more annotations, the controller suspends the active editor and waits for an explicit choice. Choosing New annotation preserves existing buffers and opens an independent draft. Choosing a draft target with no unfinished edit opens supplement mode: new text appends to the saved annotation, and a changed range shows both quotes before replacing the saved selector. If that target already owns an unfinished edit buffer, the controller resumes the old buffer with a finish-or-discard notice and does not merge the new capture. Choosing a queued, sent, or processed target creates a separate draft with `supplementalTo`; frozen history is never edited.

Mounted messages rebuild `Range` objects from offsets. If the rendered offsets no longer contain the exact quote, the Client relocates the exact text by prefix, suffix, and distance within the same immutable message id. Navigation first uses the mounted endpoint, then loads older history pages up to `locateHistoryPages`. A source endpoint calls the injected `turnProcess.setOpen(true)` before measurement only when an ancestor is actually hidden by the Turn process; an already-visible final answer is not expanded merely because `turnProcess.open` is false. The endpoint centers the complete quote bounds in the nearest vertical scroll container or the window viewport and converts visual distance through the measured CSS scale. Reduced-motion preference changes smooth scrolling to immediate scrolling. Positioned DOM spans cover each visible quote rectangle and fade before local cleanup; every navigation carries a monotonic Session epoch, so a newer or asynchronously resumed request cancels stale overlays across messages. Navigation never sets or clears the global active Custom Highlight, which remains owned by persistent marker and editor state. CSS Custom Highlights aggregate mounted persistent ranges under one plugin-owned manager; numbered buttons remain the fallback.

Markers use existing safe space after the complete selectable-text line containing the restored range endpoint; the assistant body reserves no gutter and its padding stays unchanged. One button represents each visual line: a single annotation shows its ordinal, and multiple annotations show ×N with members ordered by ordinal. Annotations without a restored range or safe marker space remain accessible from the Dock. Highlights stay faint, with stronger emphasis only for the active annotation; hovering or clicking ordinary body text does not open an annotation preview. Resize observation, viewport events, reasoning disclosure toggles, and font-loading completion schedule at most one measurement per animation frame.

## Reply chips

The Client parses raw assistant text blocks for `dsh-annotation-reply` markers. Only markers whose `submissionId` + `annotationId` pair exists among the current Session's submitted annotations are used; unknown, duplicate, forged, and malformed markers are ignored. Each marker window begins and ends at a displayed-text offset computed by running the same marker removal, blank-line collapse, and edge normalization over the corresponding raw prefix. This keeps later windows aligned after normalized whitespace and supports repeated ordinals from multiple submission batches. The Client considers every localized complete heading in a window, chooses the earliest heading only when that exact heading occurs once, and leaves the marker plain when that earliest heading text is duplicated instead of substituting a later translation or citation. The original label stays visible and is neither copied nor covered: a transparent, keyboard-focusable target uses its exact measured text bounds, while pointer hit testing leaves drag selection and copying intact. `MutationObserver` and `ResizeObserver` keep measurements current. Hovering the label for 300 ms or focusing it from the keyboard shows the annotation number, quote, and annotation summary; activating it calls source navigation rather than opening the annotation editor. Wrapped or otherwise unmeasurable labels, and malformed model output, remain plain text. Reply markers never mutate business state — only the acknowledgement marker updates the processed status.

## Feature setting lifecycle

The Host registers `enabled`, `autoAttach`, `individualSelection`, and `compactSummary` under `dsh-annotation`. The first, second, and fourth default to `true`; `individualSelection` and every [transcript visibility field](../README.en.md#transcript-visibility) default to `false`. The Client binds that namespace through `ctx.settingsScope` and registers a dedicated `settings.section`. Form edits remain staged until Save is confirmed by the Host; Reset removes the selected user-layer field. Identity-stable projections expose accepted values, and `individualSelection` stays nullable until the Host snapshot is ready so a temporary default cannot clear Session choices. An accepted selection-mode change resets current send intent conservatively without modifying outbox. The pre-0.1.3 enabled migration and contribution lifecycles retain their existing behavior.

The Dock reads the boolean `compactSummary` through the framework-bound `useCompactSummary` selector hook. Its collapsed compact summary aligns right, sizes to content, and omits the leading icon while retaining attachment and expansion controls. Turning the setting off and saving restores the full-width bar and leading icon. `panelVisible` combines the explicit list state with an inline editor, and the shell exposes it through `data-panel-open`. While visible, the upward list and bottom summary body share the same 560 px readable width capped by the composer, overlap at one border pixel, and use complementary outer corner radii; the summary body sits above the panel shadow and its main control grows so actions stay right-aligned. Full-width mode uses the same connected seam and open-state corners. The attached-count overview renders only while collapsed. One persistent chevron wrapper rotates with the open state, the panel reveals with opacity and a small upward translation from a bottom-right transform origin, and reduced motion disables both transitions. Escape closes a list without an editor and restores focus to the persistent summary trigger. Switching layout does not change annotations, delivery state, or the active editor.

The Dock has no local-storage usage display, recovery export/download, or bulk-clear footer. Local autosave and recovery retain existing data, and individual draft deletion retains Undo. Stored `localTools` user overrides are ignored without deletion or migration.

Disabling the feature removes any armed zero-width composer claim while retaining visible draft text, disposes every conversation renderer, dock, action, and command-view registration, and clears CSS Custom Highlights. Controllers, local drafts, editor recovery state, outbox entries, and durable-history reconstruction stay alive. Enabling the feature installs the same contribution group again and reuses the existing controllers. When disable lands while the official composer is submitting, the claim cannot be consumed yet; the Client subscribes to that input and releases the claim as soon as the phase leaves `submitting`, cancelling the subscription if the feature is re-enabled first.

## Marketplace update lifecycle

The plugin owns a separate `MarketUpdateController` for its configuration form. A user-triggered check first requests `/dsh-market/api/v1/capabilities`, requires schema `dsh-market/update-api/v1`, and validates every advertised endpoint as a same-origin `/dsh-market/api/v1/*` path. No update control becomes active before discovery. The Client then checks only `dsh-annotation`, starts one operation, and polls its operation id until dsh-market reports a terminal state. Package source selection, release-age policy, installation, activation, rollback recovery, and process ownership remain dsh-market responsibilities.

The controller projects installed and latest versions, progress, bounded failure text, rollback availability, refresh need, and restart need into an identity-stable snapshot store. Force becomes available only for `RELEASE_TOO_FRESH` and `VERSION_UNCHANGED`. Rollback is operation-scoped. Host restart is visible only when capability discovery reports both the restart feature and a supported restart owner; otherwise the card names the external lifecycle owner. When discovery fails, the card directs the user to Plugin Market and calls no legacy route. Plugin disposal aborts fetch and polling work before the Client fiber settles.

## Slot composition

DSH currently has no additive slot inside `AssistantMarkdown`. The Client therefore uses two composition mechanisms:

| Slot cell                               | Mechanism                | Reason                                                                                 |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `conversation.chat.node:assistant-step` | In-place entry decorator | Keep the selected assistant renderer and add selection, highlights, chips, and markers |
| `conversation.chat.node:user`           | Priority `-100` shadow   | Fold annotation submissions while preserving normal user messages                      |
| `conversation.chat.node:steering`       | Priority `-100` shadow   | Fold annotation batches admitted during a running task                                 |

The assistant integration reads the Slot ledger through `ctx.slots.entries()`, wraps each existing `assistant-step` component, and composes its `inject` result rather than registering another keyed occupant. The original renderer remains responsible for Markdown, Think, images, streaming, interruption state, and any renderer-specific behavior. The outer annotation layer owns selection roots, the action bar, highlights, reply chips, and quote markers. It rebuilds ranges and geometry when the inner renderer changes its DOM. A `slots/changed` listener handles assistant entries added later; disable and unload restore each component and inject factory when they are still owned by this decorator. Because the plugin adds no `assistant-step` occupant and no keyed slot, it composes with dsh-smooth-stream.

Transcript visibility projects display copies of Chat nodes without editing the shared Chat snapshot. Its turn cache observes `locations.getTurn()` identities, which change on content updates as well as membership changes; it counts actual recursive tool-call roots, not the assistant's protocol tool heads. `hideTools` hides every tool for stored-setting compatibility; named fields map `read` / `read_image`, `glob`, `grep`, `bash` / `pwsh`, `edit`, `write`, and all unmatched names independently. A visible root is cloned only when selected descendants must be removed; a selected root hides its complete subtree because the renderer cannot promote several children into root cards. Hidden details are unmounted, and the single turn summary sits outside the annotation selection root. A private marker collapses each fully hidden keyed Chat row because the Host Slot outlet remains mounted with `display: contents`; hidden rows therefore contribute neither height nor flow gaps. Human attachment and annotation summaries stay local to their message. New unknown extension kinds remain visible.

The visibility source and a constant Normal-mode source reach all decorated entries through `slots.provideRoot`, avoiding existing entry-inject caches. The selected `conversation.view:chat` renderer receives the framework-bound Normal hook while any hide switch is active and its original mode hook otherwise; no Chat preference is persisted or restored from a stale copy. Non-assistant decorators keep each entry's inject, store, and child-slot declarations. Teardown restores decorators before withdrawing root sources. Interactive composer takeovers are not decorated.

Lower priority wins in DSH keyed slots. The user and steering replacements use public `projectUserText` with the Host's reference labels and skill names and the owner's `openFile` and `openSkill` callbacks, including annotation submission requirements. Attachments use the official image renderer and file name/size cards with `FileTypeIcon`. Additive entries are used where available:

- `conversation.input.dock` for the grouped task-style annotation list, the header attachment toggle, and the compact selection-positioned editor;
- `conversation.chat.assistant-actions` for a keyboard-accessible whole-reply annotation action;
- `conversation.chat.commandview:<commandName>` to suppress the transport command's redundant timeline card. Registrations under both pre-rename command names keep durable rows recorded by earlier versions out of the visible timeline;
- `settings.section:dsh-annotation` for the dedicated main-Settings page containing Host-backed annotation and transcript-visibility preferences plus the optional public dsh-market update flow. This registers neither an Official `plugins.item` entry, a built-in `settings.plugins.tab`, nor a Market Slot and requires no Host-side Market dependency.

Conversation registrations also dispose when the enabled preference is off. Every registration, locale dictionary, style element, controller, subscription, and highlight is disposed with the Cordis fiber.

## Editor input handling

Marker cards and body-anchored editors share measured viewport, visible scroll-container, and composer bounds. They prefer existing whitespace beside the reply, then space below or above the anchor; narrow screens, clipped anchors, or insufficient space use a safely bounded scrollable panel. Measurements follow scrolling, resizing, and CSS zoom, including 125% and 200%, without reserving body space. An outside pointer action or Escape suspends a changed editor before the original action continues. Unchanged edits close without a buffer. The Dock lists every suspended buffer for resume or explicit discard, and only saved annotations without unfinished edits are sendable.

Selection- and marker-anchored editors are portaled outside the composer DOM; summary-started editors stay inline. Composition key events do not reach the official input. The editor tracks `compositionstart`/`compositionend`, `event.isComposing`, `nativeEvent.isComposing`, and `keyCode === 229`. Enter during composition only confirms the candidate; the Enter produced right after `compositionend` is swallowed by a latch cleared on the next event loop; a plain Enter saves; Shift+Enter inserts a newline; Escape during composition never suspends the editor.

After a successful new-annotation save, the dock waits one microtask plus one animation frame, then returns focus to the official Lexical contenteditable through a DOM adapter scoped to the current Session's composer. It restores the previous caret only when the same editor retains unchanged visible text and the user has not moved focus elsewhere; file-reference chips remain editor-owned. Save failures, explicit discard, Session switches, and edits to existing annotations never move focus.

## Processed acknowledgement

The generated user message asks the model to append:

```html
<!-- dsh-annotation:{"submissionId":"sub-…","processed":["ann-…"]} -->
```

The prompt tells the model to list only annotations actually completed under the selected processing mode and never to acknowledge the batch automatically. The Client parses raw assistant block text and validates exact strings. It accepts the current `dsh-annotation:` marker and the legacy `dsh-inline-comments:` / `dsh-inline-annotations:` markers, then strips matching markers before Markdown rendering. Prose mentions, malformed JSON, unknown ids, elapsed time, and turn completion have no status authority.

## Archived sessions

Archived tasks have no active composer, so the paperclip stays disabled and annotations cannot be armed there. Create and attach annotations in an editable task instead.

## Security properties

- The Host validates the complete decoded payload before using it.
- The configured byte and item limits apply to the complete JSON batch.
- Session identity in the payload must equal the receiving Agent id; Diff signatures additionally bind the original Session cwd, paths, comparison and contents.
- Unsent opinions remain browser-local; Diff preview results are Host-recorded snapshots. Outbox records never store image bytes.
- The package performs no arbitrary HTML rendering and uses DSH's untrusted Markdown primitive.
- Reply markers only affect display; they cannot modify business status.
- Raw command input is excluded from `command/run`; the durable standard user message is the single model-visible record.
