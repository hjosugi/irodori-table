import { useEffect, useMemo, useRef, useState } from "react";

import type { ShowActionNotice } from "@/app/ActionToast";
import {
  buildCreateDatabaseSql,
  buildTableSpecDocument,
  ddlFromTableSpecDocument,
  exportTableSpecJson,
  exportTableSpecMarkdown,
  parseTableSpecDocument,
  tableSpecFileName,
} from "@/features/schema-designer";
import {
  diagramFromMetadata,
  useSchemaDiagramStore,
} from "@/features/schema-diagram";
import {
  buildErdModel,
  downloadBlob,
  erdFileName,
  erdSvgStyle,
  hasDiagram,
  layoutErdModel,
  serializeSvgElement,
  svgMarkupToPngBlob,
  toMermaidErd,
  writePngBlobToClipboard,
  writeTextToClipboard,
  type ErdLayout,
} from "@/features/erd";
import type { SqlEditorHandle } from "@/features/query-editor";
import type { Translator } from "@/i18n";
import { errorMessage } from "@/core";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import type { IrodoriTheme } from "@/theme";
import { clampNumber } from "../app-workbench-utils";

export type ErdDiagramDeps = {
  activeConnectionId: string;
  activeConnectionName: string;
  activeMetadata: DatabaseMetadata | undefined;
  theme: IrodoriTheme;
  setQuery: (value: string) => void;
  activeEditorApi: () => SqlEditorHandle | null;
  openObjectSchemaDesigner: (object: DbObjectMetadata) => void;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useErdDiagram({
  activeConnectionId,
  activeConnectionName,
  activeMetadata,
  theme,
  setQuery,
  activeEditorApi,
  openObjectSchemaDesigner,
  showActionNotice,
  t,
}: ErdDiagramDeps) {
  const schemaSpecFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDiagramSearchRef = useRef<string | null>(null);
  const diagramInitializedFor = useRef<string | null>(null);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);

  const schemaDiagramOpen = useSchemaDiagramStore((state) => state.open);
  const openBlankSchemaDiagram = useSchemaDiagramStore(
    (state) => state.openBlank,
  );
  const openSchemaDiagramFromDocument = useSchemaDiagramStore(
    (state) => state.openFromDocument,
  );
  const setSchemaDiagramDocument = useSchemaDiagramStore(
    (state) => state.setDocument,
  );
  const closeSchemaDiagram = useSchemaDiagramStore((state) => state.close);

  const availableDiagramSchemas = useMemo(
    () =>
      activeMetadata?.schemas
        .filter((schema) =>
          schema.objects.some((object) => object.kind === "table"),
        )
        .map((schema) => schema.name) ?? [],
    [activeMetadata],
  );
  const diagramModel = useMemo(
    () =>
      activeMetadata
        ? buildErdModel(activeMetadata, {
            schemaNames: diagramSchemaNames,
            search: diagramSearch,
          })
        : null,
    [activeMetadata, diagramSchemaNames, diagramSearch],
  );
  const diagramLayout = useMemo<ErdLayout | null>(
    () => (diagramModel ? layoutErdModel(diagramModel) : null),
    [diagramModel],
  );
  const diagramSvgStyle = useMemo(() => erdSvgStyle(theme), [theme]);
  const diagramMermaid = useMemo(
    () => (activeMetadata ? toMermaidErd(activeMetadata) : ""),
    [activeMetadata],
  );

  useEffect(() => {
    if (!diagramOpen) {
      diagramInitializedFor.current = null;
      return;
    }
    if (!activeMetadata || !hasDiagram(activeMetadata)) {
      setDiagramError(
        "No tables to diagram yet - connect and load metadata first.",
      );
      return;
    }
    setDiagramError(null);
    const initKey = `${activeConnectionId}:${activeMetadata.schemas
      .map((schema) => schema.name)
      .join("|")}`;
    if (diagramInitializedFor.current !== initKey) {
      setDiagramSchemaNames(
        activeMetadata.schemas
          .filter((schema) =>
            schema.objects.some((object) => object.kind === "table"),
          )
          .map((schema) => schema.name),
      );
      setDiagramSearch(pendingDiagramSearchRef.current ?? "");
      pendingDiagramSearchRef.current = null;
      setDiagramZoom(1);
      diagramInitializedFor.current = initKey;
    }
  }, [activeConnectionId, activeMetadata, diagramOpen]);

  function openDiagramForSearch(search: string) {
    pendingDiagramSearchRef.current = search;
    setDiagramSearch(search);
    setDiagramOpen(true);
  }

  function currentDiagramSvgMarkup() {
    const svg = diagramSvgRef.current;
    if (!svg || !diagramLayout) {
      throw new Error("No ERD is rendered");
    }
    return {
      markup: serializeSvgElement(svg),
      width: diagramLayout.width,
      height: diagramLayout.height,
    };
  }

  async function downloadDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      const outcome = await downloadBlob(
        new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
        erdFileName(activeConnectionId, "svg"),
      );
      setDiagramError(null);
      if (outcome.kind !== "cancelled") {
        showActionNotice(
          "success",
          t("notice.workbench.erdSvgExported"),
          outcome.kind === "native"
            ? outcome.path
            : erdFileName(activeConnectionId, "svg"),
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.erdExportFailed"), message);
    }
  }

  async function downloadDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      const outcome = await downloadBlob(
        blob,
        erdFileName(activeConnectionId, "png"),
      );
      setDiagramError(null);
      if (outcome.kind !== "cancelled") {
        showActionNotice(
          "success",
          t("notice.workbench.erdPngExported"),
          outcome.kind === "native"
            ? outcome.path
            : erdFileName(activeConnectionId, "png"),
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.erdExportFailed"), message);
    }
  }

  async function copyDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      await writeTextToClipboard(markup);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.erdSvgCopied"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.copyFailed"), message);
    }
  }

  async function copyDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      await writePngBlobToClipboard(blob);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.erdPngCopied"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.copyFailed"), message);
    }
  }

  function currentTableSpecDocument() {
    if (!activeMetadata) {
      throw new Error("No schema metadata is loaded");
    }
    return buildTableSpecDocument(activeMetadata, {
      connectionId: activeConnectionId,
      connectionName: activeConnectionName,
      schemaNames: diagramSchemaNames,
      search: diagramSearch,
    });
  }

  async function downloadTableSpecMarkdown() {
    try {
      const exported = exportTableSpecMarkdown(currentTableSpecDocument());
      const outcome = await downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      if (outcome.kind !== "cancelled") {
        showActionNotice(
          "success",
          t("notice.workbench.tableSpecExported"),
          "Markdown",
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.tableSpecExportFailed"),
        message,
      );
    }
  }

  async function downloadTableSpecJson() {
    try {
      const exported = exportTableSpecJson(currentTableSpecDocument());
      const outcome = await downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      if (outcome.kind !== "cancelled") {
        showActionNotice(
          "success",
          t("notice.workbench.tableSpecExported"),
          "JSON",
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.tableSpecExportFailed"),
        message,
      );
    }
  }

  async function handleSchemaSpecFile(file: File) {
    try {
      const spec = parseTableSpecDocument(await file.text());
      const sql = ddlFromTableSpecDocument(spec);
      setQuery(sql);
      setDiagramOpen(false);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.ddlFromSpec"), file.name);
      window.setTimeout(() => activeEditorApi()?.focus(), 0);
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.specImportFailed"),
        message,
      );
    } finally {
      if (schemaSpecFileRef.current) {
        schemaSpecFileRef.current.value = "";
      }
    }
  }

  function createDatabaseSqlFromDiagram() {
    try {
      const sql = buildCreateDatabaseSql(currentTableSpecDocument());
      setQuery(sql);
      setDiagramOpen(false);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.createDbSqlGenerated"));
      window.setTimeout(() => activeEditorApi()?.focus(), 0);
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.createDbSqlFailed"),
        message,
      );
    }
  }

  function editDiagramTableColumns(tableId: string) {
    const object = activeMetadata?.schemas
      .flatMap((schema) => schema.objects)
      .find(
        (item) =>
          item.kind === "table" && `${item.schema}.${item.name}` === tableId,
      );
    if (!object) {
      return;
    }
    setDiagramOpen(false);
    openObjectSchemaDesigner(object);
  }

  function openSchemaDiagramDesigner() {
    if (activeMetadata && hasDiagram(activeMetadata)) {
      openSchemaDiagramFromDocument(diagramFromMetadata(activeMetadata));
    } else {
      openBlankSchemaDiagram();
    }
  }

  function editDiagramInDesigner() {
    if (!activeMetadata) {
      return;
    }
    openSchemaDiagramFromDocument(
      diagramFromMetadata(activeMetadata, {
        schemaNames: diagramSchemaNames,
        search: diagramSearch,
      }),
    );
    setDiagramOpen(false);
  }

  function seedSchemaDiagramFromDb() {
    if (activeMetadata) {
      setSchemaDiagramDocument(diagramFromMetadata(activeMetadata));
    }
  }

  function putDiagramDesignerSqlInEditor(sql: string) {
    setQuery(sql);
    closeSchemaDiagram();
    showActionNotice("success", t("notice.workbench.createDbSqlGenerated"));
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
  }

  async function copyDiagramDesignerSql(sql: string) {
    try {
      await writeTextToClipboard(sql);
      showActionNotice("success", t("notice.workbench.schemaSqlCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  function fitDiagramToViewport() {
    if (!diagramLayout || !diagramCanvasRef.current) {
      return;
    }
    const bounds = diagramCanvasRef.current.getBoundingClientRect();
    const nextZoom = clampNumber(
      Math.min(
        bounds.width / diagramLayout.width,
        bounds.height / diagramLayout.height,
      ),
      0.25,
      1.25,
    );
    setDiagramZoom(nextZoom);
    window.requestAnimationFrame(() => {
      if (diagramCanvasRef.current) {
        diagramCanvasRef.current.scrollTop = 0;
        diagramCanvasRef.current.scrollLeft = 0;
      }
    });
  }

  async function copyDiagramMermaid() {
    if (activeMetadata) {
      await navigator.clipboard?.writeText(diagramMermaid);
    }
  }

  return {
    schemaSpecFileRef,
    diagramSvgRef,
    diagramCanvasRef,
    diagramOpen,
    setDiagramOpen,
    diagramError,
    diagramSearch,
    setDiagramSearch,
    diagramSchemaNames,
    setDiagramSchemaNames,
    diagramZoom,
    setDiagramZoom,
    schemaDiagramOpen,
    closeSchemaDiagram,
    availableDiagramSchemas,
    diagramModel,
    diagramLayout,
    diagramSvgStyle,
    openDiagramForSearch,
    downloadDiagramSvg,
    downloadDiagramPng,
    copyDiagramSvg,
    copyDiagramPng,
    downloadTableSpecMarkdown,
    downloadTableSpecJson,
    handleSchemaSpecFile,
    createDatabaseSqlFromDiagram,
    editDiagramTableColumns,
    openSchemaDiagramDesigner,
    editDiagramInDesigner,
    seedSchemaDiagramFromDb,
    putDiagramDesignerSqlInEditor,
    copyDiagramDesignerSql,
    fitDiagramToViewport,
    copyDiagramMermaid,
  };
}
