# dsh-inline-annotations

[简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-43853d.svg)](package.json)

A GitHub-ready DeepSeek Harness plugin for reviewing assistant replies in place. Select exact reply text, attach comments or requirements, keep several annotations as editable drafts, and submit one idempotent batch to the current task.

> **Compatibility:** this project targets DeepSeek Harness `0.1.0-rc.5` and `0.1.0-rc.6`. DSH is pre-release software. The plugin must shadow three shipped conversation renderers because DSH does not yet expose an inline assistant-body slot. Review [Compatibility](docs/compatibility.md) before upgrading DSH.

## Features

- Select text inside one finalized assistant reply, then annotate or copy it from a 36 px floating toolbar.
- Type directly in a compact selection-positioned input with icon-only Cancel and Save actions. An empty outside click closes it; a dirty outside click keeps it open, turns the input red, and shakes it until one action is chosen.
- Autosave unfinished editor text after 400 ms, display its local-save state, and restore it after a refresh without treating it as a submitted annotation.
- Group two-line rows into ready, delivery-outcome/retry, authoritatively queued, and sent sections; use official DSH buttons, state dots, icons, tooltips, and Toasts.
- Undo one draft deletion, export current-Session recovery JSON, clear unsubmitted drafts, and inspect local storage usage from the composer list.
- Preserve the exact quote, prefix/suffix selector, assistant message id, event sequence, annotation id, and submission id.
- Capture language and line coordinates for code, or row/column coordinates for tables.
- Merge overlapping selections into the existing draft instead of stacking ambiguous highlights.
- Route an idle submission to the next turn, inject into a running task at its next safe step, or queue behind a blocking confirmation.
- Show the batch size in the submission action and explain its destination beside the button for idle, running, waiting, archived, and retry states.
- Report authoritative queue, durable send, and retryable failure outcomes through distinct DSH Toasts; withdrawal appears only while the batch remains in the observed queue.
- Copy archived-session context into a new task before submitting.
- Render submitted annotation batches as collapsed timeline cards with source navigation.
- Place numbered markers after the complete endpoint line, reserve an overflow-safe gutter, retain ascending order, and coalesce layout updates across reasoning disclosure, viewport, font, and zoom changes.
- Center the exact numbered-marker line in the active conversation or window viewport when locating source text, including CSS zoom correction.
- Persist unsent drafts, unfinished editor text, and immutable retry records in browser `localStorage`.
- Deduplicate retries across transport failures with a stable submission-derived message id.
- Advance `sent` to `processed` only when the model explicitly returns annotation ids in the requested acknowledgement marker.
- Fall back to numbered markers when the CSS Custom Highlight API is unavailable.

## Quick start

### Build from a clone

```bash
git clone https://github.com/YOUR_ORG/dsh-inline-annotations.git
cd dsh-inline-annotations
corepack enable
pnpm install
pnpm verify
```

Install the built folder into a Web profile:

```bash
dsh plugin --profile web add .
dsh web --profile web
```

Open the DSH Web URL, select text in a finalized assistant reply, and choose **Add annotation**. Type in the compact input and use its check icon to create the draft. Drafts appear in the composer dock; review the grouped list, optionally add an overall requirement, then send the batch.

### Install a GitHub release

Each `v*.*.*` tag builds an installable tarball and attaches it to GitHub Releases. Download it and install the prebuilt package without running repository build scripts:

```bash
gh release download v0.1.0 --repo YOUR_ORG/dsh-inline-annotations --pattern '*.tgz'
dsh plugin --profile web add ./dsh-inline-annotations-0.1.0.tgz
```

A pinned Git dependency also works when the profile explicitly allows this trusted package to run its `prepare` build:

```bash
dsh plugin --profile web add git+https://github.com/YOUR_ORG/dsh-inline-annotations.git#v0.1.0
```

Replace `YOUR_ORG` in this README and `package.json` before publishing your fork.

## Delivery behavior

| Session state                 | Counted action                         | Destination notice                      | Host action                                                         |
| ----------------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Idle                          | Send N annotations to task             | Sending starts the task                 | `Agent.followup()` starts the next turn                             |
| Running                       | Send N annotations to current task     | Enters at the next safe execution point | `Agent.steer()` admits the batch at the next safe step              |
| Waiting for approval/question | Queue N annotations after confirmation | Queues after confirmation completes     | `Agent.followup()` waits for the next turn                          |
| Archived                      | Copy and send N annotations            | Copies into a new task                  | `ISessions.fork()` creates and opens a child, then queues the batch |

