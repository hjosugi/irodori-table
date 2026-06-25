import { describe, expect, it } from "vitest";
import { buildOnlineQueryRequest, normalizeOnlineResult } from "./online-client";

describe("buildOnlineQueryRequest", () => {
  it("keeps endpoint secrets out of the request body", () => {
    const request = buildOnlineQueryRequest(
      {
        id: "prod",
        name: "Prod",
        mode: "online",
        engine: "postgres",
        endpoint: "https://example.test/query",
        token: "secret",
      },
      "select 1",
      100,
    );

    expect(request).toEqual({
      connectionId: "prod",
      engine: "postgres",
      sql: "select 1",
      maxRows: 100,
    });
  });
});

describe("normalizeOnlineResult", () => {
  it("accepts object rows and infers columns", () => {
    const result = normalizeOnlineResult(
      {
        rows: [
          { id: 1, name: "one" },
          { id: 2, name: "two" },
        ],
      },
      5,
    );

    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
    expect(result.rowCount).toBe(2);
  });
});
