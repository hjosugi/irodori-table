# Keyboard shortcuts

The complete default keymap, taken from
[`apps/desktop/src/core/keybindings.ts`](../apps/desktop/src/core/keybindings.ts).

`Mod` is Cmd on macOS and Ctrl on Windows and Linux. One binding covers both
platforms — the app resolves the modifier at keypress time, so `Mod+Enter` is
`⌘⏎` on a Mac and `Ctrl+Enter` elsewhere.

## Scopes

Every command declares a scope, and the scope is decided by what has focus:

| Scope | Active when focus is | 
| --- | --- |
| **editor** | In the SQL editor |
| **grid** | In the results grid |
| **global** | Anywhere, including the two above |

This is why several chords appear twice below. `Mod+S` saves the file when you
are typing SQL and commits staged edits when you are in the grid; they never
collide because only one scope is live at a time.

## General

| Shortcut | Command |
| --- | --- |
| `Mod+Shift+P` | **Show Commands** (command palette) |
| `Mod+,` | **Open Settings** |
| `Mod+Q` | **Exit** |
| `Mod+T` | **New SQL Tab** |
| `Mod+W` | **Close Tab** |
| `Mod+1` | **Focus SQL Editor** |
| `Mod+=` / `Mod+-` / `Mod+0` | Zoom in / out / reset |
| `Mod+Shift+D` | **Show ERD** |
| `Mod+Shift+I` | **Toggle AI Chat** |
| `Mod+Shift+F` | **Search in All Tabs** |
| `` Ctrl+` `` | **Toggle Terminal** — **macOS only**, see [Terminal](terminal.md#gaps) |

## File

| Shortcut | Command | Scope |
| --- | --- | --- |
| `Mod+S` | **Save** | editor |
| `Mod+Shift+S` | **Save As** | editor |

## Running queries

| Shortcut | Command |
| --- | --- |
| `Mod+Enter` | **Run Query** — selection, or the statement under the cursor |
| `Mod+Shift+Enter` | **Run Current Statement** |
| `Mod+Alt+Shift+Enter` | **Run from Start** — top of tab to cursor |
| `Mod+Shift+Backspace` | **Cancel Query** |
| *(unset)* | **Run All** |

## Editing SQL

| Shortcut | Command |
| --- | --- |
| `Alt+Shift+F` | **Format SQL** |
| `Mod+/` | **Toggle Line Comment** |
| `Tab` | **Indent Line** — accepts the completion when the popup is open |
| `Shift+Tab` | **Outdent Line** |
| `Alt+Enter` | **Quick Fix** |
| `Alt+F12` | **Quick Definition** |
| *(unset)* | **Clean Up SQL**, **Unformat SQL**, **Uppercase SQL**, **Lowercase SQL**, **Add Leading Commas**, **Convert double quotes to single quotes** |

## Results grid

| Shortcut | Command |
| --- | --- |
| `Mod+C` | **Copy selected cell or row** |
| `Mod+Shift+S` | **Export Results** |
| `Mod+E` | **Toggle Edit Data** |
| `Mod+Shift+Enter` | **Add Row** |
| `Mod+Z` | **Undo Edit** |
| `Mod+S` | **Commit Edits** |
| *(unset)* | **Copy SQL INSERTs**, **Export SQL INSERTs**, **Copy selected row as TSV**, **Copy visible result as TSV** |

## Commands with no default binding

These are real commands — invokable from the palette or a menu — that ship
without a key. Assign one in **Settings ▸ Keyboard Shortcuts** if you use them
often.

**Run All** · **Clean Up SQL** · **Unformat SQL** · **Uppercase SQL** ·
**Lowercase SQL** · **Add Leading Commas** · **Convert double quotes to single
quotes** · **Copy SQL INSERTs** · **Export SQL INSERTs** · **Toggle Search
panel** · **Open Query History** · **Toggle History Panel** · **Open Git
Panel** · **Toggle Knowledge Panel** · **Open Migration Studio** · **Open
Connection Manager** · **Generate SQL with AI** · **Explain Plan** · **Explain
Analyse** · **Toggle Sidebar** · **Toggle Completion Panel** · **Toggle Plan
Panel** · **Toggle BI Panel** · **Open Keyboard Shortcuts** · **Open
Extensions** · **Check for Updates** · **Toggle Color Theme** · **Open Help** ·
**About Irodori Table**

## Shortcuts that are not in the keymap

Two sets of bindings bypass the keymap entirely and cannot be seen or rebound in
Settings:

- **CodeMirror's find/replace**, registered at the highest precedence inside the
  editor: `Mod+F` open, `Mod+G` / `F3` next, `Shift+Mod+G` / `Shift+F3`
  previous, `Escape` close, `Mod+D` select next occurrence, `Mod+Alt+G` go to
  line. `Mod+F` therefore does **not** open the app's Search panel — see
  [Search and replace](search-and-replace.md).
- **Dialog behaviour**: `Escape` closes the topmost dialog, `Tab` / `Shift+Tab`
  cycle within its focus trap, and focus returns to whatever opened it.

Two more are local to a single component: `Enter` sends an AI chat message
(`Shift+Enter` inserts a newline), and `Ctrl+Enter` generates from the AI SQL
dialog.

## Rebinding

**Settings ▸ Keymap.** Click a row and press the keys. A binding can be a
sequence of up to two chords, with 1.2 seconds allowed between them. **Reset**
restores one row to its default; clearing a binding leaves it **unset**.

Overrides are stored under `irodori.keymap.overrides` and merged over the
defaults, so a command you never touch follows any future change to the shipped
default.

## Vim mode

Enabling Vim moves copy and paste to `Ctrl+Shift+C` and `Ctrl+Shift+V`, and
prompts you to resolve app shortcuts that collide with Vim's reserved
`Ctrl+<key>` bindings. On Windows and Linux that means **New SQL Tab**
(`Ctrl+T`) and **Close Tab** (`Ctrl+W`), with `Alt+Shift+T` and `Alt+Shift+W`
suggested. On macOS these use Cmd, so nothing conflicts. See
[Query editor](query-editor.md#vim-mode).
