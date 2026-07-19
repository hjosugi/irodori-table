import { defineConfig } from "vitest/config";

// jsdom because most units need a DOM: some import CodeMirror packages that
// expect DOM globals at module load, and the `.test.tsx` files render real
// components through Testing Library (see src/tests/setup.ts and
// src/tests/helpers/render.tsx).
//
// jsdom does not do layout: `getBoundingClientRect()` returns zeros and no
// stylesheet is applied, so `toBeVisible()` here proves `display`/`visibility`/
// `hidden`, not that an element survived a clipping ancestor. Assertions that
// need real geometry belong in the browser suite (vitest.browser.config.ts) or
// in Playwright.
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/tests/unit/**/*.test.ts", "src/tests/unit/**/*.test.tsx"],
    setupFiles: ["./src/tests/setup.ts"],
  },
});
