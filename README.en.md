# DSH Annotation

Package name: `dsh-annotation`

[简体中文](README.md)

[![CI](https://github.com/ruisenbai/dsh-annotation/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ruisenbai/dsh-annotation/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/ruisenbai/dsh-annotation)](https://github.com/ruisenbai/dsh-annotation/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-43853d.svg)](package.json)

Long AI replies are much easier to review when each note can sit beside the exact sentence it belongs to. dsh-annotation lets you highlight a passage, write feedback in place, collect several annotations, and send them together with text, images, and files through DSH's normal composer. The model then answers each annotation in order under an "Annotation N:" heading, and the original reply labels can show annotation summaries.

> **Interaction origin:** this plugin is an independent, unofficial recreation of ChatGPT's inline commenting feature for DeepSeek Harness. It copies the workflow, not OpenAI source code, assets, APIs, or branding, and it is not affiliated with or endorsed by OpenAI.

> **Market category: Sessions & Messages.** The plugin reviews assistant messages within one Session and submits annotated user messages through the official composer; it is not a theme or general appearance plugin.
>
> **Host requirement:** Plugin `0.9.0` (unreleased) requires DSH Web `0.1.6-alpha.2`. The release manifest states this exact requirement through `engines.dsh` and lockstep `@deepseek-ai/dsh-*` peers; desktop clients must embed the same version. DSH is pre-release software, so review [Compatibility](docs/compatibility.md) before upgrading.
>
> **Integration compatibility:** DSH does not expose an inline assistant-body slot. The plugin decorates the existing assistant renderer in place without occupying `assistant-step`; user and steering rows use priority shadowing.

## Preview

The complete workflow stays inside the conversation: select a quote, leave one or more numbered annotations, review the drafts, and send them from the familiar DSH composer.

![DSH Annotation overview with numbered annotations, an inline editor, and the composer draft list](docs/assets/inline-comments-overview.png)

Highlight the exact words you want to discuss; the browser selection remains available for copying.

![Selected assistant text with Add annotation and Copy actions](docs/assets/inline-comments-selection.png)

Write the note right beside the quote while its context is still on screen.

![Inline annotation editor beside an assistant reply](docs/assets/inline-comments-editor.png)

Review and adjust all local drafts before attaching them to the official composer.

![Inline annotation draft list with quoted source text](docs/assets/inline-comments-drafts.png)

Need a break from annotations? Turn the feature off under **Settings → Annotations** without deleting your drafts.

The dedicated Settings section includes feature enablement, automatic attachment, compact annotation summary, transcript visibility, and optional Market update actions.

![Annotation configuration in the main DSH Settings panel](docs/assets/inline-comments-settings.png)

## Features

- Select text inside one finalized assistant reply to open a small action bar with Add annotation and Copy. The blue selection stays alive, so Ctrl+C keeps working until a button is chosen.
- Type directly in the compact selection-positioned input with icon-only Cancel and Save actions. An empty outside click closes it; a dirty outside click keeps it open, turns the input red, and shakes it until one action is chosen.
- Autosave unfinished editor text after 400 ms, display its local-save state, and restore it after a refresh without treating it as a submitted annotation.
- The editor handles Chinese input methods end to end: Enter during composition only confirms the candidate, the Enter produced right after compositionend never saves, a plain Enter saves, Shift+Enter inserts a newline, Escape during composition does not close the editor, and composition events never reach the official composer.
- After a new annotation saves, the Client waits one microtask plus one frame and returns focus and the previous caret position to the official Lexical composer only when the same editor keeps its visible text and the user has not moved focus elsewhere. Save failures, cancel, Session switches, and edits to existing annotations never grab focus, and composer text and file-reference chips are never overwritten.
- Group two-line rows into ready-to-attach, delivery-outcome/retry, authoritatively queued, and sent sections; use official DSH buttons, state dots, icons, tooltips, and Toasts.
- Saving a new annotation attaches it to the official composer by default. Turn automatic attachment off in the plugin's configuration form when preferred, or use the header paperclip at any time. Toggling neither expands nor sends; armed annotations follow the live draft set until the official composer submits.
- Use the official composer as the only task input and Send surface. Text, annotations, images, and files can be submitted together; annotation-only submissions use the same path.
- Text, annotations, and attachments travel in one submission: the internal command declares `attachments = true`, and the Client sends standard DSH image and file attachments through the Session-addressed `commands/execute` Remote. The Host appends durable image and file blocks to one user message in attachment order. Attachment bytes and temporary file-upload receipts never enter the annotation JSON or command string.
- Success clears the text and attachments and marks the annotations sent. Failure retains the text, attachments, and annotations; retries reuse the same submission id, and the Host keeps only the first successful result per submission id.
- The outbox stores only attachment count, ordered kinds, and image media types and names; it never stores attachment bytes or temporary file-upload receipts. After a refresh, reselect the original attachments. Retry preserves the original count and ordered kinds; adding or removing attachments requires discarding the pending record and submitting again. Legacy image-only retry metadata remains readable.
- Slash commands are released automatically: while attached, composer content starting with `/` releases the official input claim and removes the zero-width token, so `/goal`, `/model`, and friends run through the official pipeline; leaving command state re-attaches. `claim.submit()` re-checks slash commands to defeat the Enter race — a raced command routes through the Session-addressed command Remote without creating an outbox, sending annotations, or marking them sent, and a failed command keeps its text, attachments, and annotations.
- Per-annotation model replies: the Host prompt asks the model to answer each annotation in order, start every paragraph with "Annotation N:", never merge annotations, emit a hidden `dsh-annotation-reply` marker before each paragraph, and end with the `dsh-annotation` acknowledgement marker. The Client preserves the original "Annotation N" text without duplicating or covering it and adds a transparent target only within reliably measured text bounds. Extra blank lines between markers and repeated ordinals from multiple batches do not shift later targets; a marker window remains plain when its earliest complete matching label is repeated. A 300 ms hover or keyboard focus shows the number, quote, and annotation summary without blocking drag selection or copying, and activation navigates to the source.
- Reply markers only control display: the Client accepts only submissionId + annotationId pairs that exist in the current Session, ignores unknown, duplicate, forged, and malformed markers, keeps plain "Annotation N" text when the model breaks format, associates multiple batches in one reply by annotationId, and never mutates business state from reply markers — only acknowledgements update the processed status.
- Custom user and steering nodes show the overall requirement, the annotation summary box, and images and files in their original order. File and skill references retain their official open actions. Images use the official thumbnails and viewer; files show type icons, names, and sizes.
- Compact annotation summary is on by default: while collapsed, the summary aligns right, sizes to its content, and omits the leading icon. Turning it off and saving restores the full-width bar; the paperclip and expand button remain available. An attached summary shows `Annotations ×N`, counting only annotations carried by the current Session's next send; draft, attachment, and delivery changes update the count, while an unattached summary retains its title and status. Hover or focus the collapsed count for a read-only overview of numbers, quotes, annotations, and states. Opening upward expands the full list and bottom summary controls to the same safe width and joins them at a one-pixel seam as one card, aligns controls right, and suppresses the redundant overview. One persistent chevron rotates smoothly and the list fades in from its bottom-right anchor; reduced motion disables both transitions. Escape collapses the list and restores focus to the summary trigger. Narrow screens, CSS zoom, internal scrolling, and annotation, delivery, and editor state remain unchanged.
- Match the official Web assistant flow, reasoning disclosure, stopped marker, composer docks, icon-action geometry, form typography, semantic colors, floating surfaces, and user-message bubbles while retaining the original map-pin glyph for Locate source.
- Delete individual drafts and undo the most recent deletion. The annotation summary has no local-storage usage, export/download, or bulk-clear footer; local autosave and refresh recovery remain available.
- Use official DSH `Switch` and `Tag` primitives in the dedicated **Settings → Annotations** page, and use dsh-market's public update API to check the installed version, install with progress, offer force only after eligible failures, and expose rollback, refresh, or Host restart when supported.
- Preserve the exact quote, prefix/suffix selector, assistant message id, event sequence, annotation id, and submission id.
- Capture language and line coordinates for code, or row/column coordinates for tables.
- Merge overlapping selections into the existing draft instead of stacking ambiguous highlights.
- Preserve the official composer's submission policy; annotation command admission uses one idempotent queued user message.
- Report authoritative queue, durable send, and retryable failure outcomes through distinct DSH Toasts; withdrawal appears only while the batch remains in the observed queue.
- Render submitted annotation batches as collapsed timeline cards with source navigation.
- Place markers only in existing safe space after the endpoint line, without reserving a body gutter or changing padding. Multiple annotations on one visual line share a single ×N marker with members ordered by ordinal; annotations without safe space or a restored range remain accessible from the summary. Highlights stay faint, with stronger emphasis only for active annotations, and ordinary body hover or clicks do not open previews. Coalesce layout updates across reasoning disclosure, viewport, font, and zoom changes.
- Clicking a marker opens its preview. Previews and body-anchored editors use measured viewport, scroll-container, and official-composer bounds: existing side space first, then below or above, with a safely bounded scrollable panel on narrow screens or when space is insufficient. Placement follows scrolling and supports 125%/200% CSS zoom. Summary-started edits stay inline, draft editing retains undo-backed deletion, and dirty-editor outside-click protection and IME handling remain active.
- When locating source text, including from a model-reply label, expand it first only when it is actually inside a folded Turn container, center the complete quote in the active conversation or window viewport with CSS zoom correction, and show one smoothly fading background over the quote range. A newer navigation cancels the earlier transient effect without clearing persistent marker or editor highlights.
- Persist unsent drafts, unfinished editor text, and immutable retry records in browser `localStorage`.
- Deduplicate retries across transport failures with a stable submission-derived message id.
- Advance `sent` to `processed` only when the model explicitly returns annotation ids in the requested acknowledgement marker.
- Fall back to numbered markers when the CSS Custom Highlight API is unavailable.

## Install

### Requirements

- DSH Web `0.1.6-alpha.2` exactly (run `dsh --version`; for a desktop client, also check its embedded host version)
- Node.js `^22.19.0` or `>=24.0.0`
- A `web` profile

When `dsh --version` differs, choose the mapped plugin release below or change to the required host version; do not bypass the version constraint with a forced install or disabled peer checks.

### Install a GitHub release (recommended)

Published GitHub Releases contain prebuilt tarballs that need no local build. The stable alias below points at the latest published release, not the unreleased `0.9.0`; check that release's host requirement before installing. Use the source-build procedure below to verify `0.9.0`:

```bash
curl -fL -o dsh-annotation.tgz https://github.com/ruisenbai/dsh-annotation/releases/latest/download/dsh-annotation.tgz
dsh plugin --profile web add ./dsh-annotation.tgz
dsh web
```

Restart DSH Web after installation when it is already running. Unreleased `0.9.0` targets DSH `0.1.6-alpha.2`. Historical mapping: `v0.8.0` targets DSH `0.1.5-alpha.1`; `v0.7.0` targets DSH `0.1.3-alpha.2`; `v0.6.0` targets DSH `0.1.3-alpha.1`; `v0.5.2`, `v0.5.1`, and `v0.5.0` target DSH `0.1.2-rc.1`; `v0.4.0` targets DSH `0.1.2-alpha.3`; `v0.3.0` targets DSH `0.1.2-alpha.1`; `v0.2.4` targets DSH `0.1.1-rc.2`.

### Build from a clone

Source builds require the complete DSH `0.1.6-alpha.2` dependency family. Prepare the matching dependencies and run the checks in the [development guide](docs/development.md#install-and-verify). Dependencies unavailable from npm must come from verifiable official source or official artifacts and must be built and installed in a disposable directory; never commit machine-local `file:` paths or a temporary lockfile to the release manifest.

Open the DSH Web URL and select text in a finalized assistant reply. A small action bar appears with Add annotation and Copy; the selection stays alive so Ctrl+C also works. Choose Add annotation to open the compact input, type the note, and press Enter or use its check icon to create the draft. Drafts appear above and attach to the official composer by default. Enter optional task text, attach images or files, then use the official Enter key or Send button to submit text, annotations, and attachments together. Turn automatic attachment off in the plugin's configuration form if desired; the header paperclip remains available for manual attachment. While attached, a slash command temporarily releases the claim: the command runs normally and the annotations are kept.

## Settings

The dedicated **Settings → Annotations** section contains three annotation switches: plugin enablement (`enabled`), automatic composer attachment for new annotations (`autoAttach`), and Compact annotation summary (`compactSummary`). These default to on; every transcript-hiding switch below defaults to off. Edits remain staged until **Save** writes the Host's `dsh-annotation` settings namespace, then apply to every Session served by that Host. Disabling the plugin removes the assistant decoration and restores the user renderers, removes the selection action bar, markers, annotation list, annotation action, hidden transport view, and composer attachment, and preserves visible composer text. Drafts, unfinished editor text, outbox state, and submitted history remain stored and return when the switch is enabled again. Disabling automatic attachment leaves new annotations as local drafts; the header paperclip still attaches them manually. Disabling Compact annotation summary and saving restores the full-width layout and leading icon without changing annotation, delivery, or editor state.

**Reset to default** clears the selected field's user-layer override and restores its declared default; hiding switches reset to off. The DSH settings provider persists all settings. Stored `localTools` user overrides are ignored without deletion or migration, and existing annotation data is not cleared. During the rename upgrade, user values from the legacy `inline-comments` settings namespace migrate into the new namespace, and the legacy section is cleared only after the new write succeeds. On the first 0.1.3 load, a valid legacy browser enablement switch remains effective until the Host accepts it, then its old key is removed. Per-Session annotation drafts remain browser-local as described under [Privacy and persistence](#privacy-and-persistence).

The **Plugin update** area in the same form calls only dsh-market's same-origin `dsh-market/update-api/v1` API. The first **Check for updates** action discovers Market capabilities before checking `dsh-annotation`; install, rollback, and Host restart appear only when Market advertises them. **Update anyway** appears only after a normal attempt fails under an eligible release policy. A live activation can request a page refresh, while desktop- or operator-owned Hosts show no restart button. Without a compatible dsh-market installation, the card directs the user to **Settings → Plugin Market** and never calls a legacy private update route.

### Transcript visibility

The following 18 switches default to off and take effect after **Save**. They use a responsive two-column grid in the main Settings panel and collapse to one column when space is narrow. Enabled categories do not mount their details; they show non-expandable counts such as `think x 3`, `Read x 2`, `Grep x 1`, and `Bash x 2`. Clicking, keyboard input, and browser find cannot reveal hidden details. Turn the corresponding switch off and save to restore them. **Hide all tool calls and results** overrides the named tool switches; **Hide other tools** covers every remaining built-in, third-party, MCP, or unknown tool name.

| Switch                                            | Setting                 | Hidden content                                                                            |
| ------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Hide reasoning                                    | `hideReasoning`         | Assistant reasoning                                                                       |
| Hide all tool calls and results                   | `hideTools`             | Every tool argument, result, and nested-call detail                                       |
| Hide `read` / `read_image`                        | `hideToolRead`          | Text- and image-reading tool calls and results                                            |
| Hide `glob`                                       | `hideToolGlob`          | File-name matching calls and results                                                      |
| Hide `grep`                                       | `hideToolGrep`          | Text-search calls and results                                                             |
| Hide `bash` / `pwsh`                              | `hideToolBash`          | Shell calls and results                                                                   |
| Hide `edit`                                       | `hideToolEdit`          | File-editing calls and results                                                            |
| Hide `write`                                      | `hideToolWrite`         | File-writing calls and results                                                            |
| Hide other tools                                  | `hideToolOther`         | Web, subagent, workflow, skill, todo, job, third-party, and unknown tools                 |
| Hide context                                      | `hideContext`           | Injected context and system prompts                                                       |
| Hide command results                              | `hideCommandResults`    | Command result messages                                                                   |
| Hide context compaction                           | `hideCompaction`        | Automatic and manual compaction summaries                                                 |
| Hide retries                                      | `hideRetries`           | Retry notices and reasons                                                                 |
| Hide failure and token-limit notices              | `hideErrors`            | Errors, truncation, and interruption notices                                              |
| Hide images and files                             | `hideAttachments`       | Message image/file attachments, not Markdown images inside body text                      |
| Hide submitted annotation details                 | `hideAnnotationHistory` | Annotation detail lists in user messages, without deleting drafts or history              |
| Hide completed-reply statistics and action footer | `hideTurnDetails`       | Statistics and standard copy, fork, and annotation actions; extension-only actions remain |
| Hide other details                                | `hideOther`             | Unknown content blocks and workflow details                                               |

Assistant activity is grouped within each loaded turn: each reasoning block counts once, tool calls including nested calls are deduplicated by call ID and grouped by name, and retries count attempts. A named tool filter removes matching tool heads and results while preserving visible sibling calls. When a selected root call owns nested calls, its whole card is hidden and every concealed call remains represented in the summary. Summaries update during streaming and history loading. User attachment/annotation summaries and events outside a turn stay beside their own message. Ordinary human text, steering instructions, and assistant body text are never removed by these switches.

While any hiding switch is active, Chat temporarily uses the full-body layout so its Compact mode cannot also conceal intermediate prose. Turning all hiding switches off restores the current Chat preference without writing that preference. These switches affect Chat presentation only, not the session log, model input, or stored annotation data. Approval, question, plan-review, running-status, and history-loading controls remain available.

## Delivery behavior

Automatic attachment is on by default, so saving a new annotation immediately arms the paperclip. Unarmed annotations remain browser-local and editable. Armed annotations follow the live unsent set: edits, deletions, and new drafts apply until the official composer submits through Enter or Send. The submit transaction then freezes one immutable payload, clears the official draft only after command success, and leaves later annotations for the next task. Clicking the paperclip manually attaches or detaches without changing text, cursor position, or panel expansion.

Transport acceptance is not presented as queue admission. An independent subscription to `session.projections.faceOf('inbox')` confirms queue admission only when a `next-turn` item's `id` matches the stable message id; only that placement exposes the queued Toast and withdrawal control. `next-step` items are not withdrawable queue entries. An `undefined` projection means not yet synchronized, not an empty queue, and cannot establish that an observed item departed. A durable `user/message` in the Chat target changes the result to sent and removes withdrawal. A failed transaction retains the official draft, images and files, armed state, immutable payload, and submission id for retry.

Regardless of the automatic-attachment switch: slash commands never carry annotations, input-method word selection never triggers a send, and a failed send never loses data.

Existing values written into the removed plugin-owned overall-request field migrate into the official composer on the first successful attachment. The value is cleared from plugin storage only after the composer accepts the claim.

## States

- **Draft:** editable and browser-local.
- **Queued:** observed as a DSH Inbox `next-turn` item but not yet present in model history.
- **Sent:** reconstructed from the durable annotation `user/message` event.
- **Processed:** set only after a model response contains the exact submission and annotation ids in the machine acknowledgement.

The plugin never marks an annotation processed from elapsed time, turn completion, or UI timing.

## Configuration

The bundle inserts one `dsh-annotation` row. Override its `config` values in the active profile composition if necessary:

| Key                           |             Default | Purpose                                                            |
| ----------------------------- | ------------------: | ------------------------------------------------------------------ |
| `commandName`                 | `annotation_submit` | Internal browser-to-Host transport command name                    |
| `maxPayloadBytes`             |            `524288` | Maximum decoded JSON batch size; text is rejected, never truncated |
| `maxAnnotationsPerSubmission` |               `100` | Maximum annotations in one batch                                   |
| `warnSelectionChars`          |             `12000` | Require an extra confirmation for a long quote                     |
| `locateHistoryPages`          |                `20` | Maximum older-history pages loaded during source navigation        |

Changing `commandName` must change the same dual-face row used by Host and Client; the shared Cordis row passes one configuration to both halves. Legacy internal commands left behind by the upgrade (`inline_comments_submit`, `inline_annotations_submit`) are forwarded to the new handler through invisible compatibility aliases; no second business implementation is retained.

## Protocol and compatibility

New submissions only emit protocol v2 (`protocolVersion: 2`, `source: "dsh-annotation"`, and the `annotation` field). Legacy v1 data is still read, and the old `comment` field converts into the new internal model. Historical messages are never rewritten; legacy acknowledgement and reply markers are still recognized, and new messages only emit `dsh-annotation-*` markers. Local storage uses the `dsh-annotation:v1:<session-id>` namespace: startup prefers the new storage, otherwise it validates, converts, and writes the legacy storage before deleting the old keys. See [Compatibility](docs/compatibility.md) and [Data model](docs/data-model.md).

## Privacy and persistence

Unsent quotes, annotations, unfinished editor text, and retry records stay in `localStorage` under `dsh-annotation:v1:<session-id>`. When the current key is absent, valid data under `dsh-inline-comments:v1:<session-id>` or `dsh-inline-annotations:v1:<session-id>` is validated, converted, and written to the new key; the legacy keys are removed only after the write succeeds. The visible key remains `v1` while its validated value uses `storageVersion: 2`; version-one values migrate on read. Local data is not sent to the Host or model until the user submits through the official composer. Submitted quotes and annotations become part of the current Session log and model context. Images and files persist through the official DSH attachment channel; annotation data never stores attachment bytes or temporary file-upload receipts. The plugin has no analytics, telemetry, or external network client. See [Privacy](docs/privacy.md).

## Model experience

- **Before submission:** no prompt, token, or KV-cache effect.
- **On submission:** one standard user message contains the official composer text, complete annotation batch, stable ids, source quotes, annotations, structural coordinates, and official image and file attachments.
- **Per-annotation replies:** the prompt asks the model to answer each annotation in order, start every paragraph with "Annotation N:", and emit a hidden association marker before each paragraph; the Client strips machine markers before rendering, preserves the visible reply labels, and provides transparent targets for labels it can locate reliably.
- **Acknowledgement request:** the message asks the model to append one hidden acknowledgement marker listing only annotations it actually handled. The Client strips that marker before rendering while retaining the raw model text for replay.
- **Tokens:** cost scales with the complete selected text and annotations; the plugin does not truncate them. The byte limit rejects oversized batches before admission.
- **KV cache:** steering or follow-up input changes subsequent model context like any other user message.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:coverage
pnpm build
pnpm test:profile
pnpm verify:bundle
pnpm publint
pnpm pack
```

The CI workflow runs type checking, linting, unit tests, a production bundle, artifact verification, and publint on Node 22.19 and 24. The Node 24 job also runs the Chromium fixture regression and a separate real-profile smoke, then creates the package artifact. `pnpm test:profile` requires plugin artifacts from `pnpm build` or `pnpm verify`; these are verification requirements, not a claim that `0.9.0` has passed them. See [Development](docs/development.md), [Architecture](docs/architecture.md), and [Data model](docs/data-model.md).

## Known limitations and deferred work

- DSH has no public slot inside assistant Markdown. Through `ctx.slots.entries()`, this plugin decorates existing `assistant-step` components in place and composes their inject faces without adding another keyed entry — so it composes with same-style decorators such as dsh-smooth-stream; `user` and `steering` remain priority `-100` shadows. Slot-entry changes require a compatibility review.
- Browser-local drafts do not synchronize between devices or browser profiles. Sent batches reconstruct from the Session log on any client.
- The machine acknowledgement is cooperative. If the model omits or corrupts it, annotations remain `sent` rather than being guessed as processed; if the model breaks the reply format, its "Annotation N" text stays plain.
- After a page refresh, unsent composer attachments cannot be recovered. A recorded attachment batch requires reselecting the original images and files in the original type order, or discarding the pending record.
- Archived tasks have no active composer and cannot arm annotations. Create annotations in an editable task.
- CSS Custom Highlights are browser-dependent. Numbered markers and timeline navigation remain available without them.
- A selection must stay within one assistant reply. Cross-message selections are rejected. Markdown file-link text participates in selection capture and restoration, but recognition depends on the current Host DOM and needs upgrade verification; see [Compatibility](docs/compatibility.md#high-risk-integration-points).
- DSH has no private command-registration flag, so the validated internal transport command may appear in slash-command discovery. The legacy command aliases never appear in the plugin settings page.

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Release guide](RELEASING.md)
- [Changelog](CHANGELOG.md)

Released under the [MIT License](LICENSE).
