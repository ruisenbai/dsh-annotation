# dsh-annotation data model and state machine

[简体中文](data-model.md) · English

## Identities

| Field                      | Owner               | Stability                                                       |
| -------------------------- | ------------------- | --------------------------------------------------------------- |
| `annotationId`             | Browser             | Stable for one draft and every later status                     |
| `submissionId`             | Browser             | Stable across every retry of one frozen batch                   |
| `messageId`                | DSH assistant event | Message-source only; identifies the exact source reply/version  |
| `messageSeq`               | DSH Session log     | Anchors source navigation and archived-session fork             |
| submission message id      | Plugin Host         | Durable retry namespace `dsh-inline-annotations:<submissionId>` |
| `sessionId`                | DSH                 | Must equal the receiving Agent id                               |
| message `source.sessionId` | DSH                 | Original Conversation; omission means the receiving Session     |

The submission message-id namespace is a protocol compatibility identifier rather than the npm package name. Current and migrated outbox records use the same value so an ambiguous retry cannot enqueue a duplicate under another id.

## Side-chat data

New side annotations use annotation protocol v6 and browser storage v7 under the receiving Session's `dsh-annotation:v1:<session-id>` key. Message `source.sessionId` preserves the original Conversation independently of the receiving payload's `sessionId`; historical and local records omit it and resolve to their owner. Source-marker projections are transient and never duplicate records into the source Session.

Pending legacy references without an outbox convert to highlight-only annotations. Their stable ids derive from the receiving Session and reference identity. Conversion commits the annotation journal before retiring the legacy reference. Retry skips existing ids and deletion marks, preserving later edits, detachments and deletions. A failed first write leaves the old reference intact; a failed retirement retries without duplicating the annotation. Frozen legacy outboxes, including unknown delivery outcomes, and sent Session history remain unchanged.

Side-chat associations and legacy reference requests use separate version domains: reference protocol v1 and association storage v2. `SideChatStorage` stores `dsh-annotation:side-chat:v2:<main-session-id>` with the main Session identity, an ordered list of parallel chats, the selected chat, sidebar visibility, a monotonic compacted generation, and each chat's Session identity, creation flag, archive state, ordered references, and optional frozen outbox. Optional `archived` and `deletedSideChatIds` fields keep existing v2 values readable. Released `dsh-annotation:side-chat:v1:<main-session-id>` records restore into one selected chat; current saves use v2 and retain the legacy value. Invalid or unsupported records stay untouched and block overwrites. The official composer owns the structured question draft and attachment objects. Unsent attachment objects are runtime-only and must be selected again after a full page reload; outbox identities contain no bytes. Association persistence remains separate from annotation storage v7; legacy conversion uses the ordered writes described above. Association-key enumeration restores side Session roles before conversation contributions mount without reading Session logs.

Each browser edit writes a unique immutable `:journal:<id>` containing its before and after state and observed journal dependencies. Readers apply three-way merges in dependency order. Additions and removals preserve both pages' edits, including references added during a send; consumed reference identities and requests do not return during a late status update. Incompatible Session identities and different frozen requests retain both records and report a conflict. Optional Web Locks serialize compaction of merged journals into the v2 record. Optional `appliedJournalIds` identifies edits already compacted while cleanup is incomplete; v2 records without it still load. Read-only restoration does not compact an unchanged record. `storage` events refresh per-chat views while each page keeps its own receiving selection, live Session references, and official drafts.

Official archival preserves the chat and its references, notes and association. Official restoration removes the archive flag without copying a Session. Successful deletion first records an independent `:deleted:<side-chat-id>` tombstone; readers exclude that identity even if an older page overwrites the compacted record. A concurrent unsaved edit to a deleted chat stays in a recovery record and cannot restore that chat. Annotation storage records a per-Session retirement mark and removes only that side Session's indexes and records. Host notifications and permanent-deletion queries reconcile stale pages. The Host's JSONL backend separately preserves committed log generations under a permanent deletion marker; browser tombstones are not a substitute for that server operation.

Save results distinguish `saved`, `merged`, `unavailable`, and `conflict`. Unavailable writes keep this page's unsaved state in memory; conflicts keep durable journals when a journal write succeeded. Both show Retry save and Export recovery in prepared or standalone composers, and in an empty panel when loading failed. Dependent creation, reference mutations, and sends stop until recovery succeeds. Retry reuses retained edits without replacing unseen peer changes. Export contains the in-memory association and readable compacted, legacy, and journal records; it excludes official drafts, attachment bytes, and Host messages. An incompatible conflict remains blocked if retry cannot merge it; export preserves the alternatives for recovery. Browser site-data clearing or closing a page with unavailable writes can still remove unsaved local data.

