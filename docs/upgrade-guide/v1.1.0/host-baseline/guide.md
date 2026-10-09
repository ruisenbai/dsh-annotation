---
kind: upgrade-guide
description: Plugin 1.1.1 requires DSH 0.2.1-alpha.1 and its matching Cordis dependencies.
---

# Upgrade the annotation Host baseline

English | [中文](guide.zh.md)

## Change

Plugin 1.1.0 targets DSH `0.2.0-rc.1`. Plugin 1.1.1 requires `>=0.2.1-alpha.1` and is verified on `0.2.1-alpha.1`, with matching Cordis and Schemastery dependencies. Installing it on a `0.2.0` Host can fail dependency checks. Browser storage v6 and submission protocol v5 are unchanged; saved drafts, deleted notes, and frozen retries need no data conversion beyond existing readers.

## Migration

1. Run `dsh --version`. Keep plugin 1.1.0 until the target Host is upgraded to `0.2.1-alpha.1`; use the Host's normal update procedure rather than changing individual official dependencies.
2. Install the 1.1.1 archive with the [README installation command](../../../../README.md#installation), using the same Web profile as the Host.
3. Restart that profile's Host and refresh its browser page. Preserve browser site data, Session logs, and profile settings.
4. Run `dsh plugin --profile web why dsh-annotation`, substituting your profile name, and confirm version `1.1.1`. In **Settings → Annotations**, confirm the existing preferences, then reopen a Session and check its saved records.
