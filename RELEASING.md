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

1. Move relevant entries from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `version` in `package.json`; refresh `pnpm-lock.yaml` only when the complete dependency family is available from its registry.
3. For a registry-resolvable DSH baseline, run:

   ```bash
   pnpm install --frozen-lockfile --strict-peer-dependencies
   pnpm verify
   pnpm test:browser
   pnpm test:coverage
   pnpm pack --pack-destination artifacts
   ```

   For an unpublished DSH baseline, use the disposable source-overlay procedure in `docs/compatibility.md` to run the same type, lint, unit, coverage, build, bundle, package, and browser checks without committing local paths or its generated lockfile.

4. Inspect the tarball file list and test-install it into a disposable DSH Web profile.
5. Commit and push the release source. When the registry path is available, push an annotated `v<version>` tag and let the Release workflow build both the versioned tarball and the stable `dsh-annotation.tgz` alias used by plugin catalogs. For an unpublished baseline, create a draft GitHub Release with the locally verified versioned tarball, an identical `dsh-annotation.tgz` copy, and the pushed commit as its target; the workflow recognizes those prebuilt assets instead of attempting a registry install.
6. Confirm the workflow accepts the tag and both assets, then publish the draft and verify the public downloads. The public Release body must state the exact `engines.dsh` host requirement and link `docs/compatibility.md`; generated notes alone are insufficient.
7. For a catalog update, confirm `engines.dsh` matches every lockstep DSH peer, keep `screenshots.json` at 1-8 repository-owned images, and update only `data/plugins/ruisenbai__dsh-annotation.yml` in `awesome-dsh-plugin`. Set and keep its category at `session` and preserve its stable tarball alias. Do not commit the generated catalog READMEs; the catalog regenerates them on `main` after the pull request merges.

The tag must exactly match `v` plus the package version. The workflow rejects mismatches and prebuilt releases missing either the versioned filename or stable alias.
