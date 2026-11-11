# Development and release

[简体中文](development.md) · English

## Prerequisites

- Node.js `>=24.9.0`;
- Corepack;
- pnpm `11.28.5`;
- the clean DeepSeek Harness master commit pinned in `source-baseline.json` for verification.

## Install and verify

The registry lockfile supplies the published `0.2.2-rc.1` family. The pinned master includes the current CSS-anchored Menu API; source verification builds its exact commit separately from the registry family. Run `pnpm install --frozen-lockfile --strict-peer-dependencies`, then `pnpm verify` and the browser/profile checks. [Official source verification](#official-source-verification) checks the exact master commit in [source-baseline.json](../source-baseline.json) independently of the registry distribution.

`pnpm run test:profile --link-selection-only` checks native web/file link selection, quotation, annotation, reload, and source navigation at 1440px and 390px.

`pnpm run test:profile --record-attachments-only` replays a recorded Session and checks arbitrary attachment clicks, stable row positions, scrolling, and unobstructed previews in wide and narrow windows.

## Side-chat verification

`snapshots/web/side-annotations-roundtrip/` contains a protocol-v6 annotation Session captured from the real deterministic sidebar flow, with its system prompt and tool schemas. `snapshots/web/side-chat-roundtrip/` retains legacy reference history. The official profile runner seeds both recordings, opens each ordinary full page, checks presentation and source routing, and compares the entire persisted event log after rendering. Recordings use the Harness snapshot normalizer and preserve existing generations. Read-only replay makes no model request.

After building, run `pnpm run test:profile:side-chat`. The runner starts an isolated official `dsh web` profile and injects a deterministic model adapter. It verifies the served candidate bundle's bytes. `--snapshot-only` replays both recordings without creating a new submission; `--launch-only` checks activation and the seeded main composer.

The current scenario checks the **Annotate in sidebar** entry, original quote and receiving title, separate main and side drafts and attachments, two side chats, source bubbles, inactive-chat recovery after reload, and annotations on side replies. It verifies that saving sends no model request and submission produces one ordinary annotation payload in the receiving Session, with the original source identity and exact model text. Long quotes and unfinished notes are exercised at 1440px with a 300px sidebar and at 390px in both themes. Tab switches preserve unfinished edits and hidden editors ignore other chats' clicks and Escape. The runner removes its temporary profile and closes its browser and Host process. These checks use the built candidate in isolation; editing this repository does not update an already installed GUI.

`tests/side-chat-*.spec.*` cover protocol validation, Workspace resolution, preparation deduplication, per-composer observables, retained-reference cleanup, frozen retries, receipt conflicts, resource draining, reference components, and storage recovery. `tests/side-chat-storage-concurrency.spec.ts` exercises racing additions, removals, consumed requests, incompatible identities, denied writes, partial compaction, and lock cancellation. `tests/client-apply.spec.ts` covers the combined composer claim and disposal ordering. Run `pnpm run test:profile` and `pnpm run test:browser` for existing message, file, and Diff compatibility. Live providers and optional third-party UI combinations require separate verification.

## Historical Diff verification

`pnpm run test:profile --legacy-diff-only` replays a frozen mixed-source Session in the isolated DSH Web profile and confirms historical Git Diff records remain readable without creation, editing, attachment, or retry controls. `pnpm run test:profile --official-only` runs the focused live-Session workspace/changes, file-preview, and turn-Diff browser path. The default `pnpm run test:profile` runs both paths with Composer and migration checks. `tests/legacy-diff.spec.ts`, `tests/diff-protocol.spec.ts`, `tests/diff-source.spec.ts`, and `tests/official-source.spec.ts` cover retained and official source data in unit tests.

## Official source verification

Source verification uses the pinned official source tree so the selection interfaces and the built Web profile come from the same master commit. Never commit its `file:` overrides or generated lockfile.

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

The helper requires a new output directory, checks the pinned Host commit and DSH package versions, and copies plugin sources without the registry lockfile. It adds every provided official package to the temporary development dependencies and pins resolution to local tarballs through workspace overrides. Explicit development entries satisfy peers that would otherwise query npm. Only the two generated configuration files are formatted after installation. pnpm settings, including strict peer enforcement and disabled automatic peer installation, live in `pnpm-workspace.yaml`. The source repository's manifest and lockfile remain unchanged. The [CI workflow](https://github.com/ruisenbai/dsh-annotation/blob/main/.github/workflows/ci.yml) builds the same pinned Host and checks the isolated plugin on Node 24.9 and 24.

The temporary install skips optional platform binaries in the `@anthropic-ai/claude-agent-sdk-*` and `@openai/codex-*` families; it does not verify those Claude or Codex CLI backends. All official DSH packages, strict peer checks, and other native and browser dependencies remain included. Real-model verification requires a configured DSH provider and credentials; when it cannot run, report that limit separately from build, unit, and browser results.

Run the plugin checks inside the prepared directory:

```bash
pnpm verify
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:profile
pnpm test:coverage
```

`tsc` emits declarations and intermediate JavaScript to `lib/types`. `tsdown` produces ESM Host entries and wraps the browser CJS artifact in `window.__ModuleLoader__.load(...)`. `client-platform.json` pins the exact modules supplied by the DSH `0.2.2-rc.1` browser loader; ordinary third-party Client libraries are bundled instead of becoming loader requests. DSH requires the factory bundle at `lib/client.js` even though generic Node tooling classifies `.js` under `type: module`; `publint` therefore gates errors while the DSH-specific verifier owns this intentional format. `scripts/verify-bundle.mjs` asserts the required artifacts, module-loader registration, declared module closure, matching peer/development ranges, DSH manifest, and Cordis patch.

## Test layout

`pnpm test` runs the unit and component suites. `tests/controller.spec.ts`, `tests/selection-drafts.spec.ts`, and `tests/legacy-diff.spec.ts` cover independent annotations, selected batches, recovery, same-ID resend, immutable retry payloads, whole-file opinions, and navigation cancellation. `tests/official-source.spec.ts` covers legacy and compact file/Diff parsing, BOM bytes, CRLF and Unicode context, line/column anchors, and whole-file quotes; `tests/document-integration.spec.tsx` and `tests/diff-integration.spec.tsx` cover delayed Host data, outside release, public changes APIs, multiline DOM capture, and stale results. `tests/annotation-interactions.spec.tsx` covers the annotation record, composer chip, paperclip, blank-new cancellation, explicit empty-note save, nonempty outside-click save, and sent-note card. `tests/client-apply.spec.ts` covers official composer claims, slash commands, attachments, Host queue authority, and failure recovery.

`pnpm test:browser` runs the real Chromium fixture at wide light and narrow dark viewport sizes. The fixture checks the source-end bubble position; compact new, draft, and sent popups with visual-line growth, a seven-line scrolling cap, and visible actions; record placement; frosted idle/hover bubbles and opaque opened bubbles; composer chip preview, reset after detachment, and fold toggle; absence of delivery labels and dots; source navigation that keeps the record open; row actions; automatic closing after send; and reattaching a sent record without duplication. Screenshots are written under ignored `artifacts/browser/`.

`pnpm test:profile` uses an isolated installed Web profile and deterministic model adapter. It checks the four annotation settings, archive recovery, command admission, historical replay, Composer submission and same-ID resend, attachment identity, historical Git Diff read-only behavior, official workspace/changes, sidebar Diff selection and Locate, Markdown whole-file and text-range annotation, saved source markers, and browser source filters. The adapter emits a `write` tool call; the official file tool produces filesystem intents, durable tool events, and workspace changes. The official source path compares the submitted message with both the Session log and the model request, then checks idempotent retry. The temporary profile binds an allocated loopback port and closes its browser and Host process afterward.

```bash
pnpm exec vitest run tests/controller.spec.ts tests/annotation-interactions.spec.tsx
pnpm test:browser
```

## Record performance

After building, run `node scripts/profile-smoke.mjs --record-perf-only` for a manual Chromium diagnostic through the installed Web profile. It loads 50, 500, and 2,000 synthetic draft records with half attached, varied opinion lengths, and one mounted source; other records represent history outside the current transcript. Each size reloads the Session, then measures five list openings, five detachments, and five keystrokes each with the list expanded and collapsed. The first opening mounts a cold list; subsequent openings remount it in the same page.

Timings start at a real click or keydown and end at the second animation frame after the update. Fixture loading and model/network latency are excluded; the endpoint does not wait for deferred persistence. The report at `artifacts/browser/record-performance.json` retains every sample, medians, runtime/browser versions, and the built bundle hash; matching record screenshots are saved beside it. Heap and DOM diagnostics run after garbage collection with the list collapsed, outside timing samples. These local measurements have no CI timing threshold and do not cover transcript scrolling or source navigation.

The record count reads the collection length; source filters traverse annotations and attachment lookups use a Set. Derived values belong to the mounted component and retain only its current record and selection references. Unchanged rows skip rendering, while changed records, selection, locale, action callbacks, editor visibility, and submission state invalidate the affected presentation. Interaction tests cover update freshness and use attachment-action translations to count renders; the browser tests cover order, focus, and scroll preservation.

## Web smoke test

After [Packaging](#packaging), install the local tarball into a disposable Web profile on the declared DSH release:

```bash
dsh plugin --profile annotation-dev add ./artifacts/dsh-annotation-1.2.0.tgz
dsh --profile annotation-dev
```

In the Web page, select a source range and explicitly save an empty note and a filled note. Confirm that both attach to the next composer message while the record stays closed. Start another blank new editor, click outside twice to observe the shake and once more to cancel, then confirm that no record or bubble appears. Repeat with whitespace and text that was entered then deleted, and check that typing in the composer cancels a blank new editor while preserving composer focus. Hover the count chip to inspect its quote and note preview; click it to expand and then collapse the record. Use a row paperclip to remove and restore one attachment, then send. Confirm the record closes after all notes are sent, the source bubble scrolls out with its text, and reopening the record allows the same sent note to be attached and sent again without a new annotation ID. Check Enter, Shift+Enter, nonempty outside-click save, the one-line check alignment, automatic wrapping and seven-line mouse-wheel scrolling in all three popups, narrow viewport placement, and text/attachment submission. The target Host release and browser both need to be recorded with the result.

## Packaging

After `pnpm verify`, browser fixture regressions, the real-profile smoke, and coverage pass in the prepared directory, restore the source repository's release manifest before packing. Keep the same shell's `ANNOTATION_SOURCE` value from setup:

```bash
cp "$ANNOTATION_SOURCE/package.json" package.json
pnpm --config.ignoreScripts=true pack --pack-destination artifacts
```

`--config.ignoreScripts=true` avoids repeating the completed prepack checks after restoring the manifest. It does not replace verification. Do not reinstall dependencies in this restored temporary directory. The published package must contain the original dependency declarations, without the temporary complete-family development entries or machine-local paths.

Inspect the resulting tarball rather than invoking pack again:

```bash
tar -tzf artifacts/dsh-annotation-1.2.0.tgz
tar -xOf artifacts/dsh-annotation-1.2.0.tgz package/package.json
```

The package must contain `lib/index.js`, `lib/invariant.js`, `lib/client.js`, declarations under `lib/types`, `cordis.patch.yml`, `source-baseline.json`, README files and images under `docs/assets`, the changelog, and the license. Compare its version, Host requirement, dependency declarations and exports with the source manifest; pnpm removes package-manager metadata and development lifecycle hooks when packing.

## Release checklist

Follow [Releasing](../RELEASING.md) for versioning, dependency sources, verification, and GitHub Release assets. This project publishes versioned tarballs and a stable `dsh-annotation.tgz` alias through GitHub Releases; it does not publish to the npm registry.

Never commit `.env`, DSH credentials, Session logs, or real annotation drafts.
