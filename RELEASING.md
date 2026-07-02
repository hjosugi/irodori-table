# Releasing

This repo ships the desktop app. Shared foundation crates and templates are
released from sibling repositories first, then consumed here by git tag.

## Preconditions

- `git status --short` is clean except for intentional release edits.
- `make kit-patch-check` passes; local `irodori-kit` patches must not ship.
- `irodori-kit`, `irodori-sql`, and `irodori-knowledge` tags referenced in
  `Cargo.toml` exist and contain the intended release code.
- If extension SDK APIs changed, `irodori-kit/packages/extension-sdk` has been
  regenerated, validated, tagged, and its template/catalog effects are reflected
  here through source data or generators.
- Generated bindings and generated registry/docs snapshots are current.

## Local Verification

Run the narrowest loop while preparing a change, then run the release gate:

```sh
make doctor
make desktop-format-check
make desktop-lint
make desktop-typegen-check
make desktop-test
cargo test --workspace
make docs-check
make security
make desktop-build-verified
```

For browser-facing changes, also run:

```sh
cd apps/desktop
npx playwright install --with-deps chromium
cd ../..
make desktop-e2e
```

## Version Bump

Use the repo-root release targets. They delegate to
`apps/desktop/tools/release.mjs` and update the desktop package, Tauri config,
Cargo manifests, lockfiles, commit, tag, and push.

```sh
make release-patch
make release-minor
make release-major
```

Before running a release target, update any sibling git tags in `Cargo.toml`
explicitly and verify the lockfile diff is intentional.

## GitHub Release

1. Push the release commit and tag created by the release target.
2. Watch the release workflow in GitHub Actions.
3. Confirm packaged artifacts include the expected connector feature set for
   that release.
4. Compare `registry/data-source-support-status.md` against shipped build
   behavior before publishing user-facing notes.
5. Publish release notes that separate app changes from sibling-crate and
   extension SDK changes.

## Rollback

If a release artifact is wrong, do not retag over a published tag. Mark the
release as withdrawn, fix forward on a new patch version, and document the
artifact issue in the replacement release notes.
