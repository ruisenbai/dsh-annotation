# Data model and state machine

## Identities

| Field                 | Owner               | Stability                                                 |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `annotationId`        | Browser             | Stable for one draft and every later status               |
| `submissionId`        | Browser             | Stable across every retry of one frozen batch             |
| `messageId`           | DSH assistant event | Identifies the exact source reply/version                 |
| `messageSeq`          | DSH Session log     | Anchors source navigation and archived-session fork       |
| submission message id | Plugin Host         | Deterministically `dsh-inline-annotations:<submissionId>` |
| `sessionId`           | DSH                 | Must equal the receiving Agent id                         |

## Submitted annotation

```json
{
  "annotationId": "ann-UUID",
  "ordinal": 1,
  "messageId": "assistant-message-id",
  "messageSeq": 42,
  "responseVersion": "assistant-message-id",
  "quote": {
    "exact": "selected text",
    "prefix": "up to 32 characters before",
    "suffix": "up to 32 characters after",
    "start": 125,
    "end": 138
  },
  "comment": "Explain why this assumption holds.",
  "structure": {
    "kind": "code",
    "language": "ts",
    "startLine": 3,
    "endLine": 5
  },
  "createdAt": 1786716000000
}
```

`responseVersion` equals `messageId` because finalized DSH assistant messages are immutable and have no separate mutable revision number. A table selector replaces `structure` with zero-based `startRow`, `startColumn`, `endRow`, and `endColumn`.

## Submission payload

```json
{
  "protocolVersion": 1,
  "submissionId": "sub-UUID",
  "sessionId": "session-id",
  "delivery": "queue",
  "createdAt": 1786716000000,
  "overallRequirement": "Reorganize the proposal using all notes.",
  "annotations": []
}
```

`delivery` is `queue` or `steer`. Annotation ordinals must be contiguous from 1, annotation ids must be unique, and the array must not be empty.

## Browser persistence

The per-Session `localStorage` value is:

```ts
interface PersistedSessionState {
  storageVersion: 2
  annotations: readonly AnnotationDraft[]
  outbox: readonly OutboxEntry[]
  overallRequirementDraft: string
  editorDraft?: PersistedEditorDraft
}
```

`editorDraft` contains the serializable selection capture, current text, long-selection decision, and optional supplemental target. The controller writes nonblank editor text after 400 ms and removes it when Cancel or Save closes the editor. The `localStorage` key retains its `v1` prefix; version-one values migrate to this value format when read.

An outbox entry contains the immutable payload, target Session id, deterministic message id, attempt count, and status. An invalid optional `editorDraft` is omitted so valid drafts and immutable retry records can still recover. Invalid core arrays, provenance, or unsupported versions are not partially trusted; the Client starts with an empty state and shows a storage warning.

## Annotation state transitions

```text
                 explicit submit
       ┌────────────────────────────────┐
       │                                ▼
     draft ──────────────────────────> queued
       ▲                                │
       │ queue withdrawal               │ standard user/message appears
       └────────────────────────────────┘
                                        ▼
                                      sent
                                        │ exact model acknowledgement id
                                        ▼
                                    processed
```

- `draft` content may be edited or deleted. The most recent deletion remains undoable in memory for 4.5 seconds; it is not persisted as a second draft.
- Annotation records use `queued` as the frozen post-submit state. The UI labels them “confirming delivery outcome” or “retry available” until the matching outbox entry is authoritatively queued; successful withdrawal creates a new editable draft state from the same annotation.
- `sent` and `processed` history is never edited.
- Opening a sent annotation creates a new draft with `supplementalTo`; it does not mutate the earlier record.
- State rank is monotonic except the explicit queued withdrawal.

## Outbox state transitions

```text
ready -> sending -> accepted ───────────────> sent
            |          │ observed queue         ▲
            |          ▼                        │
            +----> failed -> sending           queued

ready/queued -> withdrawn (only after successful queue removal)
queued -> accepted (queue was claimed before durable history became visible)
```

`accepted` records a successful command response without claiming that the authoritative Inbox contains the batch. `queued` requires the stable message id in the target Session's current `ConversationSnapshot.queue`; only this state exposes withdrawal. When that snapshot stops listing the message before durable history becomes visible, the target and any archived-source mirror return to `accepted`. A queue-removal response that reports an already claimed item forces the same reconciliation immediately. `sent` requires the durable annotation `user/message`, and neither a late transport success nor a late transport failure can demote either authoritative state.

A client-side item-count or size rejection occurs before any Host call and leaves new annotations as drafts. A transport failure is ambiguous and therefore remains retryable with the same id. Loading a persisted `sending` or still-unobserved `accepted` entry converts it to `failed`, preserving the frozen payload after a refresh or tab crash and making the same id retryable. Host deduplication resolves a retry that arrived after an unseen successful admission.

## Processed marker

Only this JSON-in-comment protocol has authority:

```html
<!-- dsh-inline-annotations:{"submissionId":"sub-UUID","processed":["ann-UUID"]} -->
```

The parser accepts string ids, removes duplicates, and ignores malformed values. A marker has status authority only when the durable submission message is also present. It does not require every annotation in a submission to be processed at once.
