import { describe, expect, it } from "vitest";
import {
  normalizeConnectionColor,
  profileFromDraft,
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
    expect(normalizeConnectionColor("bad")).toBe("#6b7280");
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
    expect(profile.color).toBe("#6b7280");
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
        mode: "url",
        url: "postgres://irodori:irodori@localhost:55432/samples",
      }),
    );

    expect(profile.name).toBe("Local Postgres");
    expect(profile.url).toBe("postgres://irodori:irodori@127.0.0.1:55432/samples");
    expect(profile.host).toBe("127.0.0.1");
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