Each legacy reference occurrence has a branded `referenceId`, `sourceSessionId`, assistant `messageId`, `messageSeq`, `responseVersion`, creation time, and a quote selector containing `exact`, `prefix`, `suffix`, `start`, and `end`. Confirmation creates a new occurrence identity even when another reference has equal text. Pending references and saved source bubbles can be removed independently of frozen submissions. Submitted history keeps the frozen occurrence list and has no removal action.

Saved side-chat source occurrences use optional `referenceRecords`, `referenceRecordIds`, and `removedReferenceIds` fields in the current browser-local v2 record. Released records without these fields initialize source occurrences from pending references; accepted occurrences can also be recovered from loaded standard user-message source metadata. The append-only ID order preserves reference bubble numbers after removal. Removal tombstones win across pages and prevent Session history from restoring deleted source bubbles. Acceptance consumes pending references without deleting their source occurrences; removing a source bubble does not rewrite an already submitted message. These fields change neither the Session log version nor model-visible submission fields. Recovery of already known occurrences performs no write.

`sideChatSubmission` on the standard user-message source freezes the submission identity, both Session identities, queue delivery, locale, creation time, question, references, ordered attachment identities, and optional `annotationSubmission`. The same optional annotation payload is also exposed through the existing annotation source field so normal history and reply processing apply. Model-visible text is generated from this frozen payload and persisted as the message content. No main transcript or browser-only context is added later. Combined reference and annotation count and the complete payload size use the existing configured limits.

The `annotationSideChatReceipts` Projection folds the standard `agent/inbox/spliced` and `user/message` events into submission-id-to-fingerprint receipts. The Host checks this Projection before admission and rejects a reused identity with different content. It does not rescan the complete Session log or add custom durable events. The Client observes the same Projection; matching admission receipts can settle a request before its transport response. Compaction retains the receipt state through the Host's Projection mechanism.

Side outboxes transition from `ready` to `sending`, then clear only after a matching accepted or duplicate receipt. A failed sending-state write stops transport and retains a retryable request. Rejection preserves a `failed` request; lost or malformed acknowledgement preserves `unknown`. Reload converts stored `sending` and unconfirmed `accepted` to `unknown`. Retry uses the identical frozen question, references, and attachment identities; later collection changes only the next batch. Acceptance removes only the captured reference identities. A conflicting receipt remains blocked across reload and later transport replies. Unsupported or malformed local records remain untouched, with writes blocked until valid data can be read.

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

`AnnotationSource` distinguishes `message`, historical `diff`, official `file`, and official `official-diff`. New message sources include the explicit tag and retain the top-level message aliases; these values must agree. Legacy message records may omit the tag. Historical Diff records forbid these aliases and message-fragment `structure` coordinates. New official file and turn-Diff records use protocol v6 and carry their creation entry; current turn-Diff creation uses `sidebar`, while earlier `hover` entries remain readable. `responseVersion` equals `messageId` because finalized DSH assistant messages are immutable and have no separate mutable revision number. A table selector replaces `structure` with zero-based `startRow`, `startColumn`, `endRow`, and `endColumn`. `supplementalTo` is present only for a separately saved clarification of another annotation; its nonblank id is limited to 256 characters, cannot equal `annotationId`, and may refer to historical annotation outside the current batch. The v1 wire used `comment` instead of `annotation`; parsing converts it in memory and never rewrites history.

## Historical Diff source

`source.kind: "diff"` in old records contains a complete comparison plus a range on one side. New Diff annotations are not created or sent. [The shared schema](../src/shared/diff-source.ts) is the executable field definition.

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
| `reboundFrom`                                                      | Optional complete earliest Diff origin, without another nested rebound; retained from earlier explicit rebinds                                                                    |

In historical captures, a side of kind `blob` held text read from an immutable Git object id, while a `working-tree` side stored exact text and its SHA-256. Identical captures used the same snapshot id, while each capture time had its own seal. Current reads validate the retained fields, quote, context, and line bounds without reactivating the former signing service or accessing Git.

The outer `quote` is reconstructed from that complete side. Its character offsets count JavaScript UTF-16 code units; `startLine`/`endLine` count actual file lines, never displayed hunk or Markdown-fragment rows. Trailing newline terminators do not invent an extra line. A real blank line can have an empty exact quote; an empty file has no line to annotate. Deleted rows expose only old coordinates, added rows only new coordinates, and context rows can be annotated independently on either side.

