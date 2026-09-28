# Privacy and security model

## Data retained before submission

For each DSH Session, the browser stores selected reply text, annotations, and any previously saved frozen Diff sides with their file/context/version metadata, selectors, source IDs, one active editor and multiple stable suspended editor buffers, drafts, selected annotation IDs, selection mode, processing mode, retry intent, and immutable retry records under `dsh-annotation:v1:<session-id>` and pending `:journal:<id>` keys in the origin's `localStorage`. Every changed journal entry includes the before and after values needed to merge concurrent pages, so unfinished text can remain in a journal until compaction succeeds. If the current key is absent, valid data under `dsh-inline-comments:v1:<session-id>` or `dsh-inline-annotations:v1:<session-id>` remains available and is converted under the Session lock before the legacy keys are removed. The Host profile patch stores `enabled`, `autoAttach`, `individualSelection`, `compactSummary`, transcript-visibility preferences and the boolean `archivedPreferencesImported` marker under the `dsh-annotation` entry; none contains annotation content. Recovery may read the Host-retained `settings.yaml.imported` file, but extracts only supported booleans from this plugin’s current and legacy namespaces. It never writes other namespaces, deletes the archive, logs its values or adds them to a model message. When the Host has no user-layer value, version 0.1.3 reads a valid pre-0.1.3 `dsh.inline-comments.enabled` value and removes that browser key only after the Host accepts it. Editor input is written after 400 ms of inactivity. Clicking outside or pressing Escape suspends a changed editor; explicit discard removes only that buffer and never a saved annotation.

New outbox payloads freeze ordered attachment identities supplied by DSH: stable content-addressed attachment id, byte count, name, and image media type where applicable. Separate summary metadata retains counts and image/file kinds. Neither field contains raw bytes or temporary upload receipts. After refresh, users must reselect the same content and names in the original order; a fresh receipt for the same file is valid. Legacy records without identities remain readable but can only enforce their recorded count and kinds, so same-kind substitution cannot be detected for those older records.

Only selected, saved annotations enter a submission; unselected annotations and unsaved editor buffers never do. Before explicit submission, opinion text and editor buffers stay browser-local. Only the selected batch reaches the model-visible user message. DSH's official composer owns attachment selection and file uploads, including uploads that occur before message submission. Anyone with access to the browser profile or origin storage may be able to read local annotation content.

If a session's browser value cannot be fully validated, valid independent records may remain visible with a storage warning. The plugin keeps the original value, blocks automatic saves for that session, and does not remove damaged entries or unfinished text from browser storage. Invalid JSON and unsupported versions remain unreadable until the value is repaired or cleared through browser site-data controls.

## Data retained after submission

Submission creates one standard DSH user message. Its model-visible text and structured source fields include the complete selected quotes and annotations, `processingMode`, and any `supplementalTo` links; its content appends the official image and file blocks in attachment order. The data follows the current DSH Session's persistence, model-provider, export, backup, and deletion policies. The plugin cannot retract content after the durable user message exists.

The command lifecycle does not duplicate the base64url payload because `recordInput` is false. Attachment preflight emits no user message or model request; its command result records stable attachment identities and names, not raw bytes or receipts. Historical Diff preview results may already contain complete source files in Session logs. The final user message remains the authoritative model-visible record. Historical Diff source metadata retains both full file sides, while its readable body includes the selected quote and bounded context. Session export and backup can therefore include more source code than the selected lines.

## Network access

The plugin contains no telemetry, analytics, or WebSocket client. Its Settings card makes user-triggered, same-origin `fetch` requests to the public dsh-market API for capability discovery, update checks, and update-progress polling; these requests contain no annotation content. Submission uses DSH's existing command Remote (`commands/execute`, with the session command fallback for attachment-free submissions). Attachment admission, image reads, file uploads, and Session operations use DSH's services.

## Validation

The Host validates protocol version, source identity, structured source fields, stable IDs, quote offsets, ordinal order, delivery mode, `processingMode`, supplement links, receiving Session identity, annotation count, and complete decoded byte size. A missing `processingMode` resolves to `answer`; an invalid mode or manual command input fails before inbox admission.

Assistant Markdown is rendered by DSH's untrusted Markdown primitive. Model acknowledgement and reply markers are parsed as text and removed before rendering; they are never injected as HTML.

The retired Diff reader and private signing service are not installed. Existing complete snapshots remain in historical Session or browser storage until that data is removed through the Host or browser's normal storage controls. New message-source annotations do not read Git files.

## Clearing local drafts

Delete one draft and use the temporary Undo action when needed. The composer list has no local-storage usage display, recovery export/download, or bulk-clear footer; local drafts and editor buffers still save automatically and recover after a refresh. An explicit discard removes its selected editor buffer without a queue-state restriction and never deletes a saved annotation. Existing local data is retained. Browser site-data controls remain the way to clear every plugin-local record for the origin. None of these actions deletes already submitted DSH Session history.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Remove prompts, selected text, API keys, paths, and Session logs from reports unless a maintainer requests a secure minimal sample.
