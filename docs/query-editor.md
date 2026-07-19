# Query editor

A CodeMirror 6 SQL editor with tabs, splits, completion driven by live schema
metadata, snippets, and an optional Vim mode.

## Tabs and splits

- `Mod+T` — **New SQL Tab**. `Mod+W` — **Close Tab**.
- `Mod+S` — **Save**. `Mod+Shift+S` — **Save As** (in editor focus; the same
  chord exports the result set when the grid has focus).
- `Mod+1` — **Focus SQL Editor** from anywhere.
- Drag a `.sql` file onto the editor to load it. Only `.sql` is accepted;
  anything else is refused with **Only .sql files can be dropped into the
  editor.** Dropping a CSV does *not* start an import — use the **Import**
  button described in [Import](import.md).

Editors can be split into groups. Each group keeps its own tab strip, and the
Search panel lists tabs per group as `tab name · group`.

## Running SQL

| Shortcut | Command | Runs |
| --- | --- | --- |
| `Mod+Enter` | **Run Query** | The selection, or the statement under the cursor |
| `Mod+Shift+Enter` | **Run Current Statement** | Only the statement under the cursor |
| `Mod+Alt+Shift+Enter` | **Run from Start** | Everything from the top of the tab to the cursor |
| *(unbound)* | **Run All** | Every statement in the tab |
| `Mod+Shift+Backspace` | **Cancel Query** | Cancels the running query |

**Run All** has no default binding — assign one in **Settings ▸ Keyboard
Shortcuts** or use the run-control dropdown beside the run button.

`Mod+Shift+Enter` is also **Add row** when the results grid has focus. Bindings
are scope-aware: the same chord resolves differently depending on whether focus
is in the editor (`.cm-host`), the grid (`.result-grid`), or neither.

## Completion

Completion is fed by the metadata loaded for the active connection, so it knows
your real schemas, tables, columns, and types.

- It triggers as you type.
- `Tab` accepts the highlighted suggestion **when the completion popup is
  open**; otherwise `Tab` indents.
- Hovering an identifier shows a metadata tooltip.
- **Quick Definition** (`Alt+F12`) shows the definition of the symbol under the
  cursor without leaving the tab.

The **Completion** sidebar panel (**View ▸ Toggle Completion Panel**) shows what
the engine currently knows about.

## Snippets

Snippets are completion entries that expand into statement templates. 92 ship by
default — `sel`, `selw`, `cte`, `ins`, `insel`, `upsert`, and so on — and many
are engine-specific, so `selw` expands to `LIMIT`, `FETCH FIRST`, or `TOP`
depending on the connected engine.

Manage them in **Settings ▸ SQL Snippets**:

- **Add snippet** creates one. Each has a **Trigger**, **Scope** (statement,
  expression, or clause), **Rank**, **Detail**, and **Template**.
- **Reset defaults** restores the shipped set.
- **Import snippets** accepts JSON or YAML, either merged (**Merge import**) or
  as a full **Replace**. A trigger must match `^[A-Za-z][A-Za-z0-9_-]{0,31}$`.

## Query magics

Lines beginning with `\` are interpreted before the SQL is sent:

| Magic | Effect |
| --- | --- |
| `\describe <table>` (`\desc`, `\d`) | Generates the engine's describe statement — `PRAGMA table_info` on SQLite/DuckDB, and so on |
| `\explain <sql>` | Wraps the SQL in the engine's explain form (`SET SHOWPLAN_TEXT ON` on SQL Server, `EXPLAIN PLAN FOR` on Oracle, `EXPLAIN` elsewhere) |
| `\erd [search]` | Opens the ERD, optionally filtered. This is the only path that fetches metadata on demand |
| `\export <format>` | Exports the current result. Accepts `csv`, `tsv`, `json`, `jsonl`, `sql`, `excel`, `markdown` |
| `\params <sql>` | Runs the SQL through the parameter prompt |

An unrecognised magic reports **Unknown query magic. Use \describe, \explain,
\export, \erd, or \params.**

## Query parameters

Statements carrying named parameters open a prompt before running. Entered
values are remembered per statement signature in local storage
(`irodori.queryParameters.v1`), so re-running the same parameterised query
pre-fills what you used last time.

## Formatting and cleanup

| Command | Shortcut |
| --- | --- |
| **Format SQL** | `Alt+Shift+F` |
| **Toggle Line Comment** | `Mod+/` |
| **Indent Line** | `Tab` |
| **Outdent Line** | `Shift+Tab` |
| **Quick Fix** (problems and fixes) | `Alt+Enter` |
| **Clean Up SQL** | *(unbound)* |
| **Unformat SQL** (collapse to one line) | *(unbound)* |
| **Uppercase SQL** / **Lowercase SQL** | *(unbound)* |
| **Add Leading Commas** | *(unbound)* |
| **Convert double quotes to single quotes** | *(unbound)* |

Formatter and linter are chosen in **Settings ▸ General**. The formatter is
either `sql-formatter` or `disabled`; the linter is either `gentle` or
`disabled`.

## Vim mode

Enable **Vim mode** in preferences. It is CodeMirror's Vim emulation
(`@replit/codemirror-vim`), toggled live without recreating the editor, so undo
history survives. The setting persists in local storage
(`irodori.editor.vimMode.v1`).

Two things change when it is on:

1. **Clipboard shortcuts move** to `Ctrl+Shift+C` (copy) and `Ctrl+Shift+V`
   (paste), because `Ctrl+C` and `Ctrl+V` belong to Vim.
2. **Conflicting app bindings are detected.** Any editor-scope command bound to
   a bare `Ctrl+<key>` that Vim reserves is flagged, with a suggested
   replacement. On Windows and Linux this catches **New SQL Tab** (`Ctrl+T`,
   Vim's insert-mode indent) and **Close Tab** (`Ctrl+W`, Vim's delete-word),
   suggesting `Alt+Shift+T` and `Alt+Shift+W`. You can accept the suggestion,
   unset the binding, or keep it. On macOS these commands use Cmd, so nothing
   conflicts and nothing is flagged.

## Editor appearance

**Settings ▸ General** carries a background image path and its opacity, plus a
global **animations** toggle and a UI zoom level (`Mod+=`, `Mod+-`, `Mod+0`).

## Gaps

- **`Mod+F` inside the editor is not the app's Search panel.** It opens
  CodeMirror's own find/replace, which is registered at the highest precedence.
  See [Search and replace](search-and-replace.md) — this trips people up.
- **Several editor transforms ship unbound**, as marked above. They are
  reachable from the command palette and the Edit menu, but have no keys until
  you assign them.
- **No SQL formatting on save**, and no per-connection formatting profile.
- **The completion panel has no manual refresh** — it follows whatever metadata
  the object browser last loaded.
