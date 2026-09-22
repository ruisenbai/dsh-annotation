# dsh-annotation data model and state machine

## Identities

| Field                 | Owner               | Stability                                                       |
| --------------------- | ------------------- | --------------------------------------------------------------- |
| `annotationId`        | Browser             | Stable for one draft and every later status                     |
| `submissionId`        | Browser             | Stable across every retry of one frozen batch                   |
| `messageId`           | DSH assistant event | Message-source only; identifies the exact source reply/version  |
| `messageSeq`          | DSH Session log     | Anchors source navigation and archived-session fork             |
| submission message id | Plugin Host         | Durable retry namespace `dsh-inline-annotations:<submissionId>` |
| `sessionId`           | DSH                 | Must equal the receiving Agent id                               |

The submission message-id namespace is a protocol compatibility identifier rather than the npm package name. Current and migrated outbox records use the same value so an ambiguous retry cannot enqueue a duplicate under another id.

## Submitted annotation

```json
{
  "annotationId": "ann-UUID",
  "ordinal": 1,
  "source": {
    "kind": "message",
    "messageId": "assistant-message-id",
    "messageSeq": 42,
    "responseVersion": "assistant-message-id"
  },
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
  "supplementalTo": "ann-older-UUID",
  "createdAt": 1786716000000
}
```

`AnnotationSource` distinguishes `message` from `diff`. New message sources include the explicit tag and retain the top-level message aliases; these values must agree. Legacy message records may omit the tag. Diff records forbid these aliases and message-fragment `structure` coordinates. `responseVersion` equals `messageId` because finalized DSH assistant messages are immutable and have no separate mutable revision number. A table selector replaces `structure` with zero-based `startRow`, `startColumn`, `endRow`, and `endColumn`. `supplementalTo` is present only for a separately saved clarification of another annotation; its nonblank id is limited to 256 characters, cannot equal `annotationId`, and may refer to historical annotation outside the current batch. The v1 wire used `comment` instead of `annotation`; parsing converts it in memory and never rewrites history.

## Diff source

`source.kind: "diff"` contains a complete, Host-attested comparison plus a range on one side. [The shared schema](../src/shared/diff-source.ts) is the executable field definition.

