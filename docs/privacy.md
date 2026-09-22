# Privacy and security model

## Data retained before submission

For each DSH Session, the browser stores selected reply text, complete frozen Diff sides and their file/context/version metadata, annotations, selectors, source IDs, one active editor and multiple stable suspended editor buffers, drafts, selected annotation IDs, selection mode, processing mode, retry intent, and immutable retry records under `dsh-annotation:v1:<session-id>` in the origin's `localStorage`. If that key is absent, valid data under `dsh-inline-comments:v1:<session-id>` or `dsh-inline-annotations:v1:<session-id>` is validated, converted, and written to the new key before the legacy keys are removed. The Host profile patch stores `enabled`, `autoAttach`, `individualSelection`, `compactSummary`, transcript-visibility preferences and the boolean `archivedPreferencesImported` marker under the `dsh-annotation` entry; none contains annotation content. Recovery may read the Host-retained `settings.yaml.imported` file, but extracts only supported booleans from this plugin’s current and legacy namespaces. It never writes other namespaces, deletes the archive, logs its values or adds them to a model message. When the Host has no user-layer value, version 0.1.3 reads a valid pre-0.1.3 `dsh.inline-comments.enabled` value and removes that browser key only after the Host accepts it. Editor input is written after 400 ms of inactivity. Clicking outside or pressing Escape suspends a changed editor; explicit discard removes only that buffer and never a saved annotation.

New outbox payloads freeze ordered attachment identities supplied by DSH: stable content-addressed attachment id, byte count, name, and image media type where applicable. Separate summary metadata retains counts and image/file kinds. Neither field contains raw bytes or temporary upload receipts. After refresh, users must reselect the same content and names in the original order; a fresh receipt for the same file is valid. Legacy records without identities remain readable but can only enforce their recorded count and kinds, so same-kind substitution cannot be detected for those older records.

Only selected, saved annotations enter a submission; unselected annotations and unsaved editor buffers never do. Before explicit submission, opinion text and editor buffers stay browser-local. Opening a Git Diff is a Host read: its ordinary command result records the file list or both captured sides, hashes and signature in the current Session log, even if no annotation is later sent. These preview commands do not call the model. Only the selected batch reaches the model-visible user message. DSH's official composer owns attachment selection and file uploads, including uploads that occur before message submission. Anyone with access to the browser profile or origin storage may be able to read local annotation content.

## Data retained after submission

Submission creates one standard DSH user message. Its model-visible text and structured source fields include the complete selected quotes and annotations, `processingMode`, and any `supplementalTo` links; its content appends the official image and file blocks in attachment order. The data follows the current DSH Session's persistence, model-provider, export, backup, and deletion policies. The plugin cannot retract content after the durable user message exists.

The command lifecycle does not duplicate the base64url payload because `recordInput` is false. Attachment preflight emits no user message or model request; its command result records stable attachment identities and names, not raw bytes or receipts. Diff preview results can contain complete source files; `recordInput: false` does not suppress result logging. The final user message remains the authoritative model-visible record. Its source metadata retains both full Diff sides for historical navigation, while its readable body includes the selected quote and bounded context. Session export and backup can therefore include more source code than the selected lines.

## Network access

The plugin contains no telemetry, analytics, or WebSocket client. Its Settings card makes user-triggered, same-origin `fetch` requests to the public dsh-market API for capability discovery, update checks, and update-progress polling; these requests contain no annotation content. Browser-to-Host Diff reads and submission use DSH's existing command Remote (`commands/execute`, with the session command fallback for attachment-free submissions). Attachment admission, image reads, file uploads, and Session operations use DSH's services.

## Validation

The Host validates protocol version, source identity, structured source fields, stable IDs, quote offsets, ordinal order, delivery mode, `processingMode`, supplement links, receiving Session identity, annotation count, and complete decoded byte size. A missing `processingMode` resolves to `answer`; an invalid mode or manual command input fails before inbox admission.

Assistant Markdown is rendered by DSH's untrusted Markdown primitive. Model acknowledgement and reply markers are parsed as text and removed before rendering; they are never injected as HTML.

The Diff reader resolves paths from the current Session cwd through `ctx.fs`, refuses traversal and out-of-workspace paths, reads Git blobs by immutable id, rejects binary/special/over-limit content, and verifies captured fingerprints and the Host signature. Git commands are read-only, use literal pathspecs, disable external diff/text conversion/filesystem-monitor hooks, and clear inherited Git repository/index overrides. The private signing key resides in the `dsh_annotation_diff_key` storage domain, never in a payload or model message. Removing that key does not erase embedded historical snapshots, but it prevents new anchors or retries from authenticating earlier captures.

## Clearing local drafts

Delete one draft and use the temporary Undo action when needed. The composer list has no local-storage usage display, recovery export/download, or bulk-clear footer; local drafts and editor buffers still save automatically and recover after a refresh. An explicit discard removes its selected editor buffer without a queue-state restriction and never deletes a saved annotation. Existing local data is retained. Browser site-data controls remain the way to clear every plugin-local record for the origin. None of these actions deletes already submitted DSH Session history.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Remove prompts, selected text, API keys, paths, and Session logs from reports unless a maintainer requests a secure minimal sample.
