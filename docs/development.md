# Development and release

## Prerequisites

- Node.js `^22.19.0` or `>=24`;
- Corepack;
- pnpm `11.7.0`;
- a DeepSeek Harness `0.1.7-rc.2` checkout or installation for Web verification.

## Install and verify

Use one exact DSH `0.1.7-rc.2` family, including the complete `@deepseek-ai/dsh` development environment. [source-baseline.json](../source-baseline.json) pins the official source commit; [Dependency source](compatibility.md#dependency-source) records the tag and commit. The npm family is available and the checked-in lockfile targets it. Verify its peer closure before running behavior checks:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
```

## Historical Diff verification

`pnpm run test:profile --legacy-diff-only` checks the built plugin in an isolated DSH Web profile. It replays a frozen mixed-source Session and confirms that old Diff records remain readable without restoring creation, navigation, editing, attachment, or retry controls. `tests/legacy-diff.spec.ts`, `tests/diff-protocol.spec.ts`, and `tests/diff-source.spec.ts` cover the same retained data in unit tests.

## Official source verification

The release also supports an independent verification against the pinned official source tree. Use this path to confirm artifact origin or when registry artifacts are unavailable. Never commit its `file:` overrides or generated lockfile.

Start in the plugin repository. Set `ANNOTATION_HOST` to a clean official checkout at the pinned commit, then build and pack its runtime families into a temporary directory:

```bash
ANNOTATION_SOURCE="$(pwd)"
ANNOTATION_HOST=/absolute/path/to/pinned-harness-checkout
ANNOTATION_WORK="$(mktemp -d)"
cd "$ANNOTATION_HOST"
pnpm install --frozen-lockfile
pnpm run build:official
pnpm run release:pack --family dsh --out "$ANNOTATION_WORK/dsh-pack" --concurrency 4
pnpm run release:pack --family vendor --out "$ANNOTATION_WORK/vendor-pack" --concurrency 4
pnpm --dir native/system/packages/entry pack --pack-destination "$ANNOTATION_WORK/native-pack"
cd "$ANNOTATION_SOURCE"
node scripts/prepare-source-verification.mjs --harness "$ANNOTATION_HOST" \
  --from "$ANNOTATION_WORK/dsh-pack" \
  --from "$ANNOTATION_WORK/vendor-pack" \
  --from "$ANNOTATION_WORK/native-pack" \
  --out "$ANNOTATION_WORK/plugin"
cd "$ANNOTATION_WORK/plugin"
pnpm install --no-frozen-lockfile --strict-peer-dependencies
pnpm exec prettier --write pnpm-workspace.yaml package.json
```

The helper requires a new output directory, checks the pinned Host commit and DSH package versions, and copies plugin sources without the registry lockfile. It adds every provided official package to the temporary development dependencies and pins resolution to local tarballs through workspace overrides. Explicit development entries satisfy peers that would otherwise query npm. Only the two generated configuration files are formatted after installation. pnpm settings, including strict peer enforcement and disabled automatic peer installation, live in `pnpm-workspace.yaml`. The source repository's manifest and lockfile remain unchanged. The [CI workflow](https://github.com/ruisenbai/dsh-annotation/blob/main/.github/workflows/ci.yml) builds the same pinned Host and checks the isolated plugin on Node 22.19 and 24.

The temporary install skips optional platform binaries in the `@anthropic-ai/claude-agent-sdk-*` and `@openai/codex-*` families; it does not verify those Claude or Codex CLI backends. All official DSH packages, strict peer checks, and other native and browser dependencies remain included. Real-model verification requires a configured DSH provider and credentials; when it cannot run, report that limit separately from build, unit, and browser results.

Run the plugin checks inside the prepared directory:

```bash
pnpm verify
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:profile
pnpm test:coverage
```

`tsc` emits declarations and intermediate JavaScript to `lib/types`. `tsdown` produces ESM Host entries and wraps the browser CJS artifact in `window.__ModuleLoader__.load(...)`. `client-platform.json` pins the exact modules supplied by the DSH `0.1.7-rc.2` browser loader; ordinary third-party Client libraries are bundled instead of becoming loader requests. DSH requires the factory bundle at `lib/client.js` even though generic Node tooling classifies `.js` under `type: module`; `publint` therefore gates errors while the DSH-specific verifier owns this intentional format. `scripts/verify-bundle.mjs` asserts the required artifacts, module-loader registration, declared module closure, matching peer/development ranges, DSH manifest, and Cordis patch.

## Test layout

`pnpm test` runs the unit and component suites. `tests/controller.spec.ts`, `tests/selection-drafts.spec.ts`, and `tests/legacy-diff.spec.ts` cover independent annotations, selected batches, recovery, same-ID resend, and immutable retry payloads. `tests/annotation-interactions.spec.tsx` covers the annotation record, composer chip, paperclip, empty notes, outside-click save, and sent-note card. `tests/client-apply.spec.ts` covers official composer claims, slash commands, attachments, Host queue authority, and failure recovery.

`pnpm test:browser` runs the real Chromium fixture at wide light and narrow dark viewport sizes. The fixture checks the source-end bubble position; compact new, draft, and sent popups with visual-line growth, a seven-line scrolling cap, and visible actions; record placement; an opaque surface; composer chip preview and fold toggle; static pending dots; source navigation that keeps the record open; row actions; automatic closing after send; and reattaching a sent record without duplication. Screenshots are written under ignored `artifacts/browser/`.

`pnpm test:profile` uses the built plugin with a real Web profile and deterministic model adapter. It checks the two current settings controls, archive recovery, command admission, historical Session replay, selection and record navigation, composer submission and same-ID resend, attachment identity, and read-only Diff history. The browser fixture covers detailed popup geometry. The temporary profile binds an automatically allocated loopback port and closes its browser and Host process after the check; it does not replace a running user profile.

```bash
pnpm exec vitest run tests/controller.spec.ts tests/annotation-interactions.spec.tsx
pnpm test:browser
```

## Web smoke test

After [Packaging](#packaging), install the local tarball into a disposable Web profile on the declared DSH release:

```bash
dsh plugin --profile annotation-dev add ./artifacts/dsh-annotation-1.0.0.tgz
dsh web --profile annotation-dev
```

In the Web page, select a source range and save an empty note and a filled note. Confirm that both attach to the next composer message while the record stays closed. Hover the count chip to inspect its quote and note preview; click it to expand and then collapse the record. Use a row paperclip to remove and restore one attachment, then send. Confirm the record closes after all notes are sent, the source bubble scrolls out with its text, and reopening the record allows the same sent note to be attached and sent again without a new annotation ID. Check Enter, Shift+Enter, outside-click save, the one-line check alignment, automatic wrapping and seven-line mouse-wheel scrolling in all three popups, narrow viewport placement, and text/attachment submission. The target Host release and browser both need to be recorded with the result.

## Packaging

After `pnpm verify`, browser fixture regressions, the real-profile smoke, and coverage pass in the prepared directory, restore the source repository's release manifest before packing. Keep the same shell's `ANNOTATION_SOURCE` value from setup:

```bash
cp "$ANNOTATION_SOURCE/package.json" package.json
pnpm --config.ignoreScripts=true pack --pack-destination artifacts
```

`--config.ignoreScripts=true` avoids repeating the completed prepack checks after restoring the manifest. It does not replace verification. Do not reinstall dependencies in this restored temporary directory. The published package must contain the original dependency declarations, without the temporary complete-family development entries or machine-local paths.

Inspect the resulting tarball rather than invoking pack again:

```bash
tar -tzf artifacts/dsh-annotation-1.0.0.tgz
tar -xOf artifacts/dsh-annotation-1.0.0.tgz package/package.json
```

The package must contain `lib/index.js`, `lib/invariant.js`, `lib/client.js`, declarations under `lib/types`, `cordis.patch.yml`, `source-baseline.json`, README files and images under `docs/assets`, the changelog, and the license. Compare its version, Host requirement, dependency declarations and exports with the source manifest; pnpm removes package-manager metadata and development lifecycle hooks when packing.

## Release checklist

Follow [Releasing](../RELEASING.md) for versioning, dependency provenance, verification, and GitHub Release assets. This project publishes versioned tarballs and a stable `dsh-annotation.tgz` alias through GitHub Releases; it does not publish to the npm registry.

Never commit `.env`, DSH credentials, Session logs, or real annotation drafts.
