# Releasing

This project publishes installable npm tarballs and GitHub Releases from version tags.

## One-time repository setup

1. Create the GitHub repository with `main` as its default branch.
2. When publishing under a different owner, replace the owner (`ruisenbai`) in `package.json`, Markdown files, and `.github/ISSUE_TEMPLATE/config.yml`.
3. Enable GitHub Discussions and private vulnerability reporting so the links in `SUPPORT.md` and `SECURITY.md` work.
4. Protect `main`, require the `CI` workflow, and require pull-request review before merging.
5. Add an `NPM_TOKEN` Actions secret only if releases should also publish to npm. GitHub Release tarballs do not require this secret.

Do not replace the contributor copyright in `LICENSE` unless the project has a specific copyright holder. Contributions are accepted under the same MIT License through `CONTRIBUTING.md`; no separate CLA is required.

## Release checklist

1. Move relevant entries from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `version` in `package.json` and refresh `pnpm-lock.yaml`.
3. Run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm test:browser
   pnpm test:coverage
   pnpm pack --pack-destination artifacts
   ```

4. Inspect the tarball file list and test-install it into a disposable DSH Web profile.
5. Commit the release, create an annotated `v<version>` tag, and push the commit and tag.
6. Confirm that the Release workflow creates the GitHub Release and attaches the tarball. If `NPM_TOKEN` is configured, also confirm the npm provenance record.

The tag must exactly match `v` plus the package version. The workflow rejects mismatches before publishing.
