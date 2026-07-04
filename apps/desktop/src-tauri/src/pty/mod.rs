//! TERM-001 — integrated terminal backend (PTY).
//!
//! A thin layer over `portable-pty` (wezterm's cross-platform PTY): `pty_spawn`
//! starts a shell and streams its output (base64'd to preserve bytes across chunk
//! boundaries) over a Tauri channel; `pty_write`/`pty_resize`/`pty_kill` drive it.
//! The frontend renders it with xterm.js. This is what lets you run any CLI —
//! including the AI command providers (Claude Code, Codex) — inside the app.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use irodori_error::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

/// Output/lifecycle events streamed to the frontend terminal.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    /// Base64-encoded output bytes.
    Data { data: String },
    /// The shell exited.
    Exit { code: i32 },
}

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<String, PtyHandle>>>,
    counter: AtomicU64,
}

/// Spawn a shell in a new PTY; returns the session id. Output arrives on `on_event`.
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> IrodoriResult<String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| internal(format!("openpty failed: {e}")))?;

    let mut cmd = CommandBuilder::new(resolve_shell(shell)?);
    if let Some(dir) = resolve_cwd(cwd)? {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| internal(format!("spawn shell failed: {e}")))?;
    // The parent doesn't need the slave handle once the child holds it.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| internal(format!("clone reader failed: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| internal(format!("take writer failed: {e}")))?;

    let id = format!("pty-{}", state.counter.fetch_add(1, Ordering::Relaxed));
    state
        .sessions
        .lock()
        .map_err(|_| internal("pty state poisoned"))?
        .insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
                writer,
                child,
            },
        );

    // Read loop: forward output, then signal exit and drop the session.
    let sessions = Arc::clone(&state.sessions);
    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    if on_event.send(PtyEvent::Data { data }).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(PtyEvent::Exit { code: 0 });
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&thread_id);
        }
    });

    Ok(id)
}

/// Write input (keystrokes) to a session.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> IrodoriResult<()> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| internal("pty state poisoned"))?;
    let handle = sessions.get_mut(&id).ok_or_else(session_not_found)?;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| internal(format!("pty write failed: {e}")))?;
    let _ = handle.writer.flush();
    Ok(())
}

/// Resize a session to `cols` x `rows`.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> IrodoriResult<()> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| internal("pty state poisoned"))?;
    let handle = sessions.get(&id).ok_or_else(session_not_found)?;
    handle
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| internal(format!("pty resize failed: {e}")))?;
    Ok(())
}

/// Kill a session and drop it.
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> IrodoriResult<()> {
    let removed = state
        .sessions
        .lock()
        .map_err(|_| internal("pty state poisoned"))?
        .remove(&id);
    if let Some(mut handle) = removed {
        let _ = handle.child.kill();
    }
    Ok(())
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn resolve_shell(shell: Option<String>) -> IrodoriResult<String> {
    let Some(shell) = shell
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_shell());
    };

    if cfg!(debug_assertions) || env_flag_enabled("IRODORI_ALLOW_CUSTOM_PTY_SHELL") {
        Ok(shell)
    } else {
        Err(IrodoriError::new(
            IrodoriErrorKind::Validation,
            "custom terminal shells are disabled in release builds; set IRODORI_ALLOW_CUSTOM_PTY_SHELL=1 for trusted local debugging",
        ))
    }
}

fn resolve_cwd(cwd: Option<String>) -> IrodoriResult<Option<PathBuf>> {
    let candidate = match cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(cwd) => PathBuf::from(cwd),
        None => match std::env::current_dir() {
            Ok(current_dir) => current_dir,
            Err(_) => return Ok(None),
        },
    };
    let canonical = candidate.canonicalize().map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Validation,
            format!("terminal cwd is not accessible: {e}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(IrodoriError::new(
            IrodoriErrorKind::Validation,
            "terminal cwd must be a directory",
        ));
    }
    Ok(Some(canonical))
}

fn env_flag_enabled(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes")
    )
}

fn session_not_found() -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::NotFound, "terminal session not found")
}

fn internal(message: impl Into<String>) -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::Internal, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_used_when_shell_input_is_empty() {
        assert_eq!(resolve_shell(None).unwrap(), default_shell());
        assert_eq!(
            resolve_shell(Some("  ".to_string())).unwrap(),
            default_shell()
        );
    }

    #[test]
    fn cwd_must_resolve_to_directory() {
        let cwd = resolve_cwd(None).expect("resolve current dir");
        assert!(cwd.map(|path| path.is_dir()).unwrap_or(true));

        let missing = resolve_cwd(Some("/definitely/missing/irodori-table-cwd".to_string()));
        assert!(missing.is_err());
    }
}
