import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbEngineBuildSupport,
  type EngineBuildSupport,
} from "@/generated/irodori-api";
import { ConnectionManagerDialog } from "@/features/connections/ConnectionManagerDialog";
import {
  connectionColorOptions,
  type ConnectionDraft,
} from "@/features/connections/connection-profiles";
import { usePreferencesStore } from "@/features/preferences";
import { componentRenderer } from "@/tests/helpers/render";

vi.mock("@/generated/irodori-api", () => ({
  dbEngineBuildSupport: vi.fn(),
}));

const mockDbEngineBuildSupport = vi.mocked(dbEngineBuildSupport);

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

const baseDraft = draft();

const render = componentRenderer(ConnectionManagerDialog, () => ({
  profiles: [baseDraft],
  connectedIds: new Set<string>(),
  selectedProfileId: baseDraft.id,
  draft: baseDraft,
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
}));

/** Keep `draft` and `profiles` consistent when a test overrides the draft. */
function renderDialog(
  overrides: Partial<Parameters<typeof ConnectionManagerDialog>[0]> = {},
) {
  const selectedDraft = overrides.draft ?? baseDraft;
  return render({
    profiles: overrides.profiles ?? [selectedDraft],
    selectedProfileId: selectedDraft.id,
    ...overrides,
    draft: selectedDraft,
  });
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
  mockDbEngineBuildSupport.mockReset();
  mockDbEngineBuildSupport.mockResolvedValue([]);
});

/**
 * Several presets also appear in the "More colors" palette, so `Use color #hex`
 * is ambiguous document-wide. The old querySelector-based test silently took
 * whichever came first; scope to the compact picker instead.
 */
function colorSwatch(color: string) {
  return within(
    screen.getByRole("group", { name: "Connection color" }),
  ).getByRole("button", { name: `Use color ${color}` });
}

