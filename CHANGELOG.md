# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning while DeepSeek Harness compatibility remains pre-release.

## [Unreleased]

## [0.2.4] - 2026-08-23

### Fixed

- The read-only preview shown when hovering or focusing the attached `Annotations ×N` summary button now always opens six pixels above the button. Its anchor uses the button's top edge and translates by the preview's full height, so varying annotation counts never make it expand downward over the composer.

## [0.2.3] - 2026-08-23

### Changed

- Clicking a numbered annotation marker in the assistant body now opens a compact preview eight pixels below that marker instead of expanding the composer summary box. Editing or supplementing from the preview keeps the editor under the same marker, follows nested scrolling and viewport resizing, and preserves marker anchoring on mobile instead of switching to the generic bottom editor. Editing from the summary box remains inline. The marker preview closes from its close action, the same marker, outside pointer input, or Escape.

## [0.2.2] - 2026-08-23

### Fixed

- Empty-composer and image submissions no longer fail with `Client API: commands/execute rejected "images"`: the `commands/execute` face on a Session AgentContext is already Agent-scoped and accepts `(line, images)`, not the root Remote form `(agentId, line, images)`. Passing the Session id again shifted the command line into the validated `images` field. The command bridge now calls the scoped two-argument face and uses the target Session context for cross-Session retries.

## [0.2.1] - 2026-08-23

### Fixed

- Sending attached annotations no longer fails with `cannot get property "remote" without inject`: the submission command is now executed through the session AgentContext that `claim.submit` receives (`actx`), which is the only context that carries the scoped `commands/execute` remote. Reading the remote from the plugin's root client context threw in the real Web runtime (the fixture provided it, so browser regressions passed) and surfaced as the send-failed Toast with the raw Cordis error. The slash-command re-check inside `claim.submit` uses the same scope context, and the session `command()` fallback stays for runtimes without the remote.

## [0.2.0] - 2026-08-23

### Changed

