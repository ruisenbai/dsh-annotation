---
kind: upgrade-guide
description: 'Annotation development requires the pinned master APIs, and installation requires DSH 0.2.2-alpha.2 or newer.'
---

# Host baseline and shared message selection

English | [中文](guide.zh.md)

## Change

The minimum Host moves from `0.2.1-rc.2` to `0.2.2-alpha.2`, with Node.js `>=24.9.0`. The shared Quote text / Add annotation toolbar requires the text-interaction API in master commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`. The published `0.2.2-alpha.2` family includes that API. Attachment and editing actions remain locked while the Host checks or sends a message. Annotation protocol v5 and browser storage v6 do not change.

## Migration

1. Check `dsh --version` and `node --version`. Keep plugin 1.1.5 while the Host remains on `0.2.1-rc.2`.
2. Upgrade to DSH `0.2.2-alpha.2` or newer before installing 1.1.6. Developers can use the registry lockfile or [official source verification](../../../development.md#official-source-verification).
3. Refresh the Web page, select text in a completed assistant reply, and verify one toolbar offers Quote text and Add annotation. Quote text inserts the passage into the composer; Add annotation opens its editor. Retain existing browser storage and Session data.
