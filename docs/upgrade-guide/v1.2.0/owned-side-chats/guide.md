---
kind: upgrade-guide
description: Upgrading to 1.3.0 from 1.2.0 raises the minimum Host version to 0.2.2-rc.4.
---

# Owned side chats

[简体中文](guide.zh.md) · English

## Change

Version 1.3.0 requires DeepSeek Harness `>=0.2.2-rc.4` and Node.js `>=24.9.0`. Owned side chats also require a matching Host build with workspace filtering and a visible Chat history start. The official master baseline and registry release show an update notice when workspace filtering is absent.

## Migration

1. Update DeepSeek Harness to `0.2.2-rc.4` or later. For owned side chats, apply the [companion Host patch](https://github.com/ruisenbai/dsh-annotation/releases/download/v1.3.0/dsh-annotation-host-rc4.patch) and build a Host supporting both workspace filtering (`uiWorkspace.registerSessionListFilter`) and the visible Chat history start (`chatTranscriptStart`), then install both halves of [plugin 1.3.0](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.3.0). Reopen Desktop or reload Web.
2. Open existing tabs from their original conversation’s right sidebar to continue their saved history. Choose **＋** to create a side chat from the history saved at that point.
3. Access a side chat from its owning conversation. Hover its tab to open it independently or archive it. Choose **Archived** in the side panel to restore it. Keep browser site data when migrating legacy tabs, including their local associations and drafts.