Transport acceptance is not presented as queue admission. The queued Toast appears only after `ConversationSnapshot.queue` contains the stable message id, and its withdrawal control remains available only in that state. A durable `user/message` changes the result to sent and removes withdrawal. A failed Toast retains and names the original immutable submission id for retry.

A network error leaves the immutable payload and submission id available for retry; a page reload during an uncertain send restores the same batch as retryable. Once the standard `user/message` event exists, its history is not edited; a later clarification becomes a new draft linked to the earlier annotation.

## States

- **Draft:** editable and browser-local.
- **Queued:** admitted to the DSH inbox but not yet present in model history.
- **Sent:** reconstructed from the durable annotation `user/message` event.
- **Processed:** set only after a model response contains the exact submission and annotation ids in the machine acknowledgement.

The plugin never marks an annotation processed from elapsed time, turn completion, or UI timing.

## Configuration

The bundle inserts one `dsh-inline-annotations` row. Override its `config` values in the active profile composition if necessary:

| Key                           |                     Default | Purpose                                                            |
| ----------------------------- | --------------------------: | ------------------------------------------------------------------ |
| `commandName`                 | `inline_annotations_submit` | Internal browser-to-Host transport command name                    |
| `maxPayloadBytes`             |                    `524288` | Maximum decoded JSON batch size; text is rejected, never truncated |
| `maxAnnotationsPerSubmission` |                       `100` | Maximum annotations in one batch                                   |
| `warnSelectionChars`          |                     `12000` | Require an extra confirmation for a long quote                     |
| `locateHistoryPages`          |                        `20` | Maximum older-history pages loaded during source navigation        |

Changing `commandName` must change the same dual-face row used by Host and Client; the shared Cordis row passes one configuration to both halves.

## Privacy and persistence

Unsent quotes, comments, unfinished editor text, and retry records stay in `localStorage` under `dsh-inline-annotations:v1:<session-id>`. The visible key remains `v1` while its validated value uses `storageVersion: 2`; version-one values migrate on read. Local data is not sent to the Host or model until the user submits. Submitted quotes and comments become part of the current Session log and model context. The plugin has no analytics, telemetry, or external network client. See [Privacy](docs/privacy.md).

## Model experience

- **Before submission:** no prompt, token, or KV-cache effect.
- **On submission:** one standard user message contains the complete batch, stable ids, source quotes, comments, structural coordinates, and optional overall requirement.
- **Acknowledgement request:** the message asks the model to append one hidden marker listing only annotations it actually handled. The Client strips that marker before rendering while retaining the raw model text for replay.
- **Tokens:** cost scales with the complete selected text and comments; the plugin does not truncate them. The byte limit rejects oversized batches before admission.
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
pnpm verify:bundle
pnpm publint
pnpm pack
```

The CI workflow runs type checking, linting, unit tests, a real Chromium regression on Node 24, a production bundle, artifact verification, and package creation on Node 22 and 24. See [Development](docs/development.md), [Architecture](docs/architecture.md), and [Data model](docs/data-model.md).

## Known limitations and deferred work

- DSH has no public slot inside assistant Markdown. This plugin replaces the `assistant-step`, `user`, and `steering` keyed renderer cells at priority `-100`; upstream renderer changes require a compatibility review.
- Browser-local drafts do not synchronize between devices or browser profiles. Sent batches reconstruct from the Session log on any client.
- The machine acknowledgement is cooperative. If the model omits or corrupts it, annotations remain `sent` rather than being guessed as processed.
- DSH currently exposes archive as a presentation state without an unarchive operation. The plugin offers the safe supported path: fork to a new task.
- CSS Custom Highlights are browser-dependent. Numbered markers and timeline navigation remain available without them.
- A selection must stay within one assistant reply. Cross-message selections are rejected.
- DSH has no private command-registration flag, so the validated internal transport command may appear in slash-command discovery.

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Release guide](RELEASING.md)
- [Changelog](CHANGELOG.md)

Released under the [MIT License](LICENSE).
