# Integrated terminal

A VSCode-style bottom terminal panel, rendered with **xterm.js + WebGL** for
Ghostty/WezTerm-class throughput, backed by a real PTY. Toggle it with
**`Ctrl+\``** or the command palette ("Toggle Terminal"). It pairs with the AI CLI
providers — run `claude` / `codex` / any tool right in the app.

## Architecture

```
xterm.js (WebGL)  ──onData──▶  pty_write
      ▲                         ▲
      │ term.write(bytes)       │  Tauri commands
   base64 decode                │
      │                         ▼
  Channel<PtyEvent> ◀──── pty_spawn (portable-pty: shell in a PTY)
                                 │  pty_resize / pty_kill
```

- **Backend** (`src-tauri/src/pty/mod.rs`): `portable-pty` (wezterm's cross-platform
  PTY). `pty_spawn` starts the shell, a reader thread streams output base64-encoded
  over a Tauri `Channel` (base64 preserves bytes across chunk boundaries);
  `pty_write` / `pty_resize` / `pty_kill` drive the session. Sessions live in a
  `PtyState` map and are dropped on exit/kill.
- **Frontend** (`src/features/terminal/`): `TerminalView` binds one xterm.js
  instance (fit + WebGL addons) to a PTY session; `TerminalPanel` is the tabbed
  bottom dock. PTY wrappers are hand-written in `src/lib/tauri/pty.ts` (the
  `Channel` arg, like the query-stream wrapper).
- **Workbench**: `terminal.toggle` command (palette + `Ctrl+\``), docked as a fixed
  bottom panel below modals.

## Notes & follow-ups
- Default shell: `$SHELL` (unix) / `%ComSpec%` (windows); cwd defaults to the
  app's working dir.
- The dock is a fixed overlay for now (low conflict with the in-flight workbench
  refactor); a resizable, content-pushing split panel is a natural follow-up.
- Persisting open terminals / splitting panes are future enhancements.
