# Architecture

## Scope

`dsh-annotation` is one installable Cordis row with two runtime halves:

- the **Host half** registers the `dsh-annotation` settings namespace and internal `annotation_submit` command (plus invisible legacy aliases), validates a base64url JSON payload, admits official image and file attachments, creates one standard user message, deduplicates retries, and calls `Agent.followup()`;
- the **Web Client half** owns selection capture, the selection action bar, draft persistence, the official-composer attachment claim, slash-command release, status reconstruction, reply-chip rendering, queue withdrawal, and source navigation.

The package does not add a custom durable Session event. Every model-visible batch is represented by the existing `user/message` event and therefore survives replay and persistence without extending DSH's closed reload vocabulary.

## Submission sequence

```mermaid
sequenceDiagram
  participant U as User
  participant C as Web Client
  participant H as Host command
  participant A as Agent inbox
  participant L as Session log
  participant M as Model

  U->>C: Select reply text (action bar: add or copy)
  Note over C: Selection stays alive; localStorage only
  U->>C: Save new annotation (auto-attach by default) or toggle paperclip
  Note over C: Live draft set follows edits until submit
  U->>C: Official Enter or Send (text + annotations + attachments)
  C->>C: Freeze payload + submission id + composer text + attachment metadata
  C->>H: commands/execute /annotation_submit <base64url JSON> + attachments
  H->>H: Validate size, ids, session, schema; admit image/file blocks
  H->>A: followup() with deterministic message id
  H-->>C: Command admitted
  A->>L: Standard user/message at claim time
  C->>C: Reconstruct status = sent
  L->>M: Complete annotation message + image/file blocks
  M->>L: Per-annotation reply markers + acknowledgement marker
  C->>C: Parse exact ids; status = processed; preserve original reply labels
```

## Composer attachment claim

After a new annotation is saved successfully, the Client arms the current Session's official composer by default. The Host-backed `autoAttach` setting can disable this step, and the header paperclip always remains as the manual toggle. Both paths use the scoped `slash/input-begin-command` event with a zero-width, non-whitespace claim token. The automatic path is attach-only, so saving another annotation cannot accidentally detach an already armed batch. Editing an existing draft does not re-arm the composer. The token keeps the official Send action eligible while the visible composer text is empty, so annotation-only submission needs no second send surface. The official Enter key and Send button submit the visible composer text and live annotation set through the same claim; Shift+Enter and the composer's remaining keyboard behavior are unchanged.

The claim declares the configured command `name` and `attachments: true`; its token remains zero-width. `claim.submit()` receives ordered `SubmitAttachment[]` values and forwards the Session id, internal command line, and attachments to the root `commands/execute` Remote. Attachment bytes and temporary file-upload receipts never enter the annotation JSON or command string. The Host admits attachments through the official channel and the handler appends durable image and file blocks after the annotation text in the same user message. The outbox stores only count, ordered image/file kinds, and image media types and names.

### Slash-command release

While attached, the Client watches the composer input state (no global keyboard listeners). When the visible content — after removing the plugin's own zero-width token — starts with `/`, the plugin enters command-release state: it releases the claim and removes the token while annotations stay logically attached. Leaving command state re-arms the claim and restores the attachment. `claim.submit()` re-checks for a leading `/` to defeat the Enter race: a raced command is executed through the root `commands/execute(sessionId, line, attachments)` Remote, without creating an outbox, sending annotations, or marking them sent. A failed command keeps its text, attachments, and annotations because the Client returns an error outcome, which retains the composer draft.

## Durable representation

The Host attaches this provenance to the standard user message:

```ts
{
  kind: 'user',
  annotationSubmission: AnnotationSubmissionPayload
}
```

`kind: 'user'` is intentional: every quote and annotation comes from an explicit human gesture, and DSH should treat the input with ordinary human authority. The extra field is an owned JSON value preserved by standard message cloning. It contains the exact submitted batch, so a fresh browser can rebuild timeline cards without a plugin sidecar. Replay also accepts the pre-rename `inlineComments` and `inlineAnnotations` provenance fields on durable messages.

The model-visible text is generated from the same payload. It states the overall requirement, demands per-annotation replies (each paragraph starts with `注解 N：` and must not merge annotations), lists the submission id, each annotation id, source message/version id, event sequence, complete quote, annotation, and structural coordinates, and requests one hidden `dsh-annotation-reply` association marker before each paragraph plus the final `dsh-annotation` acknowledgement marker.

## Protocol and storage compatibility

New submissions only emit protocol v2: `protocolVersion: 2`, `source: "dsh-annotation"`, and the `annotation` field. The parser still accepts v1 payloads (`comment` field, no source) and converts them into the v2 internal model. Historical messages are never rewritten. Legacy acknowledgement and reply marker prefixes (`dsh-inline-comments:`, `dsh-inline-annotations:`) remain authoritative reads; new messages only emit `dsh-annotation-*` markers.

