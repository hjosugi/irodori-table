import { beforeEach, describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n";
import {
  connectionCustomColorOptions,
  defaultConnectionColor,
  defaultPort,
  engineConnectionSettings,
  engineOptionFields,
  engineOptions,
  loadProfiles,
  memoryDefaults,
  normalizeConnectionColor,
  portableProfile,
  profilesStorageKey,
  profileFromDraft,
  redactPasswordFromConnectionUrl,
  repairBuiltinSampleProfile,
  sanitizedProfile,
  settingsProfileFromJson,
  validateDraft,
  withUniqueProfileIds,
  type ConnectionDraft,
} from "@/features/connections/connection-profiles";
import {
  extensionRequiredEngines,
  parseConnectorConnectionModel,
} from "@/features/extensions/connection-model";

const englishTranslator = createTranslator("en");
const japaneseTranslator = createTranslator("ja");

function draft(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "local",
    name: "Local",
    color: "#16a34a",
    engine: "postgres",
    mode: "fields",
    url: "",
    connectionTransport: "tcp",
    host: "127.0.0.1",
    port: "5432",
    user: "irodori",
    password: "secret",
    database: "samples",
    socketPath: "",
    readOnly: false,
    ...patch,
  };
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

beforeEach(() => {
  installLocalStorage();
});

describe("connection profiles", () => {
  it("normalizes custom color tags", () => {
    expect(normalizeConnectionColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeConnectionColor("#0f8")).toBe("#00ff88");
    expect(normalizeConnectionColor("bad")).toBe(defaultConnectionColor);
  });

  it("provides a broad custom connection color palette", () => {
    expect(connectionCustomColorOptions.length).toBeGreaterThanOrEqual(32);
    expect(new Set(connectionCustomColorOptions).size).toBe(
      connectionCustomColorOptions.length,
    );
    expect(
      connectionCustomColorOptions.every((color) =>
        /^#[0-9a-f]{6}$/.test(color),
      ),
    ).toBe(true);
  });

  it("normalizes settings JSON and strips stored passwords", () => {
    const profile = settingsProfileFromJson(
      {
        id: "warehouse",
        name: "Warehouse",
        color: "",
        engine: "duckdb",
        mode: "url",
        url: ":memory:",
        password: "should-not-persist",
      },
      0,
    );

    expect(profile).toMatchObject({
      id: "warehouse",
      name: "Warehouse",
      engine: "duckdb",
      mode: "url",
      url: ":memory:",
      password: "",
    });
    expect(profile.color).toBe(defaultConnectionColor);
    expect(profile.readOnly).toBe(false);
  });

  it("normalizes read-only mode from settings JSON", () => {
    const profile = settingsProfileFromJson(
      {
        id: "prod-reader",
        name: "Prod Reader",
        engine: "postgres",
        host: "prod.example.test",
        readOnly: true,
      },
      0,
    );

    expect(profile.readOnly).toBe(true);
  });

  it("redacts passwords from portable connection definitions", () => {
    const profile = portableProfile(
      draft({
        mode: "url",
        url: "postgres://irodori:secret@127.0.0.1:5432/samples?password=secret",
      }),
    );

    expect(profile.password).toBe("");
    expect(profile.url).toBe(
      "postgres://irodori@127.0.0.1:5432/samples?password=",
    );
    expect(
      redactPasswordFromConnectionUrl(
        "Server=db;Database=main;User Id=sa;Password=secret",
      ),
    ).toBe("Server=db;Database=main;User Id=sa;Password=");
  });

  it("redacts URL passwords from persisted connection definitions", () => {
    const profile = sanitizedProfile(
      draft({
        mode: "url",
        url: "postgres://irodori:secret@127.0.0.1:5432/samples?password=secret",
      }),
    );

    expect(profile.password).toBe("");
    expect(profile.url).toBe(
      "postgres://irodori@127.0.0.1:5432/samples?password=",
    );
  });

  it("migrates old localStorage profiles without keeping URL passwords", () => {
    window.localStorage.setItem(
      profilesStorageKey,
      JSON.stringify([
        draft({
          id: "prod",
          name: "Prod",
          mode: "url",
          url: "postgres://analyst:secret@db.example.test:5432/app?password=secret",
          password: "secret",
        }),
      ]),
    );

    const profile = loadProfiles().find((item) => item.id === "prod");

    expect(profile).toMatchObject({
      id: "prod",
      password: "",
      url: "postgres://analyst@db.example.test:5432/app?password=",
    });
  });

  it("drops extension secret maps left by an older localStorage payload", () => {
    window.localStorage.setItem(
      profilesStorageKey,
      JSON.stringify([
        draft({
          id: "legacy-extension",
          name: "Legacy extension",
          secretOptions: {
            apiKey: "top-secret",
            clientPrivateKey: "PRIVATE KEY",
          },
          customOptionsJson: '{"accessToken":"legacy-secret"}',
        }),
      ]),
    );

    const profile = loadProfiles().find(
      (item) => item.id === "legacy-extension",
    );

    expect(profile).toBeDefined();
    expect(profile).not.toHaveProperty("secretOptions");
    expect(JSON.stringify(profile)).not.toContain("top-secret");
    expect(JSON.stringify(profile)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(profile)).not.toContain("legacy-secret");
  });

  it("keeps duplicate imported IDs unique", () => {
    const profiles = withUniqueProfileIds([
      draft({ id: "local" }),
      draft({ id: "local", name: "Local 2" }),
      draft({ id: "", name: "Blank" }),
    ]);

    expect(profiles.map((profile) => profile.id)).toEqual([
      "local",
      "local-2",
      "connection-3",
    ]);
  });

  it("repairs bundled local Postgres profiles to the current sample URL", () => {
    const profile = repairBuiltinSampleProfile(
      draft({
        id: "local-pg",
        name: "Local Warehouse",
        color: "#16a34a",
        mode: "url",
        url: "postgres://irodori:irodori@localhost:55432/samples",
      }),
    );

    expect(profile.name).toBe("Local Postgres");
    expect(profile.url).toBe(
      "postgres://irodori:irodori@127.0.0.1:55432/samples",
    );
    expect(profile.color).toBe("#bddfbf");
    expect(profile.host).toBe("127.0.0.1");
  });

  it("migrates bundled sample colors to the pastel connection palette", () => {
    expect(
      repairBuiltinSampleProfile(draft({ id: "local-mysql", color: "#2563eb" }))
        .color,
    ).toBe("#b9cceb");
    expect(
      repairBuiltinSampleProfile(
        draft({
          id: "sqlite-memory",
          color: "#ca8a04",
          engine: "sqlite",
          database: ":memory:",
        }),
      ).color,
    ).toBe("#ead79f");
    expect(
      repairBuiltinSampleProfile(
        draft({
          id: "duckdb-memory",
          color: "#9333ea",
          engine: "duckdb",
          database: ":memory:",
        }),
      ).color,
    ).toBe("#d2c1ea");
    expect(
      repairBuiltinSampleProfile(draft({ id: "local-mysql", color: "#112233" }))
        .color,
    ).toBe("#112233");
  });

  it("no longer injects bundled MySQL sample credentials now that samples are removed", () => {
    const profile = repairBuiltinSampleProfile(
      draft({
        id: "local-mysql",
        name: "Local MySQL",
        engine: "mysql",
        mode: "url",
        url: "mysql://irodori@localhost:55306/samples",
        host: "localhost",
        port: "55306",
        database: "samples",
      }),
    );

    expect(profile.url).toBe("mysql://irodori@localhost:55306/samples");
  });

  it("validates and converts field drafts into API profiles", () => {
    const profile = draft({ mode: "fields", port: "15432", readOnly: true });

    expect(validateDraft(profile)).toBeNull();
    expect(profileFromDraft(profile)).toEqual({
      id: "local",
      engine: "postgres",
      host: "127.0.0.1",
      port: 15432,
      user: "irodori",
      password: "secret",
      database: "samples",
      socketPath: undefined,
      readOnly: true,
    });
  });

  it("allows Postgres socket transport without a TCP host", () => {
    const profile = draft({
      connectionTransport: "socket",
      host: "",
      socketPath: "/var/run/postgresql",
    });

    expect(validateDraft(profile)).toBeNull();
    expect(profileFromDraft(profile)).toMatchObject({
      id: "local",
      engine: "postgres",
      socketPath: "/var/run/postgresql",
      user: "irodori",
      password: "secret",
      database: "samples",
    });
  });

  it("requires a socket path when socket transport is selected", () => {
    expect(
      validateDraft(
        draft({
          connectionTransport: "socket",
          host: "",
          socketPath: "",
        }),
      ),
    ).toBe("socket path is required");
  });
});

describe("connector options", () => {
  it("never forwards retired static options for extension-backed engines", () => {
    const profile = profileFromDraft(
      draft({
        engine: "iceberg",
        options: {
          catalogUri: "https://catalog.example.com/v1",
          warehouse: "s3://bucket/warehouse",
          region: "us-east-1",
        },
      }),
    );

    expect(profile.options).toBeUndefined();
  });

  it("keeps the built-in Snowflake option allowlist", () => {
    const profile = profileFromDraft(
      draft({
        engine: "snowflake",
        options: {
          warehouse: "COMPUTE_WH",
          role: "ACCOUNTADMIN",
          catalogUri: "must-not-cross-engines",
        },
      }),
    );

    expect(profile.options).toEqual({
      warehouse: "COMPUTE_WH",
      role: "ACCOUNTADMIN",
    });
  });

  it("keeps connector options when importing a settings file", () => {
    const imported = settingsProfileFromJson(
      {
        id: "lake",
        engine: "iceberg",
        options: { catalogUri: "https://catalog.example.com/v1", empty: "  " },
      },
      0,
    );

    expect(imported.options).toEqual({
      catalogUri: "https://catalog.example.com/v1",
    });
  });

  it("keeps every extension-backed engine out of the built-in config", () => {
    for (const engine of extensionRequiredEngines) {
      expect(engineOptionFields(engine), `${engine} option fields`).toEqual([]);
      expect(defaultPort(engine), `${engine} default port`).toBe("");
    }
  });

  it("initializes extension drafts from connection-model defaults", () => {
    const model = parseConnectorConnectionModel({
      schemaVersion: 1,
      defaults: {
        engine: "motherduck",
        wire: "duckdb",
        port: 443,
        readOnly: true,
      },
      endpoint: {
        modes: ["motherduckService", "connectionString"],
        defaultPort: 443,
        fields: [
          {
            id: "host",
            label: "MotherDuck endpoint",
            type: "string",
            profileField: "host",
            default: "api.motherduck.com",
          },
          {
            id: "database",
            label: "Database",
            type: "string",
            profileField: "database",
            default: "analytics",
          },
        ],
      },
      profileFields: [],
      authMethods: [],
      tls: { supported: false, modes: [], fields: [] },
      transports: ["direct"],
    });
    expect(model).not.toBeNull();
    expect(memoryDefaults("motherduck", model)).toMatchObject({
      mode: "fields",
      host: "api.motherduck.com",
      port: "443",
      database: "analytics",
      readOnly: true,
    });
  });

  it("declares no secret-valued option keys", () => {
    // Options are persisted to localStorage in the clear, and upstream
    // irodori-connection rejects these keys outright ("must be stored as a
    // secret handle"). Secrets belong in `password`, which is session-only.
    const secretish =
      /^(password|passwd|pwd|secret|token|privatekey|passphrase)$/;
    const declared = engineOptions.flatMap((engine) =>
      engineOptionFields(engine.value).map((field) => field.key),
    );

    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) {
      expect(key.toLowerCase().replace(/[_-]/g, "")).not.toMatch(secretish);
    }
  });

  it("resolves every engine's form labels in both locales", () => {
    // builtin-engine-connection-config.json holds translation keys that TypeScript
    // cannot check (JSON imports widen to `string`), and `translate` throws on
    // an unknown key. Resolving every engine proves each key really exists.
    for (const locale of ["en", "ja"] as const) {
      const { t } = createTranslator(locale);
      for (const engine of engineOptions) {
        const settings = engineConnectionSettings(engine.value, t);
        for (const [field, value] of Object.entries(settings)) {
          if (!field.endsWith("Label")) {
            continue;
          }
          expect(value, `${engine.value}.${field} in ${locale}`).not.toBe("");
        }
        for (const field of engineOptionFields(engine.value)) {
          expect(t(field.labelKey), `${field.key} in ${locale}`).not.toBe("");
        }
      }
    }
  });

  it("localises the connection form instead of leaking English", () => {
    const english = engineConnectionSettings("postgres", englishTranslator.t);
    const japanese = engineConnectionSettings("postgres", japaneseTranslator.t);

    expect(english.hostLabel).toBe("Host");
    expect(english.passwordPlaceholder).toBe("Session only");
    expect(japanese.hostLabel).toBe("ホスト");
    expect(japanese.userLabel).toBe("ユーザー");
    expect(japanese.databaseLabel).toBe("データベース");
    // The prose placeholders live in code, not the config, so they translate
    // while example values like `postgres://…` stay verbatim.
    expect(japanese.passwordPlaceholder).toBe("セッションのみ");
    expect(japanese.urlPlaceholder).toBe(
      "postgres://user:password@host:5432/database",
    );
  });

  it("spells the transport the same way in the toggle and the summary", () => {
    // Regression: the toggle rendered t("connection.transportTcp") while the
    // summary row rendered a second English copy from the JSON, so one dialog
    // showed "直接 TCP" and "Direct TCP" at once.
    for (const translator of [englishTranslator, japaneseTranslator]) {
      expect(
        engineConnectionSettings("postgres", translator.t).transportLabel,
      ).toBe(translator.t("connection.transportTcp"));
    }
  });

  it("keeps options out of engines that declare none", () => {
    // SQLite is a local file — no transport, so not even the SSL fields.
    expect(engineOptionFields("sqlite")).toEqual([]);
    expect(
      profileFromDraft(draft({ options: { warehouse: "nope" } })).options,
    ).toBeUndefined();
  });

  it("offers SSL controls on every sqlx-backed engine (#229)", () => {
    // Keys must match what db/engine.rs `SslSettings::from_profile` reads.
    const expected = ["sslMode", "sslRootCert", "sslCert", "sslKey"];
    const postgresWire = [
      "postgres",
      "cockroachdb",
      "yugabytedb",
      "redshift",
      "timescaledb",
      "neon",
      "h2",
      "questdb",
    ] as const;
    const mysqlWire = ["mysql", "mariadb", "tidb"] as const;

    for (const engine of postgresWire) {
      expect(
        engineOptionFields(engine).map((field) => field.key),
        `${engine} SSL options`,
      ).toEqual(expected);
    }
    // The MySQL wire carries the same four plus its connection charset, which
    // Postgres has no connect-time counterpart for.
    for (const engine of mysqlWire) {
      expect(
        engineOptionFields(engine).map((field) => field.key),
        `${engine} SSL options`,
      ).toEqual([...expected, "charset"]);
    }
  });

  it("offers a connection charset on the MySQL wire only (#229)", () => {
    // Key must match what db/engine.rs appends to the URL, and sqlx-mysql only
    // parses `charset` for the MySQL wire.
    const charsetField = engineOptionFields("mysql").find(
      (field) => field.key === "charset",
    );
    expect(charsetField?.choices).toEqual([
      "utf8mb4",
      "utf8mb3",
      "latin1",
      "binary",
    ]);
    expect(
      engineOptionFields("postgres").some((field) => field.key === "charset"),
    ).toBe(false);
  });

  it("constrains sslMode to the modes the Rust side can translate (#229)", () => {
    // db/engine.rs `SslMode::parse` accepts these six and maps each to the
    // MySQL spelling; anything else is silently dropped, so the form must not
    // let a user type one.
    const sslMode = engineOptionFields("postgres").find(
      (field) => field.key === "sslMode",
    );
    expect(sslMode?.choices).toEqual([
      "disable",
      "allow",
      "prefer",
      "require",
      "verify-ca",
      "verify-full",
    ]);

    // The certificate fields are free-form paths, not a closed set.
    for (const key of ["sslRootCert", "sslCert", "sslKey"]) {
      const field = engineOptionFields("postgres").find(
        (candidate) => candidate.key === key,
      );
      expect(field?.choices, key).toBeUndefined();
      expect(field?.placeholder, key).toBeTruthy();
    }
  });

  it("stores certificate paths, never key material (#229)", () => {
    // `sslKey` names a file on disk. Options persist to localStorage in the
    // clear, so the value must stay a path — the sibling test
    // "declares no secret-valued option keys" is what enforces that no option
    // is named like a secret, and this one records why sslKey is allowed.
    const keys = engineOptionFields("postgres").map((field) => field.key);
    expect(keys).toContain("sslKey");
    expect(keys).not.toContain("sslPassword");
    expect(keys).not.toContain("sslKeyPassphrase");
  });
});
