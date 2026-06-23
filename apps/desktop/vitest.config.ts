import { defineConfig } from "vitest/config";

// jsdom because some units import CodeMirror packages that expect DOM globals
// at module load. The tests themselves exercise pure logic (no rendering).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
