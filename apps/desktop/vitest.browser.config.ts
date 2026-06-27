import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/tests/browser/**/*.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
      api: {
        host: "127.0.0.1",
        port: 63315,
        strictPort: true,
      },
      viewport: {
        width: 1280,
        height: 900,
      },
      trace: "off",
    },
  },
});
