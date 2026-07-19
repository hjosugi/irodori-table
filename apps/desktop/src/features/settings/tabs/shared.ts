import type { Translator } from "../../../i18n";

export type TranslateFn = Translator["t"];

export type ValueUpdater<T> = T | ((current: T) => T);
export type BooleanUpdater = ValueUpdater<boolean>;

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Open an external URL in the user's default browser through the Tauri opener
 * plugin (the window capability grants `opener:default`, which covers
 * `open_url`). `window.open` from inside a Tauri WebView is not a reliable way
 * to reach the system browser — depending on the platform it can be swallowed
 * or open a child WebView instead — so it only serves as the fallback when the
 * Tauri runtime is absent (browser preview, Playwright harness).
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Show a local path in the OS file manager through the Tauri opener plugin.
 *
 * Uses `revealItemInDir` rather than `openPath` because the window capability
 * grants `opener:default`, which covers reveal but not `open_path` (that one
 * needs its own scoped permission).
 *
 * Returns `false` instead of throwing when there is no Tauri runtime (browser
 * preview, e2e harness) or the platform refuses, so callers can fall back to
 * something the user can still act on, such as copying the path.
 */
export async function revealLocalPath(path: string): Promise<boolean> {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}
