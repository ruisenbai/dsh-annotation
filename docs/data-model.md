# dsh-annotation data model and state machine

## Identities

| Field                 | Owner               | Stability                                                       |
| --------------------- | ------------------- | --------------------------------------------------------------- |
| `annotationId`        | Browser             | Stable for one draft and every later status                     |
| `submissionId`        | Browser             | Stable across every retry of one frozen batch                   |
| `messageId`           | DSH assistant event | Identifies the exact source reply/version                       |
| `messageSeq`          | DSH Session log     | Anchors source navigation and archived-session fork             |
| submission message id | Plugin Host         | Durable retry namespace `dsh-inline-annotations:<submissionId>` |
| `sessionId`           | DSH                 | Must equal the receiving Agent id                               |

The submission message-id namespace is a protocol compatibility identifier rather than the npm package name. Current and migrated outbox records use the same value so an ambiguous retry cannot enqueue a duplicate under another id.

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
  "annotation": "Explain why this assumption holds.",
  "structure": {
    "kind": "code",
    "language": "ts",
    "startLine": 3,
    "endLine": 5
  },
  "createdAt": 1786716000000
}
```

`responseVersion` equals `messageId` because finalized DSH assistant messages are immutable and have no separate mutable revision number. A table selector replaces `structure` with zero-based `startRow`, `startColumn`, `endRow`, and `endColumn`. The v1 wire used `comment` instead of `annotation`; the parser converts v1 records into this model and never rewrites history.

## Submission payload

```json
{
  "protocolVersion": 2,
  "source": "dsh-annotation",
  "submissionId": "sub-UUID",
  "sessionId": "session-id",
  "delivery": "queue",
  "createdAt": 1786716000000,
  "overallRequirement": "Reorganize the proposal using all annotations.",
  "annotations": []
}
```

`overallRequirement` carries the official composer text captured at submit time; it is omitted for annotation-only submissions. `delivery` is `queue`. Annotation ordinals must be contiguous from 1, annotation ids must be unique, and the array must not be empty. New submissions only emit v2; v1 payloads are still read.

Images never appear inside this JSON. Composer images travel as rc.2 command attachments: the outbox entry records only `{ count, mediaTypes, names }`, and the Host appends the admitted durable image blocks after the annotation text in the user-message content.

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

`editorDraft` contains the serializable selection capture, current text, long-selection decision, and optional supplemental target. The controller writes nonblank editor text after 400 ms and removes it when Cancel or Save closes the editor. Session state uses `dsh-annotation:v1:<session-id>`; when that key is absent, valid data under `dsh-inline-comments:v1:<session-id>` or `dsh-inline-annotations:v1:<session-id>` is validated, converted, and written to the new key, and the legacy keys are removed only after the write succeeds. The key retains its `v1` prefix while version-one values migrate to this value format when read. The Host settings provider stores `enabled` and `autoAttach` under the `dsh-annotation` namespace; both schema defaults are `true`. User values from the legacy `inline-comments` namespace migrate once into the new namespace, and the legacy section is cleared only after the new write succeeds. When the new namespace has no user-layer `enabled` field, a valid value under the pre-0.1.3 browser key `dsh.inline-comments.enabled` remains authoritative until the Client writes it to the Host and then removes the key. `autoAttach` has no browser-storage migration and falls back directly to its Host schema default. A legacy plugin-owned `overallRequirementDraft` value migrates once into the official composer on the first successful attachment and is then cleared from plugin storage.

An outbox entry contains the immutable payload, target Session id, deterministic message id, attempt count, optional image metadata, and status. An invalid optional `editorDraft` is omitted so valid drafts and immutable retry records can still recover. Invalid core arrays, provenance, or unsupported versions are not partially trusted; the Client starts with an empty state and shows a storage warning.

## Annotation state transitions

```text
             official composer submit
       ┌────────────────────────────────┐
       │                                ▼
     draft ──────────────────────────> queued
       ▲                                │
       │ queue withdrawal or discard    │ standard user/message appears
       └────────────────────────────────┘
                                        ▼
                                      sent
                                        │ exact model acknowledgement id
                                        ▼
                                    processed
```

- `draft` content may be edited or deleted. The most recent deletion remains undoable in memory for 4.5 seconds; it is not persisted as a second draft.
- Annotation records use `queued` as the frozen post-submit state. The UI labels them “confirming delivery outcome” or “retry available” until the matching outbox entry is authoritatively queued; successful withdrawal creates a new editable draft state from the same annotation. A never-queued failed/ready record can be discarded with the same draft restoration.
- `sent` and `processed` history is never edited.
- Opening a sent annotation creates a new draft with `supplementalTo`; it does not mutate the earlier record.
- State rank is monotonic except the explicit queued withdrawal.

## Outbox state transitions

```text
ready -> sending -> accepted ───────────────> sent
            |          │ observed queue         ▲
            |          ▼                        │
            +----> failed -> sending           queued

ready/queued -> withdrawn (only after successful queue removal or discard)
queued -> accepted (queue was claimed before durable history became visible)
```

`accepted` records a successful command response without claiming that the authoritative Inbox contains the batch. `queued` requires the stable message id in the target Session's current `ConversationSnapshot.queue`; only this state exposes withdrawal. When that snapshot stops listing the message before durable history becomes visible, the target returns to `accepted`. A queue-removal response that reports an already claimed item forces the same reconciliation immediately. `sent` requires the durable annotation `user/message`, and neither a late transport success nor a late transport failure can demote either authoritative state.

A client-side item-count or size rejection occurs before any Host call and leaves new annotations as drafts. A refresh-loss image guard also refuses before any Host call when a recorded image batch has no images in the composer. A transport failure is ambiguous and therefore remains retryable with the same id: the official composer draft and armed attachment stay in place. Loading a persisted `sending` or still-unobserved `accepted` entry converts it to `failed`, preserving the frozen payload after a refresh or tab crash and making the same id retryable. Host deduplication resolves a retry that arrived after an unseen successful admission.

## Processed and reply markers

Only this JSON-in-comment protocol has status authority:

```html
<!-- dsh-annotation:{"submissionId":"sub-UUID","processed":["ann-UUID"]} -->
```

The parser accepts the current `dsh-annotation:` marker and the legacy `dsh-inline-comments:` and `dsh-inline-annotations:` markers, accepts string ids, removes duplicates, and ignores malformed values. A marker has status authority only when the durable submission message is also present. It does not require every annotation in a submission to be processed at once.

Reply association markers are display-only:

```html
<!-- dsh-annotation-reply:{"submissionId":"sub-UUID","annotationId":"ann-UUID","ordinal":1} -->
```

The Client accepts only markers whose submissionId + annotationId pair exists in the current Session; unknown, duplicate, forged, and malformed markers are ignored, and they never change business status.
