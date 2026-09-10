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
import { sshTunnelDefaults } from "@/features/connections/connection-ssh";
import { usePreferencesStore } from "@/features/preferences";
import { parseConnectorConnectionModel } from "@/features/extensions/connection-model";
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

const qdrantConnectionModel = parseConnectorConnectionModel({
  schemaVersion: 1,
  endpoint: {
    modes: ["hostPort", "customEndpoint", "connectionString"],
    defaultPort: 6333,
    fields: [
      {
        id: "host",
        label: "Qdrant host",
        type: "string",
        profileField: "host",
        required: true,
      },
      {
        id: "protocol",
        label: "Protocol (REST or gRPC)",
        type: "string",
        option: "protocol",
        default: "rest",
        required: true,
      },
    ],
  },
  profileFields: [],
  authMethods: [
    { id: "none", label: "No authentication", kind: "none", fields: [] },
    {
      id: "connectionString",
      label: "Connection string / DSN",
      kind: "connectionString",
      fields: [
        {
          id: "url",
          label: "Connection URL or DSN",
          type: "uri",
          profileField: "url",
          required: true,
        },
      ],
    },
    {
      id: "apiKey",
      label: "API key",
      kind: "apiKey",
      fields: [
        {
          id: "apiKey",
          label: "API key",
          type: "secret",
          secretPurpose: "token",
          required: true,
        },
      ],
    },
    {
      id: "customDriverOptions",
      label: "Custom driver options",
      kind: "custom",
      fields: [
        {
          id: "options",
          label: "Driver options",
          type: "map",
          profileField: "options",
        },
      ],
    },
  ],
  tls: {
    supported: true,
    requiredByDefault: false,
    modes: ["disable", "prefer", "verifyFull"],
    fields: [
      {
        id: "caCertificate",
        label: "CA certificate",
        type: "pem",
      },
      {
        id: "clientPrivateKey",
        label: "Client private key",
        type: "pem",
        secretPurpose: "privateKey",
      },
    ],
  },
});

const icebergConnectionModel = parseConnectorConnectionModel({
  schemaVersion: 1,
  defaults: {
    engine: "iceberg",
    wire: "lakehouse",
    port: 443,
    readOnly: false,
  },
  endpoint: {
    modes: ["catalog", "connectionString"],
    defaultPort: 443,
    fields: [
      {
        id: "catalogUri",
        label: "Catalog URI",
        type: "uri",
        option: "catalogUri",
      },
      {
        id: "warehouse",
        label: "Warehouse path",
        type: "string",
        option: "warehouse",
      },
    ],
  },
  profileFields: [],
  authMethods: [
    { id: "none", label: "No authentication", kind: "none", fields: [] },
    {
      id: "oauth2",
      label: "OAuth 2.0",
      kind: "oauth2",
      fields: [
        {
          id: "clientId",
          label: "OAuth2 client ID",
          type: "string",
          option: "oauth2ClientId",
        },
        {
          id: "clientSecret",
          label: "OAuth2 client secret",
          type: "secret",
          secretPurpose: "token",
        },
      ],
    },
  ],
  tls: { supported: false, modes: [], fields: [] },
  transports: ["direct"],
});

const fieldsOnlyConnectionModel = parseConnectorConnectionModel({
  schemaVersion: 1,
  endpoint: {
    modes: ["cloudResource", "customEndpoint"],
    fields: [{ id: "environment", label: "Environment", type: "string" }],
  },
  profileFields: [],
  authMethods: [{ id: "apiKey", label: "API key", kind: "apiKey", fields: [] }],
  tls: { supported: false, modes: [], fields: [] },
  transports: ["direct"],
});

