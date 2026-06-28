import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error("kaboom");
  return <div className="ok">healthy</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    flushSync(() =>
      root.render(
        <ErrorBoundary>
          <Boom explode={false} />
        </ErrorBoundary>,
      ),
    );
    expect(container.querySelector(".ok")?.textContent).toBe("healthy");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders the fallback (with region) when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    flushSync(() =>
      root.render(
        <ErrorBoundary region="results panel">
          <Boom explode={true} />
        </ErrorBoundary>,
      ),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("results panel");
    expect(alert?.textContent).toContain("kaboom");
    spy.mockRestore();
  });

  it("supports a custom fallback renderer", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    flushSync(() =>
      root.render(
        <ErrorBoundary fallback={(error) => <p className="custom">{error.message}</p>}>
          <Boom explode={true} />
        </ErrorBoundary>,
      ),
    );
    expect(container.querySelector(".custom")?.textContent).toBe("kaboom");
    spy.mockRestore();
  });
});
