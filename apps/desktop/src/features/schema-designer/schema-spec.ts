import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import {
  buildSchemaSql,
  type SchemaDesignerDraft,
  type SchemaForeignKeyDraft,
  type SchemaIndexDraft,
} from "./schema-designer";

export const tableSpecFormat = "irodori.table-spec.v1";

export type TableSpecColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  comment?: string;
};

export type TableSpecIndex = {
  name: string;
  columns: string[];
  unique: boolean;
};

export type TableSpecForeignKey = {
  name?: string;
  columns: string[];
  referencesSchema?: string;
  referencesTable: string;
  referencesColumns: string[];
};

export type TableSpecTable = {
  name: string;
  comment?: string;
  columns: TableSpecColumn[];
  primaryKey: string[];
  indexes: TableSpecIndex[];
  foreignKeys: TableSpecForeignKey[];
};

export type TableSpecSchema = {
  name: string;
  tables: TableSpecTable[];
};

export type TableSpecDocument = {
  format: typeof tableSpecFormat;
  exportedAt: string;
  source?: {
    connectionId?: string;
    connectionName?: string;
    filtered?: boolean;
  };
  schemas: TableSpecSchema[];
};

export type TableSpecBuildOptions = {
  connectionId?: string;
  connectionName?: string;
  schemaNames?: string[];
  search?: string;
  now?: Date;
};

export type TableSpecExport = {
  content: string;
  mime: string;
  extension: string;
};

export function buildTableSpecDocument(
  metadata: DatabaseMetadata,
  options: TableSpecBuildOptions = {},
): TableSpecDocument {
  const search = (options.search ?? "").trim().toLowerCase();
  const schemaFilter =
    options.schemaNames === undefined
      ? undefined
      : new Set(options.schemaNames);
  const visibleTables = visibleMetadataTables(metadata, schemaFilter, search);
  const visibleIds = new Set(
    visibleTables.map((table) => tableId(table.schema, table.name)),
  );

  return {
    format: tableSpecFormat,
    exportedAt: (options.now ?? new Date()).toISOString(),
    source: {
      connectionId: options.connectionId,
      connectionName: options.connectionName,
      filtered:
        visibleTables.length !==
        metadata.schemas.flatMap((schema) => schema.objects).filter(isTable)
          .length,
    },
    schemas: metadata.schemas
      .map((schema) => ({
        name: schema.name,
        tables: visibleTables
          .filter((table) => table.schema === schema.name)
          .map((table) => tableSpecTable(table, visibleIds)),
      }))
      .filter((schema) => schema.tables.length > 0),
  };
}

export function tableSpecFileName(
  connectionId: string,
  extension: string,
  now = new Date(),
) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `irodori-table-spec-${sanitizeFileNamePart(connectionId)}-${timestamp}.${extension}`;
}

export function exportTableSpecJson(
  document: TableSpecDocument,
): TableSpecExport {
  return {
    content: `${JSON.stringify(document, null, 2)}\n`,
    mime: "application/json;charset=utf-8",
    extension: "irodori-schema.json",
  };
}

export function exportTableSpecMarkdown(
  document: TableSpecDocument,
): TableSpecExport {
  return {
    content: tableSpecMarkdown(document),
    mime: "text/markdown;charset=utf-8",
    extension: "md",
  };
}

export function parseTableSpecDocument(text: string): TableSpecDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed.format !== tableSpecFormat) {
    throw new Error(
      `Unsupported table specification format. Expected ${tableSpecFormat}.`,
    );
  }
  if (!Array.isArray(parsed.schemas)) {
    throw new Error("Table specification is missing schemas.");
  }
  return {
    format: tableSpecFormat,
    exportedAt: stringValue(parsed.exportedAt) || new Date(0).toISOString(),
    source: isRecord(parsed.source)
      ? {
          connectionId: optionalString(parsed.source.connectionId),
          connectionName: optionalString(parsed.source.connectionName),
          filtered:
            typeof parsed.source.filtered === "boolean"
              ? parsed.source.filtered
              : undefined,
        }
      : undefined,
    schemas: parsed.schemas.map(parseSpecSchema),
  };
}

export function ddlFromTableSpecDocument(document: TableSpecDocument): string {
  const statements = document.schemas.flatMap((schema) =>
    schema.tables.map((table) =>
      buildSchemaSql(draftFromSpecTable(schema.name, table)).trim(),
    ),
  );
  return `${statements.filter(Boolean).join("\n\n")}\n`;
}

