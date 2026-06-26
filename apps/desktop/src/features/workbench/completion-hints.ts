import type { DatabaseMetadata } from "@/generated/irodori-api";
import type { CompletionHint } from "./types";
import { objectKindLabel } from "./object-sql";

export function completionHintsFromMetadata(
  metadata: DatabaseMetadata | undefined,
): CompletionHint[] {
  if (!metadata) {
    return [];
  }
  const relationHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind !== "index")
      .map((object) => {
        const qualifiedName = schema.name
          ? `${schema.name}.${object.name}`
          : object.name;
        return {
          label: object.name,
          detail: `${schema.name || "default"} ${objectKindLabel(object)}`,
          insertText:
            object.kind === "function" || object.kind === "procedure"
              ? `${qualifiedName}()`
              : qualifiedName,
        };
      }),
  );
  const columnHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind === "table" || object.kind === "view")
      .flatMap((object) =>
        object.columns.slice(0, 4).map((column) => ({
          label: `${object.name}.${column.name}`,
          detail: `${column.dataType}${column.nullable ? "" : " not null"}`,
          insertText: `${object.name}.${column.name}`,
        })),
      ),
  );
  return [...relationHints, ...columnHints].slice(0, 8);
}
