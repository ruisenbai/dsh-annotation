---
kind: upgrade-guide
description: DSH Annotation 1.3.2 requires DSH 0.2.2-rc.5 or later.
---

# Upgrade the annotation Host baseline

[简体中文](guide.zh.md) · English

## Change

The minimum DSH version for 1.3.2 moves from `0.2.2-rc.4` to `0.2.2-rc.5`. The plugin uses the current conversation component to display independent sessions in the sidebar and requires Node.js `24.9.0` or later. Users on `rc.4` can keep [1.3.1](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.3.1).

## Migration

1. Check the DSH version in Desktop settings or run `dsh --version` for Web. Update to `0.2.2-rc.5` or later first.
2. Install 1.3.2. Reopen Desktop or restart the Web service and refresh the browser. The plugin reads your existing drafts, side chats, and annotation records.
3. Select text in the main conversation and choose **Annotate in sidebar**. Check that the editor opens beside the source. Create a side chat and confirm that the transcript starts empty and accepts a message.

[Compatibility](../../../compatibility.en.md)
