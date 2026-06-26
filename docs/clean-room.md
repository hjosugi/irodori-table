# Reference And License Policy

Irodori Table's own code is `MIT OR 0BSD`: downstream users should be able to choose familiar MIT terms or the almost-no-conditions 0BSD path. Reference rules still depend on license and source type. Proprietary products require clean-room treatment. OSS projects may be studied at code level when their license permits it, but copied or adapted code must keep attribution and must be compatible with Irodori Table's permissive core.

## Allowed

- Read public documentation, public issue trackers, release notes, product pages, and license files.
- Read code from OSS repositories after checking the relevant license.
- Adapt small, well-scoped OSS implementation ideas only when the license is compatible with a permissive `MIT OR 0BSD` project, attribution is preserved where required, and the copied/adapted boundary is explicit in the commit.
- Use installed apps manually to understand workflows and expected DB-client behavior.
- Record feature-level observations in our own words.
- Build independent prototypes from requirements, public standards, database documentation, and permissively licensed dependencies.
- Compare behavior after our implementation exists, at the level of user-visible outcomes.

## Not Allowed

- Copy proprietary or license-incompatible source code, private APIs, icons, images, theme files, distinctive UI wording, snippets, or exact layout measurements from reference clients.
- Translate proprietary or license-incompatible code into Rust, TypeScript, or another language.
- Recreate a competitor screen pixel-for-pixel.
- Use decompiled binaries, network traces, private builds, paid-only assets, or non-public materials.
- Paste third-party code into issues, docs, prompts, commits, or tests unless its license is verified and the source is attributed.
- Use code under commercial-only directories or dual-license sections unless the license explicitly permits our use.

## Reference Tiers

- Proprietary or unclear license: public behavior and docs only; clean-room implementation.
- Public-domain-like or no-attribution permissive OSS such as 0BSD/Unlicense/CC0: easiest to reuse, while still recording provenance.
- Permissive OSS such as MIT/Apache/BSD: code may be read and selectively adapted with attribution and dependency/license tracking.
- Copyleft OSS such as GPL/AGPL: code may be read for learning; do not copy/adapt into the permissive core without an explicit separate license boundary and compatibility review.
- Commercial/paid edition source: do not use unless we have explicit rights.

## Named Reference Licenses

Verify the local `LICENSE` before any code-level use; this table records the current understanding.

- `.irodori-local/ref/beekeeper-studio-master/` — Community Edition GPLv3-or-later (copyleft); `src-commercial` is separately licensed and off-limits. Learning only; no copy into the permissive core.
- `.irodori-local/ref/vscode-sqltools-dev/` — MIT. Code may be read and selectively adapted with attribution and license tracking.
- `.irodori-local/ref/vscode-mssql-main/` — MIT. Same as above.
- `.irodori-local/ref/budibase-master/` — verify before code-level adaptation (GPL/AGPL components exist); treat as behavior reference unless a specific file's license is confirmed compatible.
- `.irodori-local/ref/duckdb-ui-main/` — MIT. Permissive; adaptable with attribution.
- `.irodori-local/ref/kibana-main/` — Elastic License 2.0 / SSPL / AGPL-3.0 (source-available, restrictive/copyleft). Behavior-only; no code adaptation into the core.
- `zed-industries/zed` (GitHub, not vendored) — GPL-3.0/AGPL-3.0 with some Apache-2.0 crates (copyleft). Study architecture; do not copy copyleft code into the `MIT OR 0BSD` core.
- A5:SQL Mk-2 (`a5m2.mmatsubara.com`, not vendored) — freeware with private
  source repository. Public site / behavior reference only. Capture useful
  feature observations in `docs/reference-a5sql.md`; do not copy UI expression
  or private implementation into the `MIT OR 0BSD` core.
- `outerbase/studio` (GitHub, not vendored) — AGPL-3.0 (copyleft). Study the data-editor/schema-editor/large-table UX and architecture; do not copy code into the `MIT OR 0BSD` core.
- `.irodori-local/ref/dbeaver-ce` (DBeaver Community) — **Apache-2.0** (permissive). Code may be read and selectively adapted with attribution and NOTICE retention; avoid the 2 EPL-2.0 files (`HippieCompletionEngine.java`, `SQLMatchingCharacterPainter.java`) unless accepting EPL terms.
- `zequel-labs/zequel` (GitHub, not vendored) — **Elastic License 2.0** (source-available, restrictive). Behavior-only; no code into the core.
- `rust-dd/rsql` (GitHub, not vendored) — README says open source and links a
  `LICENSE`, but that path returned 404 during review. Treat as public
  README/behavior reference only until compatible license terms are verified.
  Capture performance and UX observations in `docs/reference-rsql.md`; do not
  copy code into the `MIT OR 0BSD` core.

## Reference Workflow

1. Check the license before opening code for implementation guidance.
2. Capture feature observations in a neutral matrix: what the workflow does, why users need it, and how important it is.
3. Prefer public specifications and vendor docs for implementation details: SQL dialect docs, driver docs, SSH/proxy standards, LSP, Tree-sitter, VS Code theme schema.
4. Implement from our own abstractions and tests unless the OSS license explicitly permits adaptation and the PR records that fact.
5. Review pull requests for accidental copied strings, asset reuse, incompatible code, and too-close UI expression.
6. Keep third-party dependencies explicit with license review before shipping.

## Contribution Checklist

- The change is written from project requirements or from license-compatible OSS with required attribution.
- Any third-party dependency has a compatible license.
- Public references are linked when a behavior is based on public docs.
- OSS code references are linked when implementation is influenced by code-level review.
- User-visible names, empty states, dialogs, and shortcuts are ours unless they are generic platform conventions.
- Tests assert Irodori behavior, not another product's private behavior.
