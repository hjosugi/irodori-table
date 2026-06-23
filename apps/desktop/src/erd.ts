// Generate Mermaid `erDiagram` source from database metadata.
//
// The generator is pure (metadata in, Mermaid text out) so the diagram is easy to
// preview, copy, or test. Identifiers/types are sanitized to Mermaid-safe tokens;
// only base tables are drawn, and only FK edges whose target table is present, so
// the graph stays clean (no dangling edges).

import type { DatabaseMetadata } from "./generated/irodori-api";

function safeId(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `t_${cleaned}`;
}

function safeType(type: string): string {
  const token = type.trim().split(/\s+/)[0] ?? "value";
  return token.replace(/[^A-Za-z0-9_]/g, "_") || "value";
}

export function toMermaidErd(metadata: DatabaseMetadata): string {
  const tables = metadata.schemas
    .flatMap((schema) => schema.objects)
    .filter((object) => object.kind === "table");
  const known = new Set(tables.map((table) => table.name));

  const lines: string[] = ["erDiagram"];
  for (const table of tables) {
    const pk = new Set(table.primaryKey);
    const fkColumns = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
    lines.push(`  ${safeId(table.name)} {`);
    for (const column of table.columns) {
      const keys: string[] = [];
      if (pk.has(column.name)) keys.push("PK");
      if (fkColumns.has(column.name)) keys.push("FK");
      const suffix = keys.length > 0 ? ` ${keys.join(",")}` : "";
      lines.push(`    ${safeType(column.dataType)} ${safeId(column.name)}${suffix}`);
    }
    lines.push("  }");
  }
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      if (!known.has(fk.referencesTable)) {
        continue;
      }
      const label = fk.columns.join(", ") || "ref";
      // many-to-one: the FK side (many) references the parent (exactly one).
      lines.push(
        `  ${safeId(table.name)} }o--|| ${safeId(fk.referencesTable)} : "${label}"`,
      );
    }
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
