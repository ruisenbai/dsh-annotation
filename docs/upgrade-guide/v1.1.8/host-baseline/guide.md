---
kind: upgrade-guide
description: 'Annotation 1.1.8 requires DSH 0.2.2-rc.1 and adapts grouped menus to published and master Hosts.'
---

# Host baseline for 1.1.8

English | [中文](guide.zh.md)

## Change

The minimum Host moves from `0.2.2-alpha.3` to `0.2.2-rc.1`; Node.js remains `>=24.9.0`. Source verification targets master commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. Master grouped menus use CSS anchors and the actual marker button through `Menu.anchorRef`. The same button is the `returnFocus` target, which also anchors the older Menu supplied by the published `0.2.2-rc.1` package. The plugin does not pass the removed rectangle callback.

The public package name is `@bairuisen/dsh-annotation`; the unscoped npm name belongs to a different maintainer. The settings row `dsh-annotation`, annotation protocol v5, browser storage v6, drafts, recycle-bin records, and frozen retries retain their identifiers and formats. Keep plugin 1.1.7 on the older `0.2.2-alpha.3` Host.

## Migration

1. Run `dsh --version` for Web, or check the Desktop version, and require `0.2.2-rc.1` or newer before installing 1.1.8. The global Web CLI and Desktop runtime can have different versions.
2. Stop the target profile. If it has the old package, run `dsh plugin --profile web remove dsh-annotation`, then install with `dsh plugin --profile web add @bairuisen/dsh-annotation@1.1.8 --registry=https://registry.npmjs.org`. Replace `web` with the actual profile name; do not enable both packages. Use `--registry=https://registry.npmmirror.com` after mirror synchronization. Check `dsh plugin --profile web why @bairuisen/dsh-annotation` resolves 1.1.8. The [GitHub archive](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.1.8) remains an alternative; [development instructions](../../../development.md) cover local builds.
3. Restart the installed profile and refresh its client. Select ordinary text and web/file link labels; confirm one toolbar offers Quote text and Add annotation. Open a grouped marker, choose any member, and check that scrolling and Escape retain usable menu placement and focus.
4. Confirm existing notes, attachment choices, and saved-source navigation remain available after reload. Do not clear browser storage during this upgrade.
