import type { DbObjectMetadata } from "./generated/irodori-api";

export type SchemaDesignerMode = "create" | "alter";

export type SchemaColumnDraft = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  existing?: boolean;
};

export type SchemaIndexDraft = {
  id: string;
  name: string;
  columns: string;
  unique: boolean;
  existing?: boolean;
};

export type SchemaForeignKeyDraft = {
  id: string;
  name: string;
  columns: string;
  referencesSchema: string;
  referencesTable: string;
  referencesColumns: string;
  onDelete: string;
  existing?: boolean;
};

export type SchemaDesignerDraft = {
  mode: SchemaDesignerMode;
  schema: string;
  table: string;
  columns: SchemaColumnDraft[];
  indexes: SchemaIndexDraft[];
  foreignKeys: SchemaForeignKeyDraft[];
};

export function schemaDraftId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankSchemaDraft(): SchemaDesignerDraft {
  return {
    mode: "create",
    schema: "",
    table: "new_table",
    columns: [
      {
        id: "column-id",
        name: "id",
        dataType: "INTEGER",
        nullable: false,
        primaryKey: true,
        defaultValue: "",
      },
      {
        id: "column-name",
        name: "name",
        dataType: "TEXT",
        nullable: true,
        primaryKey: false,
        defaultValue: "",
      },
    ],
    indexes: [],
    foreignKeys: [],
  };
}

export function schemaDraftFromObject(object: DbObjectMetadata): SchemaDesignerDraft {
  return {
    mode: "alter",
    schema: object.schema,
    table: object.name,
    columns: object.columns.map((column) => ({
      id: `existing-column-${column.name}`,
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: object.primaryKey.includes(column.name),
      defaultValue: column.defaultValue ?? "",
      existing: true,
    })),
    indexes: object.indexes.map((index) => ({
      id: `existing-index-${index.name}`,
      name: index.name,
      columns: index.columns.join(", "),
      unique: index.unique,
      existing: true,
    })),
    foreignKeys: object.foreignKeys.map((foreignKey, index) => ({
      id: `existing-fk-${index}`,
      name: defaultForeignKeyName(object.name, foreignKey.columns),
      columns: foreignKey.columns.join(", "),
      referencesSchema: foreignKey.referencesSchema ?? "",
      referencesTable: foreignKey.referencesTable,
      referencesColumns: foreignKey.referencesColumns.join(", "),
      onDelete: "",
      existing: true,
    })),
  };
}

export function buildSchemaSql(draft: SchemaDesignerDraft) {
  const table = qualifiedIdentifier(draft.schema, draft.table || "new_table");
  if (draft.mode === "alter") {
    return buildAlterSql(draft, table);
  }
  return buildCreateSql(draft, table);
}

export function splitIdentifierList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCreateSql(draft: SchemaDesignerDraft, table: string) {
  const columns = draft.columns
    .filter((column) => column.name.trim() !== "")
    .map((column) => `  ${columnDefinition(column)}`);
  const primaryKeyColumns = draft.columns
    .filter((column) => column.primaryKey && column.name.trim() !== "")
    .map((column) => column.name);
  if (primaryKeyColumns.length > 0) {
    columns.push(
      `  PRIMARY KEY (${primaryKeyColumns.map(quoteIdentifier).join(", ")})`,
    );
  }
  draft.foreignKeys
    .filter((foreignKey) => hasForeignKeyShape(foreignKey))
    .forEach((foreignKey) => {
      columns.push(`  ${foreignKeyConstraint(draft.table, foreignKey)}`);
    });

  const statements = [`CREATE TABLE ${table} (\n${columns.join(",\n")}\n);`];
  draft.indexes
    .filter((index) => hasIndexShape(index))
    .forEach((index) => statements.push(createIndexStatement(table, draft.table, index)));
  return `${statements.join("\n\n")}\n`;
}

