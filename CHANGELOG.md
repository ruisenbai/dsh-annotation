# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning while DeepSeek Harness compatibility remains pre-release.

## [Unreleased]

### Added

- Immediate annotation-input opening after selecting assistant reply text, without an intermediate action menu.
- A direct annotation input with icon-only Cancel and Save actions, 400 ms local autosave, empty outside-click dismissal, and red shake feedback when dirty input requires a decision.
- Draft, delivery-outcome/retry, authoritative queue, and sent list groups with official state dots, two-line rows, deletion undo, local-data export, draft clearing, and storage-usage feedback.
- Official DSH buttons, icons, tooltips, and Toasts for plugin actions and submission results, with the original Lucide MapPin retained for Locate source.
- Web-native assistant flow, reasoning disclosure, stopped marker, composer geometry, 28 px icon-action targets, semantic colors, form typography, floating surfaces, and user-message bubbles while preserving the established Locate source glyph.
- Counted submission actions, task-state destination notices, and authoritative accepted/queued/sent transitions that expose withdrawal only for an observed queue item.
- Complete-line marker anchoring, an overflow-safe mobile gutter, ascending same-row order, and animation-frame-coalesced measurement.
- Exact marker-line centering in the active container or window viewport during source navigation, including CSS zoom correction, reduced-motion behavior, and a stale-selector marker fallback.
- Unit and real Chromium coverage for compact editing, autosave, mobile and zoom layout, dark mode, reasoning disclosure, and source location.
- GitHub-ready repository metadata and CI.

### Fixed

- The first Locate source action after creating an annotation now resolves updated annotation geometry and centers the source immediately.

## [0.1.0] - 2026-08-14

### Added

- Inline selection and annotation editing for finalized assistant replies.
- Multi-draft review list with local recovery, overlap handling, and code/table coordinates.
- Task-aware queue, steer, archived-session fork, withdrawal, and immutable retry behavior.
- Durable standard user-message provenance and folded timeline rendering.
- Explicit model acknowledgement parsing for processed annotation ids.
- Bidirectional source navigation and CSS Custom Highlight support with marker fallback.
- Host, protocol, controller, DOM selection, component, and cross-plane integration tests.

[Unreleased]: https://github.com/YOUR_ORG/dsh-inline-annotations/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YOUR_ORG/dsh-inline-annotations/releases/tag/v0.1.0
