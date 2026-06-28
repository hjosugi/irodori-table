// ERD model, layout, and Mermaid source generation.
//
// The SVG renderer in App.tsx consumes the layout below so image export,
// multi-schema grouping, and zoom/search controls are deterministic and testable.
// Mermaid source is still generated for copy/paste interoperability.

import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";

export type ErdColumn = {
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
};

export type ErdTable = {
  id: string;
  schema: string;
  name: string;
  label: string;
  columns: ErdColumn[];
  hiddenColumnCount: number;
};

export type ErdEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  crossSchema: boolean;
};

export type ErdSchemaGroup = {
  name: string;
  tables: ErdTable[];
};

export type ErdModel = {
  schemas: ErdSchemaGroup[];
  tables: ErdTable[];
  edges: ErdEdge[];
  totalTables: number;
  filtered: boolean;
};

export type ErdBuildOptions = {
  schemaNames?: string[];
  search?: string;
  maxColumns?: number;
};

export type ErdLayoutSchema = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tableCount: number;
};

export type ErdLayoutTable = {
  table: ErdTable;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ErdLayoutEdge = ErdEdge & {
  path: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
};

export type ErdLayout = {
  width: number;
  height: number;
  schemas: ErdLayoutSchema[];
  tables: ErdLayoutTable[];
  edges: ErdLayoutEdge[];
};

const DEFAULT_MAX_COLUMNS = 12;
const TABLE_WIDTH = 252;
const TABLE_HEADER_HEIGHT = 30;
const TABLE_COLUMN_HEIGHT = 20;
const TABLE_FOOTER_HEIGHT = 22;
const TABLE_PADDING_BOTTOM = 8;
const SCHEMA_PADDING = 20;
const SCHEMA_HEADER_HEIGHT = 34;
const TABLE_GAP_X = 116;
const TABLE_GAP_Y = 36;
const SCHEMA_GAP_Y = 34;
const DIAGRAM_PADDING = 24;
const EDGE_LABEL_WIDTH = 84;
const EDGE_LABEL_HEIGHT = 17;
const EDGE_LABEL_GAP = 10;
const EDGE_LABEL_COLLISION_GAP = 4;

function tableId(schema: string, name: string) {
  return `${schema}.${name}`;
}

function safeId(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `t_${cleaned}`;
}

function safeType(type: string): string {
  const token = type.trim().split(/\s+/)[0] ?? "value";
  return token.replace(/[^A-Za-z0-9_]/g, "_") || "value";
}

function edgeKey(sourceId: string, targetId: string, label: string) {
  return `${sourceId}->${targetId}:${label}`;
}

function tableMatchesSearch(table: DbObjectMetadata, search: string) {
  if (!search) {
    return true;
  }
  const haystack = [
    table.schema,
    table.name,
    `${table.schema}.${table.name}`,
    ...table.columns.flatMap((column) => [column.name, column.dataType]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

function resolveForeignKeyTarget(
  source: DbObjectMetadata,
  referencesSchema: string | undefined,
  referencesTable: string,
  byQualified: Map<string, DbObjectMetadata>,
  byName: Map<string, DbObjectMetadata[]>,
) {
  if (referencesSchema) {
    return byQualified.get(tableId(referencesSchema, referencesTable));
  }
  const sameSchema = byQualified.get(tableId(source.schema, referencesTable));
  if (sameSchema) {
    return sameSchema;
  }
  const candidates = byName.get(referencesTable) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function buildErdModel(
  metadata: DatabaseMetadata,
  options: ErdBuildOptions = {},
): ErdModel {
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const search = (options.search ?? "").trim().toLowerCase();
  const schemaFilter =
    options.schemaNames === undefined
      ? undefined
      : new Set(options.schemaNames);
  const allTables = metadata.schemas
    .flatMap((schema) => schema.objects)
    .filter((object) => object.kind === "table");
  const byQualified = new Map(
    allTables.map((table) => [tableId(table.schema, table.name), table]),
  );
  const byName = new Map<string, DbObjectMetadata[]>();
  for (const table of allTables) {
    const list = byName.get(table.name) ?? [];
    list.push(table);
    byName.set(table.name, list);
  }

  const visibleSourceTables = allTables.filter(
    (table) =>
      (schemaFilter === undefined || schemaFilter.has(table.schema)) &&
      tableMatchesSearch(table, search),
  );
  const visibleIds = new Set(
    visibleSourceTables.map((table) => tableId(table.schema, table.name)),
  );
  const duplicateNames = new Set(
    [...byName.entries()]
      .filter(([, tables]) => tables.length > 1)
      .map(([name]) => name),
  );

  const tables: ErdTable[] = visibleSourceTables.map((table) => {
    const pk = new Set(table.primaryKey);
    const fkColumns = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
    const columns = table.columns.slice(0, maxColumns).map((column) => ({
      name: column.name,
      dataType: column.dataType,
      primaryKey: pk.has(column.name),
      foreignKey: fkColumns.has(column.name),
    }));
    return {
      id: tableId(table.schema, table.name),
      schema: table.schema,
      name: table.name,
      label: duplicateNames.has(table.name)
        ? `${table.schema}.${table.name}`
        : table.name,
      columns,
      hiddenColumnCount: Math.max(0, table.columns.length - columns.length),
    };
  });
  const tableMap = new Map(tables.map((table) => [table.id, table]));
  const edgeDedup = new Set<string>();
  const edges: ErdEdge[] = [];
  for (const source of visibleSourceTables) {
    const sourceId = tableId(source.schema, source.name);
    for (const fk of source.foreignKeys) {
      const target = resolveForeignKeyTarget(
        source,
        fk.referencesSchema,
        fk.referencesTable,
        byQualified,
        byName,
      );
      if (!target) {
        continue;
      }
      const targetId = tableId(target.schema, target.name);
      if (
        !visibleIds.has(targetId) ||
        !tableMap.has(sourceId) ||
        !tableMap.has(targetId)
      ) {
        continue;
      }
      const label = fk.columns.length > 0 ? fk.columns.join(", ") : "ref";
      const id = edgeKey(sourceId, targetId, label);
      if (edgeDedup.has(id)) {
        continue;
      }
      edgeDedup.add(id);
      edges.push({
        id,
        sourceId,
        targetId,
        label,
        crossSchema: source.schema !== target.schema,
      });
    }
  }

  const schemas: ErdSchemaGroup[] = metadata.schemas
    .map((schema) => ({
      name: schema.name,
      tables: tables.filter((table) => table.schema === schema.name),
    }))
    .filter((schema) => schema.tables.length > 0);

  return {
    schemas,
    tables,
    edges,
    totalTables: allTables.length,
    filtered: tables.length !== allTables.length,
  };
}

export function layoutErdModel(model: ErdModel): ErdLayout {
  const layoutSchemas: ErdLayoutSchema[] = [];
  const layoutTables: ErdLayoutTable[] = [];
  let y = DIAGRAM_PADDING;
  let width = 760;

  for (const schema of model.schemas) {
    const count = schema.tables.length;
    const columnCount = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(count))));
    const rowCount = Math.ceil(count / columnCount);
    const rowHeights = Array.from({ length: rowCount }, () => 0);
    const tableHeights = schema.tables.map((table, index) => {
      const height = tableHeight(table);
      const row = Math.floor(index / columnCount);
      rowHeights[row] = Math.max(rowHeights[row], height);
      return height;
    });
    const groupWidth =
      SCHEMA_PADDING * 2 +
      columnCount * TABLE_WIDTH +
      (columnCount - 1) * TABLE_GAP_X;
    const groupHeight =
      SCHEMA_HEADER_HEIGHT +
      SCHEMA_PADDING +
      rowHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, rowCount - 1) * TABLE_GAP_Y +
      SCHEMA_PADDING;
    const groupX = DIAGRAM_PADDING;
    layoutSchemas.push({
      name: schema.name,
      x: groupX,
      y,
      width: groupWidth,
      height: groupHeight,
      tableCount: count,
    });

    const rowY = Array.from({ length: rowCount }, (_, row) => {
      const priorHeight = rowHeights
        .slice(0, row)
        .reduce((sum, height) => sum + height, 0);
      return (
        y +
        SCHEMA_HEADER_HEIGHT +
        SCHEMA_PADDING +
        priorHeight +
        row * TABLE_GAP_Y
      );
    });
    schema.tables.forEach((table, index) => {
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      layoutTables.push({
        table,
        x: groupX + SCHEMA_PADDING + column * (TABLE_WIDTH + TABLE_GAP_X),
        y: rowY[row],
        width: TABLE_WIDTH,
        height: tableHeights[index],
      });
    });

    width = Math.max(width, groupX + groupWidth + DIAGRAM_PADDING);
    y += groupHeight + SCHEMA_GAP_Y;
  }

  const tableLayout = new Map(
    layoutTables.map((table) => [table.table.id, table]),
  );
  const edges = avoidEdgeLabelOverlaps(
    model.edges.flatMap((edge, index): ErdLayoutEdge[] => {
      const source = tableLayout.get(edge.sourceId);
      const target = tableLayout.get(edge.targetId);
      if (!source || !target) {
        return [];
      }
      return [layoutEdge(edge, source, target, index)];
    }),
  );
  for (const edge of edges) {
    width = Math.max(
      width,
      edge.labelX + edge.labelWidth / 2 + DIAGRAM_PADDING,
    );
    y = Math.max(y, edge.labelY + edge.labelHeight / 2 + DIAGRAM_PADDING);
  }

  return {
    width,
    height: Math.max(420, y + DIAGRAM_PADDING - SCHEMA_GAP_Y),
    schemas: layoutSchemas,
    tables: layoutTables,
    edges,
  };
}

function avoidEdgeLabelOverlaps(edges: ErdLayoutEdge[]): ErdLayoutEdge[] {
  const resolved = [...edges].sort(
    (a, b) =>
      a.labelY - b.labelY || a.labelX - b.labelX || a.id.localeCompare(b.id),
  );

  for (let pass = 0; pass < resolved.length * resolved.length; pass += 1) {
    let moved = false;
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        if (
          !labelRectsOverlap(resolved[i], resolved[j], EDGE_LABEL_COLLISION_GAP)
        ) {
          continue;
        }
        resolved[j] = {
          ...resolved[j],
          labelY: Math.max(
            resolved[j].labelY + 1,
            labelRectBottom(resolved[i]) + EDGE_LABEL_COLLISION_GAP + 12,
          ),
        };
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
    resolved.sort(
      (a, b) =>
        a.labelY - b.labelY || a.labelX - b.labelX || a.id.localeCompare(b.id),
    );
  }

  const byId = new Map(resolved.map((edge) => [edge.id, edge]));
  return edges.map((edge) => byId.get(edge.id) ?? edge);
}

function labelRectBottom(edge: Pick<ErdLayoutEdge, "labelY" | "labelHeight">) {
  return edge.labelY - 12 + edge.labelHeight;
}

function labelRectsOverlap(
  a: Pick<ErdLayoutEdge, "labelX" | "labelY" | "labelWidth" | "labelHeight">,
  b: Pick<ErdLayoutEdge, "labelX" | "labelY" | "labelWidth" | "labelHeight">,
  gap: number,
) {
  const ax = a.labelX - a.labelWidth / 2 - gap;
  const ay = a.labelY - 12 - gap;
  const bx = b.labelX - b.labelWidth / 2 - gap;
  const by = b.labelY - 12 - gap;
  return (
    ax < bx + b.labelWidth + gap * 2 &&
    ax + a.labelWidth + gap * 2 > bx &&
    ay < by + b.labelHeight + gap * 2 &&
    ay + a.labelHeight + gap * 2 > by
  );
}

function tableHeight(table: ErdTable) {
  return (
    TABLE_HEADER_HEIGHT +
    table.columns.length * TABLE_COLUMN_HEIGHT +
    (table.hiddenColumnCount > 0 ? TABLE_FOOTER_HEIGHT : TABLE_PADDING_BOTTOM)
  );
}

function layoutEdge(
  edge: ErdEdge,
  source: ErdLayoutTable,
  target: ErdLayoutTable,
  index: number,
): ErdLayoutEdge {
  if (source.table.id === target.table.id) {
    const x = source.x + source.width;
    const y = source.y + 46;
    return {
      ...edge,
      path: `M ${x} ${y} C ${x + 54} ${y - 34}, ${x + 54} ${y + 52}, ${x} ${y + 24}`,
      labelX: x + EDGE_LABEL_WIDTH / 2 + EDGE_LABEL_GAP,
      labelY: y + 18,
      labelWidth: EDGE_LABEL_WIDTH,
      labelHeight: EDGE_LABEL_HEIGHT,
    };
  }
  const sourceCenterX = source.x + source.width / 2;
  const targetCenterX = target.x + target.width / 2;
  const sameColumn = Math.abs(sourceCenterX - targetCenterX) < source.width / 2;
  const dir = sameColumn || targetCenterX >= sourceCenterX ? 1 : -1;
  const sx = dir > 0 ? source.x + source.width : source.x;
  const tx = sameColumn
    ? target.x + target.width
    : dir > 0
      ? target.x
      : target.x + target.width;
  const sy = source.y + Math.min(source.height - 16, 44 + (index % 4) * 20);
  const ty =
    target.y + Math.min(target.height - 16, 44 + ((index + 2) % 4) * 20);
  const curve = Math.max(70, Math.abs(tx - sx) * 0.42);
  return {
    ...edge,
    path: `M ${sx} ${sy} C ${sx + dir * curve} ${sy}, ${tx - dir * curve} ${ty}, ${tx} ${ty}`,
    labelX: sx + dir * (EDGE_LABEL_WIDTH / 2 + EDGE_LABEL_GAP),
    labelY: sy - 6,
    labelWidth: EDGE_LABEL_WIDTH,
    labelHeight: EDGE_LABEL_HEIGHT,
  };
}

export function toMermaidErd(metadata: DatabaseMetadata): string {
  const model = buildErdModel(metadata, {
    maxColumns: Number.MAX_SAFE_INTEGER,
  });
  const lines: string[] = ["erDiagram"];
  for (const table of model.tables) {
    const id = safeId(table.id);
    lines.push(`  ${id} {`);
    for (const column of table.columns) {
      const keys: string[] = [];
      if (column.primaryKey) keys.push("PK");
      if (column.foreignKey) keys.push("FK");
      const suffix = keys.length > 0 ? ` ${keys.join(",")}` : "";
      lines.push(
        `    ${safeType(column.dataType)} ${safeId(column.name)}${suffix}`,
      );
    }
    lines.push("  }");
  }
  for (const edge of model.edges) {
    lines.push(
      `  ${safeId(edge.sourceId)} }o--|| ${safeId(edge.targetId)} : "${edge.label}"`,
    );
  }
  return lines.join("\n");
}

/** True when the metadata has at least one base table to draw. */
export function hasDiagram(metadata: DatabaseMetadata | undefined): boolean {
  return (
    !!metadata &&
    metadata.schemas.some((schema) =>
      schema.objects.some((object) => object.kind === "table"),
    )
  );
}
