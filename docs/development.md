# Development and release

## Prerequisites

- Node.js `^22.19.0` or `>=24`;
- Corepack;
- pnpm `11.7.0`;
- a DeepSeek Harness checkout or installation compatible with `0.1.0-rc.5`/`rc.6` for Web verification.

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

- `protocol.spec.ts`: wire parsing, complete limits, provenance, and model text;
- `host-command.spec.ts`: delivery, cross-Session rejection, and idempotency;
- `controller.spec.ts`: editing, retries, states, overlap, supplementation, recovery, and navigation;
- `selection.spec.ts` and `highlight.spec.ts`: DOM selectors, relocation, coordinates, and browser highlight fallback;
- `components.spec.tsx`: user-visible timeline, compact editor, grouped list, marker geometry, and source centering;
- `scripts/browser-test.mjs` with `tests/browser/fixture.tsx`: real Chromium coverage for autosave, outside-click decisions, mobile overflow, dark mode, zoom, reasoning disclosure, and source centering;
- `client-apply.spec.ts`: dynamic setting registration, renderer disable/restore, composer detachment, local limits, transport failure, and immutable retry;
- `submission-flow.spec.ts`: browser payload through Host admission and durable status reconstruction.

Run one suite during development:

```bash
pnpm exec vitest run tests/controller.spec.ts
```

## Web smoke test

Build before installing because DSH serves `lib/client.js`, not TypeScript sources:

```bash
pnpm build
dsh plugin --profile comments-dev add .
dsh web --profile comments-dev
```

Use the existing DSH Web URL for the selected profile. A replacement Vite server does not receive DSH's boot payload.

Minimum manual matrix:

1. select text with pointer and keyboard, then use the action bar's copy, Ctrl+C while the bar is open, and dismissal by outside click or Escape;
2. add comments to prose, fenced code, and a table;
3. create overlapping selections and trigger both empty and dirty outside-click editor behavior;
4. refresh with unfinished editor text and saved drafts, then test delete undo, export, and draft clearing;
5. submit while idle, running, and waiting for an interaction;
6. withdraw a queued batch;
7. retry after simulating a transport disconnect;
8. inspect folded timeline and both navigation directions;
9. verify an explicit acknowledgement moves only named ids to processed;
10. confirm an archived Session cannot arm the official composer;
11. turn DSH Inline Comments off and confirm official renderers return, controls and highlights disappear, an armed claim preserves visible text, and drafts return after re-enabling;
12. unload the plugin and confirm its styles, Slot entries, and controls disappear.

## Packaging

```bash
pnpm verify
pnpm publint
pnpm pack --pack-destination dist
```

Inspect the tarball before release:

```bash
pnpm pack --dry-run
```

The package must contain `lib/index.js`, `lib/invariant.js`, `lib/client.js`, declarations under `lib/types`, `cordis.patch.yml`, README files, the changelog, and the license.

## Release checklist

1. Replace `YOUR_ORG` metadata if the repository owner changed.
2. Update `CHANGELOG.md` and the compatibility matrix.
3. Run the full local verification and Web smoke matrix.
4. Set the version with `pnpm version <patch|minor|major>`.
5. Commit the lockfile and generated release metadata.
6. Create and push an annotated `vX.Y.Z` tag.
7. Confirm the Release workflow uploads the verified tarball and generated notes.
8. If the repository has an `NPM_TOKEN` secret, confirm the same workflow publishes the tarball to npm with provenance.

Never commit `.env`, DSH credentials, Session logs, or real comment drafts.
