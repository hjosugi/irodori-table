export type SqlSnippetScope = "statement" | "expression" | "clause";

export interface SqlSnippetDefinition {
  label: string;
  detail: string;
  template: string;
  scope: SqlSnippetScope;
  rank?: number;
}

const SNIPPET_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const DEFAULT_SNIPPET_RANK = 500;

export const defaultSqlSnippets: readonly SqlSnippetDefinition[] = [
  {
    label: "sel",
    detail: "select statement",
    template: "select ${1:*}\nfrom ${2:table}\nwhere ${3:condition};\n${0}",
    rank: 540,
    scope: "statement",
  },
  {
    label: "selw",
    detail: "select with where/order/limit",
    template:
      "select ${1:*}\nfrom ${2:table}\nwhere ${3:condition}\norder by ${4:column}\nlimit ${5:100};\n${0}",
    rank: 535,
    scope: "statement",
  },
  {
    label: "cte",
    detail: "with common table expression",
    template:
      "with ${1:cte_name} as (\n  select ${2:*}\n  from ${3:table}\n)\nselect ${4:*}\nfrom ${1:cte_name};\n${0}",
    rank: 530,
    scope: "statement",
  },
  {
    label: "ins",
    detail: "insert statement",
    template:
      "insert into ${1:table} (${2:columns})\nvalues (${3:values});\n${0}",
    rank: 525,
    scope: "statement",
  },
  {
    label: "upd",
    detail: "update statement",
    template:
      "update ${1:table}\nset ${2:column} = ${3:value}\nwhere ${4:condition};\n${0}",
    rank: 525,
    scope: "statement",
  },
  {
    label: "del",
    detail: "delete statement",
    template: "delete from ${1:table}\nwhere ${2:condition};\n${0}",
    rank: 525,
    scope: "statement",
  },
  {
    label: "join",
    detail: "join clause",
    template: "join ${1:table} on ${2:condition}${0}",
    rank: 520,
    scope: "clause",
  },
  {
    label: "case",
    detail: "case expression",
    template:
      "case\n  when ${1:condition} then ${2:value}\n  else ${3:fallback}\nend${0}",
    rank: 515,
    scope: "expression",
  },
  {
    label: "ct",
    detail: "create table",
    template:
      "create table ${1:table} (\n  ${2:id} ${3:integer} primary key,\n  ${4:created_at} ${5:timestamp}\n);\n${0}",
    rank: 510,
    scope: "statement",
  },
  {
    label: "idx",
    detail: "create index",
    template:
      "create index ${1:index_name}\non ${2:table} (${3:column});\n${0}",
    rank: 505,
    scope: "statement",
  },
  {
    label: "win",
    detail: "window expression",
    template:
      "${1:sum}(${2:amount}) over (partition by ${3:group_column} order by ${4:sort_column})${0}",
    rank: 500,
    scope: "expression",
  },
  {
    label: "tx",
    detail: "transaction block",
    template: "begin;\n${1:statement}\ncommit;\n${0}",
    rank: 495,
    scope: "statement",
  },
];

export function cloneDefaultSqlSnippets(): SqlSnippetDefinition[] {
  return defaultSqlSnippets.map((snippet) => ({ ...snippet }));
}

export function isSqlSnippetScope(value: unknown): value is SqlSnippetScope {
  return value === "statement" || value === "expression" || value === "clause";
}

export function sqlSnippetsFromJson(value: unknown): SqlSnippetDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("editor.snippets must be an array");
  }
  return value.map((entry, index) => sqlSnippetFromJson(entry, index));
}

function sqlSnippetFromJson(
  value: unknown,
  index: number,
): SqlSnippetDefinition {
  if (!isRecord(value)) {
    throw new Error(`editor.snippets[${index}] must be an object`);
  }
  const label = stringField(value, "label", index).trim();
  if (!SNIPPET_LABEL_PATTERN.test(label)) {
    throw new Error(
      `editor.snippets[${index}].label must start with a letter and contain only letters, numbers, "_" or "-"`,
    );
  }
  const detail = stringField(value, "detail", index).trim();
  const template = stringField(value, "template", index);
  const scope = value.scope;
  if (!isSqlSnippetScope(scope)) {
    throw new Error(
      `editor.snippets[${index}].scope must be "statement", "clause", or "expression"`,
    );
  }
  const rank = value.rank;
  if (
    rank !== undefined &&
    (typeof rank !== "number" || !Number.isFinite(rank))
  ) {
    throw new Error(`editor.snippets[${index}].rank must be a number`);
  }
  return {
    label,
    detail,
    template,
    scope,
    ...(typeof rank === "number" && Number.isFinite(rank) ? { rank } : {}),
  };
}

function stringField(
  value: Record<string, unknown>,
  field: "label" | "detail" | "template",
  index: number,
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`editor.snippets[${index}].${field} must be a string`);
  }
  return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