function visibleMetadataTables(
  metadata: DatabaseMetadata,
  schemaFilter: Set<string> | undefined,
  search: string,
) {
  return metadata.schemas
    .flatMap((schema) => schema.objects)
    .filter(isTable)
    .filter(
      (table) =>
        (schemaFilter === undefined || schemaFilter.has(table.schema)) &&
        tableMatchesSearch(table, search),
    );
}

function isTable(object: DbObjectMetadata) {
  return object.kind === "table";
}

function tableMatchesSearch(table: DbObjectMetadata, search: string) {
  if (!search) {
    return true;
  }
  return [
    table.schema,
    table.name,
    `${table.schema}.${table.name}`,
    table.comment ?? "",
    ...table.columns.flatMap((column) => [
      column.name,
      column.dataType,
      column.comment ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function tableSpecTable(
  table: DbObjectMetadata,
  visibleIds: Set<string>,
): TableSpecTable {
  return {
    name: table.name,
    comment: table.comment,
    columns: table.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      defaultValue: column.defaultValue,
      comment: column.comment,
    })),
    primaryKey: table.primaryKey,
    indexes: table.indexes
      .filter((index) => !sameIdentifierList(index.columns, table.primaryKey))
      .map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
      })),
    foreignKeys: table.foreignKeys
      .filter((foreignKey) =>
        visibleIds.has(
          tableId(
            foreignKey.referencesSchema ?? table.schema,
            foreignKey.referencesTable,
          ),
        ),
      )
      .map((foreignKey, index) => ({
        name: defaultForeignKeyName(table.name, foreignKey.columns, index),
        columns: foreignKey.columns,
        referencesSchema: foreignKey.referencesSchema ?? table.schema,
        referencesTable: foreignKey.referencesTable,
        referencesColumns: foreignKey.referencesColumns,
      })),
  };
}

