# Architecture

## Scope

`dsh-inline-annotations` is one installable Cordis row with two runtime halves:

- the **Host half** registers the internal `inline_annotations_submit` command, validates a base64url JSON payload, creates one standard user message, deduplicates retries, and calls `Agent.steer()` or `Agent.followup()`;
- the **Web Client half** owns selection capture, draft persistence, status reconstruction, rendering, queue withdrawal, source navigation, and archived-session forking.

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

  U->>C: Select reply text and save drafts
  Note over C: localStorage only
  U->>C: Submit batch
  C->>C: Freeze payload + submission id
  C->>H: /inline_annotations_submit <base64url JSON>
  H->>H: Validate size, ids, session, schema
  H->>A: steer() or followup() with deterministic message id
  H-->>C: Command admitted
  A->>L: Standard user/message at claim time
  C->>C: Reconstruct status = sent
  L->>M: Complete annotation message
  M->>L: Assistant response + explicit id marker
  C->>C: Parse exact ids; status = processed
```

## Durable representation

The Host attaches this provenance to the standard user message:

```ts
{
  kind: 'user',
  inlineAnnotations: AnnotationSubmissionPayload
}
```

`kind: 'user'` is intentional: every quote and comment comes from an explicit human gesture, and DSH should treat the input with ordinary human authority. The extra field is an owned JSON value preserved by standard message cloning. It contains the exact submitted batch, so a fresh browser can rebuild timeline cards without a plugin sidecar.

The model-visible text is generated from the same payload. It lists the submission id, each annotation id, source message/version id, event sequence, complete quote, comment, structural coordinates, optional overall requirement, and acknowledgement syntax.

## Idempotency

The stable inbox/message id is `dsh-inline-annotations:<submissionId>`. Before admission, the Host synchronously checks:

1. `agent.inbox.nextTurn`;
2. `agent.inbox.nextStep`;
3. logged `user/message` events.

A match returns success without another enqueue. This is plugin-owned idempotency; DSH's generic prompt path does not provide an idempotency key. The Client freezes the complete payload after its first attempt. A transport retry reuses both payload and submission id.

A queued item may be withdrawn through `SessionFace.updateQueue(messageId, { kind: 'remove' })`. Withdrawal returns its annotations to editable drafts. Sent history is immutable; later clarification creates a new annotation with `supplementalTo`.

## Client state owner

One `AnnotationController` exists per Session encountered by the Client plugin. The controller is an identity-stable observable supplied through the Slot `inject.hooks` compartment. Components receive the framework-bound `useAnnotations` selector hook and plain action callbacks; they do not subscribe manually or receive `ctx`.

The controller combines three sources:

- browser-local `PersistedSessionState` for drafts and immutable outbox records;
- `ConversationSnapshot.queue` for authoritative pending placement;
- replayed Chat nodes for sent submissions and model acknowledgements.

Each state change publishes one frozen snapshot and then writes the persisted fields. A storage failure leaves the in-memory snapshot usable and presents a warning.

## Selection anchoring

A selector stores:

- finalized assistant `messageId` and event `seq`;
- rendered-text half-open offsets `[start, end)`;
- exact text plus 32-character prefix and suffix;
- optional code language/line range or table row/column range.

Offsets are relative to selectable text nodes inside the plugin-owned assistant body. Buttons, scripts, styles, `aria-hidden` content, and reasoning disclosures are excluded. The assistant message id is the reply version identity; highlights are never transferred silently to another reply version.

Mounted messages rebuild `Range` objects from offsets. If the rendered offsets no longer contain the exact quote, the Client relocates the exact text by prefix, suffix, and distance within the same immutable message id. Navigation first uses the mounted endpoint, then loads older history pages up to `locateHistoryPages`. The selected reply scrolls into view and flashes. CSS Custom Highlights aggregate all mounted ranges under one plugin-owned manager; numbered buttons remain the fallback.

Each numbered button anchors after the complete selectable-text line containing its rebuilt range endpoint, rather than immediately after a mid-line selection. Markers sharing one visual line are grouped by vertical geometry and placed left to right by ordinal. Resize observation, viewport events, reasoning disclosure toggles, and font-loading completion recompute positions in CSS pixels.

## Slot composition

DSH currently has no additive slot inside `AssistantMarkdown`. The Client uses supported priority shadowing for three keyed cells:

| Slot cell                               | Priority | Reason                                                            |
| --------------------------------------- | -------: | ----------------------------------------------------------------- |
| `conversation.chat.node:assistant-step` |   `-100` | Own selection roots, highlights, and quote markers                |
| `conversation.chat.node:user`           |   `-100` | Fold annotation submissions while preserving normal user messages |
| `conversation.chat.node:steering`       |   `-100` | Fold annotation batches admitted during a running task            |

Lower priority wins in DSH keyed slots. The replacements use public `MarkdownText`, `JsonBlock`, `MessageText`, and attachment primitives. Additive entries are used where available:

- `conversation.input.dock` for the task-style collapsible annotation list and selection-positioned editor;
- `conversation.chat.assistant-actions` for a keyboard-accessible whole-reply annotation action;
- `conversation.chat.commandview:<commandName>` to suppress the transport command's redundant timeline card.

Every registration, locale dictionary, style element, controller, subscription, and highlight is disposed with the Cordis fiber.

## Processed acknowledgement

The generated user message asks the model to append:

```html
<!-- dsh-inline-annotations:{"submissionId":"sub-…","processed":["ann-…"]} -->
```

The Client parses raw assistant block text and validates exact strings. It strips matching markers before Markdown rendering. Prose mentions, malformed JSON, unknown ids, elapsed time, and turn completion have no status authority.

## Archived sessions

DSH exposes `ISessions.fork()` but no public unarchive operation. For an archived source, the Client forks at the greatest annotated source sequence, opens the child, transfers the immutable outbox, and submits there. While both Session controllers are live, the child mirrors only durable `sent` and `processed` status back to the archived source; it never rewrites submitted content. A failed fork leaves the source drafts untouched.

## Security properties

- The Host validates the complete decoded payload before using it.
- The configured byte and item limits apply to the complete JSON batch.
- Session identity in the payload must equal the receiving Agent id.
- Unsent data never crosses the browser boundary.
- The package performs no arbitrary HTML rendering and uses DSH's untrusted Markdown primitive.
- Raw command input is excluded from `command/run`; the durable standard user message is the single model-visible record.
