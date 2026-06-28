import { defineConfig } from "vitest/config";

// jsdom because some units import CodeMirror packages that expect DOM globals
// at module load. Most units exercise pure logic; a few `.test.tsx` files render
// small shared components (DialogShell, ErrorBoundary) against the jsdom DOM.
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/tests/unit/**/*.test.ts", "src/tests/unit/**/*.test.tsx"],
  },
});
