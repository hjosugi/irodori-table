import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbEngineBuildSupport,
  type EngineBuildSupport,
} from "@/generated/irodori-api";
import { ConnectionManagerDialog } from "@/features/connections/ConnectionManagerDialog";
import {
  connectionColorOptions,
  type ConnectionDraft,
} from "@/features/connections/connection-profiles";

vi.mock("@/generated/irodori-api", () => ({
  dbEngineBuildSupport: vi.fn(),
}));

const mockDbEngineBuildSupport = vi.mocked(dbEngineBuildSupport);

let container: HTMLDivElement;
let root: Root;

function draft(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "local-pg",
    name: "Local Postgres",
    color: connectionColorOptions[0],
    engine: "postgres",
    mode: "fields",
    url: "",
    connectionTransport: "tcp",
    host: "127.0.0.1",
    port: "5432",
    user: "irodori",
    password: "",
    database: "samples",
    socketPath: "",
    readOnly: false,
    ...patch,
  };
}

beforeEach(() => {
  mockDbEngineBuildSupport.mockReset();
  mockDbEngineBuildSupport.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function renderDialog(
  overrides: Partial<Parameters<typeof ConnectionManagerDialog>[0]> = {},
) {
  const selectedDraft = draft(overrides.draft);
  const props: Parameters<typeof ConnectionManagerDialog>[0] = {
    profiles: [selectedDraft],
    connectedIds: new Set(),
    selectedProfileId: selectedDraft.id,
    draft: selectedDraft,
    search: "",
    error: null,
    activeConnectionOpen: false,
    testing: false,
    connecting: false,
    onClose: vi.fn(),
    onSearchChange: vi.fn(),
    onAddProfile: vi.fn(),
    onImportProfiles: vi.fn(),
    onExportProfiles: vi.fn(),
    onSelectProfile: vi.fn(),
    onUpdateDraft: vi.fn(),
    onDeleteProfiles: vi.fn(),
    onDisconnect: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    onConnect: vi.fn((event) => event.preventDefault()),
    ...overrides,
  };
  flushSync(() => root.render(<ConnectionManagerDialog {...props} />));
  return props;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ConnectionManagerDialog", () => {
  it("selects preset colors from the compact color picker", () => {
    const nextColor = connectionColorOptions[1];
    const props = renderDialog();

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Use color ${nextColor}"]`,
    );
    expect(button).not.toBeNull();

    flushSync(() => button?.click());

    expect(props.onUpdateDraft).toHaveBeenCalledWith({ color: nextColor });
  });

  it("marks the active color as pressed", () => {
    const activeColor = connectionColorOptions[2];
    renderDialog({ draft: draft({ color: activeColor }) });

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Use color ${activeColor}"]`,
    );

    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.querySelector("svg")).not.toBeNull();
  });

  it("marks feature-gated engines missing from the current build", async () => {
    const buildSupport: EngineBuildSupport[] = [
      {
        engine: "duckdb",
        includedInCurrentBuild: false,
        requiredFeature: "duckdb",
      },
    ];
    mockDbEngineBuildSupport.mockResolvedValue(buildSupport);

    renderDialog({
      draft: draft({
        engine: "duckdb",
        database: ":memory:",
        port: "",
      }),
    });

    await flushEffects();

    const duckOption = Array.from(
      container.querySelectorAll<HTMLOptionElement>("option"),
    ).find((option) => option.value === "duckdb");
    expect(duckOption?.disabled).toBe(true);
    expect(duckOption?.textContent).toContain("not in this build");
    expect(container.textContent).toContain(
      "DuckDB is not available in this desktop build",
    );

    const testButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Test");
    const connectButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Connect");

    expect(testButton?.disabled).toBe(true);
    expect(connectButton?.disabled).toBe(true);
  });

  it("requires confirmation before deleting a connection", async () => {
    const props = renderDialog();
    const deleteButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Delete");

    expect(deleteButton).not.toBeUndefined();
    flushSync(() => deleteButton?.click());

    expect(props.onDeleteProfiles).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete connection?");

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".confirm-dialog button"),
    ).find((button) => button.textContent === "Delete");
    flushSync(() => confirmButton?.click());
    await Promise.resolve();

    expect(props.onDeleteProfiles).toHaveBeenCalledTimes(1);
    expect(props.onDeleteProfiles).toHaveBeenCalledWith(["local-pg"]);
  });

  it("shift+click selects a range and deletes it together after confirming", async () => {
    const profiles = [
      draft(),
      draft({ id: "local-mysql", name: "Local MySQL", engine: "mysql" }),
      draft({ id: "local-duck", name: "Local Duck", engine: "duckdb" }),
    ];
    const props = renderDialog({ profiles });

    const profileButton = (name: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".connection-profile strong",
        ),
      )
        .find((label) => label.textContent === name)
        ?.closest("button");

    flushSync(() => profileButton("Local Postgres")?.click());
    const rangeEnd = profileButton("Local Duck");
    flushSync(() =>
      rangeEnd?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      ),
    );

    expect(
      container.querySelectorAll(".connection-profile.selected"),
    ).toHaveLength(3);

    const deleteButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Delete (3)");
    expect(deleteButton).not.toBeUndefined();
    flushSync(() => deleteButton?.click());

    expect(container.textContent).toContain("Delete 3 connections?");
    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".confirm-dialog button"),
    ).find((button) => button.textContent === "Delete");
    flushSync(() => confirmButton?.click());
    await Promise.resolve();

    expect(props.onDeleteProfiles).toHaveBeenCalledWith([
      "local-pg",
      "local-mysql",
      "local-duck",
    ]);
  });

  it("shows structured connection errors with raw details", () => {
    renderDialog({
      error: {
        kind: "connection",
        message: "password authentication failed",
        code: "28P01",
        retryable: false,
      },
    });

    expect(container.textContent).toContain("Connection failed");
    expect(container.textContent).toContain("password authentication failed");
    expect(
      container.querySelector(".error-callout-details summary")?.textContent,
    ).toBe("Details");
    expect(container.querySelector("pre")?.textContent).toContain(
      '"code": "28P01"',
    );
  });

  describe("connector settings", () => {
    function optionInput(label: string) {
      const field = Array.from(
        container.querySelectorAll<HTMLLabelElement>(
          ".connector-options label",
        ),
      ).find((item) => item.querySelector("span")?.textContent === label);
      return field?.querySelector<HTMLInputElement>("input") ?? null;
    }

    function type(input: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      flushSync(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    it("renders the option fields an engine declares", () => {
      renderDialog({
        draft: draft({
          engine: "iceberg",
          options: { warehouse: "s3://bucket/warehouse" },
        }),
      });

      expect(optionInput("Catalog URI")?.value).toBe("");
      expect(optionInput("Warehouse path")?.value).toBe(
        "s3://bucket/warehouse",
      );
    });

    it("writes typed option values into the draft without dropping siblings", () => {
      const props = renderDialog({
        draft: draft({
          engine: "iceberg",
          options: { warehouse: "s3://bucket/warehouse" },
        }),
      });

      const input = optionInput("Catalog URI");
      expect(input).not.toBeNull();
      type(input!, "https://catalog.example.com/v1");

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        options: {
          warehouse: "s3://bucket/warehouse",
          catalogUri: "https://catalog.example.com/v1",
        },
      });
    });

    it("offers credential fields for lakehouse connections", () => {
      renderDialog({ draft: draft({ engine: "iceberg", mode: "fields" }) });

      const labels = Array.from(
        container.querySelectorAll(".connection-form-body label span"),
      ).map((item) => item.textContent);

      expect(labels).toContain("Access key ID / client ID");
      expect(labels).toContain("Secret access key / token");
      expect(
        container.querySelector<HTMLInputElement>(
          '.connection-form-body input[type="password"]',
        ),
      ).not.toBeNull();
    });

    it("stays out of the way for engines that declare no options", () => {
      renderDialog({ draft: draft({ engine: "postgres" }) });

      expect(container.querySelector(".connector-options")).toBeNull();
    });
  });
});