function tableSpecMarkdown(document: TableSpecDocument) {
  const tableCount = document.schemas.reduce(
    (sum, schema) => sum + schema.tables.length,
    0,
  );
  const lines = [
    "# Table Definition Specification",
    "",
    `- Format: \`${document.format}\``,
    `- Exported at: ${document.exportedAt}`,
    `- Schemas: ${document.schemas.length}`,
    `- Tables: ${tableCount}`,
  ];
  if (document.source?.connectionName || document.source?.connectionId) {
    lines.push(
      `- Source: ${document.source.connectionName ?? document.source.connectionId}`,
    );
  }
  lines.push(
    "",
    "## Entity List",
    "",
    "| Schema | Table | Columns | PK | FKs |",
    "| --- | --- | ---: | --- | ---: |",
  );
  for (const schema of document.schemas) {
    for (const table of schema.tables) {
      lines.push(
        `| ${escapeMarkdown(schema.name)} | ${escapeMarkdown(table.name)} | ${table.columns.length} | ${escapeMarkdown(table.primaryKey.join(", "))} | ${table.foreignKeys.length} |`,
      );
    }
  }
  lines.push("", "## Entity Details");
  for (const schema of document.schemas) {
    for (const table of schema.tables) {
      lines.push(
        "",
        `### ${escapeMarkdown(schema.name)}.${escapeMarkdown(table.name)}`,
        "",
      );
      if (table.comment) {
        lines.push(escapeMarkdown(table.comment), "");
      }
      lines.push(
        "| Column | Type | Nullable | Default | Key | Comment |",
        "| --- | --- | --- | --- | --- | --- |",
      );
      for (const column of table.columns) {
        const key = [
          table.primaryKey.includes(column.name) ? "PK" : "",
          table.foreignKeys.some((foreignKey) =>
            foreignKey.columns.includes(column.name),
          )
            ? "FK"
            : "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `| ${escapeMarkdown(column.name)} | ${escapeMarkdown(column.dataType)} | ${column.nullable ? "YES" : "NO"} | ${escapeMarkdown(column.defaultValue ?? "")} | ${key} | ${escapeMarkdown(column.comment ?? "")} |`,
        );
      }
      if (table.foreignKeys.length > 0) {
        lines.push("", "Foreign keys:");
        for (const foreignKey of table.foreignKeys) {
          const target = qualifiedName(
            foreignKey.referencesSchema,
            foreignKey.referencesTable,
          );
          lines.push(
            `- ${escapeMarkdown(foreignKey.columns.join(", "))} -> ${escapeMarkdown(target)} (${escapeMarkdown(foreignKey.referencesColumns.join(", "))})`,
          );
        }
      }
      if (table.indexes.length > 0) {
        lines.push("", "Indexes:");
        for (const index of table.indexes) {
          lines.push(
            `- ${escapeMarkdown(index.name)}${index.unique ? " unique" : ""}: ${escapeMarkdown(index.columns.join(", "))}`,
          );
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function draftFromSpecTable(
  schemaName: string,
  table: TableSpecTable,
): SchemaDesignerDraft {
  return {
    mode: "create",
    schema: schemaName,
    table: table.name,
    columns: table.columns.map((column, index) => ({
      id: `spec-column-${index}`,
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: table.primaryKey.includes(column.name),
      defaultValue: column.defaultValue ?? "",
    })),
    indexes: table.indexes.map<SchemaIndexDraft>((index, itemIndex) => ({
      id: `spec-index-${itemIndex}`,
      name: index.name,
      columns: index.columns.join(", "),
      unique: index.unique,
    })),
    foreignKeys: table.foreignKeys.map<SchemaForeignKeyDraft>(
      (foreignKey, index) => ({
        id: `spec-fk-${index}`,
        name:
          foreignKey.name ??
          defaultForeignKeyName(table.name, foreignKey.columns, index),
        columns: foreignKey.columns.join(", "),
        referencesSchema: foreignKey.referencesSchema ?? "",
        referencesTable: foreignKey.referencesTable,
        referencesColumns: foreignKey.referencesColumns.join(", "),
        onDelete: "",
      }),
    ),
  };
}

function parseSpecSchema(value: unknown): TableSpecSchema {
  if (!isRecord(value)) {
    throw new Error("Invalid schema entry in table specification.");
  }
  const name = stringValue(value.name);
  if (!name) {
    throw new Error("Schema entry is missing a name.");
  }
  if (!Array.isArray(value.tables)) {
    throw new Error(`Schema '${name}' is missing tables.`);
  }
  return {
    name,
    tables: value.tables.map(parseSpecTable),
  };
}

function parseSpecTable(value: unknown): TableSpecTable {
  if (!isRecord(value)) {
    throw new Error("Invalid table entry in table specification.");
  }
  const name = stringValue(value.name);
  if (!name) {
    throw new Error("Table entry is missing a name.");
  }
  if (!Array.isArray(value.columns)) {
    throw new Error(`Table '${name}' is missing columns.`);
  }
  return {
    name,
    comment: optionalString(value.comment),
    columns: value.columns.map(parseSpecColumn),
    primaryKey: stringArray(value.primaryKey),
    indexes: Array.isArray(value.indexes)
      ? value.indexes.map(parseSpecIndex)
      : [],
    foreignKeys: Array.isArray(value.foreignKeys)
      ? value.foreignKeys.map(parseSpecForeignKey)
      : [],
  };
}

function parseSpecColumn(value: unknown): TableSpecColumn {
  if (!isRecord(value)) {
    throw new Error("Invalid column entry in table specification.");
  }
  const name = stringValue(value.name);
  const dataType = stringValue(value.dataType);
  if (!name || !dataType) {
    throw new Error("Column entry is missing name or dataType.");
  }
  return {
    name,
    dataType,
    nullable: value.nullable !== false,
    defaultValue: optionalString(value.defaultValue),
    comment: optionalString(value.comment),
  };
}

function parseSpecIndex(value: unknown): TableSpecIndex {
  if (!isRecord(value)) {
    throw new Error("Invalid index entry in table specification.");
  }
  return {
    name: stringValue(value.name) || "idx",
    columns: stringArray(value.columns),
    unique: value.unique === true,
  };
}

function parseSpecForeignKey(value: unknown): TableSpecForeignKey {
  if (!isRecord(value)) {
    throw new Error("Invalid foreign key entry in table specification.");
  }
  const referencesTable = stringValue(value.referencesTable);
  if (!referencesTable) {
    throw new Error("Foreign key entry is missing referencesTable.");
  }
  return {
    name: optionalString(value.name),
    columns: stringArray(value.columns),
    referencesSchema: optionalString(value.referencesSchema),
    referencesTable,
    referencesColumns: stringArray(value.referencesColumns),
  };
}

function tableId(schema: string, table: string) {
  return `${schema}.${table}`;
}

function qualifiedName(schema: string | undefined, table: string) {
  return schema ? `${schema}.${table}` : table;
}

function sameIdentifierList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every(
      (item, index) => item.toLowerCase() === right[index]?.toLowerCase(),
    )
  );
}

function defaultForeignKeyName(
  table: string,
  columns: readonly string[],
  index: number,
) {
  const suffix = columns.length > 0 ? columns.join("_") : `ref_${index + 1}`;
  return `fk_${table}_${suffix}`;
}

function escapeMarkdown(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function sanitizeFileNamePart(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || "connection";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  const text = stringValue(value);
  return text || undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}
