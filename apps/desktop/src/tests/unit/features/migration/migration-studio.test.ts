import { describe, expect, it } from "vitest";
import {
  buildMigrationPlan,
  defaultMigrationDraft,
  parseColumnList,
  type MigrationDraft,
} from "@/features/migration";

function draft(patch: Partial<MigrationDraft> = {}): MigrationDraft {
  return { ...defaultMigrationDraft, ...patch };
}

describe("migration studio plan generation", () => {
  it("builds a Hive to Snowflake extraction, load, and manifest diff plan", () => {
    const plan = buildMigrationPlan(draft());

    expect(plan.title).toContain("Apache Hive");
    expect(plan.title).toContain("Snowflake");
    expect(plan.sourceSql).toContain("INSERT OVERWRITE DIRECTORY");
    expect(plan.sourceSql).toContain("STORED AS PARQUET");
    expect(plan.sourceSql).toContain("LOWER(MD5(CONCAT_WS");
    expect(plan.targetSql).toContain("CREATE OR REPLACE FILE FORMAT");
    expect(plan.targetSql).toContain("COPY INTO analytics.orders");
    expect(plan.diffSql).toContain("FULL OUTER JOIN");
    expect(plan.diffSql).toContain("irodori_source_manifest");
    expect(plan.diffSql).toContain("target_only");
  });

  it("quotes unsafe identifiers and uses Oracle SHA256 row hashes", () => {
    const plan = buildMigrationPlan(
      draft({
        sourceEngine: "oracle",
        targetEngine: "postgres",
        sourceTable: "HR.Pay Detail",
        targetTable: "public.pay_detail",
        keyColumnsText: "EMP ID",
        compareColumnsText: "EMP ID\nSALARY",
      }),
    );

    expect(plan.sourceSql).toContain('"Pay Detail"');
    expect(plan.sourceSql).toContain('"EMP ID"');
    expect(plan.sourceSql).toContain("STANDARD_HASH");
    expect(plan.targetSql).toContain('"EMP ID" TEXT');
    expect(plan.diffSql).toContain("FULL OUTER JOIN");
  });

  it("warns when row-level diff has no stable key", () => {
    const plan = buildMigrationPlan(
      draft({
        keyColumnsText: "",
        compareColumnsText: "id\namount",
      }),
    );

    expect(plan.warnings).toContain(
      "A stable business key is required for row-level diff.",
    );
    expect(plan.diffSql).toContain(
      "Row-level diff needs a stable business key",
    );
  });

  it("builds a DuckDB-backed Iceberg/S3 Tables plan", () => {
    const plan = buildMigrationPlan(
      draft({
        sourceEngine: "s3Tables",
        targetEngine: "iceberg",
        sourceVersion: "S3 Tables",
        targetVersion: "Iceberg REST",
        sourceTable: "irodori_iceberg.sales.orders",
        targetTable: "irodori_iceberg.analytics.orders",
      }),
    );

    expect(plan.sourceSql).toContain("INSTALL iceberg");
    expect(plan.sourceSql).toContain("ATTACH '${ICEBERG_WAREHOUSE}'");
    expect(plan.sourceSql).toContain(
      "DuckDB-Wasm runs this shape inside a browser tab",
    );
    expect(plan.targetSql).toContain(
      "CREATE OR REPLACE TABLE irodori_iceberg.analytics.orders AS",
    );
    expect(plan.targetSql).toContain(
      "read_parquet('${EXPORT_PATH}/*.parquet')",
    );
    expect(plan.warnings).toContain(
      "Browser DuckDB/Iceberg flows must keep credentials out of shareable URLs and exported runbooks.",
    );
    expect(plan.pairNotes.join("\n")).toContain(
      "client-is-the-server compute layer",
    );
  });

  it("parses comma and newline column lists with case-insensitive de-dupe", () => {
    expect(parseColumnList("id, name\nID\nupdated_at")).toEqual([
      "id",
      "name",
      "updated_at",
    ]);
  });
});