Historical messages display the embedded original snapshot as read-only source details. The previous locate, current-version check, and rebind actions are unavailable. Missing or malformed snapshots are rejected during parsing; the Client does not substitute a current file with the same name.

Historical source snapshots may occur in editor buffers, saved drafts, frozen outbox payloads and durable user-message metadata. Replay reads those copies without consulting the current DOM or Git state; Diff drafts and failed batches cannot be retried. The historical model text contains the file, actual comparison, both version identities, side, one-based range, selected code, context, opinion and processing mode. Historical mixed message and Diff batches retain their original submission ordinals and reply/acknowledgement ids. This Git source has no synthetic message association; a future tool-result adapter would need an explicit association field.

## Official file and turn-Diff sources

Official sources come from public Host-rendered data. A new file snapshot v2 stores `sessionId`, `resourceAddress`, path, format, resource version, byte count, a revision or byte digest, and for a range a digest of its quote and context. Raw text ranges retain one-based lines and zero-based UTF-16 columns; rendered Markdown ranges use rendered UTF-16 offsets without pretending they are raw file lines. The Client validates displayed pages against the same Host version before showing a selection action. A whole-file annotation uses an empty quote and requires a written opinion. Older v1 snapshots with complete text remain readable, including UTF-8 BOM byte semantics. A temporary Locate failure does not change the saved source or mark it permanently expired.

A new `official-diff` snapshot v2 stores Session, changes sequence, turn, file index, path, side metadata, the verified full comparison digest, bounded context, and a selected-fragment digest; it does not copy served hunks into each record. A range keeps one-based line coordinates and zero-based UTF-16 columns at both ends, including multiline selections. A whole-file Diff uses an empty quote and requires a written opinion. The review sidebar owns new annotation actions and Locate; earlier hover-origin records remain readable and locate through that sidebar with their saved annotation IDs. Historical `diff` records and older v1 complete official snapshots remain readable.

New official file and turn-Diff records use snapshot v2 and protocol v6. Storage writes `storageVersion: 7`; it reads storage versions 1 through 7 and retains frozen older outbox payloads. The independent settings `officialFileAnnotations` and `officialDiffAnnotations` disable new entry points without deleting existing records.

## Submission payload

```json
{
  "protocolVersion": 6,
  "source": "dsh-annotation",
  "submissionId": "sub-UUID",
  "sessionId": "session-id",
  "delivery": "queue",
  "protocolLocale": "zh",
  "processingMode": "answer",
  "createdAt": 1786716000000,
  "overallRequirement": "Reorganize the proposal using all annotations.",
  "annotations": [],
  "attachmentIdentities": []
}
```

`overallRequirement` carries the official composer text as user goals and constraints; it is omitted for annotation-only submissions. New submissions use `processingMode: answer`; `rewrite` and `modify` remain readable in historical payloads. `delivery` is `queue`. Only selected eligible annotations enter the array, and their ordinals are rewritten contiguously from 1 without changing browser-local ordering. Annotation ids must be unique and the array must not be empty. New submissions emit v6, including message-only batches and batches containing official file or official turn-Diff sources. Every v3–v6 annotation requires an explicit source; v3–v5 remain readable compatibility generations. Explicit message `source.sessionId` requires v6; earlier payloads cannot carry this field. Legacy v1/v2 message payloads remain readable; v1 normalizes to v2 in memory, and v2 retries stay v2. Historical Git Diff remains readable only in the retained compatibility paths and is not admitted for new sends.

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
  storageVersion: 7
  trash?: readonly AnnotationTrashEntry[]
  deletionMarks?: readonly AnnotationDeletionMark[]
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

`editorDraft` is the active editor and `editorDrafts` contains suspended buffers. A new buffer receives a stable draft id before save and uses `new:<draftId>`; an edited annotation uses `edit:<annotationId>`, so multiple unfinished new and edited values can coexist. Each buffer retains its selection capture, text, long-selection decision, changed quote when applicable, and supplemental intent. Keystrokes persist after 400 ms. The first two outside clicks shake a new quick editor. A third outside click or composer input cancels it when its trimmed text is empty and saves it when nonempty. The check button and Enter can explicitly save an empty selection note; a whole-file note requires an opinion. Canceling discards the new buffer without creating an annotation, trash item, source bubble, or selection for the next send. Existing suspended buffers remain recoverable. Save consumes a buffer, while explicit discard removes only the buffer and never the previously saved annotation. An annotation with an unfinished edit and every suspended new editor are excluded from submission.

