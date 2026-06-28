import { describe, expect, it } from "vitest";
import type { Completion } from "@codemirror/autocomplete";
import {
  buildSqlCompletionIndex,
  completeSqlLightweight,
  defaultSqlSnippets,
  expandSqlSnippetVariables,
  mergeDefaultSqlSnippets,
  mergeImportedSqlSnippets,
  snippetsForEngine,
  sqlSnippetsFromJson,
  sqlSnippetsFromText,
  type SqlSnippetDefinition,
} from "@/sql/completion";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  ForeignKey,
} from "@/generated/irodori-api";

function table(
  schema: string,
  name: string,
  columns: string[],
  options: {
    primaryKey?: string[];
    foreignKeys?: ForeignKey[];
  } = {},
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column.endsWith("_id") || column === "id" ? "int4" : "text",
      nullable: !options.primaryKey?.includes(column),
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: options.primaryKey ?? [],
    foreignKeys: options.foreignKeys ?? [],
  };
}

const metadata: DatabaseMetadata = {
  schemas: [
    {
      name: "public",
      objects: [
        table("public", "customers", ["id", "name", "email"], {
          primaryKey: ["id"],
        }),
        table("public", "orders", ["id", "customer_id", "total"], {
          primaryKey: ["id"],
          foreignKeys: [
            {
              columns: ["customer_id"],
              referencesTable: "customers",
              referencesColumns: ["id"],
            },
          ],
        }),
        {
          ...table("public", "normalize_email", ["email"]),
          kind: "function",
        },
      ],
    },
    {
      name: "sales",
      objects: [table("sales", "invoices", ["id", "customer_id", "status"])],
    },
  ],
};

function withCursor(sql: string): { doc: string; pos: number } {
  const pos = sql.indexOf("|");
  return pos >= 0 ? { doc: sql.replace("|", ""), pos } : { doc: sql, pos: sql.length };
}

function complete(sql: string, explicit = false): readonly Completion[] {
  return completeWithMetadata(sql, metadata, explicit);
}

function completeWithMetadata(
  sql: string,
  completionMetadata: DatabaseMetadata,
  explicit = false,
): readonly Completion[] {
  return completeWithEngine(sql, completionMetadata, "postgres", explicit);
}

function completeWithEngine(
  sql: string,
  completionMetadata: DatabaseMetadata,
  engine: DbEngine,
  explicit = false,
  snippets?: readonly SqlSnippetDefinition[],
): readonly Completion[] {
  const cursor = withCursor(sql);
  return (
    completeSqlLightweight({
      doc: cursor.doc,
      engine,
      explicit,
      index: buildSqlCompletionIndex(completionMetadata),
      pos: cursor.pos,
      snippets,
    })?.options ?? []
  );
}

function completeWithSnippets(
  sql: string,
  snippets: readonly SqlSnippetDefinition[],
): readonly Completion[] {
  return completeWithEngine(sql, metadata, "postgres", false, snippets);
}

function defaultSnippetForEngine(engine: DbEngine, label: string) {
  return snippetsForEngine(defaultSqlSnippets, engine).find(
    (snippet) => snippet.label === label,
  );
}

function snippetTestKey(snippet: SqlSnippetDefinition) {
  return `${snippet.label}:${snippet.engines?.join(",") ?? "*"}`;
}

function labels(sql: string, explicit = false): string[] {
  return complete(sql, explicit).map((option) => option.label);
}

function applies(sql: string, explicit = false): string[] {
  return complete(sql, explicit).map((option) => String(option.apply ?? option.label));
}

function appliesWithMetadata(sql: string, completionMetadata: DatabaseMetadata): string[] {
  return completeWithMetadata(sql, completionMetadata).map((option) =>
    String(option.apply ?? option.label),
  );
}

type EngineCompletionFixture = {
  name: string;
  engine: Extract<DbEngine, "postgres" | "sqlite" | "mysql">;
  metadata: DatabaseMetadata;
  tableSql: string;
  tableApply: string;
  tableLabel: string;
  qualifiedSql: string;
  qualifiedApply: string;
  qualifiedLabel: string;
  aliasSql: string;
  aliasColumns: string[];
  keywordSql: string;
  keywordLabel: string;
};

