import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgePanel } from "@/features/knowledge/KnowledgePanel";
import type { KnowledgePack } from "@/features/knowledge/knowledge-pack";

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
  vi.unstubAllGlobals();
});

const samplePack: KnowledgePack = {
  schemaVersion: 1,
  updatedAt: "2026-07-11T00:00:00Z",
  source: "test-knowledge-pack",
  products: [
    {
      product: "PostgreSQL",
      engineId: "postgres",
      facts: [
        {
          area: "sql_dialect",
          title: "PostgreSQL: MERGE improvements",
          summary: "MERGE gained RETURNING support in the current release.",
          priority: "high",
          confidence: "medium",
          observedAt: "2026-07-01T00:00:00Z",
          url: "https://www.postgresql.org/docs/current/",
          sourceId: "postgres-docs-current",
        },
        {
          area: "auth",
          title: "PostgreSQL: SCRAM notes",
          summary: "Authentication docs describe SCRAM channel binding.",
          priority: "normal",
          confidence: "high",
          observedAt: "2026-07-01T00:00:00Z",
        },
      ],
    },
    {
      product: "DBeaver",
      facts: [
        {
          area: "client_market",
          title: "DBeaver: release cadence",
          summary: "Client release notes track monthly feature drops.",
          priority: "low",
          confidence: "medium",
          observedAt: "2026-07-01T00:00:00Z",
        },
      ],
    },
  ],
};

function renderPanel(
  overrides: Partial<Parameters<typeof KnowledgePanel>[0]> = {},
) {
  const props: Parameters<typeof KnowledgePanel>[0] = {
    editorEngine: "postgres",
    activeConnectionName: "Local Postgres",
    onClose: vi.fn(),
    initialPack: samplePack,
    ...overrides,
  };
  flushSync(() => root.render(<KnowledgePanel {...props} />));
  return props;
}

function factTitles() {
  return Array.from(
    container.querySelectorAll(".knowledge-fact strong"),
    (node) => node.textContent,
  );
}

function setFilter(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    ".knowledge-toolbar input",
  );
  if (!input) {
    throw new Error("filter input not found");
  }
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  flushSync(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickScope(label: "connection" | "all") {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '.knowledge-scope button[role="radio"]',
    ),
  );
  const button = label === "connection" ? buttons[0] : buttons[1];
  flushSync(() => button?.click());
}

describe("KnowledgePanel", () => {
  it("scopes facts to the active connection engine by default", () => {
    renderPanel();
    expect(factTitles()).toEqual([
      "PostgreSQL: MERGE improvements",
      "PostgreSQL: SCRAM notes",
    ]);
    expect(container.textContent).toContain("Local Postgres");
    expect(container.textContent).toContain("2026-07-11T00:00:00Z");
  });

  it("shows every product when the scope is switched to all", () => {
    renderPanel();
    clickScope("all");
    expect(factTitles()).toHaveLength(3);
    expect(container.textContent).toContain("DBeaver: release cadence");
  });

  it("falls back to all products with a callout when the engine has no facts", () => {
    renderPanel({ editorEngine: "mysql" });
    expect(container.querySelector(".knowledge-callout")).toBeTruthy();
    expect(factTitles()).toHaveLength(3);
  });

  it("filters facts by substring across title and summary", () => {
    renderPanel();
    setFilter("scram");
    expect(factTitles()).toEqual(["PostgreSQL: SCRAM notes"]);

    setFilter("no-such-fact");
    expect(factTitles()).toHaveLength(0);
    expect(
      container.querySelector(".knowledge-fact-list .knowledge-callout"),
    ).toBeTruthy();
  });

  it("renders priority badges and official source links", () => {
    renderPanel();
    expect(
      container.querySelector(".knowledge-badge.priority-high")?.textContent,
    ).toBe("high");
    const link =
      container.querySelector<HTMLAnchorElement>(".knowledge-fact a");
    expect(link?.href).toBe("https://www.postgresql.org/docs/current/");
    expect(link?.textContent).toContain("postgres-docs-current");
  });

  it("replaces the pack after a successful refresh", async () => {
    const nextPack: KnowledgePack = {
      ...samplePack,
      updatedAt: "2026-08-01T00:00:00Z",
      products: [
        {
          product: "PostgreSQL",
          engineId: "postgres",
          facts: [samplePack.products[0].facts[0]],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => nextPack,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    container
      .querySelector<HTMLButtonElement>(".knowledge-header button")
      ?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("2026-08-01T00:00:00Z");
    });
    expect(factTitles()).toEqual(["PostgreSQL: MERGE improvements"]);
  });

  it("keeps the bundled pack and shows an error when refresh fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    container
      .querySelector<HTMLButtonElement>(".knowledge-header button")
      ?.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector(".knowledge-callout.error")?.textContent,
      ).toContain("offline");
    });
    expect(factTitles()).toHaveLength(2);
  });

  it("closes from the header button", () => {
    const props = renderPanel();
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".knowledge-header button",
    );
    flushSync(() => buttons[1]?.click());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
