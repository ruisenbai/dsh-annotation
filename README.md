# dsh-inline-annotations

[简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-43853d.svg)](package.json)

A standalone DeepSeek Harness plugin for reviewing assistant replies in place. Select exact reply text, keep several comments as editable drafts, attach them to the official composer, and submit one idempotent task containing composer text plus structured annotations.

> **Compatibility:** this project requires DeepSeek Harness `0.1.0-rc.6` or a later `0.1.x` prerelease. DSH is pre-release software. The plugin must shadow three shipped conversation renderers because DSH does not yet expose an inline assistant-body slot. Review [Compatibility](docs/compatibility.md) before upgrading DSH.

## Features

- Select text inside one finalized assistant reply to open the annotation input immediately, without an intermediate action menu or click.
- Type directly in the compact selection-positioned input with icon-only Cancel and Save actions. An empty outside click closes it; a dirty outside click keeps it open, turns the input red, and shakes it until one action is chosen.
- Autosave unfinished editor text after 400 ms, display its local-save state, and restore it after a refresh without treating it as a submitted annotation.
- Group two-line rows into ready-to-attach, delivery-outcome/retry, authoritatively queued, and sent sections; use official DSH buttons, state dots, icons, tooltips, and Toasts.
- Toggle the paperclip in the annotation header without expanding or sending. Armed annotations follow the live draft set until the official composer submits.
- Use the official composer as the only task input and Send surface. Ordinary text plus annotations, or annotations alone, produce one task and one model execution.
- Match the official Web assistant flow, reasoning disclosure, stopped marker, composer docks, icon-action geometry, form typography, semantic colors, floating surfaces, and user-message bubbles while retaining the original map-pin glyph for Locate source.
- Undo one draft deletion, export current-Session recovery JSON, clear unsubmitted drafts, and inspect local storage usage from the composer list.
- Preserve the exact quote, prefix/suffix selector, assistant message id, event sequence, annotation id, and submission id.
- Capture language and line coordinates for code, or row/column coordinates for tables.
- Merge overlapping selections into the existing draft instead of stacking ambiguous highlights.
- Preserve the official composer's submission policy; annotation command admission uses one idempotent queued user message.
- Report authoritative queue, durable send, and retryable failure outcomes through distinct DSH Toasts; withdrawal appears only while the batch remains in the observed queue.
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

Open the DSH Web URL and select text in a finalized assistant reply. The compact input opens immediately; type the comment and use its check icon to create the draft, or use X to cancel. Drafts appear above the official composer. Click the paperclip in the annotation header, enter any task text in the official composer, and use its normal Enter key or Send button. The paperclip also enables an annotation-only submission when the composer text is empty.

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

The paperclip has two states. Unarmed annotations remain browser-local and editable. Armed annotations follow the live unsent set: edits, deletions, and new drafts apply until the official composer submits. The submit transaction then freezes one immutable payload, clears the official draft only after command success, and leaves later annotations for the next task. Clicking the paperclip again detaches without changing text, cursor position, or panel expansion.

Transport acceptance is not presented as queue admission. The queued Toast appears only after `ConversationSnapshot.queue` contains the stable message id, and its withdrawal control remains available only in that state. A durable `user/message` changes the result to sent and removes withdrawal. A failed transaction retains the official draft, armed state, immutable payload, and submission id for retry.

Existing values written into the removed plugin-owned overall-request field migrate into the official composer on the first successful attachment. The value is cleared from plugin storage only after the composer accepts the claim.

The current DSH command submit API does not expose official composer image ids. The plugin therefore refuses attachment while images are present and refuses a mixed submission if images are added after arming. It does not discard either image or annotation drafts.

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

Unsent quotes, comments, unfinished editor text, and retry records stay in `localStorage` under `dsh-inline-annotations:v1:<session-id>`. The visible key remains `v1` while its validated value uses `storageVersion: 2`; version-one values migrate on read. Local data is not sent to the Host or model until the user submits through the official composer. Submitted quotes and comments become part of the current Session log and model context. The plugin has no analytics, telemetry, or external network client. See [Privacy](docs/privacy.md).

## Model experience

- **Before submission:** no prompt, token, or KV-cache effect.
- **On submission:** one standard user message contains the official composer text, complete annotation batch, stable ids, source quotes, comments, and structural coordinates.
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
- Archived tasks have no active composer and cannot arm annotations. Create annotations in an editable task.
- DSH command claims do not carry composer image ids, so images and inline annotations cannot share one submission yet.
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
