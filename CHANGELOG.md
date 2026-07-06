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

## [0.7.33] - 2026-07-06

### Changed

- Updated the desktop npm dependency group and Rust dependency group from
  Dependabot. (#77, #78)

## [0.7.32] - 2026-07-06

### Fixed

- Sidebars keep their configured widths (explorer 200px, inspector 300px by
  default) when the dock layout is first built or a sidebar is opened;
  dockview's proportional redistribution stretched the explorer to ~465px on
  a 1440px window. (#74)

## [0.7.31] - 2026-07-06

### Fixed

- The results header wraps inside a narrowed pane instead of overflowing:
  result-set tabs and actions were sliced at the sidebar boundary, which read
  as the sidebar overlaying the results. (#72)

## [0.7.30] - 2026-07-06

### Changed

- Row Detail moved out of the results pane into a full-height right sidebar
  view (VS Code-style): selecting a row or cell opens it, the sidebar view
  switcher can bring it back, and closing it clears the row selection. (#68)
- The Save button is removed from the editor run toolbar; saving stays on
  File → Save and its keyboard shortcut, keeping the bottom dock focused on
  format/run actions. (#70)

## [0.7.29] - 2026-07-06

### Changed

- Stable release dispatch now gates on updater, Windows signing, and macOS
  signing/notarization secrets before publishing signed Windows artifacts,
  signed/notarized macOS artifacts, and stable updater manifests.
- Editor Save/Run toolbar is docked at the bottom-right of the editor pane,
  with the run-options dropdown opening upward (TablePlus-style). (#64)
- Saved connections moved from the explorer panel strip to a dedicated
  far-left connections rail with engine icons and color tags (TablePlus-style).
  (#65)
- Left/right sidebars span the full workspace height; the saved dockview
  layout key is bumped to v2 so existing installs pick up the new arrangement
  (VS Code-style). (#66)
- Editor tabs use the WAI-ARIA tablist pattern and gain hover close buttons,
  middle-click close, and a visible tab-actions menu. (#62)
- Menubar supports WAI-ARIA APG keyboard navigation. (#55)

### Fixed

- Body-portaled popovers (menubar menus, context menus) rendered fully
  transparent; theme variables are now mirrored onto `:root`. (#52)
- Escape closed every stacked dialog at once; it now closes only the topmost.
  (#53)
- Settings dialog lacked initial focus, a focus trap, and `aria-modal`. (#54)
- Unsaved SQL tab content was silently lost on quit/reload; editor tabs are
  now persisted. (#56)
- Discard wiped staged grid edits without confirmation, and the delete-rows
  confirm button was mislabeled "Commit". (#57)
- Large UI surfaces (Connection Manager, ERD, About, run controls, query
  parameters, sidebar, titlebar/statusbar, results summary) bypassed i18n and
  showed English under the Japanese locale; 141 keys added to both locales.
  (#58)
- Every "接続を追加" click persisted a fresh "Connection N" draft; pristine
  drafts are now reused and discarded on close, and the SQLite sample profile
  is only persisted after a successful connection. (#59)
- Toast stack covered dialog action buttons (Connect/Test/Save in the
  Connection Manager). (#60)
- ERD showed "no tables match" while metadata was still loading, and
  lazy-loaded dialogs opened with no feedback. (#61)
- Result-mode control state was not announced to assistive technology, and
  the About copy-path button failed silently and could get stuck. (#63)

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

[0.7.33]: https://github.com/hjosugi/irodori-table/compare/v0.7.32...v0.7.33
[0.7.6]: https://github.com/hjosugi/irodori-table/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/hjosugi/irodori-table/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/hjosugi/irodori-table/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/hjosugi/irodori-table/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/hjosugi/irodori-table/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/hjosugi/irodori-table/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/hjosugi/irodori-table/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/hjosugi/irodori-table/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/hjosugi/irodori-table/releases/tag/v0.5.0