- Renamed the public repository to **ruisenbai/dsh-annotation**: package metadata URLs, documentation badges, clone and install instructions, support links, changelog links, and the license line now use the new repository name. GitHub redirects the old repository URLs, and the legacy protocol/storage identifiers intentionally keep their old names for compatibility.
- Renamed the plugin runtime identity to **dsh-annotation**: the npm package name, bundle row, settings namespace, settings card, internal command (`annotation_submit`), log prefixes, Slot ids, locale namespace, DOM data attributes, and CSS Custom Highlight names all use the new identity.
- Unified the user-visible Chinese terminology on 注解 and the internal domain model on annotation semantics (`comment` → `annotation`, `inlineComments` → `annotations`, `inline-comments-submit` → `annotation-submit`).
- Upgraded the internal protocol to v2 (`protocolVersion: 2`, `source: "dsh-annotation"`, `annotation` field). New submissions only emit v2; legacy v1 payloads are still read and converted, historical messages are never rewritten, and legacy acknowledgement and reply markers remain authoritative reads while new messages only emit `dsh-annotation-*` markers.
- Migrated browser storage to the `dsh-annotation:v1:<session-id>` namespace: legacy keys are validated, converted, and written to the new key before removal, and a failed migration keeps the legacy data. The legacy `inline-comments` settings namespace migrates the same way, and the legacy internal command names forward to the new handler through invisible aliases.
- Enabled official slash commands while annotations are attached: composer content starting with `/` temporarily releases the input claim and removes the zero-width token, the claim re-arms when command state ends, `claim.submit()` re-checks slash commands to defeat the Enter race, and a raced command routes through the rc.2 official Session command interface without creating an outbox, sending annotations, or marking them sent.
- Merged composer images into the same submission: the claim declares `CommandClaim.images = true`, images travel as rc.2 standard command attachments, the internal command declares `input.images = true`, the Host appends the admitted durable image blocks to the single user message, and the custom user node renders official image thumbnails and the official image viewer. The outbox stores only image count, media types, and names; after a refresh, a recorded image batch refuses to resubmit without images and offers re-selection or discarding the pending record.
- Restored focus and the previous caret position to the official composer after saving a new annotation (one microtask plus one frame, DOM adapter scoped to the current Session's composer card, no text overwrite, no focus grab on save failure, cancel, Session switch, or edits to existing annotations).
- Completed Chinese input-method handling in the annotation editor: Enter during composition only confirms the candidate, the post-composition Enter never saves, a plain Enter saves, Shift+Enter inserts a newline, Escape during composition never closes the editor, and composition events never reach the official composer.
- The model prompt now demands ordered per-annotation replies: each paragraph starts with `注解 N：`, annotations are never merged, a hidden `dsh-annotation-reply` marker precedes each paragraph, and the reply ends with the `dsh-annotation` acknowledgement marker. The Client validates markers against the current Session, locates each `注解 N` heading by text Range, and overlays React chips that show the annotation number, source quote, and user annotation on hover or keyboard focus; unknown, duplicate, forged, and malformed markers are ignored, and reply markers never mutate business state.
- Stopped registering a competing `conversation.chat.node:assistant-step` entry. The Client now decorates every existing assistant renderer in place, composes its inject face, and restores both fields on disable or unload so renderer plugins such as `dsh-smooth-stream` can remain the sole keyed owner.
- Rebuild annotation ranges and marker geometry after an inner renderer mutates its DOM, while excluding live-region and Think text from persistent quote offsets.
- Matched the rc.2 official queue-action geometry in the annotation summary header: 10 px action spacing, 28 px circular targets, and the official interactive hover background.
- Added a Host-backed, on-by-default automatic-attachment switch. Saving a new annotation now attaches the live annotation set to the official composer, whose Enter key sends it together with visible composer text and images; editing an existing annotation remains attach-neutral and the paperclip remains the manual override.

### Fixed

- A manual detach click on the annotation summary box now sticks: the input-state repair watcher no longer re-attaches the claim after the user cancelled the attachment, while the slash-command release still auto-restores the attachment when the command state ends.
- Clearing the last draft annotation now releases the armed composer claim immediately (even while the claim is still in the claimed phase), so ordinary composer text sends through the official plain-message path afterwards.
- An Enter that lands right after the annotations were cleared no longer fails with the raw `no draft annotations to submit` error: the claim is released after settlement and the composer shows a friendly localized notice, keeping the typed text for the next Enter.
- The annotation summary box's fold button now keeps the same 6 px right margin from the visible card edge as the official task summary box (including the dsh-queue-plus takeover of QueueDock).
- Locate source now survives the history-page race: after `loadOlder` resolves, the Client waits a few frames for the mounted assistant node to register its endpoint instead of failing a synchronous check, and the reveal re-measures once after scrolling an unrendered reply into view (lazy-rendered or `content-visibility` content).
- Editing an existing annotation no longer positions or locates anything in the assistant body: the editor opens inline inside the annotation summary box (including marker-clicked edits and supplemental annotations), so a failed marker lookup can no longer strand the popup at the body's top-right corner.
- The selection action bar now opens wherever the selection drag ends: `pointerup` is observed on the document in the capture phase, so releasing the mouse outside the assistant body (past the bubble edge, over other UI) still opens the bar for a selection that lies inside one assistant reply. Cross-message selections keep being rejected, and the existing dismiss paths (outside pointerdown, selection collapse, Escape) are unchanged.

### Added

- Empty-content annotations (highlight-only): an empty or whitespace-only annotation saves as `kind: "highlight-only"` and means “mark the quoted text only; review and respond to it”. The editor shows the empty-content hint and keeps Save enabled, the list/overview/chips display 仅标记原文 instead of a blank line, clearing an existing annotation converts it to highlight-only (deletion still requires the delete action), and highlight-only items participate in attachment, send, retry, processed confirmation, and per-annotation replies.
- Compact “注解 ×N” summary (the only summary mode): the annotation summary box always shows the attached-annotation count near the official composer as a “注解 ×N” chip; clicking it pops the full annotation list upward (a drop-up panel anchored above the chip row, rounded on top, max-height with internal scrolling) instead of expanding downward. Hover or keyboard focus on the chip opens a read-only overview (ordinal, quote summary, annotation summary, highlight-only state, and draft/retry status) with max-height internal scrolling. The count updates on add/delete/attach/detach, resets after a successful send, survives failed sends, counts highlight-only items, and stays per-Session. The previous `summaryMode` setting was removed; the compact behavior is unconditional.
- The plugin settings card is now named **注解** (zh) / **Annotations** (en) instead of the package id, and a new Host-backed `localTools` switch (default on) shows or hides the local data usage, export, and clear-drafts controls at the bottom of the annotation list; the toggle takes effect immediately through a reactive store.
- DSH-locale model protocol: new submissions freeze `protocolLocale: "zh" | "en"` from the DSH locale at outbox creation; first send and retries reuse the frozen language, UI language switches never rewrite pending or sent content, and legacy records without the field keep the old English protocol. Reply parsing accepts 注解 N：/注解 N:/Annotation N: and legacy formats; association still rides the hidden stable marker.
- Optional dsh-focus-chat compatibility (`src/client/focus-adapter.ts`): the adapter stays passive without the plugin (no service dependency, no pending startup), detects the focus view through its public DOM root, pauses marker/chip measurement for hidden nodes while the focus view is active, re-measures after view switches, and deduplicates normal-view markers by message id. Failures only disable focus enhancements.

## [0.1.3] - 2026-08-22

### Changed

- Raised the supported and development baseline to DeepSeek Harness `0.1.1-rc.2` and added the complete matching DSH development environment so peer validation covers the assembled release.
- Moved the enabled switch from General Settings to **Settings → Plugins → Plugin configuration** through the official Host `inline-comments` settings namespace and keyed plugin-card Slot.
- Staged enabled-setting edits until Save, added Discard and Reset-to-default behavior, and applied conversation changes only after the Host settings provider accepts the value.
- Moved enabled-preference persistence to the active DSH settings provider while keeping per-Session comment drafts in browser storage; a valid pre-0.1.3 browser preference migrates once and is removed only after the Host accepts it.

## [0.1.2] - 2026-08-20

### Changed

- Raised the supported and development baseline to DeepSeek Harness `0.1.0-rc.8`.
- Migrated historical message images to rc.8's `renderMessageImages` Slot helper after attachment React components and the `loadImage` renderer prop were removed.
- Updated the input-trigger claim callback for rc.8's serialized image argument while keeping mixed image and comment submissions disabled.
- Updated composer reference serialization for rc.8's full-length display ranges so model reference markup replaces the complete inline label.
- Removed the direct `dsh-client-ui-attachment` dependency because rc.8 supplies attachment presentation through the conversation Slot.

## [0.1.1] - 2026-08-19

### Changed

- Raised the supported and development baseline to DeepSeek Harness `0.1.0-rc.7` after reviewing the command, Session, input-trigger, Slot, renderer, and browser-composer integration points.
- Added the optional `unrun` peer required by the current `tsdown` release to load the TypeScript build configuration reliably.
- Added a local oxlint configuration so linting inside a parent repository no longer picks up the parent's configuration.

## [0.1.0] - 2026-08-17

### Added

- A browser-wide **DSH Inline Comments** switch in General Settings. It is enabled by default; disabling it restores official conversation renderers and removes comment UI while preserving drafts, outbox state, visible composer text, and history for later re-enabling. Disabling while a submission is in flight releases the composer claim as soon as the transport settles.
- Automatic migration from `dsh-inline-annotations:v1:<session-id>` to `dsh-inline-comments:v1:<session-id>` without discarding valid Session data.
- Current `inlineComments` user-message provenance and `dsh-inline-comments:` model acknowledgement output, with readers for durable `inlineAnnotations` provenance and acknowledgement markers.
- A hidden command-view row for durable rows recorded under the pre-rename `inline_annotations_submit` command, so upgraded Sessions keep them out of the visible timeline.
- A selection action bar with Add comment and Copy buttons after selecting assistant reply text. The selection stays alive, so Ctrl+C keeps working; Copy keeps the selection, and clicking elsewhere or pressing Escape dismisses the bar.
- A direct comment input with icon-only Cancel and Save actions, 400 ms local autosave, empty outside-click dismissal, and red shake feedback when dirty input requires a decision.
- Draft, attachable, delivery-outcome/retry, authoritative queue, and sent list groups with official state dots, two-line rows, deletion undo, local-data export, draft clearing, and storage-usage feedback.
- A paperclip toggle that arms the current Session's official composer without expanding the list or sending. Armed comments follow the live unsent set until the official submit; ordinary text plus comments, or comments alone, create one task and one model execution.
- One-time migration of the removed plugin-owned overall-request text into the official composer on the first successful attachment, plus explicit refusal of mixed image and comment drafts because DSH command claims do not carry composer image ids.
- Web-native assistant flow, reasoning disclosure, stopped marker, composer geometry, 28 px icon-action targets, semantic colors, form typography, floating surfaces, user-message bubbles, and the original Lucide MapPin for Locate source.
- Complete-line marker anchoring, an overflow-safe mobile gutter, ascending same-row order, animation-frame-coalesced measurement, exact marker-line centering, CSS zoom correction, reduced-motion behavior, and a stale-selector fallback.
- Unit and real Chromium coverage for compact editing, autosave, mobile and zoom layout, dark mode, reasoning disclosure, attachment behavior, official composer submission, and source location, along with GitHub CI and release automation.

### Changed

- The project and npm package are named **DSH Inline Comments** and `dsh-inline-comments`; the Cordis row, default command, artifact names, documentation, and install examples use the same identity.
- The English UI uses “comment” instead of “annotation”, and the Chinese UI uses 注释. The durable `dsh-inline-annotations:<submissionId>` message-id namespace remains unchanged so pre-upgrade retries keep one authoritative queue identity.
- The plugin no longer renders an overall-requirement textarea, destination notices, or its own send/retry button. The official composer is the only task input and submit surface.
- `overallRequirement` carries the official composer text at submit time; submitted history renders it as the ordinary user-message text above the folded comment card.
- Attachment retry reuses the immutable submission id and payload through the official composer.

### Removed

- Archived-session fork-on-send behavior: archived tasks have no active composer and cannot arm comments.

### Fixed

- The first Locate source action after creating a comment resolves updated comment geometry and centers the source immediately.
- Editing a comment from its numbered marker anchors the editor to the right of the marker, flips left in narrow viewports, and exposes a draft delete action backed by undo.

[Unreleased]: https://github.com/ruisenbai/dsh-annotation/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/ruisenbai/dsh-annotation/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/ruisenbai/dsh-annotation/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/ruisenbai/dsh-annotation/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ruisenbai/dsh-annotation/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ruisenbai/dsh-annotation/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/ruisenbai/dsh-annotation/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ruisenbai/dsh-annotation/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ruisenbai/dsh-annotation/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ruisenbai/dsh-annotation/releases/tag/v0.1.0
