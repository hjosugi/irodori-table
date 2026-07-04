import { migrationBuildPlan } from "@/generated/irodori-api";
import type { MigrationPlanInput } from "@/generated/irodori-api";
import {
  buildMigrationPlan,
  createMigrationPlanPlaceholder,
  defaultMigrationDraft,
  migrationPlanInputFromDraft,
  parseColumnList,
  type MigrationDraft,
} from "@/features/migration";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/generated/irodori-api", () => {
  const labels: Record<string, string> = {
    hive: "Apache Hive",
    snowflake: "Snowflake",
    postgres: "PostgreSQL",
    mysql: "MySQL",
    oracle: "Oracle",
    duckdb: "DuckDB / DuckDB-Wasm",
    iceberg: "Apache Iceberg REST",
    s3Tables: "AWS S3 Tables",
  };
  const columns = (value: string): string[] =>
    Array.from(
      new Map(
        value
          .split(/[\n,]+/)
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => [part.toLocaleLowerCase(), part]),
      ).values(),
    );

  return {
    migrationBuildPlan: vi.fn(async (input: MigrationPlanInput) => {
      const sourceLabel = labels[input.sourceEngine] ?? input.sourceEngine;
      const targetLabel = labels[input.targetEngine] ?? input.targetEngine;
      const keys = columns(input.keyColumnsText);
      const compareColumns = columns(input.compareColumnsText);
      const hashColumns = compareColumns.length > 0 ? compareColumns : keys;

      return {
        title:
          `${sourceLabel} ${input.sourceVersion} -> ${targetLabel} ${input.targetVersion}`
            .replace(/\s+/g, " ")
            .trim(),
        sourceLabel,
        targetLabel,
        hashAlgorithm: "md5",
        hashAlgorithmLabel: "MD5",
        keys,
        compareColumns,
        hashColumns,
        warnings: [
          "Row hashes must use MD5 over Irodori canonical row strings on both source and target manifests.",
        ],
        tasks: [
          {
            title: "Extract manifest",
            detail: "Native planner builds the extraction SQL.",
            level: "ready",
          },
        ],
        pairNotes: ["Native irodori-migration plan."],
        sourceSql: `-- Native MD5 source manifest for ${input.sourceTable}`,
        targetSql: `-- Native MD5 target manifest for ${input.targetTable}`,
        diffSql: "-- Native FULL OUTER JOIN diff",
        runbook: "# Native migration runbook",
      };
    }),
  };
});

const migrationBuildPlanMock = vi.mocked(migrationBuildPlan);

function draft(patch: Partial<MigrationDraft> = {}): MigrationDraft {
  return { ...defaultMigrationDraft, ...patch };
}

describe("migration studio plan bridge", () => {
  beforeEach(() => {
    migrationBuildPlanMock.mockClear();
  });

  it("delegates plan generation to the native migration planner", async () => {
    const plan = await buildMigrationPlan(draft());

    expect(migrationBuildPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEngine: "hive",
        targetEngine: "snowflake",
        sourceTable: "legacy.orders",
        targetTable: "analytics.orders",
        batchSize: 5_000_000,
        diffLimit: 1_000,
      }),
    );
    expect(plan.title).toContain("Apache Hive");
    expect(plan.title).toContain("Snowflake");
    expect(plan.hashAlgorithm).toBe("md5");
    expect(plan.hashAlgorithmLabel).toBe("MD5");
    expect(plan.sourceSql).toContain("Native MD5 source manifest");
    expect(plan.sourceSql).not.toContain("blake3");
  });

  it("keeps the UI input normalization small and deterministic", () => {
    const input = migrationPlanInputFromDraft(
      draft({
        batchSize: 0,
        diffLimit: 1,
        nullToken: "",
        delimiter: "",
        keyColumnsText: "id, name\nID",
      }),
    );

    expect(input.batchSize).toBe(1_000);
    expect(input.diffLimit).toBe(10);
    expect(input.nullToken).toBe("__IRODORI_NULL__");
    expect(input.delimiter).toBe("|#|");
    expect(input.keyColumnsText).toBe("id, name\nID");
  });

  it("propagates native planner failures", async () => {
    migrationBuildPlanMock.mockRejectedValueOnce(
      "migration plan is not runnable: at least one stable key column is required",
    );

    await expect(
      buildMigrationPlan(draft({ keyColumnsText: "" })),
    ).rejects.toBe(
      "migration plan is not runnable: at least one stable key column is required",
    );
  });

  it("uses an MD5 placeholder while the native plan is loading or unavailable", () => {
    const plan = createMigrationPlanPlaceholder(
      draft({
        sourceEngine: "oracle",
        targetEngine: "postgres",
        sourceTable: "HR.Pay Detail",
        targetTable: "public.pay_detail",
        keyColumnsText: "EMP ID",
        compareColumnsText: "EMP ID\nSALARY",
      }),
      "native planner unavailable",
    );

    expect(plan.hashAlgorithm).toBe("md5");
    expect(plan.hashAlgorithmLabel).toBe("MD5");
    expect(plan.keys).toEqual(["EMP ID"]);
    expect(plan.hashColumns).toEqual(["EMP ID", "SALARY"]);
    expect(plan.warnings).toEqual(["native planner unavailable"]);
  });

  it("parses comma and newline column lists with case-insensitive de-dupe", () => {
    expect(parseColumnList("id, name\nID\nupdated_at")).toEqual([
      "id",
      "name",
      "updated_at",
    ]);
  });
});