const engineCompletionFixtures: EngineCompletionFixture[] = [
  {
    name: "PostgreSQL",
    engine: "postgres",
    metadata: {
      schemas: [
        {
          name: "public",
          objects: [table("public", "customers", ["id", "name", "email"])],
        },
        {
          name: "sales",
          objects: [
            table("sales", "invoices", ["id", "customer_id", "status"]),
          ],
        },
      ],
    },
    tableSql: "select * from cust",
    tableApply: "customers",
    tableLabel: "customers",
    qualifiedSql: "select * from sales.",
    qualifiedApply: "invoices",
    qualifiedLabel: "invoices",
    aliasSql: "select c.| from customers c",
    aliasColumns: ["id", "name", "email"],
    keywordSql: "ili",
    keywordLabel: "ilike",
  },
  {
    name: "SQLite",
    engine: "sqlite",
    metadata: {
      schemas: [
        {
          name: "main",
          objects: [table("main", "accounts", ["id", "display_name", "email"])],
        },
        {
          name: "analytics",
          objects: [
            table("analytics", "events", ["id", "account_id", "event_name"]),
          ],
        },
      ],
    },
    tableSql: "select * from acc",
    tableApply: "accounts",
    tableLabel: "accounts",
    qualifiedSql: "select * from analytics.",
    qualifiedApply: "events",
    qualifiedLabel: "events",
    aliasSql: "select a.| from accounts a",
    aliasColumns: ["id", "display_name", "email"],
    keywordSql: "pra",
    keywordLabel: "pragma",
  },
  {
    name: "MySQL",
    engine: "mysql",
    metadata: {
      schemas: [
        {
          name: "app",
          objects: [table("app", "customers", ["id", "full_name", "email"])],
        },
        {
          name: "audit",
          objects: [
            table("audit", "events", ["id", "customer_id", "event_type"]),
          ],
        },
      ],
    },
    tableSql: "select * from cust",
    tableApply: "customers",
    tableLabel: "customers",
    qualifiedSql: "select * from audit.",
    qualifiedApply: "events",
    qualifiedLabel: "events",
    aliasSql: "select c.| from customers c",
    aliasColumns: ["id", "full_name", "email"],
    keywordSql: "stra",
    keywordLabel: "straight_join",
  },
];

function labelsForEngine(sql: string, fixture: EngineCompletionFixture): string[] {
  return completeWithEngine(sql, fixture.metadata, fixture.engine).map(
    (option) => option.label,
  );
}

function appliesForEngine(sql: string, fixture: EngineCompletionFixture): string[] {
  return completeWithEngine(sql, fixture.metadata, fixture.engine).map((option) =>
    String(option.apply ?? option.label),
  );
}

