# Architecture

## Scope

`dsh-annotation` is one installable Cordis row with two runtime halves:

- the **Host half** registers the `dsh-annotation` settings namespace and internal `annotation_submit` command (plus invisible legacy aliases), validates a base64url JSON payload, admits official image attachments, creates one standard user message, deduplicates retries, and calls `Agent.followup()`;
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
  U->>C: Official Enter or Send (text + annotations + images)
  C->>C: Freeze payload + submission id + composer text + image metadata
  C->>H: commands/execute /annotation_submit <base64url JSON> + images
  H->>H: Validate size, ids, session, schema; admit image blocks
  H->>A: followup() with deterministic message id
  H-->>C: Command admitted
  A->>L: Standard user/message at claim time
  C->>C: Reconstruct status = sent
  L->>M: Complete annotation message + image blocks
  M->>L: Per-annotation reply markers + acknowledgement marker
  C->>C: Parse exact ids; status = processed; chips overlay "注解 N"
```

## Composer attachment claim

After a new annotation is saved successfully, the Client arms the current Session's official composer by default. The Host-backed `autoAttach` setting can disable this step, and the header paperclip always remains as the manual toggle. Both paths use the scoped `slash/input-begin-command` event with a zero-width, non-whitespace claim token. The automatic path is attach-only, so saving another annotation cannot accidentally detach an already armed batch. Editing an existing draft does not re-arm the composer. The token keeps the official Send action eligible while the visible composer text is empty, so annotation-only submission needs no second send surface. The official Enter key and Send button submit the visible composer text and live annotation set through the same claim; Shift+Enter and the composer's remaining keyboard behavior are unchanged.

The claim declares `CommandClaim.images = true`, so composer images ride standard command attachments. `claim.submit()` receives the serialized `SubmitImageAttachment[]` and forwards the Session id, internal command line, and images to the root `commands/execute` Remote. Base64 bytes never enter the annotation JSON or the command string; the Host admits them through the official attachment channel and the handler receives durable `ImageBlock`s, which it appends after the annotation text in the single user message. The outbox entry records only image count, media types, and display names.

### Slash-command release

While attached, the Client watches the composer input state (no global keyboard listeners). When the visible content — after removing the plugin's own zero-width token — starts with `/`, the plugin enters command-release state: it releases the claim and removes the token while annotations stay logically attached. Leaving command state re-arms the claim and restores the attachment. `claim.submit()` re-checks for a leading `/` to defeat the Enter race: a raced command is executed through the root `commands/execute(sessionId, line, images)` Remote, without creating an outbox, sending annotations, or marking them sent. A failed command keeps its text, images, and annotations because the Client returns an error outcome, which retains the composer draft.

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

An item observed in `SessionSnapshot.queue` may be withdrawn through `SessionFace.updateQueue(messageId, { kind: 'remove' })`. Withdrawal returns its annotations to editable drafts. A never-queued failed/ready record can be discarded directly, which also returns its annotations to drafts. A successful command response remains internally `accepted` until queue or durable Chat history confirms its actual placement. When a target snapshot stops listing an observed queue item before its durable message appears, its outbox returns to `accepted` so withdrawal disappears during the claim-to-history window. Sent history is immutable; later clarification creates a new annotation with `supplementalTo`.

## Client state owner

One `AnnotationController` exists per Session encountered by the Client plugin. The controller is an identity-stable observable supplied through the Slot `inject.hooks` compartment. Components receive the framework-bound `useAnnotations` selector hook and plain action callbacks; they do not subscribe manually or receive `ctx`.

The controller combines three sources:

- browser-local `PersistedSessionState` for drafts and immutable outbox records;
- `SessionSnapshot.queue` for authoritative pending placement;
- replayed nodes from the Chat conversation target for sent submissions and model acknowledgements.

Durable state changes publish one frozen snapshot and write the persisted fields immediately. Editor keystrokes publish immediately and coalesce `localStorage` writes behind a 400 ms timer; another durable change or Session-controller disposal flushes the same editor state first. A storage failure leaves the in-memory snapshot usable and presents a warning.

The composer compares live outbox snapshots only after its initial baseline. A confirmed queue transition shows an official queued Toast and keeps withdrawal available, a durable transition shows sent and removes withdrawal, and a failed transition names the immutable submission id for retry. Reloaded recovery state does not replay stale Toasts.

## Selection anchoring

A selector stores:

- finalized assistant `messageId` and event `seq`;
- rendered-text half-open offsets `[start, end)`;
- exact text plus 32-character prefix and suffix;
- optional code language/line range or table row/column range.

Offsets are relative to selectable text nodes inside the decorated assistant body. Buttons, scripts, styles, `aria-hidden` content, live regions, status text, Think content, and plugin controls are excluded. The assistant message id is the reply version identity; highlights are never transferred silently to another reply version.

Mounted messages rebuild `Range` objects from offsets. If the rendered offsets no longer contain the exact quote, the Client relocates the exact text by prefix, suffix, and distance within the same immutable message id. Navigation first uses the mounted endpoint, then loads older history pages up to `locateHistoryPages`. It centers the numbered line in the nearest vertical scroll container or the window viewport and converts visual distance through the measured CSS scale. If a stale selector cannot rebuild its range, the numbered marker is the fallback target. Reduced-motion preference changes smooth scrolling to immediate scrolling. The reply then flashes without changing keyboard focus through another scroll. CSS Custom Highlights aggregate all mounted ranges under one plugin-owned manager; numbered buttons remain the fallback.

Each numbered button anchors after the complete selectable-text line containing its rebuilt range endpoint, rather than immediately after a mid-line selection. Markers sharing one visual line are grouped by vertical geometry and placed left to right by ordinal. The assistant body reserves a gutter of up to four marker columns; larger groups and markers with stale selectors continue row-major inside that gutter instead of covering text or leaving the viewport. Resize observation, viewport events, reasoning disclosure toggles, and font-loading completion schedule at most one measurement per animation frame.

## Reply chips

The Client parses raw assistant text blocks for `dsh-annotation-reply` markers. Only markers whose `submissionId` + `annotationId` pair exists among the current Session's submitted annotations are used; unknown, duplicate, forged, and malformed markers are ignored. Each accepted marker maps to the `注解 N` heading that follows it in the rendered text, which is rebuilt into a text `Range`. After streaming settles, a React chip overlays that Range's position, and `MutationObserver` plus `ResizeObserver` keep it in place. Hover or keyboard focus shows the annotation number, the selected source text, and the user's annotation; clicking opens the source annotation. Reply markers never mutate business state — only the acknowledgement marker updates the processed status. When the model breaks the format, the plain `注解 N` text stays visible.

## Feature setting lifecycle

The Host registers a `dsh-annotation` settings namespace whose `enabled`, `autoAttach`, and `localTools` fields default to `true`. The Client binds that namespace through `ctx.settingsScope` and registers an expandable card in the keyed `settings.plugin.item:dsh-annotation` Slot. Card edits are staged until Save writes the Host settings provider; Reset removes the selected user-layer field so the schema default applies again. Identity-stable `SnapshotStore<boolean>` projections expose Host-accepted values to the feature lifecycle, new-annotation save path, and local-data controls; during the one-time pre-0.1.3 migration, the enabled projection preserves a valid browser preference until the Host accepts it. The card and per-Session controllers remain mounted for the plugin fiber, while conversation-facing Slot registrations form one dynamic disposer group.

Disabling the feature removes any armed zero-width composer claim while retaining visible draft text, disposes every conversation renderer, dock, action, and command-view registration, and clears CSS Custom Highlights. Controllers, local drafts, editor recovery state, outbox entries, and durable-history reconstruction stay alive. Enabling the feature installs the same contribution group again and reuses the existing controllers. When disable lands while the official composer is submitting, the claim cannot be consumed yet; the Client subscribes to that input and releases the claim as soon as the phase leaves `submitting`, cancelling the subscription if the feature is re-enabled first.

## Slot composition

DSH currently has no additive slot inside `AssistantMarkdown`. The Client therefore uses two composition mechanisms:

| Slot cell                               | Mechanism                | Reason                                                                                 |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `conversation.chat.node:assistant-step` | In-place entry decorator | Keep the selected assistant renderer and add selection, highlights, chips, and markers |
| `conversation.chat.node:user`           | Priority `-100` shadow   | Fold annotation submissions while preserving normal user messages                      |
| `conversation.chat.node:steering`       | Priority `-100` shadow   | Fold annotation batches admitted during a running task                                 |

The assistant integration reads the Slot ledger through `ctx.slots.entries()`, wraps each existing `assistant-step` component, and composes its `inject` result rather than registering another keyed occupant. The original renderer remains responsible for Markdown, Think, images, streaming, interruption state, and any renderer-specific behavior. The outer annotation layer owns selection roots, the action bar, highlights, reply chips, and quote markers. It rebuilds ranges and geometry when the inner renderer changes its DOM. A `slots/changed` listener handles assistant entries added later; disable and unload restore each component and inject factory when they are still owned by this decorator. Because the plugin adds no `assistant-step` occupant and no keyed slot, it composes with dsh-smooth-stream.

Lower priority wins in DSH keyed slots. The user and steering replacements use public `MessageText` and the official image renderer. Additive entries are used where available:

- `conversation.input.dock` for the grouped task-style annotation list, the header attachment toggle, local-data controls, and the compact selection-positioned editor;
- `conversation.chat.assistant-actions` for a keyboard-accessible whole-reply annotation action;
- `conversation.chat.commandview:<commandName>` to suppress the transport command's redundant timeline card. Registrations under both pre-rename command names keep durable rows recorded by earlier versions out of the visible timeline;
- `settings.plugin.item:dsh-annotation` for the Host-backed enablement and automatic-attachment preferences under the Plugins settings section.

Conversation registrations also dispose when the enabled preference is off. Every registration, locale dictionary, style element, controller, subscription, and highlight is disposed with the Cordis fiber.

## Editor input handling

The compact annotation editor is portaled outside the composer DOM, so its composition events cannot reach the official input. On top of that, the editor tracks `compositionstart`/`compositionend`, `event.isComposing`, `nativeEvent.isComposing`, and `keyCode === 229`. Enter during composition only confirms the candidate; the Enter produced right after `compositionend` is swallowed by a latch cleared on the next event loop; a plain Enter saves; Shift+Enter inserts a newline; Escape during composition never closes the editor.

After a successful new-annotation save, the dock waits one microtask plus one animation frame, then returns focus to the official composer textarea through a DOM adapter scoped to the current Session's composer card, restoring the previous caret position without overwriting any text. Save failures, cancellation, Session switches, and edits to existing annotations never move focus.

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