`trash` retains each deleted annotation and its related unfinished edits; `deletionMarks` records the latest trashed, restored, or purged revision and prevents stale pages or durable history replay from reviving a deletion. A batch delete writes all entries before removing them from the active list. The most recent batch is undoable for 4.5 seconds in the current page; restore retains annotation IDs and historical send status but leaves the next-message selection empty. Permanent deletion removes the local annotation body and keeps only its minimal deletion mark. It does not change durable Session messages.

The `dsh-annotation-source-snapshots` IndexedDB database stores optional full historical source content separately from this per-Session value. Owners use Session and annotation IDs, while content keys include its media type and SHA-256 digest so identical captures share bytes. A complete owner has committed all bytes of the verified source version; an interrupted, changed, or unavailable source leaves the saved quote and context as a fragment. Capture resumes for retained editor, saved, and recycle-bin records when their source becomes available. Purging the last owner removes the unreferenced content. No full copy is added to protocol v6 submissions by this archive.

Absent optional fields preserve old `storageVersion: 2` records: `editorDrafts` and `selectedAnnotationIds` become empty, `selectionMode` becomes `all`, and `processingMode` becomes `answer`. Loaded state then uses explicit selected ids; eligible legacy aggregate drafts migrate to that selection. A missing legacy `retrySubmissionId` selects the first retryable outbox entry for compatibility; new snapshots write an id or explicit `null`, so no current retry is chosen implicitly. Selected ids are filtered to existing eligible annotations on every publish, including sent annotations explicitly reattached for another message.

The v7 writer keeps `dsh-annotation:v1:<session-id>` and reads storage versions 1 through 7. A validated older value converts to v7 without upgrading frozen outbox payloads or changing their source values; v1 retains its existing normalization to v2. In a browser with Web Locks, the converted value is written under the same Session key while holding the Session lock, then old keys are removed. Without Web Locks, the old value remains readable and new changes stay in separate journal keys until a capable page completes the merge. The Host settings provider retains `enabled`, `autoAttach`, `individualSelection`, and `compactSummary` for profile compatibility and adds independent `officialFileAnnotations` and `officialDiffAnnotations` switches. The current UI exposes all four active annotation controls; legacy selection and summary settings remain readable without changing interaction. User values from the legacy namespace and the pre-0.1.3 enabled browser key retain their existing write-before-delete migration. A legacy plugin-owned `overallRequirementDraft` migrates once into the official composer after a successful claim.

An outbox entry contains the immutable payload, target Session id, deterministic message id, attempt count, optional attachment metadata, and status. The payload fixes its selected annotations, contiguous ordinals, `processingMode`, `overallRequirement`, `protocolLocale`, supplemental links, and any `attachmentIdentities`. When identities are present, their count and ordered kinds must agree with the attachment metadata or recovery rejects the record. The `attachments` metadata stores `{ count, kinds, mediaTypes, names }`: `kinds` retains ordered `image`/`file` tags, while `mediaTypes` and `names` describe images only. It contains no attachment bytes or temporary upload receipts. Legacy `images: { count, mediaTypes, names }` remains readable and represents an image-only batch; when both fields exist, `attachments` owns the retry requirement. These fields are retained by the v7 storage migration without upgrading frozen older payloads.

Storage recovery distinguishes a missing value, a fully validated value, and a failed read. With a supported storage version and valid JSON, each annotation, outbox entry, and editor buffer is validated separately: independent valid entries and the valid overall requirement remain visible, while damaged entries and duplicate identities are excluded from the working view. Invalid editor targets and duplicate buffer keys are excluded too. The original browser value and any legacy keys remain untouched, the storage warning remains visible, and automatic saves are blocked after any read failure. This preserves damaged batches and unfinished text for manual recovery from browser storage. Invalid JSON and unsupported storage versions cannot be partially decoded and open with an empty working view under the same write block. A later successful reload or explicit clearing of the browser value is required before normal saves resume. Valid v1/v2/v3/v4/v5/v6/v7 data still follows the migrations above, including frozen retry payloads; a transient write failure after a successful read remains retryable. Selected ids are deduplicated and filtered to eligible saved annotations, including reattached sent annotations.

