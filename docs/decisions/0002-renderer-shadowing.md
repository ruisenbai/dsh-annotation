# Decision 0002: Shadow input-message renderers

Status: accepted for user and steering rows; assistant part superseded by Decision 0003

## Context

Submitted batches also need a folded timeline row. Standard user and steering renderers display generated model text and do not expose a per-message body slot.

## Decision

Register priority `-100` replacements for the keyed `user` and `steering` cells. Lower priority wins while the shipped priority-0 renderers remain available after plugin disposal.

Build replacements only from public DSH data and primitives. Preserve user text, images, and file mentions, and render official image thumbnails through the official image viewer for annotation submissions. Use additive slots for the composer dock and assistant action. Decision 0003 replaces the former `assistant-step` shadow with an in-place decorator.

## Consequences

- Stop or uninstall restores shipped user and steering renderers through Slot lifecycle disposal.
- DSH renderer changes can cause visual or behavioral drift even when TypeScript still compiles.
- Every supported DSH upgrade requires the Web smoke matrix in `docs/development.md`.
