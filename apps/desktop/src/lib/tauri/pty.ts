import { Channel, invoke } from "@tauri-apps/api/core";

/** Output/lifecycle events streamed from a PTY session (mirrors the Rust enum). */
export type PtyEvent =
  | { type: "data"; data: string } // base64-encoded bytes
  | { type: "exit"; code: number };

export type PtySpawnOptions = {
  shell?: string;
  cwd?: string;
  cols: number;
  rows: number;
};

/**
 * True when the Tauri runtime is reachable from this window. Constructing a
 * `Channel` without it throws synchronously (`__TAURI_INTERNALS__` has no
 * `transformCallback`), unlike `invoke`, which merely rejects — so `ptySpawn`
 * must guard on this before touching `Channel` (#186). Detection mirrors
 * `hasTauriRuntime` in erd-export.ts and `tauriRuntimeError` in
 * app-workbench-utils.ts.
 */
export function isPtyRuntimeAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

/** Spawn a shell in a PTY; `onEvent` receives output/exit. Resolves to the id. */
export function ptySpawn(
  options: PtySpawnOptions,
  onEvent: (event: PtyEvent) => void,
): Promise<string> {
  if (!isPtyRuntimeAvailable()) {
    // Reject instead of letting the Channel constructor throw synchronously:
    // in a plain browser (vite preview, Playwright harness) the throw used to
    // escape the terminal panel and take the whole workbench down (#186).
    return Promise.reject(
      new Error("The terminal requires the Tauri desktop runtime."),
    );
  }
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("pty_spawn", {
    shell: options.shell,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    onEvent: channel,
  });
}

export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function ptyResize(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: string): Promise<void> {
  return invoke("pty_kill", { id });
}
