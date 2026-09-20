# Development and release

## Prerequisites

- Node.js `^22.19.0` or `>=24`;
- Corepack;
- pnpm `11.7.0`;
- a DeepSeek Harness `0.1.6-alpha.2` checkout or installation for Web verification.

## Install and verify

Use one exact DSH `0.1.6-alpha.2` family, including the complete `@deepseek-ai/dsh` development environment. [source-baseline.json](../source-baseline.json) pins the official source commit; [Dependency source](compatibility.md#dependency-source) records the tag and commit. The npm family is available and the checked-in lockfile targets it. Verify its peer closure before running behavior checks:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
```

## Official source verification

The release also supports an independent verification against the pinned official source tree. Use this path to confirm artifact provenance or when registry artifacts are unavailable. Never commit its `file:` overrides or generated lockfile.

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

`tsc` emits declarations and intermediate JavaScript to `lib/types`. `tsdown` produces ESM Host entries and wraps the browser CJS artifact in `window.__ModuleLoader__.load(...)`. `client-platform.json` pins the exact modules supplied by the DSH `0.1.6-alpha.2` browser loader; ordinary third-party Client libraries are bundled instead of becoming loader requests. DSH requires the factory bundle at `lib/client.js` even though generic Node tooling classifies `.js` under `type: module`; `publint` therefore gates errors while the DSH-specific verifier owns this intentional format. `scripts/verify-bundle.mjs` asserts the required artifacts, module-loader registration, declared module closure, matching peer/development ranges, DSH manifest, and Cordis patch.

## Test layout

`pnpm test:browser` runs the browser fixture. `pnpm test:profile` runs [the real-profile smoke](../scripts/profile-smoke.mjs) and requires the built plugin artifacts from `pnpm verify` or `pnpm build`. It links those artifacts into an isolated official Web profile and pins the in-page directory picker. It checks bundle discovery, Client activation, and configuration persistence through a browser reload. A deterministic LLM adapter then runs the standard Agent preset: the Host annotation command must persist the same message passed to the model, and a duplicate submission must not start another model request. Owner-local expected files pin the model text and the real conversation's accessible output, including Markdown file links and restored annotation history. The test does not install the release tarball or drive selection through the real GUI Composer; the manual matrix below covers that full interaction. Record each command's result separately.

- `protocol.spec.ts`: v2 wire parsing, v1 compatibility conversion, complete limits, provenance sources, reply markers, and model text;
- `host-command.spec.ts`: delivery, cross-Session rejection, ordered image/file blocks, legacy aliases, and idempotency;
- `controller.spec.ts`: editing, retries, states, overlap, supplementation, recovery, discard, attachment metadata, and navigation;
- `model-ack.spec.ts`: acknowledgement and reply markers, legacy prefixes, and marker stripping;
- `storage.spec.ts`: the `dsh-annotation:v1:` namespace, legacy migration, v1 payload conversion, attachment metadata, legacy image metadata, and fail-closed recovery;
- `selection.spec.ts` and `highlight.spec.ts`: DOM selectors, relocation, coordinates, and browser highlight fallback;
- `components.spec.tsx`: user-visible timeline, compact editor, input-method handling, composer focus restore, reply chips, grouped list, marker geometry, source centering, and the plugin-configuration card;
- `market-update.spec.ts`: public dsh-market capability discovery, version checks, update progress, force eligibility, rollback, refresh, restart, endpoint rejection, and quiescent disposal;
- `feature-toggle.spec.ts`: staged Host writes for enablement and automatic attachment, legacy preference migration, failure recovery, and quiescent disposal;
- `scripts/browser-test.mjs` with `tests/browser/fixture.tsx`: real Chromium coverage for autosave, default automatic attachment, official Enter submission, action-button geometry and hover, outside-click decisions, mobile overflow, dark mode, zoom, reasoning disclosure, and source centering;
- `client-apply.spec.ts`: Host-backed plugin setting registration, automatic and manual composer attachment, slash-command release and the Enter race, text+annotation+image/file submission, missing or mismatched attachment refusal, assistant decorator composition and restoration, user-renderer disable/restore, composer detachment, reference serialization, local limits, transport failure, and immutable retry;
- `submission-flow.spec.ts`: browser payload through Host admission and durable status reconstruction.

Run one suite during development:

```bash
pnpm exec vitest run tests/controller.spec.ts
```

## Web smoke test

Complete [Packaging](#packaging) first, then install that tarball into a disposable profile on the declared DSH host. DSH serves the package's built `lib/client.js`:

```bash
dsh plugin --profile annotation-dev add ./artifacts/dsh-annotation-0.9.0.tgz
dsh web --profile annotation-dev
```

Use the existing DSH Web URL for the selected profile. A replacement Vite server does not receive DSH's boot payload.

Minimum manual matrix:

1. select text with pointer and keyboard, then use the action bar's copy, Ctrl+C while the bar is open, and dismissal by outside click or Escape;
2. add annotations to prose, fenced code, a table, and Markdown file-link labels; select a link alone and across adjacent text, then remount the message and confirm restored ranges include the labels but not hidden icons or action buttons;
3. create overlapping selections and trigger both empty and dirty outside-click editor behavior;
4. refresh with unfinished editor text and saved drafts, confirm both recover without clearing existing data, then test individual draft deletion and Undo; confirm the list has no local-storage usage, export/download, or bulk-clear footer;
5. keep automatic attachment enabled, save a new annotation, confirm focus and the caret return to the official Lexical composer without replacing text or file-reference chips, confirm the command name does not appear as visible text, add optional official composer text, images, and files, and submit with Enter while idle, running, and waiting for an interaction;
6. exercise the input-method editor: Enter during composition, the post-composition Enter, plain Enter, Shift+Enter, and Escape during composition;
7. while attached, type `/goal` and confirm the command runs with the annotations preserved and re-attached afterwards;
8. confirm an Inbox-only `next-turn` update exposes withdrawal without a Session or Chat update; confirm an undefined projection preserves the last known placement, a synchronized empty projection removes withdrawal, and `next-step` items do not expose it; withdraw a queued batch and discard a failed pending record;
9. retry after simulating a transport disconnect, including a mixed image/file batch after a refresh and a retry with missing or reordered attachment kinds;
10. inspect folded timeline and both navigation directions; activate file and skill references in ordinary user/steering rows and annotation submission requirements, and inspect file-type icons on attachments;
11. verify an explicit acknowledgement moves only named ids to processed, and that per-annotation reply chips appear over each "注解 N" heading with quote and annotation on hover;
12. confirm an archived Session cannot arm the official composer;
13. enable `dsh-smooth-stream` at the same time and confirm both streaming and annotations work without a duplicate `assistant-step` load error;
14. open **Settings → Annotations**, confirm the dedicated section has a responsive grid containing all 18 transcript switches and no duplicate bundle or built-in-plugin form, independently hide `grep`, `bash`, and an unknown tool, then save the disabled automatic-attachment switch, confirm newly saved annotations remain detached while composer focus still returns, and attach them manually with the paperclip;
15. save the disabled plugin switch and confirm the existing assistant renderer remains, its annotation layer disappears, user renderers return, an armed claim preserves visible text, and drafts return after saving the enabled switch;
16. with dsh-market `1.45.0` or later installed, check for an update from the annotation card, observe progress, confirm force appears only after a release-age or unchanged-version failure, and exercise any advertised refresh, rollback, and restart actions; repeat without the public API and confirm the card only directs users to Plugin Market;
17. unload the plugin and confirm its styles, user/steering Slot entries, assistant decoration, update polling, and controls disappear.

## Packaging

After `pnpm verify`, browser fixture regressions, the real-profile smoke, and coverage pass in the prepared directory, restore the source repository's release manifest before packing. Keep the same shell's `ANNOTATION_SOURCE` value from setup:

```bash
cp "$ANNOTATION_SOURCE/package.json" package.json
pnpm --config.ignoreScripts=true pack --pack-destination artifacts
```

`--config.ignoreScripts=true` avoids repeating the completed prepack checks after restoring the manifest. It does not replace verification. Do not reinstall dependencies in this restored temporary directory. The published package must contain the original dependency declarations, without the temporary complete-family development entries or machine-local paths.

Inspect the resulting tarball rather than invoking pack again:

```bash
tar -tzf artifacts/dsh-annotation-0.9.0.tgz
tar -xOf artifacts/dsh-annotation-0.9.0.tgz package/package.json
```

The package must contain `lib/index.js`, `lib/invariant.js`, `lib/client.js`, declarations under `lib/types`, `cordis.patch.yml`, `source-baseline.json`, README files and images under `docs/assets`, the changelog, and the license. Compare its `package.json` with the source repository's manifest before release.

## Release checklist

Follow [Releasing](../RELEASING.md) for versioning, dependency provenance, verification, and GitHub Release assets. This project publishes versioned tarballs and a stable `dsh-annotation.tgz` alias through GitHub Releases; it does not publish to the npm registry.

Never commit `.env`, DSH credentials, Session logs, or real annotation drafts.
