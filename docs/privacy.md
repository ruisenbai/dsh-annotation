# Privacy and security model

## Data retained before submission

For each DSH Session, the browser stores selected reply text, comments, selectors, source ids, unfinished editor text, drafts, and immutable retry records under `dsh-inline-annotations:v1:<session-id>` in the origin's `localStorage`. Editor input is written after 400 ms of inactivity; Cancel removes the unfinished editor record.

Before explicit submission, the plugin does not send this data to the DSH Host, the model provider, analytics, or another network service. Anyone with access to the browser profile or origin storage may be able to read it.

## Data retained after submission

Submission creates one standard DSH user message. Its model-visible text and provenance include the complete selected quotes and comments. The data follows the current DSH Session's persistence, model-provider, export, backup, and deletion policies. The plugin cannot retract content after the durable user message exists.

The command lifecycle does not duplicate the base64url payload because `recordInput` is false. The user message remains the authoritative model-visible record.

## Network access

The plugin contains no direct `fetch`, WebSocket, telemetry, analytics, or update-check client. Browser-to-Host submission uses DSH's existing command Remote. Image reads and Session operations use DSH's injected services.

## Validation

The Host validates protocol version, field types, stable ids, quote offsets, ordinal order, delivery mode, receiving Session identity, annotation count, and complete decoded byte size. Invalid manual command input fails before inbox admission.

Assistant Markdown is rendered by DSH's untrusted Markdown primitive. Model acknowledgement comments are parsed as text and removed before rendering; they are never injected as HTML.

## Clearing local drafts

Delete one draft and use the temporary Undo action when needed. The composer list can export the current Session's local recovery JSON or clear its unfinished editor and unsubmitted annotations. Browser site-data controls remain the way to clear every plugin-local record for the origin. None of these actions deletes already submitted DSH Session history.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Remove prompts, selected text, API keys, paths, and Session logs from reports unless a maintainer requests a secure minimal sample.
