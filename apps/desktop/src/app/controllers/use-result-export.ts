import type { ShowActionNotice } from "@/app/ActionToast";
import { downloadBlob, writeTextToClipboard } from "@/features/erd";
import {
  buildResultExport,
  buildXlsxBlob,
  resultExportFileName,
  toCount,
  type ResultExportFormat,
} from "@/features/results";
import type { Translator } from "@/i18n";
import { errorMessage } from "@/core";
import type { QueryResult } from "@/generated/irodori-api";

type ValueUpdater<T> = T | ((current: T) => T);

export type ResultExportDeps = {
  activeResult: QueryResult | null | undefined;
  activeConnectionId: string;
  inferEditTarget: () => { table: string } | null;
  setExportMenuOpen: (value: ValueUpdater<boolean>) => void;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useResultExport({
  activeResult,
  activeConnectionId,
  inferEditTarget,
  setExportMenuOpen,
  showActionNotice,
  t,
}: ResultExportDeps) {
  async function saveExportBlob(blob: Blob, fileName: string) {
    const outcome = await downloadBlob(blob, fileName);
    if (outcome.kind === "native") {
      showActionNotice("success", t("notice.grid.exportSaved"), outcome.path);
    } else if (outcome.kind === "browser") {
      showActionNotice("success", t("notice.grid.exportStarted"), fileName);
    }
  }

  async function exportActiveResult(format: ResultExportFormat) {
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToExport"));
      return;
    }
    const target = inferEditTarget();
    const fileName = resultExportFileName(activeConnectionId, format);
    try {
      let blob: Blob;
      if (format === "xlsx") {
        blob = await buildXlsxBlob(exportResult, target?.table ?? "Result");
      } else {
        const exported = buildResultExport(
          exportResult,
          format,
          target?.table ?? "query_result",
        );
        blob = new Blob([exported.bom ? "\uFEFF" : "", exported.content], {
          type: exported.mime,
        });
      }
      setExportMenuOpen(false);
      await saveExportBlob(blob, fileName);
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.grid.exportFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyActiveResultSqlInserts() {
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToCopy"));
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      "sql",
      target?.table ?? "query_result",
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        t("notice.grid.insertSqlCopied"),
        t("notice.grid.rowCountDetail", {
          count: toCount(exportResult.rows.length),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyActiveResultAs(format: ResultExportFormat) {
    if (format === "sql") {
      await copyActiveResultSqlInserts();
      return;
    }
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToCopy"));
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      format,
      target?.table ?? "query_result",
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        t("notice.grid.copiedAs", { format: format.toUpperCase() }),
        t("notice.grid.rowCountDetail", {
          count: toCount(exportResult.rows.length),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  return {
    exportActiveResult,
    copyActiveResultSqlInserts,
    copyActiveResultAs,
  };
}
