import { describe, expect, it } from "vitest";
import {
  buildGraphResultModel,
  layoutGraphResultModel,
} from "@/features/results/graph-result";

describe("graph result model", () => {
  it("extracts Neo4j-style nodes and relationships from query rows", () => {
    const model = buildGraphResultModel(
      ["a", "r", "b"],
      [
        [
          {
            elementId: "n1",
            labels: ["Person"],
            properties: { name: "Ada" },
          },
          {
            elementId: "r1",
            type: "KNOWS",
            startNodeElementId: "n1",
            endNodeElementId: "n2",
            properties: { since: 2024 },
          },
          {
            elementId: "n2",
            labels: ["Person"],
            properties: { name: "Grace" },
          },
        ],
      ],
    );

    expect(model.nodes.map((node) => node.label)).toEqual(["Ada", "Grace"]);
    expect(model.edges).toEqual([
      expect.objectContaining({
        sourceId: "n1",
        targetId: "n2",
        label: "KNOWS",
      }),
    ]);

    const layout = layoutGraphResultModel(model);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges[0].path).toMatch(/^M /);
    expect(Number.isFinite(layout.edges[0].labelX)).toBe(true);
  });

  it("extracts generic source-target edge rows", () => {
    const model = buildGraphResultModel(
      ["edge"],
      [
        [
          {
            source: "doc-1",
            target: "doc-2",
            type: "SIMILAR_TO",
            score: 0.91,
          },
        ],
      ],
    );

    expect(model.nodes.map((node) => node.id)).toEqual(["doc-1", "doc-2"]);
    expect(model.edges[0]).toMatchObject({
      sourceId: "doc-1",
      targetId: "doc-2",
      label: "SIMILAR_TO",
      properties: { score: 0.91 },
    });
  });
});