describe("ConnectionManagerDialog", () => {
  it("selects preset colors from the compact color picker", async () => {
    const nextColor = connectionColorOptions[1];
    const { props, user } = renderDialog();

    await user.click(colorSwatch(nextColor));

    expect(props.onUpdateDraft).toHaveBeenCalledWith({ color: nextColor });
  });

  it("marks the active color as pressed", () => {
    const activeColor = connectionColorOptions[2];
    renderDialog({ draft: draft({ color: activeColor }) });

    const button = colorSwatch(activeColor);

    expect(button).toHaveAttribute("aria-pressed", "true");
    // The tick is the only visible cue that this swatch is the active one.
    expect(button.querySelector("svg")).not.toBeNull();
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
      draft: draft({ engine: "duckdb", database: ":memory:", port: "" }),
    });

    const duckOption = await screen.findByRole("option", {
      name: /not in this build/,
    });
    expect(duckOption).toHaveValue("duckdb");
    expect(duckOption).toBeDisabled();
    expect(
      screen.getByText(/DuckDB is not available in this desktop build/),
    ).toBeVisible();

    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("requires confirmation before deleting a connection", async () => {
    const { props, user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(props.onDeleteProfiles).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Delete connection?" });
    expect(confirm).toBeVisible();

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(props.onDeleteProfiles).toHaveBeenCalledTimes(1);
    expect(props.onDeleteProfiles).toHaveBeenCalledWith(["local-pg"]);
  });

  it("shift+click selects a range and deletes it together after confirming", async () => {
    const profiles = [
      draft(),
      draft({ id: "local-mysql", name: "Local MySQL", engine: "mysql" }),
      draft({ id: "local-duck", name: "Local Duck", engine: "duckdb" }),
    ];
    const { props, user, container } = renderDialog({ profiles });

    await user.click(screen.getByRole("button", { name: /Local Postgres/ }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: /Local Duck/ }));
    await user.keyboard("{/Shift}");

    // Selection is a purely visual state with no ARIA surface on these rows.
    expect(
      container.querySelectorAll(".connection-profile.selected"),
    ).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Delete (3)" }));

    const confirm = screen.getByRole("dialog", {
      name: "Delete 3 connections?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(props.onDeleteProfiles).toHaveBeenCalledWith([
      "local-pg",
      "local-mysql",
      "local-duck",
    ]);
  });

  it("shows structured connection errors with raw details", () => {
    const { container } = renderDialog({
      error: {
        kind: "connection",
        message: "password authentication failed",
        code: "28P01",
        retryable: false,
      },
    });

    expect(screen.getByText("Connection failed")).toBeVisible();
    expect(screen.getByText("password authentication failed")).toBeVisible();
    expect(screen.getByText("Details")).toBeVisible();
    // The raw payload lives in a collapsed <details>, so it is deliberately
    // not asserted as visible.
    expect(container.querySelector("pre")?.textContent).toContain(
      '"code": "28P01"',
    );
  });

  describe("accessible names", () => {
    // #139: aria-label sat on roleless <div>s, which assistive tech ignores.
    // The color picker at the top of the form already does this right with
    // role="group"; these two toggles now match it.
    it("exposes the input-mode and transport toggles as named groups", () => {
      renderDialog();

      const modeToggle = screen.getByRole("group", {
        name: "Connection input mode",
      });
      expect(
        within(modeToggle).getByRole("button", { name: "URL" }),
      ).toBeVisible();

      const transportToggle = screen.getByRole("group", {
        name: "Connection transport",
      });
      expect(
        within(transportToggle).getByRole("button", { name: "Unix socket" }),
      ).toBeVisible();
    });

    // #140: the search input was named only by its placeholder — the weakest
    // fallback in the accname computation. ExtensionsTab already pairs the
    // placeholder with an explicit aria-label; this control now does too.
    it("gives the connection search an explicit accessible name", () => {
      renderDialog();

      const search = screen.getByRole("textbox", {
        name: "Search connections",
      });
      expect(search).toHaveAttribute("aria-label", "Search connections");
    });
  });

  describe("empty picker", () => {
    // #143: with zero saved connections Delete was still enabled and walked
    // straight into confirming the deletion of a connection that does not
    // exist.
    it("disables Delete when there are no saved connections", () => {
      renderDialog({ profiles: [] });

      expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    });

    it("disables Delete while the draft is an unsaved new connection", () => {
      const saved = draft({ id: "saved-pg", name: "Saved Postgres" });
      renderDialog({ profiles: [saved], draft: draft({ id: "brand-new" }) });

      expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    });

    // #144: a first run showed "No matching connections" although nothing had
    // been searched — the message must depend on whether a search is active.
    it("shows a first-run hint instead of 'no matches' when nothing is saved", () => {
      renderDialog({ profiles: [] });

      expect(
        screen.getByText("No saved connections yet. Select + to add one."),
      ).toBeVisible();
      expect(screen.queryByText("No matching connections")).toBeNull();
    });

    it("keeps the no-matches message for searches that find nothing", () => {
      renderDialog({ profiles: [], search: "prod" });

      expect(screen.getByText("No matching connections")).toBeVisible();
      expect(
        screen.queryByText("No saved connections yet. Select + to add one."),
      ).toBeNull();
    });
  });

  describe("connector settings", () => {
    it("renders the option fields an engine declares", () => {
      renderDialog({
        draft: draft({
          engine: "iceberg",
          options: { warehouse: "s3://bucket/warehouse" },
        }),
      });

      // getByLabelText also proves the <label> is wired to the input, which a
      // querySelector walk from the label span never checked.
      expect(screen.getByLabelText("Catalog URI")).toHaveValue("");
      expect(screen.getByLabelText("Warehouse path")).toHaveValue(
        "s3://bucket/warehouse",
      );
    });

    it("writes typed option values into the draft without dropping siblings", () => {
      const { props } = renderDialog({
        draft: draft({
          engine: "iceberg",
          options: { warehouse: "s3://bucket/warehouse" },
        }),
      });

      // fireEvent.change rather than user.type: the input is controlled by the
      // `draft` prop, and onUpdateDraft is a spy that never feeds a new draft
      // back, so per-keystroke typing would only ever report one character.
      fireEvent.change(screen.getByLabelText("Catalog URI"), {
        target: { value: "https://catalog.example.com/v1" },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        options: {
          warehouse: "s3://bucket/warehouse",
          catalogUri: "https://catalog.example.com/v1",
        },
      });
    });

    it("offers credential fields for lakehouse connections", () => {
      renderDialog({ draft: draft({ engine: "iceberg", mode: "fields" }) });

      expect(screen.getByLabelText("Access key ID / client ID")).toBeVisible();
      expect(
        screen.getByLabelText("Secret access key / token"),
      ).toHaveAttribute("type", "password");
    });

    it("stays out of the way for engines that declare no options", () => {
      const { container } = renderDialog({
        draft: draft({ engine: "postgres" }),
      });

      expect(container.querySelector(".connector-options")).toBeNull();
    });
  });
});
