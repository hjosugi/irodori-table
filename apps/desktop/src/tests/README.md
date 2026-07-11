<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# Desktop Tests

This tree keeps test code out of production feature folders.

- `unit/`: Vitest unit tests for pure logic and small feature models.
- `unit/features/`: feature-specific units, grouped by feature name.
- `unit/sql/`, `unit/results/`, `unit/erd/`: domain-level units for shared modules.

Use `@/...` imports from tests instead of long relative paths. Browser and workflow
tests stay in `apps/desktop/e2e`.
