import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogShell } from "@/components/DialogShell";

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

describe("DialogShell", () => {
  it("renders an accessible dialog with the supplied label", () => {
    render(
      <DialogShell className="data-dialog" label="Test dialog" onClose={() => {}}>
        <button type="button">Inside</button>
      </DialogShell>,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Test dialog");
    expect(dialog?.classList.contains("data-dialog")).toBe(true);
  });

  it("prefers aria-labelledby over aria-label when provided", () => {
    render(
      <DialogShell labelledBy="heading-1" onClose={() => {}}>
        <h2 id="heading-1">Heading</h2>
      </DialogShell>,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-labelledby")).toBe("heading-1");
    expect(dialog?.getAttribute("aria-label")).toBeNull();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <DialogShell label="x" onClose={onClose}>
        <button type="button">Inside</button>
      </DialogShell>,
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when closeOnEscape is false", () => {
    const onClose = vi.fn();
    render(
      <DialogShell label="x" onClose={onClose} closeOnEscape={false}>
        <button type="button">Inside</button>
      </DialogShell>,
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on overlay click but not on dialog-body click", () => {
    const onClose = vi.fn();
    render(
      <DialogShell
        className="data-dialog"
        overlayClassName="modal-overlay"
        label="x"
        onClose={onClose}
      >
        <button type="button">Inside</button>
      </DialogShell>,
    );
    const overlay = container.querySelector<HTMLElement>(".modal-overlay");
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.click();
    expect(onClose).not.toHaveBeenCalled();
    overlay?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the first focusable element on mount and restores it on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    render(
      <DialogShell label="x" onClose={() => {}}>
        <button type="button" id="first">
          First
        </button>
        <button type="button">Second</button>
      </DialogShell>,
    );
    expect(document.activeElement?.id).toBe("first");

    flushSync(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
