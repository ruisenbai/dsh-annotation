# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning while DeepSeek Harness compatibility remains pre-release.

## [Unreleased]

### Added

- A browser-wide **DSH Inline Comments** switch in General Settings. It is enabled by default; disabling it restores official conversation renderers and removes comment UI while preserving drafts, outbox state, visible composer text, and history for later re-enabling. Disabling while a submission is in flight releases the composer claim as soon as the transport settles.
- Automatic migration from `dsh-inline-annotations:v1:<session-id>` to `dsh-inline-comments:v1:<session-id>` without discarding valid Session data.
- Current `inlineComments` user-message provenance and `dsh-inline-comments:` model acknowledgement output, with readers for durable `inlineAnnotations` provenance and acknowledgement markers.
- A hidden command-view row for durable rows recorded under the pre-rename `inline_annotations_submit` command, so upgraded Sessions keep them out of the visible timeline.
- A paperclip toggle in the annotation header that arms the current Session's official composer without expanding the list or sending. Armed annotations follow the live unsent set until the official submit.
- One official composer submission containing ordinary text plus structured annotations, driven by the official Enter key and Send button. Annotation-only submission is allowed when the composer text is empty.
- One-time migration of the removed plugin-owned overall-request text into the official composer on the first successful attachment.
- Explicit refusal of mixed image and annotation drafts because DSH command claims do not carry composer image ids.
- A selection action bar with Add annotation and Copy buttons after selecting assistant reply text. The selection stays alive, so Ctrl+C keeps working; Copy keeps the selection, and clicking elsewhere or pressing Escape dismisses the bar.
- A direct annotation input with icon-only Cancel and Save actions, 400 ms local autosave, empty outside-click dismissal, and red shake feedback when dirty input requires a decision.
- Draft, attachable, delivery-outcome/retry, authoritative queue, and sent list groups with official state dots, two-line rows, deletion undo, local-data export, draft clearing, and storage-usage feedback.
- Official DSH buttons, icons, tooltips, and Toasts for plugin actions and submission results, with the original Lucide MapPin retained for Locate source.
- Web-native assistant flow, reasoning disclosure, stopped marker, composer geometry, 28 px icon-action targets, semantic colors, form typography, floating surfaces, and user-message bubbles while preserving the established Locate source glyph.
- Complete-line marker anchoring, an overflow-safe mobile gutter, ascending same-row order, and animation-frame-coalesced measurement.
- Exact marker-line centering in the active container or window viewport during source navigation, including CSS zoom correction, reduced-motion behavior, and a stale-selector marker fallback.
- Unit and real Chromium coverage for compact editing, autosave, mobile and zoom layout, dark mode, reasoning disclosure, attach toggle, official composer submission, and source location.
- GitHub-ready repository metadata and CI.

### Changed

- The project and npm package are named **DSH Inline Comments** and `dsh-inline-comments`; the Cordis row, default command, artifact names, documentation, and install examples use the same identity.
- The English UI uses “comment” instead of “annotation”. The durable `dsh-inline-annotations:<submissionId>` message-id namespace remains unchanged so pre-upgrade retries keep one authoritative queue identity.
- The Chinese UI term 注解 is renamed to 注释 across the interface, the collapsed timeline summary, and the Chinese README.
- The plugin no longer renders an overall-requirement textarea, destination notices, or its own send/retry button. The official composer is the only task input and submit surface.
- `overallRequirement` now carries the official composer text at submit time; submitted history renders it as the ordinary user-message text above the folded annotation card.
- Attachment retry reuses the immutable submission id and payload through the official composer.

### Removed

- Archived-session fork-on-send behavior: archived tasks have no active composer and cannot arm annotations.

### Fixed

- The first Locate source action after creating an annotation now resolves updated annotation geometry and centers the source immediately.
- Editing an annotation from its numbered marker now anchors the editor to the right of the marker (flipping left in narrow viewports) instead of the top-right corner, and the edit dialog exposes a delete action for the draft backed by the existing undo.

## [0.1.0] - 2026-08-14

### Added

- Inline selection and annotation editing for finalized assistant replies.
- Multi-draft review list with local recovery, overlap handling, and code/table coordinates.
- Task-aware queue, steer, archived-session fork, withdrawal, and immutable retry behavior.
- Durable standard user-message provenance and folded timeline rendering.
- Explicit model acknowledgement parsing for processed annotation ids.
- Bidirectional source navigation and CSS Custom Highlight support with marker fallback.
- Host, protocol, controller, DOM selection, component, and cross-plane integration tests.

[Unreleased]: https://github.com/ruisenbai/dsh-inline-comments/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ruisenbai/dsh-inline-comments/releases/tag/v0.1.0