Browser storage uses the `dsh-annotation:v1:<session-id>` namespace. On load, the Client reads the new key first; when it is absent, it validates a legacy `dsh-inline-comments:v1:` or `dsh-inline-annotations:v1:` value, converts it, writes the new key, and only then removes the legacy keys. Legacy host-side settings namespaces migrate the same way, and the legacy internal command names forward to the new handler through invisible aliases.

## Idempotency

The stable inbox/message id is `dsh-inline-annotations:<submissionId>` for both current and migrated outbox records. This durable protocol namespace preserves retry identity across package-name changes. Before admission, the Host synchronously checks:

1. `agent.inbox.nextTurn`;
2. `agent.inbox.nextStep`;
3. logged `user/message` events.

A match returns success without another enqueue, so the Host keeps only the first successful result per submission id. This is plugin-owned idempotency; DSH's generic prompt path does not provide an idempotency key. The Client freezes the complete payload after its first attempt. A transport retry reuses both payload and submission id.

An item observed in the Inbox projection's `next-turn` entries may be withdrawn through `SessionFace.updateQueue(messageId, { kind: 'remove' })`; the entry's `id` is the stable message id. `next-step` entries are not part of this withdrawable queue. An `undefined` projection is unsynchronized and does not establish queue admission or departure. Withdrawal returns its annotations to editable drafts. A never-queued failed/ready record can be discarded directly, which also returns its annotations to drafts. A successful command response remains internally `accepted` until queue or durable Chat history confirms its actual placement. When a target snapshot stops listing an observed queue item before its durable message appears, its outbox returns to `accepted` so withdrawal disappears during the claim-to-history window. Sent history is immutable; later clarification creates a new annotation with `supplementalTo`.

## Client state owner

One `AnnotationController` exists per Session encountered by the Client plugin. The controller is an identity-stable observable supplied through the Slot `inject.hooks` compartment. Components receive the framework-bound `useAnnotations` selector hook and plain action callbacks; they do not subscribe manually or receive `ctx`.

The controller combines three sources:

- browser-local `PersistedSessionState` for drafts and immutable outbox records;
- the independently subscribed `session.projections.faceOf('inbox')` snapshot for authoritative `next-turn` placement, mapping each `id` to the controller's `messageId` and preserving `undefined` as unsynchronized;
- replayed nodes from the Chat conversation target for sent submissions and model acknowledgements.

Durable state changes publish one frozen snapshot and write the persisted fields immediately. Editor keystrokes publish immediately and coalesce `localStorage` writes behind a 400 ms timer; another durable change or Session-controller disposal flushes the same editor state first. A storage failure leaves the in-memory snapshot usable and presents a warning.

The composer compares live outbox snapshots only after its initial baseline. A confirmed queue transition shows an official queued Toast and keeps withdrawal available, a durable transition shows sent and removes withdrawal, and a failed transition names the immutable submission id for retry. Reloaded recovery state does not replay stale Toasts.

## Selection anchoring

A selector stores:

- finalized assistant `messageId` and event `seq`;
- rendered-text half-open offsets `[start, end)`;
- exact text plus 32-character prefix and suffix;
- optional code language/line range or table row/column range.