Each browser page first writes its changed records to a unique `dsh-annotation:v1:<session-id>:journal:<id>` key. This synchronous write retains the latest page-hide editor state even when a lock request is pending. Web Locks serializes validation, merge, and replacement of the v7 Session value; processed journal keys are removed only after that write succeeds. Other pages reload on the browser `storage` event. Two pages adding different annotations keep both records. An unrelated stale save contains no deletion operation, so it cannot revive a deleted draft. Concurrent edits of one draft or unfinished buffer retain both versions by assigning the conflicting copy a new annotation or buffer id; a deletion paired with a concurrent unfinished edit retains the edited buffer and a draft copy. Live composer selection remains local to each page, while the stored selection and processing choice follow the last applied journal. Frozen payloads and submission ids remain unchanged; a conflicting payload with the same id, conflicting non-empty overall requirements, invalid journal data, or a failed canonical write keeps the journal keys and reports a storage error. For a shared outbox id, `sent` remains authoritative and otherwise the higher attempt and advanced status win. Without Web Locks, unique journal writes and cross-page reads still protect data, but entries are not compacted; browser storage quota can eventually stop further saves.

The Client rereads submission and acknowledgement history when the Chat snapshot changes; an Inbox-only update reuses the last history result. A Session controller caches each unchanged immutable Chat node's parsed protocol data in a `WeakMap`, so node replacement and older-page loading parse new nodes while removed nodes can be collected. Unloading the controller releases the cache and derived history. Reconciliation reuses unchanged annotation, outbox, editor, and reply-association references. A view without visible changes does not notify subscribers, and unchanged persisted fields do not start another browser write. A changed Chat snapshot still visits its node list to detect replacements; this cache reduces parsing and writes, not the node-list scan.

## Host preference recovery

DSH `0.2.1-alpha.2` stores editable preferences in the `dsh-annotation` profile entry. `archivedPreferencesImported` is a volatile Config boolean, defaulting to `false`, outside browser annotation storage and submission protocols. A successful archive recovery writes supported missing preference fields and this marker in one revision-fenced mutation. Existing user overrides win; after completion, clearing a field inherits its profile/default value rather than restoring the archive. Protocol v6, storage v7 and frozen outbox entries retain their separate versions; the private Diff signing service is no longer installed.

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

- `draft` content may be edited or deleted. The most recent deleted batch remains undoable in memory for 4.5 seconds. A changed edit buffer blocks that saved draft from eligibility until Save or Discard; discarding the buffer preserves the saved draft.
- Batch creation includes only explicitly selected eligible annotations. A newly saved draft is selected by default; a sent annotation may be selected again and keeps its original id and source bubble. Unselected drafts remain `draft`, and payload ordinals become contiguous for that batch. Durable replay restores each submitted annotation's payload ordinal rather than browser-local numbering.
- The record's sent status reflects durable delivery even while its paperclip is selected for another message; paperclip selection only controls the next submission.
- Annotation records use `queued` as the frozen post-submit state. The UI labels them “confirming delivery outcome” or “retry available” until the matching outbox entry is authoritatively queued; successful withdrawal restores only that batch. Direct discard has the same effect only for a never-queued failed/ready record.
- An overlapping message selection starts an independent new annotation. `queued`, `sent`, and `processed` records retain their submitted content; a sent or processed record can be reattached for a later message without creating another annotation. Historical linked supplements and old Diff rebinds retain `supplementalTo`; new Diff rebinds are unavailable.
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

A client-side item-count or size rejection occurs before final submission and leaves new annotations as drafts; attachment identity preflight may already have completed. A recorded attachment batch requires the same count and ordered kinds before any Host call. New records then compare preflight identities, and the Host independently verifies admitted blocks before queueing or deduplication. Missing, added, reordered, renamed, or replaced attachments reject the attempt without changing its payload. A fresh upload receipt for the original content and name is valid. Legacy image-only metadata requires that count of images; legacy records without identities cannot detect same-kind substitutions. To send different attachments, discard the old record and create a new submission. A transport failure is ambiguous and remains retryable with the same id: the official composer draft and armed annotation claim stay in place. Only message-source `ready` or `failed` retries can send; a stale action against `queued`, `accepted`, or `sent` is a no-op, and `withdrawn` aborts. Loading a persisted `sending` or still-unobserved `accepted` entry converts it to `failed`, preserving the frozen payload after a refresh or tab crash and making the same id retryable. Host deduplication resolves a retry that arrived after an unseen successful admission.

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

The Client accepts only markers whose submissionId + annotationId pair exists in the current Session. A reattached annotation keeps one record but can have several submitted pairs; the Client rebuilds those associations from durable user messages and confirmed local outbox entries so both earlier and later replies remain interactive after reload. Unknown, duplicate, forged, and malformed markers are ignored, and reply markers never change business status.
