import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorDetails } from "@/components/ErrorDetails";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

describe("ErrorDetails", () => {
  it("frames structured backend errors with a summary and raw details", () => {
    flushSync(() =>
      root.render(
        <ErrorDetails
          error={{
            kind: "timeout",
            message: "connect timed out after 30s",
            code: "ETIMEDOUT",
            retryable: true,
          }}
        />,
      ),
    );

    expect(container.textContent).toContain("Timed out");
    expect(container.textContent).toContain("connect timed out after 30s");
    expect(container.querySelector("details summary")?.textContent).toBe(
      "Details",
    );
    expect(container.querySelector("pre")?.textContent).toContain(
      '"kind": "timeout"',
    );
  });

  it("keeps plain string errors compact", () => {
    flushSync(() => root.render(<ErrorDetails error="Invalid host" />));

    expect(container.textContent).toContain("Invalid host");
    expect(container.querySelector("details")).toBeNull();
  });
});
