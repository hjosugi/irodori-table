# Search and replace

**There are two separate find systems in the editor area, and the obvious
shortcut gives you the one you probably did not mean.**

| You press | You get |
| --- | --- |
| `Mod+F` | **CodeMirror's find panel** — current tab only |
| `Mod+Shift+F` | **Irodori's Search panel** — every open tab |

They have different options, different replace behaviour, and only one of them
is configurable in Settings. Neither searches the results grid; for that, use the
grid's own [filters](results.md#sorting-filtering-and-searching).

## The Search panel (cross-tab)

Opened by:

- `Mod+Shift+F` — **Search in All Tabs**. Prefills the query from your editor
  selection.
- The sidebar **Find** tab.
- Command palette ▸ **Toggle Search panel** (no default binding).

It searches **every open editor tab**. In split mode each group contributes its
own entry, labelled `tab name · group`.

### Options

| Glyph | Meaning |
| --- | --- |
| `Aa` | **Match case** |
| `ab` | **Match whole word** |
| `.*` | **Use regular expression** |

Whole-word treats `$` as a word character, which suits SQL identifiers but means
`$1` will not match as a whole word.

### Replacing

The replace row is behind a chevron — **Show replace** / **Hide replace**. There
is no shortcut to open it.

| Control | Scope |
| --- | --- |
| Icon on a result row (**Replace this match**) | That one match |
| Icon on a file header (**Replace all in this tab**) | That tab |
| **All** (**Replace all (every tab)**) | Every matching tab |

In regex mode `$&` is the whole match, `$$` is a literal `$`, and `$1`–`$99` are
capture groups. **An out-of-range group expands to an empty string.** In
non-regex mode `$` is always literal.

There is **no undo** for a replace. Check the match list before pressing
**All**.

Matches are capped at 5000 per tab.

## CodeMirror's find panel (current tab)

The stock editor find, registered at the highest precedence so it wins `Mod+F`
inside the editor.

| Shortcut | Action |
| --- | --- |
| `Mod+F` | Open find |
| `Mod+G` / `F3` | Next match |
| `Shift+Mod+G` / `Shift+F3` | Previous match |
| `Escape` | Close |
| `Mod+D` | Select next occurrence |
| `Mod+Alt+G` | Go to line |

These bindings are not in the app's keymap, do not appear in **Settings ▸
Keyboard Shortcuts**, and cannot be rebound. This panel has its own replace
implementation, independent of the cross-tab one.

## Which to use

- **One tab, want next/previous navigation** — `Mod+F`.
- **Across every open tab, or replacing the same thing everywhere** —
  `Mod+Shift+F`.

## Gaps

- **`Mod+F` and `Mod+Shift+F` open different features.** Nothing in either
  panel says so.
- **The Search panel has no Find Next / Find Previous** and no match cursor —
  you navigate by clicking result rows.
- **No undo after replace**, in either system.
- **The Search panel is entirely untranslated.** Every string — **Search**,
  **Replace**, **Match case**, **No results.**, the result count — is hardcoded
  English and stays English under the Japanese locale, including its
  English-only pluralisation.
- **Replacing a match that has moved silently does nothing** rather than
  reporting a stale offset.
- **Panel state persists for the session.** Closing the panel does not clear the
  replacement field, so a later **All** can fire with a replacement you have
  forgotten about.
- **CodeMirror's panel is untranslated too**, and its options are unavailable to
  the keymap editor.