| Field                                                              | Meaning                                                                                                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot.version`, `snapshot.id`                                  | Snapshot format 1; SHA-256 identity of its session/workspace/repository, paths, comparison and version contents, excluding capture time                                           |
| `snapshot.sessionId`, `snapshot.workspace`, `snapshot.workspaceId` | Receiving Session, its exact header cwd, and a hash of the filesystem provider's canonical workspace URL                                                                          |
| `snapshot.repository`, `snapshot.repositoryId`                     | Git root and a hash of its canonical URL plus Git directory; linked worktrees remain distinct                                                                                     |
| `snapshot.oldPath`, `snapshot.newPath`                             | Literal repository-relative paths; both are retained for a Git-reported rename; an absent side has a null path                                                                    |
| `snapshot.range`                                                   | `worktree`: index → captured working file, including untracked files; `staged`: captured HEAD → index, including an unborn HEAD                                                   |
| `snapshot.head`                                                    | Captured immutable commit id, or null for an unborn HEAD; not a substitute for the two side identities                                                                            |
| `snapshot.old`, `snapshot.new`                                     | Each side's kind, complete UTF-8 text, SHA-256 and Git blob oid when available; absent sides have null content/hash/oid, and a working side has a content hash rather than an oid |
| `snapshot.capturedAt`, `snapshot.seal`                             | Capture time and HMAC-SHA-256 over snapshot identity plus time, using the Host-private persisted signing key                                                                      |
| `side`, `startLine`, `endLine`                                     | `old` or `new`; independent one-based, inclusive file coordinates on that side                                                                                                    |
| `fingerprint`, `contextBefore`, `contextAfter`                     | SHA-256 of the exact quote; separate before/after strings retain up to three complete lines on each side of the range                                                             |
| `reboundFrom`                                                      | Optional complete earliest Diff origin, without another nested rebound; retained when the user creates a supplement at a uniquely matched current location                        |

A side of kind `blob` is read and rechecked by immutable Git object id. A side of kind `working-tree` stores exact text and its SHA-256; names such as HEAD, index and working tree alone are not version identities. Identical captures keep the same snapshot id, while each capture time has its own seal. The Host checks the signature, receiving Session/cwd, content hashes, quote, context and line bounds before submission, without requiring current Git contents to match.

The outer `quote` is reconstructed from that complete side. Its character offsets count JavaScript UTF-16 code units; `startLine`/`endLine` count actual file lines, never displayed hunk or Markdown-fragment rows. Trailing newline terminators do not invent an extra line. A real blank line can have an empty exact quote; an empty file has no line to annotate. Deleted rows expose only old coordinates, added rows only new coordinates, and context rows can be annotated independently on either side.

Locate source always prefers the embedded original snapshot, including when files, index entries, commits or the repository are unavailable. A current-version check requires matching workspace/repository/comparison and related file paths, then exact complete-line quote and context matching. Zero or multiple candidates never choose a line. A unique candidate requires an explicit user action and becomes a new `supplementalTo` annotation; sent sources are not rewritten. Missing or malformed snapshots and unsupported sources are rejected instead of substituting a current same-name file.

Source snapshots are copied into editor buffers, saved drafts, frozen outbox payloads and durable user-message metadata. Retries and replay use those copies, not current DOM or Git state. The readable model text contains the file, actual comparison, both version identities, side, one-based range, selected code, context, opinion and processing mode. Message and Diff annotations share the same contiguous submission ordinals and reply/acknowledgement ids. This Git source has no synthetic message association; a future tool-result adapter would need an explicit association field.

## Submission payload

```json
{
  "protocolVersion": 3,
  "source": "dsh-annotation",
  "submissionId": "sub-UUID",
  "sessionId": "session-id",
  "delivery": "queue",
  "protocolLocale": "zh",
  "processingMode": "rewrite",
  "createdAt": 1786716000000,
  "overallRequirement": "Reorganize the proposal using all annotations.",
  "annotations": [],
  "attachmentIdentities": []
}
```

`overallRequirement` carries the official composer text as user goals and constraints; it is omitted for annotation-only submissions. `processingMode` selects the output form: `answer`, `rewrite`, or `modify`. `delivery` is `queue`. Only selected eligible annotations enter the array, and their ordinals are rewritten contiguously from 1 without changing browser-local ordering. Annotation ids must be unique and the array must not be empty. New submissions emit v3 and require an explicit source on every annotation. Legacy v1/v2 message payloads remain readable; v1 normalizes to v2 in memory, and v2 retries stay v2. Neither legacy version admits Diff sources.

`protocolLocale` and `processingMode` freeze when the pending record is created. Retry reuses the complete payload, including the selected annotation set and `supplementalTo` links. A legacy record without `protocolLocale` defaults to `en`; v1 or v2 without `processingMode` defaults to `answer`; an explicit unsupported mode is invalid. Sent history is never rewritten.

New composer submissions include ordered `attachmentIdentities`, with an empty array meaning no attachments. Each entry contains `type` (`image` or `file`), the opaque branded `attachmentId` returned by DSH, a nonnegative safe-integer `bytes` count, and the display `name` (required for files, optional for images); image entries also carry a supported `mediaType`. Identity ids are nonblank and limited to 256 characters. Parsing freezes these fields and discards unrelated input fields. Equality includes identity, kind, byte count, name, image media type, and order. Absence is preserved for legacy records and is not converted to an empty array; those records retain their metadata-only retry guard.

## Annotation kinds

```json
{
  "annotationId": "ann-UUID",
  "annotation": "这里需要补充异常处理",
  "kind": "note"
}
```

`kind` is `note` (content non-empty) or `highlight-only` (empty or whitespace-only content). Legacy records without `kind` infer from the content: non-empty becomes `note`, empty becomes `highlight-only`. Highlight-only means there is no extra note text; the selected source still participates in the chosen answer, rewrite, or modify mode and cannot be skipped.

Attachment bytes and temporary file-upload receipts never appear inside this JSON. Composer images and files travel as ordered `SubmitAttachment[]` values through `commands/execute(sessionId, line, attachments)`. The Host appends the admitted durable `ImageBlock` and `FileBlock` values after the annotation text without reordering them.

## Browser persistence

The per-Session `localStorage` value is:

```ts
interface PersistedSessionState {
  storageVersion: 3
  annotations: readonly AnnotationDraft[]
  outbox: readonly OutboxEntry[]
  overallRequirementDraft: string
  editorDraft?: PersistedEditorDraft
  editorDrafts?: readonly PersistedEditorDraft[]
  selectionMode?: 'all' | 'individual'
  selectedAnnotationIds?: readonly AnnotationId[]
  processingMode?: 'answer' | 'rewrite' | 'modify'
  retrySubmissionId?: SubmissionId | null
}
```

`editorDraft` is the active editor and `editorDrafts` contains suspended buffers. A new buffer receives a stable draft id before save and uses `new:<draftId>`; an edited annotation uses `edit:<annotationId>`, so multiple unfinished new and edited values can coexist. Each buffer retains its selection capture, text, long-selection decision, changed quote when applicable, and supplemental intent. Keystrokes persist after 400 ms. Outside clicks and Escape move a changed active editor into `editorDrafts`; Save consumes its buffer, while explicit discard removes only the buffer and never the previously saved annotation. An annotation with an unfinished edit and every suspended new editor are excluded from submission.

Absent optional fields preserve old `storageVersion: 2` records: `editorDrafts` and `selectedAnnotationIds` become empty, `selectionMode` becomes `all`, and `processingMode` becomes `answer`. A missing legacy `retrySubmissionId` selects the first retryable outbox entry for compatibility; new snapshots write an id or explicit `null`, so no current retry is chosen implicitly. Selected ids are filtered to existing eligible drafts on every publish.

The v3 writer keeps `dsh-annotation:v1:<session-id>` and reads storage versions 1, 2 and 3. Loading an older version validates and writes a v3 state under that key without upgrading outbox payloads to v3 or changing their source values; v1 retains its existing normalization to v2. When that key is absent, valid legacy namespace data is validated, converted, and written before old keys are removed. `diffPanel` is transient UI state and is not persisted. The Host settings provider stores `enabled`, `autoAttach`, `individualSelection`, and `compactSummary`; their defaults are `true`, `true`, `false`, and `true`. User values from the legacy namespace and the pre-0.1.3 enabled browser key retain their existing write-before-delete migration. A legacy plugin-owned `overallRequirementDraft` migrates once into the official composer after a successful claim.

An outbox entry contains the immutable payload, target Session id, deterministic message id, attempt count, optional attachment metadata, and status. The payload fixes its selected annotations, contiguous ordinals, `processingMode`, `overallRequirement`, `protocolLocale`, supplemental links, and any `attachmentIdentities`. When identities are present, their count and ordered kinds must agree with the attachment metadata or recovery rejects the record. The `attachments` metadata stores `{ count, kinds, mediaTypes, names }`: `kinds` retains ordered `image`/`file` tags, while `mediaTypes` and `names` describe images only. It contains no attachment bytes or temporary upload receipts. Legacy `images: { count, mediaTypes, names }` remains readable and represents an image-only batch; when both fields exist, `attachments` owns the retry requirement. These fields are retained by the v3 storage migration without upgrading frozen v2 payloads to v3.

An invalid active or suspended editor buffer is omitted so valid annotations and immutable retry records can recover; duplicate buffer keys and buffers targeting missing or immutable annotations are also dropped. Selected ids are deduplicated and filtered to eligible saved drafts. Invalid core arrays, selection-mode values, processing modes, attachment metadata, submitted source fields, or unsupported versions are not partially trusted; the Client starts with an empty state and shows a storage warning.

## Host preference recovery

DSH `0.1.7-alpha.1` stores editable preferences in the `dsh-annotation` profile entry. `archivedPreferencesImported` is a volatile Config boolean, defaulting to `false`, outside browser annotation storage and submission protocols. A successful archive recovery writes supported missing preference fields and this marker in one revision-fenced mutation. Existing user overrides win; after completion, clearing a field inherits its profile/default value rather than restoring the archive. Protocol v3, storage v3, frozen outbox entries and the private Diff signing domain are unchanged.

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

- `draft` content may be edited or deleted. The most recent deletion remains undoable in memory for 4.5 seconds. A changed edit buffer blocks that saved draft from eligibility until Save or Discard; discarding the buffer preserves the saved draft.
- Batch creation moves only the eligible annotations selected by aggregate or individual mode. Unselected drafts remain `draft`, and payload ordinals become contiguous for that batch. Durable replay restores each submitted annotation's payload ordinal rather than browser-local numbering.
- Annotation records use `queued` as the frozen post-submit state. The UI labels them “confirming delivery outcome” or “retry available” until the matching outbox entry is authoritatively queued; successful withdrawal restores only that batch. Direct discard has the same effect only for a never-queued failed/ready record.
- Supplementing a draft without an unfinished edit appends text and may replace its quote after showing both ranges. If an edit buffer already exists, that buffer resumes first and the overlapping capture is not merged. `queued`, `sent`, and `processed` records are immutable; supplementing one creates a new draft with `supplementalTo`.
- State rank is monotonic except an explicit successful queued withdrawal. Late transport results, retry selection, and discard cannot demote queued, sent, or processed authority. If durable history arrives after an ambiguous failed record was discarded, it restores the frozen id, fields, status, and ordinal. A later saved change survives as an unselected linked draft with a new id; an unfinished change survives as an unselected independent supplemental editor buffer.

## Outbox state transitions

```text
ready -> sending -> accepted ───────────────> sent
            |          │ observed queue         ▲
            |          ▼                        │
            +----> failed -> sending           queued