describe("completeSqlLightweight", () => {
  it("does not auto-open broad empty completions", () => {
    expect(labels("select ")).toEqual([]);
    expect(labels("select ", true)).toContain("customers");
  });

  it("suggests schema members after schema dot", () => {
    expect(labels("select * from sales.")).toEqual(["invoices"]);
    expect(applies("select * from sales.")).toEqual(["invoices"]);
  });

  it("keeps explicit empty relation completions deterministic", () => {
    expect(labels("select * from |", true)).toEqual([
      "customers",
      "invoices",
      "orders",
      "public",
      "sales",
    ]);
    expect(applies("select * from |", true)).toEqual([
      "customers",
      "sales.invoices",
      "orders",
      "public.",
      "sales.",
    ]);
  });

  it("sorts equally ranked relation candidates by label", () => {
    const unorderedMetadata: DatabaseMetadata = {
      schemas: [
        {
          name: "public",
          objects: [
            table("public", "orders", ["id"]),
            table("public", "customers", ["id"]),
          ],
        },
      ],
    };

    expect(appliesWithMetadata("select * from |", unorderedMetadata)).toEqual([
      "customers",
      "orders",
      "public.",
    ]);
  });

  it("qualifies duplicate relation insert text deterministically", () => {
    const duplicateMetadata: DatabaseMetadata = {
      schemas: [
        { name: "public", objects: [table("public", "customers", ["id"])] },
        { name: "sales", objects: [table("sales", "customers", ["id"])] },
      ],
    };

    expect(appliesWithMetadata("select * from cust", duplicateMetadata)).toEqual([
      "public.customers",
      "sales.customers",
    ]);
  });

  it("suggests columns after aliases without keywords or tables", () => {
    expect(labels("select c.| from customers c")).toEqual(["id", "name", "email"]);
  });

  it("qualifies unqualified columns when aliases are present", () => {
    expect(labels("select id from customers c join orders o on o.|")).toEqual([
      "id",
      "customer_id",
      "total",
    ]);
    expect(labels("select * from customers c join orders o where id")).toEqual([
      "c.id",
      "o.id",
    ]);
  });

  it("adds foreign-key join snippets in JOIN relation context", () => {
    const options = complete("select * from customers c join ord");
    const join = options.find(
      (option) => option.label === "orders" && String(option.apply).includes(" on "),
    );
    expect(join?.apply).toBe("orders o on o.customer_id = c.id");
  });

  it("adds Emmet-style SQL snippet completions", () => {
    const options = complete("sel");
    const snippet = options.find((option) => option.label === "sel");

    expect(options.slice(0, 2).map((option) => option.label)).toEqual([
      "sel",
      "selw",
    ]);
    expect(snippet?.detail).toBe("select statement");
    expect(typeof snippet?.apply).toBe("function");
  });

  it("adds operational SQL snippets for safe DML workflows", () => {
    const deleteOperation = complete("delop").find(
      (option) => option.label === "delop",
    );
    const updateOperation = complete("updop").find(
      (option) => option.label === "updop",
    );
    const transaction = complete("begin").find(
      (option) => option.label === "begin",
    );

    expect(deleteOperation?.detail).toBe("delete operation: select/delete/select");
    expect(updateOperation?.detail).toBe("update operation: preview/update/verify");
    expect(typeof transaction?.apply).toBe("function");
    expect(defaultSqlSnippets.find((snippet) => snippet.label === "delop")?.template).toContain(
      "rollback",
    );
    expect(defaultSqlSnippets.find((snippet) => snippet.label === "begin")?.template).toContain(
      "-- commit;",
    );
  });

  it("keeps new default snippets when merging stored custom snippets", () => {
    const merged = mergeDefaultSqlSnippets([
      {
        label: "sel",
        detail: "custom select override",
        template: "select 1;${0}",
        scope: "statement",
        rank: 999,
      },
      {
        label: "mine",
        detail: "custom snippet",
        template: "select ${1:value};${0}",
        scope: "statement",
      },
    ]);

    expect(merged.find((snippet) => snippet.label === "sel")?.detail).toBe(
      "custom select override",
    );
    expect(merged.some((snippet) => snippet.label === "delop")).toBe(true);
    expect(merged.some((snippet) => snippet.label === "updop")).toBe(true);
    expect(merged.some((snippet) => snippet.label === "mine")).toBe(true);
    expect(new Set(merged.map(snippetTestKey)).size).toBe(
      merged.length,
    );
    expect(defaultSqlSnippets.some((snippet) => snippet.label === "checksum")).toBe(
      true,
    );
  });

  it("filters default snippets to the active database dialect", () => {
    expect(defaultSnippetForEngine("postgres", "upsert")?.template).toContain(
      "on conflict",
    );
    expect(defaultSnippetForEngine("mysql", "upsert")?.template).toContain(
      "on duplicate key update",
    );
    expect(defaultSnippetForEngine("oracle", "selw")?.template).toContain(
      "fetch first",
    );
    expect(defaultSnippetForEngine("sqlserver", "begin")?.template).toContain(
      "begin transaction",
    );
    expect(defaultSnippetForEngine("bigquery", "begin")?.template).toContain(
      "begin transaction",
    );
    expect(defaultSnippetForEngine("bigquery", "begin")?.template).not.toContain(
      "begin;\n",
    );
    expect(defaultSnippetForEngine("bigquery", "tx")?.template).toContain(
      "rollback transaction",
    );
    expect(defaultSnippetForEngine("bigquery", "commit")?.template).toContain(
      "commit transaction",
    );
    expect(defaultSnippetForEngine("mongodb", "sel")).toBeUndefined();
    expect(
      snippetsForEngine(defaultSqlSnippets, "bigquery").filter(
        (snippet) => snippet.label === "touch",
      ),
    ).toHaveLength(1);
    expect(defaultSnippetForEngine("bigquery", "touch")?.template).toContain(
      "current_timestamp()",
    );
  });

  it("uses dialect-specific snippet variants in completion", () => {
    const mysqlUpsert = completeWithEngine("ups", metadata, "mysql").find(
      (option) => option.label === "upsert",
    );
    const oracleDeleteOperation = defaultSnippetForEngine("oracle", "delop");
    const clickHouseDeleteOperation = defaultSnippetForEngine("clickhouse", "delop");
    const sqlServerDeleteReturning = defaultSnippetForEngine("sqlserver", "delret");
    const questDbSampleBy = defaultSnippetForEngine("questdb", "sampleby");
    const questDbLatestOn = defaultSnippetForEngine("questdb", "lateston");
    const questDbAsofJoin = defaultSnippetForEngine("questdb", "asofjoin");

    expect(mysqlUpsert?.detail).toBe("insert on duplicate key update");
    expect(oracleDeleteOperation?.template).toContain("fetch first");
    expect(oracleDeleteOperation?.template).not.toContain("limit");
    expect(clickHouseDeleteOperation?.detail).toBe(
      "ClickHouse delete mutation: preview/delete/check",
    );
    expect(clickHouseDeleteOperation?.template).toContain("alter table");
    expect(clickHouseDeleteOperation?.template).not.toContain("delete from");
    expect(sqlServerDeleteReturning?.template).toContain("output deleted.${3:*}");
    expect(questDbSampleBy?.template).toContain("sample by");
    expect(questDbLatestOn?.template).toContain("latest on");
    expect(questDbAsofJoin?.template).toContain("asof join");
    expect(questDbAsofJoin?.template).toContain("on (${5:symbol_column})");
  });

  it("adds clause snippets in column-capable contexts", () => {
    const joinSnippet = complete("select * from customers c jo").find(
      (option) => option.label === "join" && option.detail === "join clause",
    );

    expect(typeof joinSnippet?.apply).toBe("function");
  });

  it("keeps SQL snippets out of relation and qualified contexts", () => {
    expect(labels("select * from sel")).not.toContain("sel");
    expect(labels("select c.sel from customers c")).not.toContain("sel");
  });

  it("uses snippet definitions loaded from JSON", () => {
    const snippets = sqlSnippetsFromJson([
      {
        label: "sf",
        detail: "select first rows",
        template: "select ${1:*}\nfrom ${2:table}\nlimit ${3:10};\n${0}",
        scope: "statement",
        rank: 550,
      },
    ]);

    const options = completeWithSnippets("sf", snippets);

    expect(options.map((option) => option.label)).toEqual(["sf"]);
    expect(options[0]?.detail).toBe("select first rows");
    expect(typeof options[0]?.apply).toBe("function");
    expect(completeWithSnippets("sel", snippets).map((option) => option.label)).not.toContain(
      "sel",
    );
  });

  it("expands VS Code-style named snippet variables without touching tabstops", () => {
    const template =
      "select ${TM_SELECTED_TEXT} as ${1:alias}, '${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}' as day, '${UUID}' as id;${0}";

    expect(
      expandSqlSnippetVariables(template, {
        CURRENT_DATE: "28",
        CURRENT_MONTH: "06",
        CURRENT_YEAR: "2026",
        TM_SELECTED_TEXT: "price_$raw}",
        UUID: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBe(
      "select price_\\$raw\\} as ${1:alias}, '2026-06-28' as day, '123e4567-e89b-12d3-a456-426614174000' as id;${0}",
    );
  });

  it("loads engine-scoped snippet definitions from JSON", () => {
    const snippets = sqlSnippetsFromJson([
      {
        label: "sf",
        detail: "snowflake only",
        template: "select current_warehouse();${0}",
        scope: "statement",
        engines: ["snowflake"],
      },
    ]);

    expect(snippets[0]?.engines).toEqual(["snowflake"]);
    expect(completeWithEngine("sf", metadata, "snowflake", false, snippets)).toHaveLength(1);
    expect(completeWithEngine("sf", metadata, "postgres", false, snippets)).toHaveLength(0);
  });

  it("merges imported snippets by label and engine scope", () => {
    const merged = mergeImportedSqlSnippets(
      [
        {
          label: "ops",
          detail: "old postgres",
          template: "select 1;${0}",
          scope: "statement",
          engines: ["postgres"],
        },
        {
          label: "ops",
          detail: "mysql variant",
          template: "select 2;${0}",
          scope: "statement",
          engines: ["mysql"],
        },
      ],
      [
        {
          label: "ops",
          detail: "new postgres",
          template: "select 3;${0}",
          scope: "statement",
          engines: ["postgres"],
        },
        {
          label: "mine",
          detail: "new custom",
          template: "select 4;${0}",
          scope: "statement",
        },
      ],
    );

    expect(merged.map(snippetTestKey)).toEqual([
      "ops:postgres",
      "ops:mysql",
      "mine:*",
    ]);
    expect(merged.find((snippet) => snippetTestKey(snippet) === "ops:postgres")?.detail).toBe(
      "new postgres",
    );
  });

  it("imports snippets from JSON text wrappers", async () => {
    const imported = await sqlSnippetsFromText(
      JSON.stringify({
        editor: {
          snippets: [
            {
              label: "ops",
              detail: "ops select",
              template: "select ${1:*};${0}",
              scope: "statement",
              engines: ["postgres"],
            },
          ],
        },
      }),
      "snippets.json",
    );

    expect(imported.format).toBe("json");
    expect(imported.snippets).toHaveLength(1);
    expect(imported.snippets[0]?.engines).toEqual(["postgres"]);
  });

  it("imports snippets from YAML text", async () => {
    const imported = await sqlSnippetsFromText(
      `
snippets:
  - label: delop_sf
    detail: Snowflake delete operation
    scope: statement
    engines: [snowflake]
    template: |
      delete from \${1:table}
      where \${2:condition};
      \${0}
`,
      "snippets.yaml",
    );

    expect(imported.format).toBe("yaml");
    expect(imported.snippets[0]?.label).toBe("delop_sf");
    expect(imported.snippets[0]?.template).toContain("delete from ${1:table}");
    expect(completeWithEngine("delop_sf", metadata, "snowflake", false, imported.snippets)).toHaveLength(1);
    expect(completeWithEngine("delop_sf", metadata, "postgres", false, imported.snippets)).toHaveLength(0);
  });

  it("falls back to cheap keyword completion without metadata matches", () => {
    expect(labels("sel")).toContain("select");
    expect(labels("select * from customers c where ema")).toContain("c.email");
  });

  it("does not leak common SQL keywords into non-SQL engines", () => {
    expect(completeWithEngine("sel", metadata, "mongodb").map((option) => option.label)).not.toContain(
      "select",
    );
    expect(completeWithEngine("ag", metadata, "elasticsearch").map((option) => option.label)).toContain(
      "aggs",
    );
    expect(completeWithEngine("sel", metadata, "elasticsearch").map((option) => option.label)).not.toContain(
      "select",
    );
  });

  it("adds dialect-specific keyword completions", () => {
    expect(completeWithEngine("dual", metadata, "oracle").map((option) => option.label)).toContain(
      "dual",
    );
    expect(completeWithEngine("row", metadata, "oracle").map((option) => option.label)).toContain(
      "rownum",
    );
    expect(completeWithEngine("firs", metadata, "firebird").map((option) => option.label)).toContain(
      "first",
    );
    expect(completeWithEngine("next", metadata, "firebird").map((option) => option.label)).toContain(
      "next value for",
    );
  });

  it("ignores semicolons inside strings when resolving the current statement", () => {
    expect(labels("select ';' as marker from customers c where em")).toEqual([
      "c.email",
    ]);
  });

  it("suppresses completions inside strings and comments", () => {
    expect(labels("select 'ema")).toEqual([]);
    expect(labels("select 1 -- ema")).toEqual([]);
  });
});

describe.each(engineCompletionFixtures)(
  "completeSqlLightweight $name engine fixture",
  (fixture) => {
    it("suggests table names in relation context", () => {
      expect(labelsForEngine(fixture.tableSql, fixture)).toEqual([
        fixture.tableLabel,
      ]);
      expect(appliesForEngine(fixture.tableSql, fixture)).toEqual([
        fixture.tableApply,
      ]);
    });

    it("suggests schema-qualified relation names", () => {
      expect(labelsForEngine(fixture.qualifiedSql, fixture)).toEqual([
        fixture.qualifiedLabel,
      ]);
      expect(appliesForEngine(fixture.qualifiedSql, fixture)).toEqual([
        fixture.qualifiedApply,
      ]);
    });

    it("suggests columns after table aliases", () => {
      expect(labelsForEngine(fixture.aliasSql, fixture)).toEqual(
        fixture.aliasColumns,
      );
    });

    it("falls back to engine keywords when metadata has no match", () => {
      expect(labelsForEngine(fixture.keywordSql, fixture)).toContain(
        fixture.keywordLabel,
      );
    });
  },
);
