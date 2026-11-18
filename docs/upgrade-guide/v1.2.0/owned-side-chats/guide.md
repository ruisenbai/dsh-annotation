---
kind: upgrade-guide
description: Plugin 1.3.1 runs owned side chats on stock DSH 0.2.2-rc.4.
---

# Owned side chats

[简体中文](guide.zh.md) · English

## Change

Plugin 1.3.1 requires DSH `>=0.2.2-rc.4` and Node.js `>=24.9.0`. It supplies workspace filtering and the side transcript start on a stock Host.

## Migration

1. Update DSH to `0.2.2-rc.4` or later, install the complete 1.3.1 plugin package, then reopen Desktop or restart Web and refresh the browser.
2. Open existing tabs from their original conversation’s right sidebar to continue their saved history. Choose **＋** to create a side chat from the history saved at that point.
3. Access a side chat from its owning conversation. Hover its tab to open it independently or archive it. Choose **Archived** in the side panel to restore it. Keep browser site data when migrating legacy tabs, including their local associations and drafts.
