import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, useConfirm } from "@/components/ConfirmDialog";

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

function render(node: React.ReactNode) {
  flushSync(() => root.render(node));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  ) as HTMLButtonElement | undefined;
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete connection?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the title and message and routes confirm/cancel callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete connection?"
        message="This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Delete connection?");
    expect(container.textContent).toContain("This can't be undone.");

    flushSync(() => buttonByText("Delete")?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    flushSync(() => buttonByText("Cancel")?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("useConfirm resolves true on confirm", async () => {
    let confirmFn: ReturnType<typeof useConfirm>["confirm"] | undefined;
    function Host() {
      const { confirm, confirmElement } = useConfirm();
      confirmFn = confirm;
      return <>{confirmElement}</>;
    }
    render(<Host />);

    let resolved: boolean | undefined;
    let pending: Promise<void> | undefined;
    flushSync(() => {
      pending = confirmFn!({ title: "Proceed?" }).then((value) => {
        resolved = value;
      });
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    flushSync(() => buttonByText("Confirm")?.click());
    await pending;
    expect(resolved).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("useConfirm resolves false on cancel", async () => {
    let confirmFn: ReturnType<typeof useConfirm>["confirm"] | undefined;
    function Host() {
      const { confirm, confirmElement } = useConfirm();
      confirmFn = confirm;
      return <>{confirmElement}</>;
    }
    render(<Host />);

    let resolved: boolean | undefined;
    let pending: Promise<void> | undefined;
    flushSync(() => {
      pending = confirmFn!({ title: "Proceed?" }).then((value) => {
        resolved = value;
      });
    });

    flushSync(() => buttonByText("Cancel")?.click());
    await pending;
    expect(resolved).toBe(false);
  });
});
