import type { DbEngine, DbObjectMetadata } from "@/generated/irodori-api";

export function objectKindLabel(object: DbObjectMetadata) {
  switch (object.kind) {
    case "view":
      return "view";
    case "function":
      return "function";
    case "procedure":
      return "procedure";
    case "index":
      return "index";
    default:
      return "table";
  }
}

export function quoteSqlIdentifier(engine: DbEngine, name: string) {
  const quote =
    engine === "mysql" || engine === "mariadb" || engine === "tidb" ? "`" : '"';
  return `${quote}${name.split(quote).join(quote + quote)}${quote}`;
}

export function qualifiedObjectName(
  engine: DbEngine,
  object: DbObjectMetadata,
) {
  const parts = [object.schema, object.name].filter(Boolean);
  return parts.map((part) => quoteSqlIdentifier(engine, part)).join(".");
}

export function tablePreviewSql(engine: DbEngine, object: DbObjectMetadata) {
  const table = qualifiedObjectName(engine, object);
  if (engine === "sqlserver") {
    return `select top (200) * from ${table};`;
  }
  return `select * from ${table} limit 200;`;
}
