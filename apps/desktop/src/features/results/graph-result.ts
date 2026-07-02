export type GraphResultNode = {
  id: string;
  label: string;
  labels: string[];
  properties: Record<string, unknown>;
};

export type GraphResultEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphResultModel = {
  nodes: GraphResultNode[];
  edges: GraphResultEdge[];
  sourceRows: number;
};

export type GraphResultLayoutNode = GraphResultNode & {
  x: number;
  y: number;
};

export type GraphResultLayoutEdge = GraphResultEdge & {
  path: string;
  labelX: number;
  labelY: number;
};

export type GraphResultLayout = {
  width: number;
  height: number;
  nodes: GraphResultLayoutNode[];
  edges: GraphResultLayoutEdge[];
};

const maxGraphNodes = 160;
const maxGraphEdges = 260;
const nodeRadius = 34;
const layoutPadding = 56;
const graphColumnGap = 138;
const graphRowGap = 104;

export function buildGraphResultModel(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): GraphResultModel {
  const builder = new GraphBuilder();
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      builder.visit(
        cell,
        columns[columnIndex] ?? `col_${columnIndex}`,
        rowIndex,
      );
    });
  });
  return {
    nodes: builder.nodes(),
    edges: builder.edges(),
    sourceRows: rows.length,
  };
}

export function layoutGraphResultModel(
  model: GraphResultModel,
): GraphResultLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(model.nodes.length)));
  const rows = Math.max(1, Math.ceil(model.nodes.length / columns));
  const width = Math.max(
    360,
    layoutPadding * 2 + (columns - 1) * graphColumnGap,
  );
  const height = Math.max(260, layoutPadding * 2 + (rows - 1) * graphRowGap);
  const nodes = model.nodes.map((node, index): GraphResultLayoutNode => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      x: layoutPadding + column * graphColumnGap,
      y: layoutPadding + row * graphRowGap,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = model.edges.flatMap((edge): GraphResultLayoutEdge[] => {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) {
      return [];
    }
    if (source.id === target.id) {
      const loopX = source.x + nodeRadius + 28;
      const loopY = source.y - nodeRadius - 18;
      return [
        {
          ...edge,
          path: `M ${source.x + nodeRadius} ${source.y} C ${loopX} ${loopY}, ${loopX} ${source.y + nodeRadius + 18}, ${source.x} ${source.y + nodeRadius}`,
          labelX: loopX,
          labelY: source.y,
        },
      ];
    }
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const sx = source.x + (dx / distance) * nodeRadius;
    const sy = source.y + (dy / distance) * nodeRadius;
    const tx = target.x - (dx / distance) * nodeRadius;
    const ty = target.y - (dy / distance) * nodeRadius;
    const midX = (sx + tx) / 2;
    const midY = (sy + ty) / 2;
    const bend = Math.min(42, Math.max(18, distance * 0.12));
    const nx = -dy / distance;
    const ny = dx / distance;
    const cx = midX + nx * bend;
    const cy = midY + ny * bend;
    return [
      {
        ...edge,
        path: `M ${round(sx)} ${round(sy)} Q ${round(cx)} ${round(cy)} ${round(tx)} ${round(ty)}`,
        labelX: round(cx),
        labelY: round(cy),
      },
    ];
  });
  return { width, height, nodes, edges };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

class GraphBuilder {
  private readonly nodeMap = new Map<string, GraphResultNode>();
  private readonly edgeMap = new Map<string, GraphResultEdge>();

  visit(value: unknown, column: string, rowIndex: number): string | null {
    if (
      this.nodeMap.size >= maxGraphNodes &&
      this.edgeMap.size >= maxGraphEdges
    ) {
      return null;
    }
    if (typeof value === "string") {
      return this.visitJsonString(value, column, rowIndex);
    }
    if (Array.isArray(value)) {
      let lastId: string | null = null;
      value.forEach((item, index) => {
        lastId = this.visit(item, `${column}_${index}`, rowIndex) ?? lastId;
      });
      return lastId;
    }
    const record = asRecord(value);
    if (!record) {
      return null;
    }
    const edgeId = this.addEdgeRecord(record, column, rowIndex);
    if (edgeId) {
      return edgeId;
    }
    const nodeId = this.addNodeRecord(record, column, rowIndex);
    if (nodeId) {
      return nodeId;
    }
    for (const [key, child] of Object.entries(record)) {
      this.visit(child, key, rowIndex);
    }
    return null;
  }

