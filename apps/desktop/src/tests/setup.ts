import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without `globals`, so Testing Library cannot find the `afterEach`
// it normally auto-registers cleanup on. Register it here, or every rendered
// tree — including anything portaled to <body> — leaks into the next test's
// `screen` queries.
afterEach(() => {
  cleanup();
});
