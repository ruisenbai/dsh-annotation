# Architecture

## Scope

`dsh-inline-comments` is one installable Cordis row with two runtime halves:

- the **Host half** registers the `inline-comments` settings namespace and internal `inline_comments_submit` command, validates a base64url JSON payload, creates one standard user message, deduplicates retries, and calls `Agent.followup()`;
- the **Web Client half** owns selection capture, the selection action bar, draft persistence, the official-composer attachment claim, status reconstruction, rendering, queue withdrawal, and source navigation.

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
  U->>C: Toggle paperclip (arm official composer)
  Note over C: Live draft set follows edits until submit
  U->>C: Official Enter or Send
  C->>C: Freeze payload + submission id + composer text
  C->>H: /inline_comments_submit <base64url JSON>
  H->>H: Validate size, ids, session, schema
  H->>A: followup() with deterministic message id
  H-->>C: Command admitted
  A->>L: Standard user/message at claim time
  C->>C: Reconstruct status = sent
  L->>M: Complete inline-comment message
  M->>L: Assistant response + explicit id marker
  C->>C: Parse exact ids; status = processed
```

## Composer attachment claim

The header paperclip arms the current Session's official composer through the scoped `slash/input-begin-command` event with a zero-width, non-whitespace claim token. The token keeps the official Send action eligible while the visible composer text is empty, so annotation-only submission needs no second send surface. The official Enter key and Send button submit through the claim; Shift+Enter and the composer's remaining keyboard behavior are unchanged.

DSH can pass serialized composer images to claims that opt in. This claim deliberately omits `CommandClaim.images`, so DSH rejects mixed image and annotation drafts before invoking its submit callback and retains both drafts. Detaching removes the token through the scoped `slash/input-consume-token` event or a plain draft write without touching the remaining text. The header button suppresses its pointerdown default so composer focus and caret survive the toggle.

## Durable representation

The Host attaches this provenance to the standard user message:

```ts
{
  kind: 'user',
  inlineComments: AnnotationSubmissionPayload
}
```

`kind: 'user'` is intentional: every quote and comment comes from an explicit human gesture, and DSH should treat the input with ordinary human authority. The extra field is an owned JSON value preserved by standard message cloning. It contains the exact submitted batch, so a fresh browser can rebuild timeline cards without a plugin sidecar. Replay also accepts `inlineAnnotations` on durable messages that use the legacy provenance field.

The model-visible text is generated from the same payload. It lists the submission id, each annotation id, source message/version id, event sequence, complete quote, comment, structural coordinates, optional overall requirement, and acknowledgement syntax.

## Idempotency

The stable inbox/message id is `dsh-inline-annotations:<submissionId>` for both current and migrated outbox records. This durable protocol namespace preserves retry identity across package-name changes. Before admission, the Host synchronously checks:

1. `agent.inbox.nextTurn`;
2. `agent.inbox.nextStep`;
3. logged `user/message` events.

A match returns success without another enqueue. This is plugin-owned idempotency; DSH's generic prompt path does not provide an idempotency key. The Client freezes the complete payload after its first attempt. A transport retry reuses both payload and submission id.

An item observed in `ConversationSnapshot.queue` may be withdrawn through `SessionFace.updateQueue(messageId, { kind: 'remove' })`. Withdrawal returns its annotations to editable drafts. A successful command response remains internally `accepted` until queue or durable history confirms its actual placement. When a target snapshot stops listing an observed queue item before its durable message appears, its outbox returns to `accepted` so withdrawal disappears during the claim-to-history window. Sent history is immutable; later clarification creates a new annotation with `supplementalTo`.

## Client state owner

One `AnnotationController` exists per Session encountered by the Client plugin. The controller is an identity-stable observable supplied through the Slot `inject.hooks` compartment. Components receive the framework-bound `useAnnotations` selector hook and plain action callbacks; they do not subscribe manually or receive `ctx`.

The controller combines three sources:

- browser-local `PersistedSessionState` for drafts and immutable outbox records;
- `ConversationSnapshot.queue` for authoritative pending placement;
- replayed Chat nodes for sent submissions and model acknowledgements.

Durable state changes publish one frozen snapshot and write the persisted fields immediately. Editor keystrokes publish immediately and coalesce `localStorage` writes behind a 400 ms timer; another durable change or Session-controller disposal flushes the same editor state first. A storage failure leaves the in-memory snapshot usable and presents a warning.

The composer compares live outbox snapshots only after its initial baseline. A confirmed queue transition shows an official queued Toast and keeps withdrawal available, a durable transition shows sent and removes withdrawal, and a failed transition names the immutable submission id for retry. Reloaded recovery state does not replay stale Toasts.

## Selection anchoring

A selector stores:

- finalized assistant `messageId` and event `seq`;
- rendered-text half-open offsets `[start, end)`;
- exact text plus 32-character prefix and suffix;
- optional code language/line range or table row/column range.

Offsets are relative to selectable text nodes inside the plugin-owned assistant body. Buttons, scripts, styles, `aria-hidden` content, and reasoning disclosures are excluded. The assistant message id is the reply version identity; highlights are never transferred silently to another reply version.

Mounted messages rebuild `Range` objects from offsets. If the rendered offsets no longer contain the exact quote, the Client relocates the exact text by prefix, suffix, and distance within the same immutable message id. Navigation first uses the mounted endpoint, then loads older history pages up to `locateHistoryPages`. It centers the numbered line in the nearest vertical scroll container or the window viewport and converts visual distance through the measured CSS scale. If a stale selector cannot rebuild its range, the numbered marker is the fallback target. Reduced-motion preference changes smooth scrolling to immediate scrolling. The reply then flashes without changing keyboard focus through another scroll. CSS Custom Highlights aggregate all mounted ranges under one plugin-owned manager; numbered buttons remain the fallback.

Each numbered button anchors after the complete selectable-text line containing its rebuilt range endpoint, rather than immediately after a mid-line selection. Markers sharing one visual line are grouped by vertical geometry and placed left to right by ordinal. The assistant body reserves a gutter of up to four marker columns; larger groups and markers with stale selectors continue row-major inside that gutter instead of covering text or leaving the viewport. Resize observation, viewport events, reasoning disclosure toggles, and font-loading completion schedule at most one measurement per animation frame.

## Feature setting lifecycle

The Host registers an `inline-comments` settings namespace whose `enabled` field defaults to `true`. The Client binds that namespace through `ctx.settingsScope` and registers an expandable card in the keyed `settings.plugin.item:inline-comments` Slot. Card edits are staged until Save writes the Host settings provider; Reset removes the user-layer field so the schema default applies again. An identity-stable `SnapshotStore<boolean>` projects Host-accepted values into the feature lifecycle; during the one-time pre-0.1.3 migration, it preserves a valid browser preference until the Host accepts it. The card and per-Session controllers remain mounted for the plugin fiber, while conversation-facing Slot registrations form one dynamic disposer group.

Disabling the feature removes any armed zero-width composer claim while retaining visible draft text, disposes every conversation renderer, dock, action, and command-view registration, and clears CSS Custom Highlights. Controllers, local drafts, editor recovery state, outbox entries, and durable-history reconstruction stay alive. Enabling the feature installs the same contribution group again and reuses the existing controllers. When disable lands while the official composer is submitting, the claim cannot be consumed yet; the Client subscribes to that input and releases the claim as soon as the phase leaves `submitting`, cancelling the subscription if the feature is re-enabled first.

## Slot composition

DSH currently has no additive slot inside `AssistantMarkdown`. The Client uses supported priority shadowing for three keyed cells:

| Slot cell                               | Priority | Reason                                                                       |
| --------------------------------------- | -------: | ---------------------------------------------------------------------------- |
| `conversation.chat.node:assistant-step` |   `-100` | Own selection roots, the selection action bar, highlights, and quote markers |
| `conversation.chat.node:user`           |   `-100` | Fold comment submissions while preserving normal user messages               |
| `conversation.chat.node:steering`       |   `-100` | Fold comment batches admitted during a running task                          |

Lower priority wins in DSH keyed slots. The replacements use public `MarkdownText`, `JsonBlock`, `MessageText`, and attachment primitives. Additive entries are used where available:

- `conversation.input.dock` for the grouped task-style comment list, the header attachment toggle, local-data controls, and the compact selection-positioned editor;
- `conversation.chat.assistant-actions` for a keyboard-accessible whole-reply comment action;
- `conversation.chat.commandview:<commandName>` to suppress the transport command's redundant timeline card. A second registration under the pre-rename `inline_annotations_submit` name keeps durable rows recorded by earlier versions out of the visible timeline;
- `settings.plugin.item:inline-comments` for the Host-backed enabled preference under the Plugins settings section.

Conversation registrations also dispose when the enabled preference is off. Every registration, locale dictionary, style element, controller, subscription, and highlight is disposed with the Cordis fiber.

## Processed acknowledgement

The generated user message asks the model to append:

```html
<!-- dsh-inline-comments:{"submissionId":"sub-…","processed":["ann-…"]} -->
```

The Client parses raw assistant block text and validates exact strings. It accepts both the current `dsh-inline-comments:` marker and the legacy `dsh-inline-annotations:` marker, then strips matching markers before Markdown rendering. Prose mentions, malformed JSON, unknown ids, elapsed time, and turn completion have no status authority.

## Archived sessions

Archived tasks have no active composer, so the paperclip stays disabled and annotations cannot be armed there. Create and attach annotations in an editable task instead.

## Security properties

- The Host validates the complete decoded payload before using it.
- The configured byte and item limits apply to the complete JSON batch.
- Session identity in the payload must equal the receiving Agent id.
- Unsent data never crosses the browser boundary.
- The package performs no arbitrary HTML rendering and uses DSH's untrusted Markdown primitive.
- Raw command input is excluded from `command/run`; the durable standard user message is the single model-visible record.