  nodes() {
    return [...this.nodeMap.values()].slice(0, maxGraphNodes);
  }

  edges() {
    return [...this.edgeMap.values()].slice(0, maxGraphEdges);
  }

  private visitJsonString(value: string, column: string, rowIndex: number) {
    const text = value.trim();
    if (!looksJson(text)) {
      return null;
    }
    try {
      return this.visit(JSON.parse(text), column, rowIndex);
    } catch {
      return null;
    }
  }

  private addNodeRecord(
    record: Record<string, unknown>,
    column: string,
    rowIndex: number,
  ) {
    const labels =
      readStringArray(record.labels) ?? readStringArray(record.label);
    const properties = readProperties(record);
    const idValue =
      record.elementId ??
      record.element_id ??
      record.id ??
      record.identity ??
      record._id;
    const hasNodeShape = Boolean(labels?.length) || Boolean(record.properties);
    if (!hasNodeShape && idValue === undefined) {
      return null;
    }
    if (this.nodeMap.size >= maxGraphNodes) {
      return null;
    }
    const id = stableId(
      idValue ?? `${column}:${rowIndex}:${this.nodeMap.size}`,
    );
    const nextLabels = labels?.length ? labels : [column];
    const current = this.nodeMap.get(id);
    this.nodeMap.set(id, {
      id,
      label: nodeLabel(nextLabels, properties, id),
      labels: mergeUnique(current?.labels ?? [], nextLabels),
      properties: Object.assign({}, current?.properties, properties),
    });
    return id;
  }

  private addEdgeRecord(
    record: Record<string, unknown>,
    column: string,
    rowIndex: number,
  ) {
    const label = stringValue(
      record.type ?? record.relationshipType ?? record.label,
    );
    const sourceValue =
      record.startNodeElementId ??
      record.start_node_element_id ??
      record.startNodeId ??
      record.start ??
      record.source ??
      record.from;
    const targetValue =
      record.endNodeElementId ??
      record.end_node_element_id ??
      record.endNodeId ??
      record.end ??
      record.target ??
      record.to;
    if (!label || sourceValue === undefined || targetValue === undefined) {
      return null;
    }
    if (this.edgeMap.size >= maxGraphEdges) {
      return null;
    }
    const sourceId = this.endpointId(
      sourceValue,
      `${column}:source:${rowIndex}`,
    );
    const targetId = this.endpointId(
      targetValue,
      `${column}:target:${rowIndex}`,
    );
    const properties = readProperties(record);
    const id = stableId(
      record.elementId ??
        record.id ??
        `${sourceId}->${targetId}:${label}:${this.edgeMap.size}`,
    );
    this.edgeMap.set(id, {
      id,
      sourceId,
      targetId,
      label,
      properties,
    });
    return id;
  }

  private endpointId(value: unknown, fallback: string) {
    const record = asRecord(value);
    if (record) {
      const nodeId = this.addNodeRecord(record, fallback, 0);
      if (nodeId) {
        return nodeId;
      }
    }
    const id = stableId(value ?? fallback);
    if (!this.nodeMap.has(id) && this.nodeMap.size < maxGraphNodes) {
      this.nodeMap.set(id, {
        id,
        label: id,
        labels: ["node"],
        properties: {},
      });
    }
    return id;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looksJson(value: string) {
  return (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  );
}

function readStringArray(value: unknown): string[] | null {
  if (typeof value === "string") {
    return value ? [value] : null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length ? strings : null;
}

function readProperties(record: Record<string, unknown>) {
  const nested = asRecord(record.properties);
  const ignored = new Set([
    "id",
    "_id",
    "identity",
    "elementId",
    "element_id",
    "labels",
    "label",
    "type",
    "relationshipType",
    "start",
    "source",
    "from",
    "startNodeId",
    "startNodeElementId",
    "start_node_element_id",
    "end",
    "target",
    "to",
    "endNodeId",
    "endNodeElementId",
    "end_node_element_id",
    "properties",
  ]);
  const direct = Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !ignored.has(key) && isScalar(value),
    ),
  );
  return nested ? { ...direct, ...nested } : direct;
}

function isScalar(value: unknown) {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function stableId(value: unknown) {
  return String(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nodeLabel(
  labels: readonly string[],
  properties: Record<string, unknown>,
  id: string,
) {
  for (const key of ["name", "title", "label", "id"]) {
    const value = properties[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return labels[0] ?? id;
}

function mergeUnique(left: readonly string[], right: readonly string[]) {
  return [...new Set([...left, ...right])];
}
