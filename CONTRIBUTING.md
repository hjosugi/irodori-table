# Contributing

Irodori Table is built as a permissive, clean-room project. Contributions should
be easy for downstream users to copy, fork, embed, or compete with under
`MIT OR 0BSD`.

## Clean-Room Rules

Read and follow [docs/clean-room.md](docs/clean-room.md) before using any
reference product, repository, docs, issue, screenshot, icon, theme, snippet, or
sample code for implementation work.

The short version:

- Implement from Irodori requirements, public specifications, vendor docs, or
  license-compatible OSS with attribution.
- Do not copy proprietary, commercial-only, GPL/AGPL, source-available, or
  unclear-license implementation into the permissive core.
- Record public references and code-level OSS influences in the PR when they
  affected the implementation.

## Licensing

Project-authored code, official examples, and official templates use
`MIT OR 0BSD` by default. Asset and dependency rules are documented in
[docs/licensing.md](docs/licensing.md).

Run the license check before opening a PR:

```sh
scripts/check-licenses.sh
```

For dependency, build, CI, release, extension, or credential-handling changes,
also read [docs/development-security.md](docs/development-security.md) and run:

```sh
make security
```

## Local Checks

The root workspace contains the Rust crate skeletons used by the roadmap. The
desktop app remains in `apps/desktop`.

For system packages, troubleshooting webview rendering bugs on Wayland/NVIDIA, and debugging procedures on Linux (particularly Arch Linux or CachyOS), please refer to [docs/linux-development.md](docs/linux-development.md).

```sh
make setup
make check
```

For generated Tauri bindings:

```sh
make desktop-typegen
```

## Pull Requests

Use the default PR template and keep the clean-room checklist filled in. If a
change is influenced by third-party OSS code, name the source, license, files or
APIs reviewed, and what was adapted.

Example PR body:

```md
## Summary

- Add dialect-aware identifier quoting for generated edit statements.
- Keep statement generation independent and covered by unit tests.

## Verification

- cargo test -p irodori-table-desktop edit::tests
- scripts/check-licenses.sh
```
