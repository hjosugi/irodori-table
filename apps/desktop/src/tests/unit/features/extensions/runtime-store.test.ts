import { describe, expect, it } from "vitest";
import { deriveEnabledHostFeatures } from "@/features/extensions/runtime-store";
import type { InstalledExtension } from "@/generated/irodori-api";

function extension(
  patch: Partial<InstalledExtension> = {},
): InstalledExtension {
  return {
    id: "irodori.knowledge",
    name: "Irodori Knowledge",
    version: "0.1.0",
    runtime: "declarative",
    hostFeatures: ["knowledge"],
    sha256: "a".repeat(64),
    enabled: true,
    installedAt: "0",
    supportedCalls: [],
    ...patch,
  };
}

describe("declarative extension host features", () => {
  it("keeps feature UI unavailable when the extension is absent or disabled", () => {
    expect(deriveEnabledHostFeatures([])).toEqual([]);
    expect(deriveEnabledHostFeatures([extension({ enabled: false })])).toEqual(
      [],
    );
  });

  it("enables each installed declarative feature exactly once", () => {
    expect(
      deriveEnabledHostFeatures([
        extension(),
        extension({ id: "irodori.knowledge-copy" }),
        extension({
          id: "irodori.datalake",
          name: "Irodori Datalake",
          hostFeatures: ["datalake"],
        }),
      ]),
    ).toEqual(["knowledge", "datalake"]);
  });

  it("does not activate host features declared by native connectors", () => {
    expect(
      deriveEnabledHostFeatures([
        extension({ runtime: "native", hostFeatures: ["knowledge"] }),
      ]),
    ).toEqual([]);
  });
});
