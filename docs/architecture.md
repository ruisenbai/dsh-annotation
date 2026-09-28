# Architecture

## Scope

`dsh-annotation` is one installable Cordis row with two runtime halves:

- the **Host half** registers the `dsh-annotation` settings namespace and internal `annotation_submit` command (plus invisible legacy aliases), validates a base64url JSON payload and rejects new Diff sources, admits official image and file attachments, creates one standard user message, deduplicates retries, and calls `Agent.followup()`;
- the **Web Client half** owns message selection, independent annotation records, editor buffers, the selected send set, the official composer claim, immutable retries, status reconstruction, reply chips, queue withdrawal, and source navigation.

The package does not add a custom durable Session event. Every model-visible batch is represented by the existing `user/message` event and therefore survives replay and persistence without extending DSH's closed reload vocabulary.

## Historical Diff records

The earlier Code Diff annotation feature has no entry point, Git reader, preview command, or Host signing service. The current Client creates and sends message-source annotations only. Existing Diff sources in durable Session messages and browser storage remain parseable so historical text, file positions, and diagnostic snapshots can be read without accessing the current repository. Older Diff drafts, editor buffers, and failed batches are retained as read-only data; they cannot be edited, selected, located in the current file, deleted from the record, or retried. [Data model](data-model.md#historical-diff-source) owns the retained fields.

## Submission sequence

```mermaid
sequenceDiagram
  participant U as User
  participant C as Web Client
  participant H as Host command
  participant A as Agent inbox
  participant L as Session log
  participant M as Model

  U->>C: Select reply text
  U->>C: Save an annotation; attach records with paperclips
  U->>C: Send through the official composer
  C->>H: Prepare ordered official attachments when present
  H-->>C: Admitted attachment identities
  C->>C: Validate the selected set and freeze the payload
  C->>H: commands/execute /annotation_submit + attachments
  H->>A: followup() with a deterministic message id
  A->>L: Standard user/message
  L->>M: Composer text, selected annotations, and attachments
  M->>L: Reply markers and completed-id acknowledgement
  C->>C: Reconstruct queued, sent, and processed status
```

## Composer attachment claim

Each newly saved annotation enters `selectedAnnotationIds` and, when `autoAttach` is enabled, arms the official composer. A record row's paperclip selects or deselects one draft or historical sent annotation. Selecting a sent annotation uses its original ID in the next payload; it does not create another record. A manual detach remains detached until the user reattaches or saves another annotation. A new conversation has no record or empty-state copy; the record closes automatically when all annotations have sent status and none is selected. The rounded composer chip counts only annotations in the next batch, shares the official add-file button's left inset, and previews their source and note. Its detach control appears on hover or keyboard focus. Its first click opens the expanded record; later clicks toggle the row list without hiding the record. The model-side button hides or shows the whole record. Pending records use a static status dot; locating source text preserves the record's visibility and expansion state.

The claim declares the configured command `name` and `attachments: true`; `claim.submit()` receives ordered `SubmitAttachment[]` values and captures one controller snapshot for preparation. The selected annotations receive contiguous batch ordinals, and new payloads use `processingMode: answer`. A retry retains its original mode, text, selected records, locale, target Session, and attachment identities. Before creating a new outbox record, the controller rechecks every captured annotation against live content so deletion or an unfinished edit cannot submit stale text.

For a new attachment-bearing send, the Client invokes `/<commandName> prepare-attachments` through the existing `commands/execute` Remote. DSH admits the official attachments first; the plugin returns only ordered stable ids, byte counts, names, and image media types. A retry compares reselected attachments with the frozen identities. The final command independently verifies admitted blocks. Raw bytes and temporary upload receipts never enter the annotation JSON or command string.

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

The model-visible text is generated from the same payload. The overall requirement remains the user's goal and constraints, with `processingMode: answer` for new submissions; historical `rewrite` and `modify` payloads retain their frozen model instructions on retry. The protocol retains brief `Annotation N:` / `注解 N：` handling notes and one hidden `dsh-annotation-reply` marker per annotation. The text also carries `supplementalTo` when present and requests a final acknowledgement containing only ids actually completed under the selected mode.

The shadow user-message renderer places a compact comment count above the ordinary message body. One comment previews its quote and note on hover and navigates to a message source on double-click. A multi-comment count toggles a list of source quotes and notes with per-row map-pin navigation. Historical Diff sources remain readable in that list without a navigation action. The renderer does not expose diagnostic details. The annotation record uses the Host task panel's translucent menu token, backdrop filter, and panel shadow without a texture layer; other plugin-owned translucent overlays add a fine grain.

## Protocol and storage compatibility

New submissions emit protocol v3 with explicit message sources and batch-level `processingMode` plus optional annotation-level `supplementalTo`. The parser accepts only `answer`, `rewrite`, or `modify`; an absent mode in old v1/v2 records defaults to `answer`, while an explicit invalid value fails. A supplemental id uses the normal nonblank bounded-id validation, cannot equal its own annotation id, and need not name an annotation in the current batch. The v1 `comment` conversion, missing `kind` inference, missing `protocolLocale` English fallback, legacy marker prefixes, and no-rewrite rule for historical messages remain unchanged.

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

The composer compares live outbox snapshots only after its initial baseline. A confirmed queue transition shows an official queued Toast and keeps withdrawal available, a durable transition shows sent and removes withdrawal, and a failed transition presents the retained batch for retry. Internal ids are not shown in sent-message UI. Reloaded recovery state does not replay stale Toasts.

## Selection anchoring

A message selector stores the finalized assistant message id and sequence, half-open rendered-text offsets, the exact quote, and its prefix and suffix. Code and table selectors retain their structural coordinates. Capture excludes hidden content and plugin controls; the restored range belongs only to the same assistant message. Selecting an overlapping range directly opens a new independent editor while preserving an unfinished editor buffer.

Mounted messages rebuild `Range` objects from offsets. If the quote moved within the same immutable message, the Client uses exact text, context, and distance to relocate it. Navigation loads older pages when necessary, expands a genuinely hidden Turn process, centers the quote, and displays a brief local highlight. CSS Custom Highlights are transparent at rest and color only an active quote; the manager maintains active ranges per message.

Each mounted reply shares one text-node and offset index across its annotations and reply chips. Text or DOM changes invalidate that index; replacing the message body, changing the message identity, and unmounting release its node references. Scroll, viewport, and font geometry changes remeasure positions against the current index. Changing the active quote updates the active CSS highlight without rebuilding the unchanged base highlight.

A number bubble measures the last non-whitespace character of the restored selection and sits at its upper right, with its tail pointing toward the lower left. Marker measurement intersects the viewport and scroll-container bounds, so a bubble disappears as its source scrolls away. A visible bubble can represent multiple annotations on one line. Hovering or clicking it highlights the quote; clicking opens a content-sized card positioned beside, below, or above the quote without covering it. A record row remains the fallback when no bubble fits. Resizing, scrolling, font loading, and Turn disclosure trigger remeasurement.

## Reply chips

The Client parses raw assistant text blocks for `dsh-annotation-reply` markers. Only markers whose `submissionId` + `annotationId` pair exists among the current Session's submitted annotations are used; unknown, duplicate, forged, and malformed markers are ignored. A resend reuses the annotation ID with a new submission ID; the Client recognizes both pairs from durable submissions or confirmed local outbox entries without duplicating the annotation record. Each marker window begins and ends at a displayed-text offset computed by running the same marker removal, blank-line collapse, and edge normalization over the corresponding raw prefix. This keeps later windows aligned after normalized whitespace and supports repeated ordinals from multiple submission batches. The Client considers every localized complete heading in a window, chooses the earliest heading only when that exact heading occurs once, and leaves the marker plain when that earliest heading text is duplicated instead of substituting a later translation or citation. The original label stays visible and is neither copied nor covered: a transparent, keyboard-focusable target uses its exact measured text bounds, while pointer hit testing leaves drag selection and copying intact. `MutationObserver` and `ResizeObserver` keep measurements current. Hovering the label for 300 ms or focusing it from the keyboard shows the annotation number, quote, and annotation summary; activating it calls source navigation rather than opening the annotation editor. Wrapped or otherwise unmeasurable labels, and malformed model output, remain plain text. Reply markers never mutate business state — only the acknowledgement marker updates the processed status.

## Feature setting lifecycle

The main Settings card exposes `enabled` and `autoAttach`; the optional dsh-market controls manage plugin updates. Historical individual-selection, compact-summary, and transcript-visibility preferences remain readable in stored settings but have no controls in the active annotation UI. The private `archivedPreferencesImported` marker prevents archived preferences from being imported repeatedly. [Compatibility](compatibility.md#main-settings-integration) describes the retained settings data.

Disabling the feature removes an armed composer claim while retaining visible draft text and disposes conversation registrations and CSS Custom Highlights. Controllers, local drafts, editor buffers, outbox entries, and durable-history reconstruction remain available. When disable lands during official composer submission, release waits for the input phase to leave `submitting`.

## Marketplace update lifecycle

The plugin owns a separate `MarketUpdateController` for its configuration form. A user-triggered check first requests `/dsh-market/api/v1/capabilities`, requires schema `dsh-market/update-api/v1`, and validates every advertised endpoint as a same-origin `/dsh-market/api/v1/*` path. No update control becomes active before discovery. The Client then checks only `dsh-annotation`, starts one operation, and polls its operation id until dsh-market reports a terminal state. Package source selection, release-age policy, installation, activation, rollback recovery, and process ownership remain dsh-market responsibilities.

The controller projects installed and latest versions, progress, bounded failure text, rollback availability, refresh need, and restart need into an identity-stable snapshot store. Force becomes available only for `RELEASE_TOO_FRESH` and `VERSION_UNCHANGED`. Rollback is operation-scoped. Host restart is visible only when capability discovery reports both the restart feature and a supported restart owner; otherwise the card names the external lifecycle owner. When discovery fails, the card directs the user to Plugin Market and calls no legacy route. Plugin disposal aborts fetch and polling work before the Client fiber settles.

## Slot composition

DSH has no additive slot inside `AssistantMarkdown`. The Client decorates the existing `assistant-step` renderer in place, composes its injected props, and passes the Host-rendered element into an annotation-only wrapper. The Host renderer owns Markdown, reasoning, tools, images, streaming, and interruption presentation; the wrapper has no standalone assistant-body renderer. It uses priority shadows for `user` and `steering` nodes so annotation submissions can show their history alongside ordinary message content. The decorator removes annotation protocol markers from display; it does not filter unrelated transcript content. A `slots/changed` listener decorates later assistant entries, and disposal restores owned entries.

`conversation.input.dock` renders the downward annotation record and source-anchored editor. The record follows the official task strip width, padding, typography, chevron, status glyphs, translucent background, blur, and shadow; `conversation.input.right` adds the record toggle before model selection; `conversation.input.overlay` adds the attached-count chip. `conversation.chat.assistant-actions` offers a whole-reply annotation entry, `conversation.chat.commandview` hides only the redundant annotation transport command row, and `settings.section:dsh-annotation` renders plugin settings and optional Market updates. Registrations, locale strings, styles, controllers, subscriptions, and highlights belong to the plugin fiber and dispose with it.

## Editor input handling

New annotations use a compact input bar with a check button. A blank note is valid. Enter saves, Shift+Enter inserts a newline, and Escape suspends an unfinished editor. An outside click shakes the new editor; the third outside click or input in the official composer saves it. Draft bubble cards use the same source-anchored placement, with a trash button for deletion. The new editor and draft and sent bubble cards share a 392-pixel responsive width, fixed corners, and a textarea that starts at one line, grows with visual wrapping up to seven lines, and then scrolls with the Host scrollbar. The field cannot be manually resized; limited room reduces its visible height while preserving the action buttons. A sent bubble opens a read-only card with a paperclip for attaching it again.

Floating cards measure the selected range, the visible scroll container, the viewport, and the composer. Editors and bubble cards prefer ten pixels below the final non-whitespace selected character, then above; reply previews continue to use the reply gutter first. A bounded panel uses the remaining area when the card does not fit. The active text stays visible. The new editor restores the official composer focus and caret after a successful save only if that input remains the active unchanged target.

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
- Session identity in the payload must equal the receiving Agent id; new Diff submissions are rejected.
- Unsent opinions remain browser-local; old Diff snapshots in persisted history are preserved. Outbox records never store image bytes.
- The package performs no arbitrary HTML rendering and uses DSH's untrusted Markdown primitive.
- Reply markers only affect display; they cannot modify business status.
- Raw command input is excluded from `command/run`; the durable standard user message is the single model-visible record.
