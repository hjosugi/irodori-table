# Terminal

A real terminal docked below the workbench: a genuine PTY running your login
shell, rendered with xterm.js.

## Opening it

- **Command palette** (`Mod+Shift+P`) ▸ **Toggle Terminal**.
- `Ctrl+`` ` — **macOS only.** See [Gaps](#gaps); on Windows and Linux this
  default binding does not fire, so use the palette or rebind it.

There is no menu item and no toolbar button for the terminal.

## What it runs

Your actual shell, with your privileges:

- macOS and Linux: `$SHELL`, falling back to `/bin/bash`.
- Windows: `%ComSpec%`, falling back to `cmd.exe`.

It starts in the directory Irodori Table was launched from, with
`TERM=xterm-256color`. There is no allow-list, deny-list, or command filtering —
anything you type runs exactly as it would in any other terminal.

Release builds refuse requests to spawn a *different* shell binary; that path is
only enabled in debug builds or with `IRODORI_ALLOW_CUSTOM_PTY_SHELL=1`. The UI
never requests a custom shell, so this does not affect normal use.

## Tabs

| Control | Label | Effect |
| --- | --- | --- |
| Tab | **Terminal 1**, **Terminal 2**, … | Switches session |
| **×** on a tab | **Close Terminal *n*** | Ends that session; closing the last one closes the dock |
| **+** | **New terminal** | Spawns another PTY |
| **⨯** | **Close panel** | Hides the dock and ends every session in it |

Inactive tabs stay alive in the background, so a long-running command keeps going
while you work in another tab. Closing the panel kills them all — there is no
detach.

When a shell exits, the view prints `[process exited]`.

The terminal follows the app theme, reading the editor background and text
colours.

## Gaps

- **`Ctrl+`` ` does not work on Windows or Linux.** It is the only default
  binding written with a literal `Ctrl` instead of `Mod`. On those platforms the
  physical Ctrl key is canonicalised to `Mod`, so the pressed chord (``Mod+` ``)
  never matches the stored binding (``Ctrl+` ``). **Settings ▸ Keyboard
  Shortcuts** displays it as `Ctrl+`` ` either way, giving no hint that it is
  inert. Workaround: open from the command palette, or re-record the binding in
  the Keymap tab — pressing the same physical keys stores ``Mod+` ``, which
  does match.
- **The dock is a fixed height** (`min(340px, 50vh)`) with no resize handle.
- **Terminal labels are not translated.** **Terminal 1**, **New terminal**,
  **Close panel**, and `[process exited]` are hardcoded English in every locale.
- **No split panes, no session naming, no scrollback search, no copy-mode
  bindings** beyond what xterm.js provides by default.
- **Sessions do not survive closing the panel**, and there is no way to
  reattach.
