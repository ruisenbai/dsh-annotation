---
kind: upgrade-guide
description: Plugin 1.1.2 requires DSH 0.2.1-alpha.2.
---

# Upgrade the annotation Host baseline

English | [中文](guide.zh.md)

## Change

Plugin 1.1.1 targets DSH `0.2.1-alpha.1`. Version 1.1.2 requires `>=0.2.1-alpha.2` and uses that release for development and verification. Browser storage v6, submission protocol v5, saved drafts, recycle-bin records, and frozen retries retain their existing formats.

## Migration

1. Confirm the Host version is `0.2.1-alpha.2` or later. Keep plugin 1.1.1 while using `0.2.1-alpha.1`; update the complete Host through its normal update procedure.
2. Install the 1.1.2 GitHub Release archive with the [README commands](../../../../README.md#installation), using your existing Web profile.
3. Restart that profile's running Host and refresh its browser page. Preserve browser site data, Session logs, and profile settings.
4. Confirm `why dsh-annotation` resolves `1.1.2`. Open **Settings → Annotations** and check the existing preferences and saved Session records.
