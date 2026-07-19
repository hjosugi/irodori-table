<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# Irodori Table user guide

How to actually use the app, one page per feature area. These pages describe
**what the current build does**, not what it is meant to do. Where a feature is
half-built, the page says so and tells you what works today.

Durable public documentation — install paths, platform setup, policy pages, the
feature matrix — lives at <https://hjosugi.github.io/irodori-docs/>. This guide
is the app-local companion: it tracks the code in this repository and is updated
in the same pull requests.

Individual pages are English only, following the repository convention:
directory index files (`README.md`) are bilingual, every other document is
English.

## Install to first query

1. **Install.** Download a desktop build from the install guide:
   <https://hjosugi.github.io/irodori-docs/install-guide.html>. Release assets
   are published at
   <https://github.com/hjosugi/irodori-table/releases>. To run from source
   instead, follow the quickstart in the [root README](../README.md).

2. **Open the connection manager.** **File ▸ Open Connection Manager**. There is
   no default shortcut; the command palette (`Mod+Shift+P`) also lists **Open
   Connection Manager**. `Mod` is Cmd on macOS and Ctrl everywhere else.

3. **Add a profile.** Click the **+** button at the top of the profile list,
   name it, and pick an engine. The form re-labels itself per engine — SQLite
   asks for a file, Athena asks for a region, Iceberg asks for a catalog. See
   [Connections](connections.md).

   If the engine needs a connector extension (all lakehouse, vector, and search
   engines do), install that first — see [Lakehouse connections](lakehouse.md)
   for the full walkthrough.

4. **Test, then connect.** **Test** checks the profile without opening a
   session. **Connect** opens it and loads the object browser.

5. **Run a query.** `Mod+T` opens a new SQL tab. Type a statement and press
   `Mod+Enter` — that runs the selection, or the statement under the cursor if
   nothing is selected. Results appear below. See [Query editor](query-editor.md)
   and [Results](results.md).

Nothing to connect to yet? The built-in `sqlite-memory` profile opens an
in-memory SQLite database seeded with sample data, so steps 2–4 can be skipped
for a first look.

## Pages

| Page | Covers |
| --- | --- |
| [Connections](connections.md) | Profiles, engines, transports, secrets, import/export |
| [Lakehouse connections](lakehouse.md) | Iceberg, Delta Lake, Hudi, Hive, Athena, S3 Tables — extension first |
| [Query editor](query-editor.md) | Running SQL, completion, snippets, query magics, parameters, Vim mode |
| [Results](results.md) | Grid, filtering, sorting, export and copy formats, row detail, structure, charts, editing |
| [Query history](query-history.md) | What is recorded, retention, re-running, restoring results |
| [Search and replace](search-and-replace.md) | The two separate find systems and which one you get |
| [ERD](erd.md) | Generated entity-relationship diagram, exports, table specs |
| [Schema designer](schema-designer.md) | Form-driven CREATE/ALTER SQL generation |
| [Schema diagram designer](schema-diagram.md) | Free-form canvas modelling, JSON round-trip |
| [Import](import.md) | CSV/TSV/JSON/JSONL to generated INSERT SQL |
| [Migration Studio](migration-studio.md) | Cross-engine migration planning and diff SQL |
| [AI chat and SQL generation](ai-chat.md) | Providers, agent mode, what the model can and cannot see |
| [Knowledge panel](knowledge.md) | The bundled fact pack and what it is for |
| [Git](git.md) | Commit graph, changes, branches — **and the repo-path gap** |
| [Terminal](terminal.md) | Embedded shell |
| [Extensions](extensions.md) | Installing connectors and other extensions |
| [Security](security.md) | Passkey lock, secret storage, read-only connections |
| [Preferences](preferences.md) | Settings dialog, theme, language, editor options |
| [Updater](updater.md) | Update checks and which builds have them |
| [Keyboard shortcuts](keyboard-shortcuts.md) | The full default keymap, and how to rebind |

## Conventions in these pages

- `Mod` means Cmd on macOS, Ctrl on Windows and Linux. This is how the app
  itself resolves bindings, so one shortcut list covers all platforms.
- **Bold** marks text you actually see in the UI — button labels, menu items,
  field names. They are quoted from the English locale
  (`apps/desktop/src/i18n/locales/en.ts`); Japanese UI users see the `ja`
  strings from the same file, except where a page notes that a screen is not
  translated.
- Shortcuts are quoted from `apps/desktop/src/core/keybindings.ts`, which is the
  only source of truth for the default keymap.
- A **Gaps** section at the end of a page lists what is missing, stubbed, or
  misleading in that area. If something you expect is not in the page body,
  check there before assuming it exists.
