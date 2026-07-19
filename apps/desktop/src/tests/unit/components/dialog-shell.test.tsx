import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogShell } from "@/components/DialogShell";
import { renderUi } from "@/tests/helpers/render";

describe("DialogShell", () => {
  it("renders an accessible dialog with the supplied label", () => {
    renderUi(
      <DialogShell
        className="data-dialog"
        label="Test dialog"
        onClose={() => {}}
      >
        <button type="button">Inside</button>
      </DialogShell>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Test dialog");
    expect(dialog).toHaveClass("data-dialog");
    expect(screen.getByRole("button", { name: "Inside" })).toBeVisible();
  });

  it("prefers aria-labelledby over aria-label when provided", () => {
    renderUi(
      <DialogShell labelledBy="heading-1" onClose={() => {}}>
        <h2 id="heading-1">Heading</h2>
      </DialogShell>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Heading");
    expect(dialog).not.toHaveAttribute("aria-label");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const { user } = renderUi(
      <DialogShell label="x" onClose={onClose}>
        <button type="button">Inside</button>
      </DialogShell>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when closeOnEscape is false", async () => {
    const onClose = vi.fn();
    const { user } = renderUi(
      <DialogShell label="x" onClose={onClose} closeOnEscape={false}>
        <button type="button">Inside</button>
      </DialogShell>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on overlay click but not on dialog-body click", async () => {
    const onClose = vi.fn();
    const { user, container } = renderUi(
      <DialogShell
        className="data-dialog"
        overlayClassName="modal-overlay"
        label="x"
        onClose={onClose}
      >
        <button type="button">Inside</button>
      </DialogShell>,
    );

    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    // The scrim behind the dialog is presentational, so it has no role to
    // query by; it is the one place here a class selector is the honest tool.
    const overlay = container.querySelector<HTMLElement>(".modal-overlay");
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the first focusable element on mount and restores it on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = renderUi(
      <DialogShell label="x" onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </DialogShell>,
    );
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  // Not covered here: the Tab focus trap, which is the reason this shell
  // exists rather than a bare div. Its candidate list is filtered by
  // `el.offsetParent !== null` (DialogShell.tsx:126), and jsdom does no layout,
  // so `offsetParent` is null for every element and the list collapses to
  // whatever already has focus. Any assertion about Tab wrapping would pass or
  // fail for reasons unrelated to the trap. Sidebar.tsx:165 filters tree rows
  // the same way, so its arrow-key navigation is unreachable here too; both
  // belong in the browser suite (vitest.browser.config.ts).
});
