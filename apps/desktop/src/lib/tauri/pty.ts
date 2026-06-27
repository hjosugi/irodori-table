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

/** Spawn a shell in a PTY; `onEvent` receives output/exit. Resolves to the id. */
export function ptySpawn(
  options: PtySpawnOptions,
  onEvent: (event: PtyEvent) => void,
): Promise<string> {
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

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: string): Promise<void> {
  return invoke("pty_kill", { id });
}
