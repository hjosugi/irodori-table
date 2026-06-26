import { defineConfig } from "vitest/config";

// jsdom because some units import CodeMirror packages that expect DOM globals
// at module load. The tests themselves exercise pure logic (no rendering).
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/tests/unit/**/*.test.ts"],
  },
});