if (
  !qdrantConnectionModel ||
  !icebergConnectionModel ||
  !fieldsOnlyConnectionModel
) {
  throw new Error("test connector connection models did not parse");
}

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
  onOpenSqliteSample: vi.fn(),
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

  it("allows an installed connector to replace a missing built-in feature", async () => {
    const buildSupport: EngineBuildSupport[] = [
      {
        engine: "mongodb",
        includedInCurrentBuild: false,
        requiredFeature: "mongo",
      },
    ];
    mockDbEngineBuildSupport.mockResolvedValue(buildSupport);

    renderDialog({
      draft: draft({ engine: "mongodb", port: "27017" }),
      installedConnectorEngines: new Set(["mongodb"]),
    });

    const mongoOption = await screen.findByRole("option", { name: "MongoDB" });
    expect(mongoOption).not.toBeDisabled();
    expect(
      screen.queryByText(/MongoDB is not available in this desktop build/),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Test" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
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

    // Bulk delete lives in the row right-click menu now, not a counted footer
    // button. Right-clicking a row that is part of the selection keeps the set.
    fireEvent.contextMenu(screen.getByRole("button", { name: /Local Duck/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete (3)" }));

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

  it("right-clicking a single row opens an edit/delete menu", async () => {
    const profiles = [
      draft(),
      draft({ id: "local-mysql", name: "Local MySQL", engine: "mysql" }),
    ];
    const { props, user } = renderDialog({ profiles });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Local MySQL/ }));

    // A single (unselected) row offers Edit (load into the form) and Delete.
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));

    expect(props.onSelectProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local-mysql" }),
    );
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
    it("renders endpoint, authentication, and TLS from the installed connector", () => {
      renderDialog({
        draft: draft({
          engine: "qdrant",
          host: "qdrant.example.test",
          port: "6333",
          user: "",
          password: "",
          options: { authMethod: "apiKey" },
        }),
        connectionModel: qdrantConnectionModel,
      });

      expect(screen.getByLabelText("Qdrant host")).toHaveValue(
        "qdrant.example.test",
      );
      expect(screen.getByLabelText("Endpoint mode")).toHaveValue("hostPort");
      expect(screen.getByLabelText(/^Protocol \(REST or gRPC\)/)).toHaveValue(
        "rest",
      );
      expect(screen.getByLabelText("Authentication method")).toHaveValue(
        "apiKey",
      );
      expect(
        within(screen.getByLabelText("Authentication method")).queryByRole(
          "option",
          { name: "Connection string / DSN" },
        ),
      ).toBeNull();
      expect(screen.getByLabelText(/^API key/)).toHaveAttribute(
        "type",
        "password",
      );
      expect(
        screen.getAllByText("Session only · not saved").length,
      ).toBeGreaterThanOrEqual(2);
      expect(screen.getByLabelText("TLS mode")).toHaveValue("prefer");
      expect(screen.getByLabelText("CA certificate").tagName).toBe("TEXTAREA");
      expect(screen.queryByLabelText("API key / token")).toBeNull();
    });

    it("keeps connection-string auth in URL mode", () => {
      renderDialog({
        draft: draft({
          engine: "qdrant",
          mode: "url",
          options: { authMethod: "connectionString" },
        }),
        connectionModel: qdrantConnectionModel,
      });

      expect(
        within(screen.getByLabelText("Authentication method")).getByRole(
          "option",
          { name: "Connection string / DSN" },
        ),
      ).toBeVisible();
    });

    it("forces connectors with no connection-string mode onto fields", () => {
      const { props } = renderDialog({
        draft: draft({ engine: "pinecone", mode: "url" }),
        connectionModel: fieldsOnlyConnectionModel,
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({ mode: "fields" });
      expect(
        screen.queryByRole("group", { name: "Connection input mode" }),
      ).toBeNull();
    });

    it("renders supplemental profile fields and TLS fields without modes", () => {
      const supplementalModel = parseConnectorConnectionModel({
        schemaVersion: 1,
        endpoint: { modes: ["cloudResource"], fields: [] },
        profileFields: [
          {
            id: "tenant",
            label: "Tenant",
            type: "string",
            option: "tenant",
            required: true,
          },
        ],
        authMethods: [
          {
            id: "none",
            label: "No authentication",
            kind: "none",
            fields: [],
          },
        ],
        tls: {
          supported: true,
          requiredByDefault: true,
          modes: [],
          fields: [
            {
              id: "serverName",
              label: "TLS server name",
              type: "string",
              option: "serverName",
            },
          ],
        },
      });
      if (!supplementalModel) {
        throw new Error("supplemental connector model did not parse");
      }

      renderDialog({
        draft: draft({ engine: "qdrant", user: "", password: "" }),
        connectionModel: supplementalModel,
      });

      expect(screen.getByText("Profile", { selector: "legend" })).toBeVisible();
      expect(screen.getByLabelText(/^Tenant/)).toBeVisible();
      expect(screen.getByText("TLS", { selector: "legend" })).toBeVisible();
      expect(screen.getByLabelText("TLS server name")).toBeVisible();
      expect(screen.queryByLabelText("TLS mode")).toBeNull();
    });

    it("writes extension secrets to the transient draft map", () => {
      const selectedDraft = draft({
        engine: "qdrant",
        host: "qdrant.example.test",
        port: "6333",
        user: "",
        password: "",
        options: { authMethod: "apiKey" },
      });
      const { props } = renderDialog({
        draft: selectedDraft,
        connectionModel: qdrantConnectionModel,
      });

      fireEvent.change(screen.getByLabelText(/^API key/), {
        target: { value: "top-secret" },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        secretOptions: { apiKey: "top-secret" },
      });
    });

    it("clears old credentials when the declared authentication method changes", () => {
      const selectedDraft = draft({
        engine: "qdrant",
        password: "legacy-secret",
        options: { authMethod: "apiKey", protocol: "rest" },
        secretOptions: { apiKey: "top-secret" },
      });
      const { props } = renderDialog({
        draft: selectedDraft,
        connectionModel: qdrantConnectionModel,
      });

      fireEvent.change(screen.getByLabelText("Authentication method"), {
        target: { value: "none" },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        options: { authMethod: "none", protocol: "rest" },
        secretOptions: {},
        password: "",
      });
    });

    it("keeps custom driver options session-only and editable", () => {
      const selectedDraft = draft({
        engine: "qdrant",
        user: "",
        password: "",
        options: { authMethod: "customDriverOptions" },
        customOptionsJson: '{"cluster":"analytics"}',
      });
      const { props } = renderDialog({
        draft: selectedDraft,
        connectionModel: qdrantConnectionModel,
      });

      const options = screen.getByLabelText(/^Driver options/);
      expect(options.tagName).toBe("TEXTAREA");
      expect(options).toHaveValue('{"cluster":"analytics"}');
      expect(options).toHaveAttribute("autocomplete", "new-password");

      fireEvent.change(options, {
        target: { value: '{"cluster":"warehouse"}' },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        customOptionsJson: '{"cluster":"warehouse"}',
      });
    });

    it("renders the option fields an engine declares", () => {
      renderDialog({
        draft: draft({
          engine: "iceberg",
          options: { warehouse: "s3://bucket/warehouse" },
        }),
        connectionModel: icebergConnectionModel,
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
        connectionModel: icebergConnectionModel,
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
      renderDialog({
        draft: draft({
          engine: "iceberg",
          mode: "fields",
          options: { authMethod: "oauth2" },
        }),
        connectionModel: icebergConnectionModel,
      });

      expect(screen.getByLabelText("OAuth2 client ID")).toBeVisible();
      expect(screen.getByLabelText(/^OAuth2 client secret/)).toHaveAttribute(
        "type",
        "password",
      );
    });

    it("stays out of the way for engines that declare no options", () => {
      // SQLite is a local file, so it has neither connector options nor the
      // SSL fields every sqlx-backed engine gained in #229.
      const { container } = renderDialog({
        draft: draft({ engine: "sqlite" }),
      });

      expect(container.querySelector(".connector-options")).toBeNull();
    });

    it("renders sslMode as a select and the certificates as paths (#229)", () => {
      renderDialog({ draft: draft({ engine: "postgres", mode: "fields" }) });

      const sslMode = screen.getByLabelText("SSL mode");
      expect(sslMode.tagName).toBe("SELECT");
      expect(
        [...(sslMode as HTMLSelectElement).options].map(
          (option) => option.value,
        ),
      ).toEqual([
        "",
        "disable",
        "allow",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
      ]);
      // The empty first entry is what leaves the driver default in place, so a
      // profile saved without touching this field connects as it always did.
      expect((sslMode as HTMLSelectElement).value).toBe("");

      expect(screen.getByLabelText("SSL root certificate")).toHaveAttribute(
        "placeholder",
        "/etc/ssl/certs/server-ca.pem",
      );
    });

    it("reports the chosen SSL mode as a connector option (#229)", () => {
      const { props } = renderDialog({
        draft: draft({ engine: "postgres", mode: "fields" }),
      });

      fireEvent.change(screen.getByLabelText("SSL mode"), {
        target: { value: "verify-full" },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        options: { sslMode: "verify-full" },
      });
    });
  });
  describe("SSH tunnel", () => {
    const enabledTunnel = {
      ...sshTunnelDefaults(),
      enabled: true,
      host: "bastion.example.com",
      user: "deploy",
    };

    it("offers the tunnel for a field-mode network engine", () => {
      renderDialog({ draft: draft({ engine: "postgres", mode: "fields" }) });

      expect(
        screen.getByLabelText("Connect through an SSH tunnel"),
      ).not.toBeChecked();
    });

    // A DSN carries user, database, and driver options in one string, and the
    // forwarder can only replace a host and a port.
    it("hides the tunnel in URL mode and for file-backed engines", () => {
      renderDialog({ draft: draft({ engine: "postgres", mode: "url" }) });
      expect(
        screen.queryByLabelText("Connect through an SSH tunnel"),
      ).toBeNull();

      renderDialog({ draft: draft({ engine: "sqlite", mode: "fields" }) });
      expect(
        screen.queryByLabelText("Connect through an SSH tunnel"),
      ).toBeNull();
    });

    it("keeps the tunnel fields hidden until it is switched on", async () => {
      const { props, user } = renderDialog();
      expect(screen.queryByLabelText("SSH host")).toBeNull();

      await user.click(screen.getByLabelText("Connect through an SSH tunnel"));

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        ssh: { ...sshTunnelDefaults(), enabled: true },
      });
    });

    it("edits the tunnel without dropping the rest of it", () => {
      const { props } = renderDialog({ draft: draft({ ssh: enabledTunnel }) });

      fireEvent.change(screen.getByLabelText("SSH port"), {
        target: { value: "2222" },
      });

      expect(props.onUpdateDraft).toHaveBeenCalledWith({
        ssh: { ...enabledTunnel, port: "2222" },
      });
    });

    it("swaps the credential field with the authentication method", () => {
      renderDialog({ draft: draft({ ssh: enabledTunnel }) });
      expect(screen.getByLabelText("SSH password")).toBeVisible();
      expect(screen.queryByLabelText("Private key file")).toBeNull();

      renderDialog({
        draft: draft({ ssh: { ...enabledTunnel, authMethod: "privateKey" } }),
      });
      expect(screen.getByLabelText("Private key file")).toBeVisible();
      expect(screen.getByLabelText("Key passphrase")).toBeVisible();
    });

    it("asks for a host key only when verification is on", () => {
      renderDialog({ draft: draft({ ssh: enabledTunnel }) });
      expect(screen.queryByLabelText("Expected host key")).toBeNull();

      renderDialog({
        draft: draft({ ssh: { ...enabledTunnel, strictHostKey: true } }),
      });
      expect(screen.getByLabelText("Expected host key")).toBeVisible();
    });

    it("names the tunnel in the transport readout", () => {
      renderDialog({ draft: draft({ ssh: enabledTunnel }) });

      expect(
        screen.getByText("SSH tunnel via bastion.example.com"),
      ).toBeVisible();
    });
  });
});
