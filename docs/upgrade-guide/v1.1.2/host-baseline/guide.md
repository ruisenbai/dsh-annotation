---
kind: upgrade-guide
description: Plugin 1.1.3 requires DSH 0.2.1-rc.2.
---

# Upgrade the annotation Host baseline

English | [中文](guide.zh.md)

## Change

Plugin 1.1.2 targets DSH `0.2.1-alpha.2`. Version 1.1.3 requires `>=0.2.1-rc.2` and uses the Host's current composer and message rendering APIs. Browser storage v6, submission protocol v5, drafts, recycle-bin records, and frozen retries retain their existing formats.

## Migration

1. Confirm the Host version is `0.2.1-rc.2` or later. Keep plugin 1.1.2 while using `0.2.1-alpha.2`; update the complete Host through its normal update procedure.
2. Install the 1.1.3 GitHub Release archive with the [README commands](../../../../README.md#installation), using your existing Web profile.
3. Restart that profile's running Host and refresh its browser page. Preserve browser site data, Session logs, and profile settings.
4. Confirm `why dsh-annotation` resolves `1.1.3`. Open **Settings → Annotations**, check saved records, and send an annotation with composer text and an attachment.
