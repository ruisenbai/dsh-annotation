---
kind: upgrade-guide
description: 'Annotation 1.1.7 requires DSH 0.2.2-alpha.3 or newer and follows the current master child-Session selection policy.'
---

# Host baseline and child-Session selection

English | [中文](guide.zh.md)

## Change

The minimum Host moves from `0.2.2-alpha.2` to `0.2.2-alpha.3`, with Node.js `>=24.9.0`. Verification targets master commit `8bd073392eef6f54e921a093b95076248eb08cbb`. Its continuable child Sessions no longer expose parent-availability metadata; Quote text and Add annotation follow the Host's current selection policy. One-shot, unknown, and removed Sessions retain their restrictions. The published package version alone does not identify this master change.

Records use one newest-first list with attachment controls instead of delivery labels and groups. Any available annotation can be attached again after sending. Associated reply labels are blue bold text without underlines and retain previews and source navigation. Annotation protocol v5 and browser storage v6 keep their formats.

## Migration

1. Check `dsh --version` and `node --version`. Keep plugin 1.1.6 while using DSH `0.2.2-alpha.2`.
2. Update the Host before installing 1.1.7. Developers verifying the latest master use the pinned checkout and [official source verification](../../../development.md#official-source-verification).
3. Restart the profile and refresh its Web page. Select text in a completed reply and verify one toolbar offers Quote text and Add annotation, including in a continuable child Session.
4. Attach a saved annotation, send it, and attach it again. Confirm the record count, unchanged note identity, and blue bold reply link. Retain existing browser storage and Session data.
