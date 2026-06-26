import { describe, expect, it } from "vitest";
import { buildParameterInputs } from "@/features/query-editor/query-parameters";
import type { QueryParameterPromptSet } from "@/generated/irodori-api";

const promptSet: QueryParameterPromptSet = {
  signature: "select :id :active :payload",
  prompts: [
    {
      key: { kind: "name", name: "id" },
      id: "id",
      label: "id",
      placeholder: "",
    },
    {
      key: { kind: "name", name: "active" },
      id: "active",
      label: "active",
      placeholder: "",
    },
    {
      key: { kind: "name", name: "payload" },
      id: "payload",
      label: "payload",
      placeholder: "",
    },
  ],
};

describe("query parameter inputs", () => {
  it("parses scalar and JSON values from prompt memory", () => {
    expect(
      buildParameterInputs(promptSet, {
        id: "42",
        active: "true",
        payload: '{"tier":"gold"}',
      }),
    ).toEqual([
      { key: { kind: "name", name: "id" }, value: 42 },
      { key: { kind: "name", name: "active" }, value: true },
      { key: { kind: "name", name: "payload" }, value: { tier: "gold" } },
    ]);
  });

  it("keeps invalid JSON as text", () => {
    expect(
      buildParameterInputs(promptSet, {
        id: "abc",
        active: "false",
        payload: "{",
      }),
    ).toEqual([
      { key: { kind: "name", name: "id" }, value: "abc" },
      { key: { kind: "name", name: "active" }, value: false },
      { key: { kind: "name", name: "payload" }, value: "{" },
    ]);
  });
});
