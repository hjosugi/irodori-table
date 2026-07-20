import { afterEach, describe, expect, it } from "vitest";
import { isPtyRuntimeAvailable, ptySpawn } from "@/lib/tauri/pty";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown };
};

// jsdom has no Tauri runtime, which is exactly the environment of the browser
// preview and the Playwright harness where #186 crashed the workbench.
describe("pty without the Tauri runtime (#186)", () => {
  afterEach(() => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
  });

  it("reports the runtime as missing", () => {
    expect(isPtyRuntimeAvailable()).toBe(false);
  });

  it("reports the runtime as present when Tauri internals expose invoke", () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {
      invoke: () => Promise.resolve(),
    };
    expect(isPtyRuntimeAvailable()).toBe(true);
  });

  it("rejects ptySpawn instead of throwing synchronously", async () => {
    // Pre-fix the Tauri Channel was constructed unconditionally and threw
    // "Cannot read properties of undefined (reading 'transformCallback')"
    // before any caller .catch() could run, taking the workbench down.
    let spawned: Promise<string> | null = null;
    expect(() => {
      spawned = ptySpawn({ cols: 80, rows: 24 }, () => {});
    }).not.toThrow();
    await expect(spawned).rejects.toThrow(/desktop/i);
  });
});
