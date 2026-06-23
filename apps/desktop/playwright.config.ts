import { defineConfig, devices } from "@playwright/test";

// In sandboxes where Playwright can't download its managed browser, point this
// at an existing Chromium binary (e.g. PW_CHROME_PATH=/path/to/chrome). When
// unset, Playwright uses its own managed browser (the CI default).
const executablePath = process.env.PW_CHROME_PATH || undefined;

// Headless-browser smoke (QA-004, browser portion). This drives the real web
// frontend — not the full Tauri shell — so Tauri `invoke` calls reject and the
// app falls back to its mock snapshot; the editor/theme/format paths are pure
// frontend and exercised for real. A full Tauri+SQLite smoke needs a Tauri runner.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
