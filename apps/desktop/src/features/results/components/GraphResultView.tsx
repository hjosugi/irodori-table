import { useMemo } from "react";
import type { GraphResultModel } from "../graph-result";
import { layoutGraphResultModel } from "../graph-result";

export function GraphResultView({ model }: { model: GraphResultModel }) {
  const layout = useMemo(() => layoutGraphResultModel(model), [model]);
  if (model.nodes.length === 0) {
    return (
      <div className="graph-result-empty">
        No graph-shaped values found in this result
      </div>
    );
  }
  return (
    <div className="graph-result-view">
      <div className="graph-result-toolbar">
        <strong>Graph</strong>
        <span>
          {model.nodes.length} nodes · {model.edges.length} edges ·{" "}
          {model.sourceRows} rows
        </span>
      </div>
      <div className="graph-result-canvas">
        <svg
          className="graph-result-svg"
          role="img"
          aria-label="Query result graph"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
        >
          <defs>
            <marker
              id="graph-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <g className="graph-result-edge" key={edge.id}>
              <path d={edge.path} markerEnd="url(#graph-arrow)" />
              <text x={edge.labelX} y={edge.labelY}>
                {truncate(edge.label, 24)}
              </text>
            </g>
          ))}
          {layout.nodes.map((node) => (
            <g
              className="graph-result-node"
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
            >
              <circle r="34" />
              <text className="graph-result-node-label" y="-3">
                {truncate(node.label, 16)}
              </text>
              <text className="graph-result-node-type" y="14">
                {truncate(node.labels.join(":"), 18)}
              </text>
              <title>
                {node.labels.join(":")} {JSON.stringify(node.properties)}
              </title>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}
