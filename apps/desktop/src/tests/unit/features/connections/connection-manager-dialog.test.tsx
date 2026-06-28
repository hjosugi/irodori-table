import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManagerDialog } from "@/features/connections/ConnectionManagerDialog";
import {
  connectionColorOptions,
  type ConnectionDraft,
} from "@/features/connections/connection-profiles";

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
    host: "127.0.0.1",
    port: "5432",
    user: "irodori",
    password: "",
    database: "samples",
    readOnly: false,
    ...patch,
  };
}

beforeEach(() => {
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
    onDeleteProfile: vi.fn(),
    onDisconnect: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    onConnect: vi.fn((event) => event.preventDefault()),
    ...overrides,
  };
  flushSync(() => root.render(<ConnectionManagerDialog {...props} />));
  return props;
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

  it("requires confirmation before deleting a connection", async () => {
    const props = renderDialog();
    const deleteButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Delete");

    expect(deleteButton).not.toBeUndefined();
    flushSync(() => deleteButton?.click());

    expect(props.onDeleteProfile).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete connection?");

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".confirm-dialog button"),
    ).find((button) => button.textContent === "Delete");
    flushSync(() => confirmButton?.click());
    await Promise.resolve();

    expect(props.onDeleteProfile).toHaveBeenCalledTimes(1);
  });
});
