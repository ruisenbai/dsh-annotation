# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning while DeepSeek Harness compatibility remains pre-release.

## [Unreleased]

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

[Unreleased]: https://github.com/ruisenbai/dsh-inline-comments/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/ruisenbai/dsh-inline-comments/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ruisenbai/dsh-inline-comments/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ruisenbai/dsh-inline-comments/releases/tag/v0.1.0
