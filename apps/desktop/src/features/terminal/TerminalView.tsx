import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { ptyKill, ptyResize, ptySpawn, ptyWrite, type PtyEvent } from "@/lib/tauri/pty";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * One xterm.js terminal bound to a PTY session. WebGL rendering gives it
 * Ghostty/WezTerm-class throughput; output is base64-decoded from the channel.
 */
export function TerminalView({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily:
        'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: "#1a1b1e", foreground: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable (e.g. headless) — fall back to the canvas/DOM renderer.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    void ptySpawn({ cols: term.cols, rows: term.rows }, (event: PtyEvent) => {
      if (disposed) return;
      if (event.type === "data") {
        term.write(decodeBase64(event.data));
      } else if (event.type === "exit") {
        term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      }
    })
      .then((id) => {
        idRef.current = id;
      })
      .catch((error) => {
        term.write(`\r\n\x1b[31m${String(error)}\x1b[0m\r\n`);
      });

    const dataSub = term.onData((data) => {
      const id = idRef.current;
      if (id) void ptyWrite(id, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      const id = idRef.current;
      if (id) void ptyResize(id, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      dataSub.dispose();
      resizeObserver.disconnect();
      const id = idRef.current;
      if (id) void ptyKill(id);
      term.dispose();
    };
  }, []);

  // Refit + focus when this tab becomes active (it was display:none before).
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    fit.fit();
    const id = idRef.current;
    if (id) void ptyResize(id, term.cols, term.rows);
    term.focus();
  }, [active]);

  return <div className="terminal-view" ref={containerRef} />;
}
