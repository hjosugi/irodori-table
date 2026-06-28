import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowDetailSidebar } from "@/features/results/components/RowDetailSidebar";

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

function renderSidebar(
  overrides: Partial<Parameters<typeof RowDetailSidebar>[0]> = {},
) {
  const props: Parameters<typeof RowDetailSidebar>[0] = {
    columns: ["id", "name"],
    values: null,
    table: null,
    metadata: undefined,
    engine: "postgres",
    connectionId: "local-pg",
    onClose: vi.fn(),
    ...overrides,
  };
  flushSync(() => root.render(<RowDetailSidebar {...props} />));
  return props;
}

describe("RowDetailSidebar", () => {
  it("stays mounted with an empty state when no row is selected", () => {
    renderSidebar();

    expect(container.querySelector(".row-detail")).not.toBeNull();
    expect(container.textContent).toContain("No row selected");
    expect(
      container.querySelector<HTMLButtonElement>(".row-detail-copy")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>(".row-detail-search input")
        ?.disabled,
    ).toBe(true);
  });

  it("renders field rows when a row is selected", () => {
    renderSidebar({ values: [1029, "Kawase Foods"] });

    expect(container.textContent).toContain("2 fields");
    expect(container.textContent).toContain("id");
    expect(container.textContent).toContain("1029");
    expect(container.textContent).toContain("Kawase Foods");
  });
});