function buildAlterSql(draft: SchemaDesignerDraft, table: string) {
  const statements: string[] = [];
  draft.columns
    .filter((column) => !column.existing && column.name.trim() !== "")
    .forEach((column) =>
      statements.push(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition(column)};`),
    );
  draft.indexes
    .filter((index) => !index.existing && hasIndexShape(index))
    .forEach((index) => statements.push(createIndexStatement(table, draft.table, index)));
  draft.foreignKeys
    .filter((foreignKey) => !foreignKey.existing && hasForeignKeyShape(foreignKey))
    .forEach((foreignKey) =>
      statements.push(
        `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdentifier(
          foreignKey.name || defaultForeignKeyName(draft.table, splitIdentifierList(foreignKey.columns)),
        )} ${foreignKeyReference(foreignKey)};`,
      ),
    );

  if (statements.length === 0) {
    return "-- Add a new column, index, or foreign key to generate ALTER SQL.\n";
  }
  return `${statements.join("\n\n")}\n`;
}

function columnDefinition(column: SchemaColumnDraft) {
  const pieces = [
    quoteIdentifier(column.name),
    column.dataType.trim() || "TEXT",
    column.nullable ? "" : "NOT NULL",
    column.defaultValue.trim() ? `DEFAULT ${column.defaultValue.trim()}` : "",
  ].filter(Boolean);
  return pieces.join(" ");
}

function hasIndexShape(index: SchemaIndexDraft) {
  return index.columns.trim() !== "";
}

function hasForeignKeyShape(foreignKey: SchemaForeignKeyDraft) {
  return (
    foreignKey.columns.trim() !== "" &&
    foreignKey.referencesTable.trim() !== "" &&
    foreignKey.referencesColumns.trim() !== ""
  );
}

function createIndexStatement(
  table: string,
  tableName: string,
  index: SchemaIndexDraft,
) {
  const columns = splitIdentifierList(index.columns).map(quoteIdentifier).join(", ");
  const indexName =
    index.name.trim() ||
    `${index.unique ? "uidx" : "idx"}_${sanitizeIdentifier(tableName)}_${splitIdentifierList(index.columns)
      .map(sanitizeIdentifier)
      .join("_")}`;
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(
    indexName,
  )} ON ${table} (${columns});`;
}

function foreignKeyConstraint(tableName: string, foreignKey: SchemaForeignKeyDraft) {
  const name =
    foreignKey.name.trim() ||
    defaultForeignKeyName(tableName, splitIdentifierList(foreignKey.columns));
  return `CONSTRAINT ${quoteIdentifier(name)} ${foreignKeyReference(foreignKey)}`;
}

function foreignKeyReference(foreignKey: SchemaForeignKeyDraft) {
  const columns = splitIdentifierList(foreignKey.columns).map(quoteIdentifier).join(", ");
  const referencesColumns = splitIdentifierList(foreignKey.referencesColumns)
    .map(quoteIdentifier)
    .join(", ");
  const references = qualifiedIdentifier(
    foreignKey.referencesSchema,
    foreignKey.referencesTable,
  );
  const onDelete = foreignKey.onDelete.trim()
    ? ` ON DELETE ${foreignKey.onDelete.trim()}`
    : "";
  return `FOREIGN KEY (${columns}) REFERENCES ${references} (${referencesColumns})${onDelete}`;
}

function defaultForeignKeyName(tableName: string, columns: string[]) {
  const suffix = columns.map(sanitizeIdentifier).join("_") || "ref";
  return `fk_${sanitizeIdentifier(tableName)}_${suffix}`;
}

function qualifiedIdentifier(schema: string, table: string) {
  return [schema, table].filter((part) => part.trim() !== "").map(quoteIdentifier).join(".");
}

function quoteIdentifier(name: string) {
  return `"${(name.trim() || "unnamed").replace(/"/g, '""')}"`;
}

function sanitizeIdentifier(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "unnamed";
}
