# Changelog

All notable changes to Irodori Table are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor versions may include breaking changes).

## Release Policy

- Patch releases contain compatible fixes only. Security fixes should ship on the
  lowest active patch line that can receive them safely.
- Until 1.0, minor releases may include breaking changes, but each breaking
  change must be called out in this changelog with impact and migration notes.
- Major releases are reserved for intentional compatibility resets after 1.0.
- The stable auto-update channel follows published, non-prerelease GitHub
  Releases for `v*` tags.

## [0.7.6] - 2026-07-04

### Changed

- DuckDB and MotherDuck now ship through installable connector extensions; the
  desktop crate no longer carries embedded libduckdb or a `duckdb` Cargo
  feature.

## [0.7.5] - 2026-07-04

### Changed

- Lightweight Linux releases now skip duplicate release-job typegen checks and
  publish an AppImage-only artifact so the fast lane spends less time compiling
  and packaging.

## [0.7.4] - 2026-07-04

### Changed

- Lightweight Linux releases now build default features only, leaving DuckDB and
  legacy connector bundles out of the fast release lane.

## [0.7.3] - 2026-07-04

### Changed

- The tag release workflow now publishes a lightweight Linux pre-release without
  macOS, Windows, or updater signing so releases can proceed while signing
  secrets are being provisioned.

## [0.7.2] - 2026-07-04

### Fixed

- Migration Studio now delegates plan generation to `irodori-migration` 0.4
  through a typed Tauri command, removing the incompatible TypeScript BLAKE3
  planner and using the crate's cross-engine MD5 row-hash contract.
- The migration planner boundary now has generated TypeScript bindings, native
  regression tests, and UI bridge tests for the desktop command contract.

## [0.7.1] - 2026-07-02

### Fixed

- Release builds now pass `--features legacy-connectors,duckdb` so packaged
  binaries include the built-in connectors documented as shipped.
- The release dry-run workflow uses the same connector feature set as the
  release workflow.
- Feature-gated connector errors now point users toward release builds or
  marketplace connectors instead of only telling developers to rebuild locally.

### Changed

- TypeScript binding generation dependencies were updated to `typeship` 0.2.0.

## [0.7.0] - 2026-07-02

### Added

- Native connector extension framework groundwork, connector repository
  scaffolding updates, and extension scenario/fleet tooling.
- Release hardening for public desktop distribution: Windows code signing,
  macOS signing/notarization preparation, signed Tauri updater artifacts, and
  stable-channel `latest.json` publication.
- Knowledge ML cheatsheet extraction hardening and developer doctor checks for
  release/environment readiness.

### Changed

- Desktop app structure was reorganized around controller hooks and clearer
  workbench boundaries.
- Release documentation now records signing secrets, notarization setup,
  updater channel policy, and breaking-change policy.
- Connector catalog and support snapshots were aligned with the managed
  extension distribution model.

### Removed

- Legacy generic `objectStore` and `kvStore` engine exposure was removed from
  the root catalog and app-consumed docs/snapshots.

## [0.6.0] - 2026-07-02

### Added

- First-run onboarding: the empty object browser now offers "Open SQLite
  sample" (creates an in-memory sample database with demo tables) and
  "Add a connection"; a connected-but-empty database offers "Create a table"
  and "Import from file".
- Retry button on connection and query error notifications when the backend
  classifies the error as retryable.
- Notifications now stack (up to 4) instead of overwriting each other;
  error notifications stay until dismissed.
- Command palette: arrow-key navigation, focus trap, and combobox ARIA.
- Object browser tree: keyboard navigation (Up/Down/Left/Right/Home/End).
- About dialog links to documentation, GitHub, and the issue tracker.
- Notification, sidebar, and onboarding strings are localized (English and
  Japanese).

- Clicking a line number selects that line (Shift+click extends), plus a
  Mod+L select-line shortcut.
- Editor accuracy and performance regression suite (e2e): exact-text edit
  scenarios plus 5,000-line load/typing/scroll benchmarks with a gutter
  alignment check.

### Fixed

- Desktop exports (results, ERD SVG/PNG, table specs, connection profiles,
  SQL tabs, schema diagrams) use the native Save As dialog instead of a
  browser download, which exposed the dev-server address in the WebKitGTK
  download banner.
- The editor re-measures font metrics on UI zoom changes and after async
  font loads, and the code font is integer-px — the caret no longer drifts
  off the character it edits.
- Editor gutter pins the content font metrics so line numbers stay aligned
  with their lines in the WebKitGTK webview.

### Changed

- All destructive-action confirmations use the styled confirm dialog
  (git operations, history bulk delete, local AI model delete, reload guard)
  instead of native `window.confirm`.
- Committing grid edits that include row deletions now asks for a final
  confirmation.
- SECURITY.md documents GitHub private vulnerability reporting as the
  disclosure channel.

## [0.5.0] - 2026-07-01

- Foundation crates extracted to the sibling repo
  [irodori-kit](https://github.com/hjosugi/irodori-kit) (consumed via git
  tags); this repository is app-only.
- Packaging templates moved to irodori-kit.
- Bundled sample connections and the seeded demo workspace were removed;
  a fresh install starts with an empty workspace.

[0.7.6]: https://github.com/hjosugi/irodori-table/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/hjosugi/irodori-table/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/hjosugi/irodori-table/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/hjosugi/irodori-table/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/hjosugi/irodori-table/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/hjosugi/irodori-table/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/hjosugi/irodori-table/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/hjosugi/irodori-table/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/hjosugi/irodori-table/releases/tag/v0.5.0
