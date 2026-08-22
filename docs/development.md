# Development and release

## Prerequisites

- Node.js `^22.19.0` or `>=24`;
- Corepack;
- pnpm `11.7.0`;
- a DeepSeek Harness `0.1.1-rc.2` checkout or installation for Web verification.

## Install and verify

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:coverage
pnpm build
pnpm verify:bundle
pnpm publint
```

`tsc` emits declarations and intermediate JavaScript to `lib/types`. `tsdown` produces ESM Host entries and wraps the browser CJS artifact in `window.__ModuleLoader__.load(...)`. DSH requires that factory bundle at `lib/client.js` even though generic Node tooling classifies `.js` under `type: module`; `publint` therefore gates errors while the DSH-specific verifier owns this intentional format. `scripts/verify-bundle.mjs` asserts the required artifacts, module-loader registration, DSH manifest, and Cordis patch.

## Test layout

- `protocol.spec.ts`: v2 wire parsing, v1 compatibility conversion, complete limits, provenance sources, reply markers, and model text;
- `host-command.spec.ts`: delivery, cross-Session rejection, image blocks, legacy aliases, and idempotency;
- `controller.spec.ts`: editing, retries, states, overlap, supplementation, recovery, discard, image metadata, and navigation;
- `model-ack.spec.ts`: acknowledgement and reply markers, legacy prefixes, and marker stripping;
- `storage.spec.ts`: the `dsh-annotation:v1:` namespace, legacy migration, v1 payload conversion, image metadata, and fail-closed recovery;
- `selection.spec.ts` and `highlight.spec.ts`: DOM selectors, relocation, coordinates, and browser highlight fallback;
- `components.spec.tsx`: user-visible timeline, compact editor, input-method handling, composer focus restore, reply chips, grouped list, marker geometry, source centering, and the plugin-configuration card;
- `feature-toggle.spec.ts`: staged Host writes for enablement and automatic attachment, legacy preference migration, failure recovery, and quiescent disposal;
- `scripts/browser-test.mjs` with `tests/browser/fixture.tsx`: real Chromium coverage for autosave, default automatic attachment, official Enter submission, action-button geometry and hover, outside-click decisions, mobile overflow, dark mode, zoom, reasoning disclosure, and source centering;
- `client-apply.spec.ts`: Host-backed plugin setting registration, automatic and manual composer attachment, slash-command release and the Enter race, text+annotation+image submission, image-retry refusal, assistant decorator composition and restoration, user-renderer disable/restore, composer detachment, reference serialization, local limits, transport failure, and immutable retry;
- `submission-flow.spec.ts`: browser payload through Host admission and durable status reconstruction.

Run one suite during development:

```bash
pnpm exec vitest run tests/controller.spec.ts
```

## Web smoke test

Build before installing because DSH serves `lib/client.js`, not TypeScript sources:

```bash
pnpm build
dsh plugin --profile annotation-dev add .
dsh web --profile annotation-dev
```

Use the existing DSH Web URL for the selected profile. A replacement Vite server does not receive DSH's boot payload.

Minimum manual matrix:

1. select text with pointer and keyboard, then use the action bar's copy, Ctrl+C while the bar is open, and dismissal by outside click or Escape;
2. add annotations to prose, fenced code, and a table;
3. create overlapping selections and trigger both empty and dirty outside-click editor behavior;
4. refresh with unfinished editor text and saved drafts, then test delete undo, export, and draft clearing;
5. keep automatic attachment enabled, save a new annotation, confirm focus and the caret return to the official composer, add optional official composer text and images, and submit with Enter while idle, running, and waiting for an interaction;
6. exercise the input-method editor: Enter during composition, the post-composition Enter, plain Enter, Shift+Enter, and Escape during composition;
7. while attached, type `/goal` and confirm the command runs with the annotations preserved and re-attached afterwards;
8. withdraw a queued batch; discard a failed pending record;
9. retry after simulating a transport disconnect, including an image batch after a refresh;
10. inspect folded timeline and both navigation directions;
11. verify an explicit acknowledgement moves only named ids to processed, and that per-annotation reply chips appear over each "注解 N" heading with quote and annotation on hover;
12. confirm an archived Session cannot arm the official composer;
13. enable `dsh-smooth-stream` at the same time and confirm both streaming and annotations work without a duplicate `assistant-step` load error;
14. save the disabled automatic-attachment switch under **Settings → Plugins → Plugin configuration**, confirm newly saved annotations remain detached while composer focus still returns, then attach them manually with the paperclip;
15. save the disabled plugin switch and confirm the existing assistant renderer remains, its annotation layer disappears, user renderers return, an armed claim preserves visible text, and drafts return after saving the enabled switch;
16. unload the plugin and confirm its styles, user/steering Slot entries, assistant decoration, and controls disappear.

## Packaging

```bash
pnpm verify
pnpm publint
mkdir -p artifacts
pnpm pack --pack-destination artifacts
```

Inspect the tarball before release:

```bash
pnpm pack --dry-run
```

The package must contain `lib/index.js`, `lib/invariant.js`, `lib/client.js`, declarations under `lib/types`, `cordis.patch.yml`, README files and images under `docs/assets`, the changelog, and the license.

## Release checklist

1. Replace owner metadata if the repository owner changed.
2. Update `CHANGELOG.md` and the compatibility matrix.
3. Run the full local verification and Web smoke matrix.
4. Set the version with `pnpm version <patch|minor|major>`.
5. Commit the lockfile and generated release metadata.
6. Create and push an annotated `vX.Y.Z` tag.
7. Confirm the Release workflow uploads the verified tarball and generated notes.
8. If the repository has an `NPM_TOKEN` secret, confirm the same workflow publishes the tarball to npm with provenance.

Never commit `.env`, DSH credentials, Session logs, or real annotation drafts.
