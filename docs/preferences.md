# Preferences

**Settings** — `Mod+,`, or **File ▸ Open Settings**, or **Open Settings** from
the command palette. Subtitle: *Editor, theme, shortcuts*.

Eight sections: **General**, **Theme**, **Keymap**, **Snippets**, **Security**,
**Extensions**, **Jobs**, **JSON**.

Everything is stored locally in browser local storage. Nothing is synced.

## General

| Setting | What it does | Default |
| --- | --- | --- |
| **Check for updates on startup** | *Look for a signed app update when Irodori starts.* | On |
| **Language** | *Display language for the desktop UI.* English or Japanese | Detected from the system |
| **UI zoom** | Scales workbench, editor, menus, and grid together | 100% (75–150%, step 10) |
| **Editor mode** | **Default** or **Vim** bindings | Default |
| **Editor background image** | *Optional faint image shown behind the SQL editor.* URL or data URL, with **Choose** and **Reset** | Empty |
| **Background image opacity** | Opacity of the above | 0.08 (0–0.35) |
| **Animations** | *Use short transitions for menus, panes, and controls.* Reduced-motion system settings are still respected | On |
| **Auto Commit** | *Commit each statement automatically after it runs.* | On |
| **SQL formatter** | `sql-formatter` or **Disabled** | sql-formatter |
| **SQL linter** | **Gentle** or **Disabled** | Gentle |
| **Result offload** | *Page large result sets from disk instead of capping in RAM.* | Off |
| **Resident rows** | Rows kept in memory before the disk-backed result takes over | 10000 (1000–100000) |
| **Query history** | *Number of query runs retained locally. Set to 0 to disable history.* | 200 (0–500) |
| **History result rows** | *Rows saved with each successful query. Set to 0 to keep SQL only.* | 50 (0–500) |
| **Sidebar** | Show or hide the object browser | Shown |

Switching **Editor mode** to Vim opens the Keymap tab automatically, because
enabling Vim can conflict with app shortcuts — see
[Query editor](query-editor.md#vim-mode).

Setting **Query history** to 0 does not only stop recording; it clears what is
already stored.

## Theme

| Setting | Notes |
| --- | --- |
| **Color mode** | **System**, **Dark**, or **Light**. Default System |
| **Default themes** | 44 built-ins — 22 dark, 22 light — listed as `{name} ({kind})` |
| **Saved themes** | Custom themes imported through the JSON section |
| **Active theme** | Shows what is in effect, with **Use Built-in** to drop a custom theme |
| **Import themes** | *Paste an Irodori or VS Code theme in the JSON section to save it here.* Opens the JSON tab |

Dark defaults to **Ayame Iris**, light to **Ayame Iris Paper**.

The theme can also be flipped with **Toggle Color Theme** from the Tools menu or
the palette.

**Custom themes can only be imported through Settings ▸ JSON.** There is no file
picker for themes.

## Keymap

Every command in the catalog, with its scope badge (**global**, **editor**, or
**grid**). Click a row to record a new binding — one or two chords, with a 1.2
second window between them. **Reset** restores a single overridden row. A blank
binding shows as **unset**.

Conflicts are flagged as **Shortcut conflict - click to rebind**. Some are
built-in and harmless because the commands live in different scopes — `Mod+S` is
Save in the editor and Commit edits in the grid, `Mod+Shift+S` is Save As and
Export, `Mod+Shift+Enter` is Run Current Statement and Add row.

With Vim mode on, a **Vim shortcut adjustments** panel appears offering **Apply
Recommended** or **Apply Selected**, and per conflict **Move to {shortcut}**,
**Unset app shortcut**, or **Keep current**.

Overrides persist under `irodori.keymap.overrides`. Full default list:
[Keyboard shortcuts](keyboard-shortcuts.md).

## Snippets

See [Query editor](query-editor.md#snippets).

## Jobs

**Background Jobs**, split into **Active** and **History**, with **Refresh** and
**Cancel job**. Job kinds are knowledge refresh, index build, ML evaluation,
bulk edit, and source scan.

## JSON

**Settings JSON** — *Edits apply to theme JSON, editor, layout, keymap, and
saved connections.* **Reset from current** reloads the editor from live state;
**Apply JSON** writes it back.

This is the only route for importing a custom theme, and the only way to reach a
few settings that have no control of their own.

## Gaps

- **Three settings exist only as translated strings** and are never rendered:
  **Sidebar position** (Left/Right), **Completion pane**, and **History pane**.
  The underlying sidebar-side state is real and can be set through Settings ▸
  JSON as `layout.sidebarSide`, but there is no UI control.
- **Choosing a theme that does not match the colour mode silently reverts.** The
  **Default themes** dropdown lists all 44 regardless of mode; picking a light
  theme while in Dark mode snaps back to the default dark theme with no message.
- **Job kind names and the waiting state are hardcoded English** and stay
  English under the Japanese locale.
- **No settings export/import as a file** — only the JSON tab's text area.
- **Only two locales.** English and Japanese.
