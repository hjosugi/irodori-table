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
  const createTableStatement = createTableStatementFor(table, createTableItems(draft));
  const statements = [
    createTableStatement,
    ...draft.indexes.filter(hasIndexShape).map((index) =>
      createIndexStatement(table, draft.table, index),
    ),
  ];
  return joinSqlStatements(statements);
}

function buildAlterSql(draft: SchemaDesignerDraft, table: string) {
  const statements = alterStatements(draft, table);

  if (statements.length === 0) {
    return "-- Add a new column, index, or foreign key to generate ALTER SQL.\n";
  }
  return joinSqlStatements(statements);
}

function createTableItems(draft: SchemaDesignerDraft): string[] {
  return [
    ...draft.columns.filter(hasColumnName).map(columnDefinition),
    ...tableConstraints(draft),
  ].map(indentSqlItem);
}

function tableConstraints(draft: SchemaDesignerDraft): string[] {
  return [
    primaryKeyConstraint(draft.columns),
    ...draft.foreignKeys
      .filter(hasForeignKeyShape)
      .map((foreignKey) => foreignKeyConstraint(draft.table, foreignKey)),
  ].filter(isPresent);
}

function createTableStatementFor(table: string, items: readonly string[]): string {
  return `CREATE TABLE ${table} (\n${items.join(",\n")}\n);`;
}

function alterStatements(draft: SchemaDesignerDraft, table: string): string[] {
  return [
    ...draft.columns.filter(isNewColumnWithName).map((column) =>
      addColumnStatement(table, column),
    ),
    ...draft.indexes.filter(isNewIndexWithShape).map((index) =>
      createIndexStatement(table, draft.table, index),
    ),
    ...draft.foreignKeys.filter(isNewForeignKeyWithShape).map((foreignKey) =>
      addForeignKeyStatement(table, draft.table, foreignKey),
    ),
  ];
}

function joinSqlStatements(statements: readonly string[]): string {
  return `${statements.join("\n\n")}\n`;
}

function indentSqlItem(value: string): string {
  return `  ${value}`;
}

function hasColumnName(column: SchemaColumnDraft) {
  return column.name.trim() !== "";
}

function isNewColumnWithName(column: SchemaColumnDraft): boolean {
  return !column.existing && hasColumnName(column);
}

function isNewIndexWithShape(index: SchemaIndexDraft): boolean {
  return !index.existing && hasIndexShape(index);
}

function isNewForeignKeyWithShape(foreignKey: SchemaForeignKeyDraft): boolean {
  return !foreignKey.existing && hasForeignKeyShape(foreignKey);
}

function addColumnStatement(table: string, column: SchemaColumnDraft) {
  return `ALTER TABLE ${table} ADD COLUMN ${columnDefinition(column)};`;
}

function addForeignKeyStatement(
  table: string,
  tableName: string,
  foreignKey: SchemaForeignKeyDraft,
) {
  return `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdentifier(
    foreignKey.name || defaultForeignKeyName(tableName, splitIdentifierList(foreignKey.columns)),
  )} ${foreignKeyReference(foreignKey)};`;
}

function primaryKeyConstraint(columns: readonly SchemaColumnDraft[]): string | null {
  const primaryKeyColumns = columns
    .filter((column) => column.primaryKey && hasColumnName(column))
    .map((column) => column.name);
  return primaryKeyColumns.length > 0
    ? `PRIMARY KEY (${quoteIdentifierList(primaryKeyColumns)})`
    : null;
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
  const columns = splitIdentifierList(index.columns);
  const indexName = index.name.trim() || defaultIndexName(tableName, columns, index.unique);
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(
    indexName,
  )} ON ${table} (${quoteIdentifierList(columns)});`;
}

function foreignKeyConstraint(tableName: string, foreignKey: SchemaForeignKeyDraft) {
  const name =
    foreignKey.name.trim() ||
    defaultForeignKeyName(tableName, splitIdentifierList(foreignKey.columns));
  return `CONSTRAINT ${quoteIdentifier(name)} ${foreignKeyReference(foreignKey)}`;
}

function foreignKeyReference(foreignKey: SchemaForeignKeyDraft) {
  const columns = quoteIdentifierList(splitIdentifierList(foreignKey.columns));
  const referencesColumns = quoteIdentifierList(
    splitIdentifierList(foreignKey.referencesColumns),
  );
  const references = qualifiedIdentifier(
    foreignKey.referencesSchema,
    foreignKey.referencesTable,
  );
  const onDelete = foreignKey.onDelete.trim()
    ? ` ON DELETE ${foreignKey.onDelete.trim()}`
    : "";
  return `FOREIGN KEY (${columns}) REFERENCES ${references} (${referencesColumns})${onDelete}`;
}

function defaultIndexName(
  tableName: string,
  columns: readonly string[],
  unique: boolean,
): string {
  const prefix = unique ? "uidx" : "idx";
  const suffix = columns.map(sanitizeIdentifier).join("_");
  return `${prefix}_${sanitizeIdentifier(tableName)}_${suffix}`;
}

function defaultForeignKeyName(tableName: string, columns: readonly string[]) {
  const suffix = columns.map(sanitizeIdentifier).join("_") || "ref";
  return `fk_${sanitizeIdentifier(tableName)}_${suffix}`;
}

function qualifiedIdentifier(schema: string, table: string) {
  return [schema, table].filter((part) => part.trim() !== "").map(quoteIdentifier).join(".");
}

function quoteIdentifierList(names: readonly string[]): string {
  return names.map(quoteIdentifier).join(", ");
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

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
