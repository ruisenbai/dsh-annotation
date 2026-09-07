# Privacy and security model

## Data retained before submission

For each DSH Session, the browser stores selected reply text, annotations, selectors, source ids, unfinished editor text, drafts, and immutable retry records under `dsh-annotation:v1:<session-id>` in the origin's `localStorage`. If that key is absent, valid data under `dsh-inline-comments:v1:<session-id>` or `dsh-inline-annotations:v1:<session-id>` is validated, converted, and written to the new key before the legacy keys are removed. The Host settings provider stores the enabled preference under the `dsh-annotation` namespace; that preference contains no annotation content. User values from the legacy `inline-comments` settings namespace migrate once into the new namespace. When the Host has no user-layer value, version 0.1.3 reads a valid pre-0.1.3 `dsh.inline-comments.enabled` value and removes that browser key only after the Host accepts it. Editor input is written after 400 ms of inactivity; Cancel removes the unfinished editor record.

Outbox attachment metadata stores only the count, ordered image/file kinds, and image media types and display names. It contains no attachment bytes or temporary file-upload receipts. Unsent composer attachments cannot be reconstructed from this metadata after a refresh; retry requires the recorded count and ordered kinds. Legacy image-only metadata remains readable. Users must reselect the original attachments because the retry guard does not compare file bytes.

Before explicit submission, the plugin does not send annotation content to the DSH Host, the model provider, analytics, or another network service. DSH's official composer owns attachment selection and file uploads, including uploads that occur before message submission. Anyone with access to the browser profile or origin storage may be able to read local annotation content.

## Data retained after submission

Submission creates one standard DSH user message. Its model-visible text and provenance include the complete selected quotes and annotations, and its content appends the official image and file blocks in attachment order. The data follows the current DSH Session's persistence, model-provider, export, backup, and deletion policies. The plugin cannot retract content after the durable user message exists.

The command lifecycle does not duplicate the base64url payload because `recordInput` is false. The user message remains the authoritative model-visible record.

## Network access

The plugin contains no direct `fetch`, WebSocket, telemetry, analytics, or update-check client. Browser-to-Host submission uses DSH's existing command Remote (`commands/execute`, with the session command fallback for attachment-free submissions). Attachment admission, image reads, file uploads, and Session operations use DSH's services.

## Validation

The Host validates protocol version, source identity, field types, stable ids, quote offsets, ordinal order, delivery mode, receiving Session identity, annotation count, and complete decoded byte size. Invalid manual command input fails before inbox admission.

Assistant Markdown is rendered by DSH's untrusted Markdown primitive. Model acknowledgement and reply markers are parsed as text and removed before rendering; they are never injected as HTML.

## Clearing local drafts

Delete one draft and use the temporary Undo action when needed. The composer list can export the current Session's local recovery JSON or clear its unfinished editor and unsubmitted annotations. A failed pending record can be discarded outright. Browser site-data controls remain the way to clear every plugin-local record for the origin. None of these actions deletes already submitted DSH Session history.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Remove prompts, selected text, API keys, paths, and Session logs from reports unless a maintainer requests a secure minimal sample.
