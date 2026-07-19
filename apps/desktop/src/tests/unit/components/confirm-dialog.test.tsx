import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, useConfirm } from "@/components/ConfirmDialog";
import { usePreferencesStore } from "@/features/preferences";
import { renderUi } from "@/tests/helpers/render";

function ConfirmHost({
  onReady,
}: {
  onReady: (confirm: ReturnType<typeof useConfirm>["confirm"]) => void;
}) {
  const { confirm, confirmElement } = useConfirm();
  onReady(confirm);
  return <>{confirmElement}</>;
}

// Default button labels come from t("common.confirm"/"common.cancel"), so the
// locale has to be pinned or the queries below depend on machine settings.
beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    renderUi(
      <ConfirmDialog
        open={false}
        title="Delete connection?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the title and message and routes confirm/cancel callbacks", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { user } = renderUi(
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

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAccessibleName("Delete connection?");
    expect(screen.getByText("This can't be undone.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Cancel must be the first focusable control so a stray Enter cannot confirm
  // a destructive action. Nothing checked that before.
  it("focuses cancel rather than confirm when it opens", () => {
    renderUi(
      <ConfirmDialog
        open
        title="Delete connection?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("useConfirm resolves true on confirm", async () => {
    let confirm!: ReturnType<typeof useConfirm>["confirm"];
    const { user } = renderUi(
      <ConfirmHost
        onReady={(value) => {
          confirm = value;
        }}
      />,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = confirm({ title: "Proceed?" });
    });
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await expect(pending).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("useConfirm resolves false on cancel", async () => {
    let confirm!: ReturnType<typeof useConfirm>["confirm"];
    const { user } = renderUi(
      <ConfirmHost
        onReady={(value) => {
          confirm = value;
        }}
      />,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = confirm({ title: "Proceed?" });
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(pending).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
