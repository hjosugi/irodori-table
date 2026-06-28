import { describe, expect, it } from "vitest";
import {
  connectionCustomColorOptions,
  defaultConnectionColor,
  normalizeConnectionColor,
  portableProfile,
  profileFromDraft,
  redactPasswordFromConnectionUrl,
  repairBuiltinSampleProfile,
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
    host: "127.0.0.1",
    port: "5432",
    user: "irodori",
    password: "secret",
    database: "samples",
    ...patch,
  };
}

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

  it("validates and converts field drafts into API profiles", () => {
    const profile = draft({ mode: "fields", port: "15432" });

    expect(validateDraft(profile)).toBeNull();
    expect(profileFromDraft(profile)).toEqual({
      id: "local",
      engine: "postgres",
      host: "127.0.0.1",
      port: 15432,
      user: "irodori",
      password: "secret",
      database: "samples",
    });
  });
});
