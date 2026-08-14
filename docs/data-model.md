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
  storageVersion: 1
  annotations: readonly AnnotationDraft[]
  outbox: readonly OutboxEntry[]
  overallRequirementDraft: string
}
```

An outbox entry contains the immutable payload, target Session id, deterministic message id, attempt count, and status. Corrupt or unsupported storage is not partially trusted; the Client starts with an empty state and shows a storage warning.

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

- `draft` content may be edited or deleted.
- `queued` content is frozen. Withdrawal creates a new editable draft state from the same annotation.
- `sent` and `processed` history is never edited.
- Opening a sent annotation creates a new draft with `supplementalTo`; it does not mutate the earlier record.
- State rank is monotonic except the explicit queued withdrawal.

## Outbox state transitions

```text
ready -> sending -> queued -> sent
            |
            +----> failed -> sending (same payload and id)

ready/queued -> withdrawn (only before a durable user message)
```

A client-side item-count or size rejection occurs before any Host call and leaves new annotations as drafts. A transport failure is ambiguous and therefore remains retryable with the same id. Loading a persisted `sending` entry converts it to `failed`, preserving the frozen payload after a refresh or tab crash. Host deduplication resolves a retry that arrived after an unseen successful admission.

## Processed marker

Only this JSON-in-comment protocol has authority:

```html
<!-- dsh-inline-annotations:{"submissionId":"sub-UUID","processed":["ann-UUID"]} -->
```

The parser accepts string ids, removes duplicates, and ignores malformed values. A marker has status authority only when the durable submission message is also present. It does not require every annotation in a submission to be processed at once.
