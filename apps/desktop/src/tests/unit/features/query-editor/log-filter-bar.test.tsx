import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogFilterBar } from "@/features/query-editor/LogFilterBar";
import { emptyLogFilter } from "@/features/query-editor/editor-log-filter";
import { usePreferencesStore } from "@/features/preferences";
import { renderUi } from "@/tests/helpers/render";

// Labels come from t(); pin the locale so queries do not depend on machine
// settings.
beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("LogFilterBar", () => {
  it("exposes real accessible names for every control (#140)", () => {
    renderUi(
      <LogFilterBar
        filter={emptyLogFilter}
        hiddenLineCount={0}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "Log filters" })).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Minimum log level" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Filter log entries (regex)" }),
    ).toBeVisible();
    for (const name of ["All", "DEBUG", "INFO", "WARN", "ERROR"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
  });

  it("selects a minimum severity", async () => {
    const onFilterChange = vi.fn();
    const { user } = renderUi(
      <LogFilterBar
        filter={emptyLogFilter}
        hiddenLineCount={0}
        onFilterChange={onFilterChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "WARN" }));
    expect(onFilterChange).toHaveBeenCalledWith({
      minLevel: "warn",
      text: "",
    });
  });

  it("marks the active level pressed", () => {
    renderUi(
      <LogFilterBar
        filter={{ minLevel: "error", text: "" }}
        hiddenLineCount={0}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "ERROR" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("edits the text filter", async () => {
    const onFilterChange = vi.fn();
    const { user } = renderUi(
      <LogFilterBar
        filter={emptyLogFilter}
        hiddenLineCount={0}
        onFilterChange={onFilterChange}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Filter log entries (regex)" }),
      "x",
    );
    expect(onFilterChange).toHaveBeenCalledWith({ minLevel: "all", text: "x" });
  });

  it("clears the text filter with Escape", async () => {
    const onFilterChange = vi.fn();
    const { user } = renderUi(
      <LogFilterBar
        filter={{ minLevel: "all", text: "timeout" }}
        hiddenLineCount={2}
        onFilterChange={onFilterChange}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "Filter log entries (regex)",
    });
    input.focus();
    await user.keyboard("{Escape}");
    expect(onFilterChange).toHaveBeenCalledWith({ minLevel: "all", text: "" });
  });

  it("shows the hidden-line count and a clear control when active", async () => {
    const onFilterChange = vi.fn();
    const { user } = renderUi(
      <LogFilterBar
        filter={{ minLevel: "warn", text: "boom" }}
        hiddenLineCount={5}
        onFilterChange={onFilterChange}
      />,
    );
    expect(screen.getByText("5 lines hidden")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear log filters" }));
    expect(onFilterChange).toHaveBeenCalledWith(emptyLogFilter);
  });

  it("hides count and clear control while inactive", () => {
    renderUi(
      <LogFilterBar
        filter={emptyLogFilter}
        hiddenLineCount={0}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.queryByText(/lines hidden/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Clear log filters" }),
    ).toBeNull();
  });

  it("localizes into Japanese", () => {
    usePreferencesStore.setState({ locale: "ja" });
    renderUi(
      <LogFilterBar
        filter={emptyLogFilter}
        hiddenLineCount={0}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "最小ログレベル" })).toBeVisible();
  });
});
