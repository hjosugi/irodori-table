import type { RefObject } from "react";
import type { ErdLayout, ErdLayoutTable } from "./erd";
import type { IrodoriTheme } from "@/theme";

export function erdSvgStyle(theme: IrodoriTheme) {
  const { ui, syntax } = theme;
  return `
    .erd-bg { fill: ${ui.editorBg}; }
    .erd-schema { fill: ${ui.surfaceMuted}; stroke: ${ui.border}; stroke-width: 1; }
    .erd-schema-title { fill: ${ui.muted}; font: 700 13px Inter, ui-sans-serif, system-ui; }
    .erd-table { fill: ${ui.surfaceRaised}; stroke: ${ui.borderStrong}; stroke-width: 1; }
    .erd-table-header { fill: ${ui.gridHeader}; stroke: ${ui.border}; stroke-width: 1; }
    .erd-table-title { fill: ${ui.text}; font: 700 12px SFMono-Regular, Consolas, monospace; }
    .erd-column { fill: ${ui.text}; font: 11px SFMono-Regular, Consolas, monospace; }
    .erd-column-type { fill: ${ui.muted}; font: 10px SFMono-Regular, Consolas, monospace; }
    .erd-badge { fill: ${ui.selectedStrong}; stroke: ${ui.focus}; stroke-width: 1; }
    .erd-badge-text { fill: ${ui.focus}; font: 700 9px Inter, ui-sans-serif, system-ui; }
    .erd-edge { fill: none; stroke: ${ui.borderStrong}; stroke-width: 1.3; }
    .erd-edge.cross { stroke: ${syntax.property}; stroke-dasharray: 5 4; }
    .erd-svg marker path { fill: ${ui.borderStrong}; }
    .erd-edge-label-bg { fill: ${ui.editorBg}; opacity: 0.92; }
    .erd-edge-label { fill: ${ui.muted}; font: 10px SFMono-Regular, Consolas, monospace; }
    .erd-muted { fill: ${ui.muted}; font: 10px SFMono-Regular, Consolas, monospace; }
  `;
}

function truncateErdText(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

export function ErdSvg({
  layout,
  svgRef,
  svgStyle,
}: {
  layout: ErdLayout;
  svgRef: RefObject<SVGSVGElement | null>;
  svgStyle: string;
}) {
  return (
    <svg
      ref={svgRef}
      className="erd-svg"
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Entity relationship diagram"
    >
      <style>{svgStyle}</style>
      <defs>
        <marker
          id="erd-arrow-one"
          markerHeight="8"
          markerWidth="10"
          orient="auto"
          refX="8"
          refY="4"
          viewBox="0 0 10 8"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
        </marker>
      </defs>
      <rect
        className="erd-bg"
        x="0"
        y="0"
        width={layout.width}
        height={layout.height}
      />
      {layout.schemas.map((schema) => (
        <g key={schema.name}>
          <rect
            className="erd-schema"
            x={schema.x}
            y={schema.y}
            width={schema.width}
            height={schema.height}
            rx="7"
          />
          <text
            className="erd-schema-title"
            x={schema.x + 16}
            y={schema.y + 22}
          >
            {schema.name}
          </text>
          <text
            className="erd-muted"
            x={schema.x + schema.width - 72}
            y={schema.y + 22}
          >
            {schema.tableCount} tables
          </text>
        </g>
      ))}
      {layout.edges.map((edge) => (
        <g key={edge.id}>
          <path
            className={`erd-edge${edge.crossSchema ? " cross" : ""}`}
            d={edge.path}
            markerEnd="url(#erd-arrow-one)"
          />
          <rect
            className="erd-edge-label-bg"
            x={edge.labelX - edge.labelWidth / 2}
            y={edge.labelY - 12}
            width={edge.labelWidth}
            height={edge.labelHeight}
            rx="3"
          />
          <text
            className="erd-edge-label"
            x={edge.labelX}
            y={edge.labelY}
            textAnchor="middle"
          >
            {truncateErdText(edge.label, 16)}
          </text>
        </g>
      ))}
      {layout.tables.map((node) => (
        <ErdTableNode key={node.table.id} node={node} />
      ))}
    </svg>
  );
}

function ErdTableNode({ node }: { node: ErdLayoutTable }) {
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <title>{node.table.id}</title>
      <rect
        className="erd-table"
        x="0"
        y="0"
        width={node.width}
        height={node.height}
        rx="5"
      />
      <rect
        className="erd-table-header"
        x="0"
        y="0"
        width={node.width}
        height="30"
        rx="5"
      />
      <text className="erd-table-title" x="10" y="20">
        {truncateErdText(node.table.label, 30)}
      </text>
      {node.table.columns.map((column, index) => {
        const y = 49 + index * 20;
        return (
          <g key={`${column.name}-${index}`}>
            {column.primaryKey ? (
              <ErdBadge x={9} y={y - 13} label="PK" />
            ) : null}
            {column.foreignKey ? (
              <ErdBadge x={column.primaryKey ? 37 : 9} y={y - 13} label="FK" />
            ) : null}
            <text
              className="erd-column"
              x={column.primaryKey || column.foreignKey ? 68 : 12}
              y={y}
            >
              {truncateErdText(column.name, 22)}
            </text>
            <text
              className="erd-column-type"
              x={node.width - 10}
              y={y}
              textAnchor="end"
            >
              {truncateErdText(column.dataType, 18)}
            </text>
          </g>
        );
      })}
      {node.table.hiddenColumnCount > 0 ? (
        <text className="erd-muted" x="12" y={node.height - 8}>
          + {node.table.hiddenColumnCount} more columns
        </text>
      ) : null}
    </g>
  );
}

function ErdBadge({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect className="erd-badge" x={x} y={y} width="22" height="13" rx="3" />
      <text
        className="erd-badge-text"
        x={x + 11}
        y={y + 10}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}