ready/failed -> withdrawn (direct discard before queue authority)
queued -> withdrawn (only after successful queue removal)
queued -> accepted (queue was claimed before durable history became visible)
```

`accepted` records a successful command response without claiming that the authoritative Inbox contains the batch. `queued` requires the stable message id to match a `next-turn` item's `id` in the target Session's `session.projections.faceOf('inbox')` snapshot; only this placement exposes withdrawal. `next-step` items do not qualify. An `undefined` projection is unsynchronized, not empty, and preserves the last known placement. When a synchronized snapshot stops listing the message before durable Chat history becomes visible, the target returns to `accepted`. A queue-removal response that reports an already claimed item forces the same reconciliation immediately. `sent` requires the durable annotation `user/message`, and neither a late transport success nor a late transport failure can demote either authoritative state.

A client-side item-count or size rejection occurs before final submission and leaves new annotations as drafts; attachment identity preflight may already have completed. A recorded attachment batch requires the same count and ordered kinds before any Host call. New records then compare preflight identities, and the Host independently verifies admitted blocks before queueing or deduplication. Missing, added, reordered, renamed, or replaced attachments reject the attempt without changing its payload. A fresh upload receipt for the original content and name is valid. Legacy image-only metadata requires that count of images; legacy records without identities cannot detect same-kind substitutions. To send different attachments, discard the old record and create a new submission. A transport failure is ambiguous and remains retryable with the same id: the official composer draft and armed annotation claim stay in place. Only `ready` or `failed` retries can send; a stale action against `queued`, `accepted`, or `sent` is a no-op, and `withdrawn` aborts. Loading a persisted `sending` or still-unobserved `accepted` entry converts it to `failed`, preserving the frozen payload after a refresh or tab crash and making the same id retryable. Host deduplication resolves a retry that arrived after an unseen successful admission.

## Processed and reply markers

Only this JSON-in-comment protocol has status authority:

```html
<!-- dsh-annotation:{"submissionId":"sub-UUID","processed":["ann-UUID"]} -->
```

The model is instructed to list only ids actually completed under the selected mode and never to acknowledge the full batch automatically. The parser accepts the current `dsh-annotation:` marker and the legacy `dsh-inline-comments:` and `dsh-inline-annotations:` markers, accepts string ids, removes duplicates, and ignores malformed values. A marker has status authority only when the durable submission message is also present; partial processing is valid.

Reply association markers are display-only:

```html
<!-- dsh-annotation-reply:{"submissionId":"sub-UUID","annotationId":"ann-UUID","ordinal":1} -->
```

The Client accepts only markers whose submissionId + annotationId pair exists in the current Session; unknown, duplicate, forged, and malformed markers are ignored, and they never change business status.
