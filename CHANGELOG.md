# Changelog

All notable changes to Irodori Table are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor versions may include breaking changes).

## [Unreleased]

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

[Unreleased]: https://github.com/hjosugi/irodori-table/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/hjosugi/irodori-table/releases/tag/v0.5.0
