# Releasing

Version tags publish npm-format tarballs through GitHub Releases. This project does not publish to the npm registry.

## One-time repository setup

1. Create the GitHub repository with `main` as its default branch.
2. When publishing under a different owner, replace the owner (`ruisenbai`) in `package.json`, Markdown files, and `.github/ISSUE_TEMPLATE/config.yml`.
3. Enable GitHub Discussions and private vulnerability reporting so the links in `SUPPORT.md` and `SECURITY.md` work.
4. Protect `main`, require the `CI` workflow, and require pull-request review before merging.
5. Keep GitHub Actions permission to write repository contents so the Release workflow can create tags and attach tarballs.

Do not replace the contributor copyright in `LICENSE` unless the project has a specific copyright holder. Contributions are accepted under the same MIT License through `CONTRIBUTING.md`; no separate CLA is required.

## Release checklist

For `0.9.0`, the exact Host target is `0.1.6-alpha.2`; [Compatibility](docs/compatibility.md#dependency-source) records its official source tag and commit. Keep the changelog entry under Unreleased until publication. Record executed checks and outstanding manual checks separately; updating the version, dependency lockfile, or documentation does not establish release readiness. Check the dedicated **Settings → Annotations** page, its responsive 18-switch transcript grid, selective tool filtering, Inbox-only queue updates, unsynchronized Inbox snapshots, next-step exclusion, clickable user/steering references, and Markdown file-link selection and restoration before release. Replace the README settings image with evidence from the main Settings page.

1. Move relevant entries from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `version` in `package.json`; refresh `pnpm-lock.yaml` only when the complete dependency family is available from its registry.
3. For a registry-resolvable DSH baseline, run:

   ```bash
   pnpm install --frozen-lockfile --strict-peer-dependencies
   pnpm verify
   pnpm test:browser
   pnpm test:profile
   pnpm test:coverage
   pnpm pack --pack-destination artifacts
   ```

   For an unpublished DSH baseline, follow [Install and verify](docs/development.md#install-and-verify) and [Packaging](docs/development.md#packaging). Record the verified official source commit or artifact URLs, package versions, and executed commands. Run the same type, lint, unit, coverage, build, bundle, package, browser fixture, and real-profile checks in the disposable environment. Restore the source `package.json` before `pnpm --config.ignoreScripts=true pack --pack-destination artifacts`; the complete-family development entries, local overrides, and temporary lockfile are verification inputs only. Do not report a registry install as passing when only source verification ran.

4. Inspect the tarball file list, package version, and exact `engines.dsh` and peer declarations, then test-install it into a disposable DSH Web profile using the declared host version.
5. Commit and push the release source. When the registry path is available, push an annotated `v<version>` tag and let the Release workflow build both the versioned tarball and the stable `dsh-annotation.tgz` alias used by plugin catalogs. For an unpublished baseline, create a draft GitHub Release with the locally verified versioned tarball, an identical `dsh-annotation.tgz` copy, and the pushed commit as its target; the workflow recognizes those prebuilt assets instead of attempting a registry install.
6. Confirm the workflow accepts the tag and both assets, then publish the draft and verify the public downloads. Compare the downloaded assets byte for byte; the workflow only detects their filenames. The public Release body must state the exact `engines.dsh` host requirement and link `docs/compatibility.md`; generated notes alone are insufficient. Distinguish executed checks from manual checks that remain unverified.
7. For a catalog update, confirm `engines.dsh` matches every lockstep DSH peer, keep `screenshots.json` at 1-8 repository-owned images, and update only `data/plugins/ruisenbai__dsh-annotation.yml` in `awesome-dsh-plugin`. Set and keep its category at `session` and preserve its stable tarball alias. Do not commit the generated catalog READMEs; the catalog regenerates them on `main` after the pull request merges.

The tag must exactly match `v` plus the package version. The workflow rejects a version mismatch. It uses the prebuilt path only when both the versioned filename and stable alias exist; otherwise it attempts the registry build.
