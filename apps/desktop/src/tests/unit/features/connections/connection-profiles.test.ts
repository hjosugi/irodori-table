import { beforeEach, describe, expect, it } from "vitest";
import {
  connectionCustomColorOptions,
  defaultConnectionColor,
  engineOptionFields,
  engineOptions,
  loadProfiles,
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
  function lakehouseDraft(patch: Partial<ConnectionDraft> = {}) {
    return draft({
      id: "lake",
      engine: "iceberg",
      mode: "fields",
      host: "",
      port: "",
      user: "AKIAIOSFODNN7EXAMPLE",
      database: "sales.orders",
      ...patch,
    });
  }

  it("carries declared connector options through to the API profile", () => {
    const profile = profileFromDraft(
      lakehouseDraft({
        options: {
          catalogUri: "https://catalog.example.com/v1",
          warehouse: "s3://bucket/warehouse",
        },
      }),
    );

    expect(profile.options).toEqual({
      catalogUri: "https://catalog.example.com/v1",
      warehouse: "s3://bucket/warehouse",
    });
    // Credentials stay on the profile columns, never in options.
    expect(profile.user).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(profile.password).toBe("secret");
  });

  it("carries connector options in URL mode too", () => {
    const profile = profileFromDraft(
      lakehouseDraft({
        mode: "url",
        url: "s3://bucket/warehouse/sales/orders",
        options: { catalogUri: "https://catalog.example.com/v1" },
      }),
    );

    expect(profile.options).toEqual({
      catalogUri: "https://catalog.example.com/v1",
    });
  });

  it("omits options entirely when nothing is set", () => {
    expect(profileFromDraft(lakehouseDraft()).options).toBeUndefined();
    expect(
      profileFromDraft(lakehouseDraft({ options: { catalogUri: "  " } }))
        .options,
    ).toBeUndefined();
  });

  it("drops options that the selected engine does not declare", () => {
    // Left behind after switching engines in the form: `role` is Snowflake's,
    // and must not reach the Iceberg connector.
    const profile = profileFromDraft(
      lakehouseDraft({
        options: { warehouse: "s3://bucket/warehouse", role: "ACCOUNTADMIN" },
      }),
    );

    expect(profile.options).toEqual({ warehouse: "s3://bucket/warehouse" });
  });

  it("requires options marked required", () => {
    const athena = draft({ engine: "athena", mode: "url", url: "athena://db" });

    expect(validateDraft(athena)).toBe("aws region is required");
    expect(
      validateDraft({ ...athena, options: { region: "us-east-1" } }),
    ).toBeNull();
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

  it("keeps options out of engines that declare none", () => {
    expect(engineOptionFields("postgres")).toEqual([]);
    expect(
      profileFromDraft(draft({ options: { warehouse: "nope" } })).options,
    ).toBeUndefined();
  });
});