Offsets are relative to selectable text nodes inside the decorated assistant body. Markdown file-link button labels are included in capture and restoration; other buttons, scripts, styles, `aria-hidden` content, live regions, status text, Think content, and plugin controls are excluded. Link recognition depends on the exact-version DOM described in [Compatibility](compatibility.md#high-risk-integration-points). The assistant message id is the reply version identity; highlights are never transferred silently to another reply version.

Mounted messages rebuild `Range` objects from offsets. If the rendered offsets no longer contain the exact quote, the Client relocates the exact text by prefix, suffix, and distance within the same immutable message id. Navigation first uses the mounted endpoint, then loads older history pages up to `locateHistoryPages`. A source endpoint calls the injected `turnProcess.setOpen(true)` before measurement only when an ancestor is actually hidden by the Turn process; an already-visible final answer is not expanded merely because `turnProcess.open` is false. The endpoint centers the complete quote bounds in the nearest vertical scroll container or the window viewport and converts visual distance through the measured CSS scale. Reduced-motion preference changes smooth scrolling to immediate scrolling. Positioned DOM spans cover each visible quote rectangle and fade before local cleanup; every navigation carries a monotonic Session epoch, so a newer or asynchronously resumed request cancels stale overlays across messages. Navigation never sets or clears the global active Custom Highlight, which remains owned by persistent marker and editor state. CSS Custom Highlights aggregate mounted persistent ranges under one plugin-owned manager; numbered buttons remain the fallback.

Markers use existing safe space after the complete selectable-text line containing the restored range endpoint; the assistant body reserves no gutter and its padding stays unchanged. One button represents each visual line: a single annotation shows its ordinal, and multiple annotations show ×N with members ordered by ordinal. Annotations without a restored range or safe marker space remain accessible from the Dock. Highlights stay faint, with stronger emphasis only for the active annotation; hovering or clicking ordinary body text does not open an annotation preview. Resize observation, viewport events, reasoning disclosure toggles, and font-loading completion schedule at most one measurement per animation frame.

## Reply chips

The Client parses raw assistant text blocks for `dsh-annotation-reply` markers. Only markers whose `submissionId` + `annotationId` pair exists among the current Session's submitted annotations are used; unknown, duplicate, forged, and malformed markers are ignored. Each marker window begins and ends at a displayed-text offset computed by running the same marker removal, blank-line collapse, and edge normalization over the corresponding raw prefix. This keeps later windows aligned after normalized whitespace and supports repeated ordinals from multiple submission batches. The Client considers every localized complete heading in a window, chooses the earliest heading only when that exact heading occurs once, and leaves the marker plain when that earliest heading text is duplicated instead of substituting a later translation or citation. The original label stays visible and is neither copied nor covered: a transparent, keyboard-focusable target uses its exact measured text bounds, while pointer hit testing leaves drag selection and copying intact. `MutationObserver` and `ResizeObserver` keep measurements current. Hovering the label for 300 ms or focusing it from the keyboard shows the annotation number, quote, and annotation summary; activating it calls source navigation rather than opening the annotation editor. Wrapped or otherwise unmeasurable labels, and malformed model output, remain plain text. Reply markers never mutate business state — only the acknowledgement marker updates the processed status.

## Feature setting lifecycle

The Host registers a `dsh-annotation` settings namespace with three annotation fields, `enabled`, `autoAttach`, and `compactSummary`, defaulting to `true`, plus the [transcript visibility fields](../README.en.md#transcript-visibility), all defaulting to `false`. The Client binds that namespace through `ctx.settingsScope` and registers a dedicated `settings.section` with id `dsh-annotation`. The main Settings shell owns navigation and renders the complete annotation form. Form edits are staged until Save writes the Host settings provider; Reset removes the selected user-layer field so the schema default applies again. Identity-stable `SnapshotStore<boolean>` projections expose Host-accepted values to the feature lifecycle, new-annotation save path, and compact summary through framework-bound hooks; during the one-time pre-0.1.3 migration, the enabled projection preserves a valid browser preference until the Host accepts it. The settings and per-Session controllers remain alive for the plugin fiber, while the Settings section and conversation-facing Slot registrations form independently disposable groups.

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

Marker cards and body-anchored editors share measured viewport, visible scroll-container, and composer bounds. They prefer existing whitespace beside the reply, then space below or above the anchor; narrow screens, clipped anchors, or insufficient space use a safely bounded scrollable panel. Measurements follow scrolling, resizing, and CSS zoom, including 125% and 200%, without reserving body space. Dirty editors still require Cancel or Save before dismissal; autosaving unfinished text does not permit collapsing them without that decision.

Selection- and marker-anchored editors are portaled outside the composer DOM; summary-started editors stay inline. Composition key events do not reach the official input. The editor tracks `compositionstart`/`compositionend`, `event.isComposing`, `nativeEvent.isComposing`, and `keyCode === 229`. Enter during composition only confirms the candidate; the Enter produced right after `compositionend` is swallowed by a latch cleared on the next event loop; a plain Enter saves; Shift+Enter inserts a newline; Escape during composition never closes the editor.

After a successful new-annotation save, the dock waits one microtask plus one animation frame, then returns focus to the official Lexical contenteditable through a DOM adapter scoped to the current Session's composer. It restores the previous caret only when the same editor retains unchanged visible text and the user has not moved focus elsewhere; file-reference chips remain editor-owned. Save failures, cancellation, Session switches, and edits to existing annotations never move focus.

## Processed acknowledgement

The generated user message asks the model to append:

```html
<!-- dsh-annotation:{"submissionId":"sub-…","processed":["ann-…"]} -->
```

The Client parses raw assistant block text and validates exact strings. It accepts the current `dsh-annotation:` marker and the legacy `dsh-inline-comments:` / `dsh-inline-annotations:` markers, then strips matching markers before Markdown rendering. Prose mentions, malformed JSON, unknown ids, elapsed time, and turn completion have no status authority.

## Archived sessions

Archived tasks have no active composer, so the paperclip stays disabled and annotations cannot be armed there. Create and attach annotations in an editable task instead.

## Security properties

- The Host validates the complete decoded payload before using it.
- The configured byte and item limits apply to the complete JSON batch.
- Session identity in the payload must equal the receiving Agent id.
- Unsent data never crosses the browser boundary; outbox records never store image bytes.
- The package performs no arbitrary HTML rendering and uses DSH's untrusted Markdown primitive.
- Reply markers only affect display; they cannot modify business status.
- Raw command input is excluded from `command/run`; the durable standard user message is the single model-visible record.
