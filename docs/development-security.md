# Development Security

Last updated: 2026-06-26 JST.

This document covers day-to-day security controls for Irodori Table development.
Product security requirements live in `docs/production-readiness.md`; clean-room
and license rules live in `docs/clean-room.md` and `docs/licensing.md`.

## Package Manager Policy

- npm lockfiles are the reproducible source of truth for JavaScript dependency
  resolution.
- Bun is allowed for local script execution through `JS_PM=bun`, but do not
  commit Bun lockfiles unless the project explicitly migrates package managers.
- Use `npm ci` for CI-equivalent installs and before release work.
- Use `make setup-fast` only as a local convenience path.
- Do not run `npm audit fix --force` as a blind cleanup. Review the dependency
  tree and behavior changes, then update intentionally.

## Supply Chain Checks

Use:

```sh
make security
```

The target runs:

- `scripts/check-licenses.sh`;
- `scripts/dependency-review.mjs` for install scripts, remote tarball
  integrity, non-registry npm resolution, Cargo git sources, and external Cargo
  path dependencies;
- `cargo metadata --locked`;
- `npm audit --package-lock-only --audit-level high` for each npm lockfile;
- `npm audit signatures --package-lock-only` for npm registry signature checks;
- `cargo audit --deny warnings` when `cargo-audit` is installed.

Set `NPM_AUDIT_LEVEL=moderate` to make npm advisory checks stricter. CI sets
`REQUIRE_CARGO_AUDIT=1` so missing RustSec coverage fails the workflow.
New install scripts, Cargo git dependencies, or external Cargo path
dependencies must be reviewed and documented in
`tools/security/dependency-review-allowlist.json`.

## Dependency Review Rules

Treat a new dependency as a design decision, not a convenience import.

Before adding one:

- prefer the standard library, existing project dependencies, or small local
  code when the behavior is simple;
- check license compatibility against `docs/licensing.md`;
- check install scripts, native binaries, generated code, postinstall downloads,
  package ownership, and recent maintainer churn;
- pin behavior through the existing lockfile and include the lockfile diff in
  the same change;
- add tests around the behavior the dependency is expected to provide.

Extra scrutiny is required for database drivers, parser/grammar packages,
cryptography, compression/archive libraries, native modules, browser-executed
WASM, and release/signing tools.

## Secrets And Logs

- Do not persist plaintext database passwords or tokens.
- Do not commit `.env` files, sample credentials beyond local throwaway
  containers, private certs, database dumps, or screenshots containing secrets.
- Redact passwords, tokens, connection URLs, and certificate material before
  logging or surfacing errors.
- Keep import/export paths explicit and user-chosen; avoid background writes to
  broad directories.

## GitHub Actions

- Keep workflow permissions minimal. Default to `contents: read`.
- Use official actions where possible and let Dependabot update action versions.
- Be cautious with new third-party actions; prefer shell commands or existing
  toolchains when the action is only a thin wrapper.
- Any workflow that publishes artifacts, signs releases, uploads SARIF, or uses
  OIDC must declare the narrow permissions it needs.

Current security workflows:

- `Security`: dependency policy, npm advisory/signature checks, and RustSec.
- `CodeQL`: static analysis for JavaScript/TypeScript and Rust.
- `OpenSSF Scorecard`: repository supply-chain posture surfaced through code
  scanning SARIF. Public score publishing is disabled.

## Release Hardening Backlog

These are intentionally not solved by the current local checks:

- sign desktop artifacts and document verification;
- generate SBOMs for release artifacts;
- pin container base images by digest once the release cadence is stable;
- add secret scanning/push protection in the hosted repository settings;
- evaluate SLSA provenance for release builds.

## Repository Settings Checklist

These are configured in GitHub settings rather than committed files:

- enable Dependabot alerts and security updates;
- enable secret scanning and push protection;
- require `Security`, `CodeQL`, and normal CI checks before merging to `main`;
- protect release tags once signed releases are introduced;
- restrict who can approve and run workflows from external pull requests.
