# Contributing

Thank you for improving `dsh-inline-comments`.

## Before opening an issue

- Search existing issues and discussions.
- Confirm the problem on a supported DSH version.
- Remove prompts, selected text, credentials, paths, and Session logs from public examples.
- Use the security process instead of an issue for vulnerabilities.

## Development setup

```bash
git clone https://github.com/YOUR_ORG/dsh-inline-comments.git
cd dsh-inline-comments
corepack enable
pnpm install
pnpm verify
```

See [Development](docs/development.md) for Web smoke testing and packaging.

## Change expectations

- Keep model-visible text reconstructable from the standard Session log.
- Preserve immutable sent history and stable annotation/submission ids.
- Validate complete wire/file values at their parser boundary; do not truncate selected text silently.
- Register every Slot, style, subscription, and other side effect under the Cordis fiber with a disposer.
- Use DSH Slot framework hooks and injected callbacks; presentation components must not reach `ctx`.
- Keep product UI copy in both Simplified Chinese and English dictionaries.
- Update README or reference documentation whenever behavior, configuration, compatibility, privacy, or persisted fields change.
- Add focused tests for each state transition and failure path. Product-visible changes also require the manual Web matrix before release.

## Pull requests

1. Create a focused branch from `main`.
2. Use clear commits; Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, and `test:` are welcome.
3. Run:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm format:check
   pnpm test
   pnpm build
   pnpm verify:bundle
   ```

4. Explain user-visible behavior, compatibility impact, tests, and manual verification in the PR template.
5. Keep unrelated refactors in a separate PR.

By contributing, you agree that your contribution is licensed under the project's MIT License and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
