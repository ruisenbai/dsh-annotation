# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning while DeepSeek Harness compatibility remains pre-release.

## [Unreleased]

### Added

- A compact selection toolbar with annotation and copy actions.
- A direct annotation input with icon-only Cancel and Save actions, 400 ms local autosave, empty outside-click dismissal, and red shake feedback when dirty input requires a decision.
- Draft, queued, and sent list groups with two-line rows, deletion undo, local-data export, draft clearing, and storage-usage feedback.
- Official DSH icons and tooltips for all plugin actions, replacing the bundled Lucide dependency.
- Complete-line marker anchoring, an overflow-safe mobile gutter, ascending same-row order, and animation-frame-coalesced measurement.
- Exact marker-line centering in the active scroll viewport during source navigation.
- Unit and real Chromium coverage for compact editing, autosave, mobile and zoom layout, dark mode, reasoning disclosure, and source location.
- GitHub-ready repository metadata and CI.

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
