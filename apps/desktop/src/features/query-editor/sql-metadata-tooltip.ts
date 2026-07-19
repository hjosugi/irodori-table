import { currentAppLocale } from "@/features/preferences";
import {
  sqlColumnDefinitionPreview,
  sqlColumnSampleValues,
  sqlMetadataTargetSubtitle,
  sqlMetadataTargetTitle,
  sqlObjectColumnDefinitionRows,
  sqlObjectDefinitionPreview,
  sqlObjectSampleRows,
  type SqlMetadataTarget,
} from "@/sql/metadata-inspection";

type MetadataObject = SqlMetadataTarget["object"];
type MetadataForeignKey = MetadataObject["foreignKeys"][number];
type MetadataIndex = MetadataObject["indexes"][number];

export type SqlMetadataTooltipLink = {
  label: string;
  target: SqlMetadataTarget;
};

export type SqlMetadataTooltipOptions = {
  className?: string;
  links?: readonly SqlMetadataTooltipLink[];
  onLinkClick?: (target: SqlMetadataTarget) => void;
  onTitleClick?: (target: SqlMetadataTarget) => void;
};

export function renderSqlMetadataTooltip(
  target: SqlMetadataTarget,
  options: SqlMetadataTooltipOptions = {},
): HTMLElement {
  const root = document.createElement("div");
  root.className = [
    "sql-metadata-tooltip",
    `sql-metadata-tooltip-${target.kind}`,
    options.className,
  ]
    .filter(Boolean)
    .join(" ");
  appendTitle(root, target, options.onTitleClick);
  appendText(
    root,
    "div",
    "sql-metadata-subtitle",
    // Rendered at hover time, so reading the store here stays fresh.
    sqlMetadataTargetSubtitle(target, currentAppLocale()),
  );

  if (target.kind === "column") {
    appendColumnDetails(root, target);
  } else {
    appendObjectDetails(root, target.object);
  }

  appendMetadataLinks(root, options.links ?? [], options.onLinkClick);
  return root;
}

function appendObjectDetails(root: HTMLElement, object: MetadataObject) {
  if (object.comment) {
    appendText(root, "div", "sql-metadata-comment", object.comment);
  }

  const definition = document.createElement("pre");
  definition.className = "sql-metadata-definition";
  definition.textContent = truncateText(
    sqlObjectDefinitionPreview(object),
    1_400,
  );
  root.appendChild(definition);

  appendObjectColumns(root, object);
  appendObjectKeys(root, object);
  appendObjectIndexes(root, object);
  appendObjectSample(root, object);
}

function appendObjectColumns(root: HTMLElement, object: MetadataObject) {
  const rows = sqlObjectColumnDefinitionRows(object, 10);
  if (rows.length === 0) {
    return;
  }

  const columns = document.createElement("div");
  columns.className = "sql-metadata-columns";
  appendText(columns, "div", "sql-metadata-section-title", "columns");
  for (const row of rows) {
    appendText(columns, "div", "sql-metadata-detail-line", row);
  }
  root.appendChild(columns);
}

function appendObjectKeys(root: HTMLElement, object: MetadataObject) {
  const rows = object.foreignKeys.map((foreignKey) =>
    formatForeignKeySummary(object, foreignKey),
  );
  appendLimitedDetailSection(
    root,
    "sql-metadata-keys",
    "foreign keys",
    "foreign key",
    rows,
    6,
  );
}

function appendObjectIndexes(root: HTMLElement, object: MetadataObject) {
  const rows = object.indexes.map(formatIndexSummary);
  appendLimitedDetailSection(
    root,
    "sql-metadata-indexes",
    "indexes",
    "index",
    rows,
    6,
  );
}

function appendObjectSample(root: HTMLElement, object: MetadataObject) {
  const sampleRows = sqlObjectSampleRows(object, 2);
  if (!object.sample || sampleRows.length === 0) {
    return;
  }

  const sample = document.createElement("div");
  sample.className = "sql-metadata-sample";
  appendText(sample, "div", "sql-metadata-section-title", "sample");
  appendText(
    sample,
    "div",
    "sql-metadata-sample-row",
    object.sample.columns.slice(0, 4).join("  |  "),
  );
  for (const row of sampleRows) {
    appendText(
      sample,
      "div",
      "sql-metadata-sample-row",
      row.slice(0, 4).join("  |  "),
    );
  }
  root.appendChild(sample);
}

function appendColumnDetails(
  root: HTMLElement,
  target: Extract<SqlMetadataTarget, { kind: "column" }>,
) {
  const definition = document.createElement("pre");
  definition.className = "sql-metadata-definition";
  definition.textContent = sqlColumnDefinitionPreview(
    target.object,
    target.column,
  );
  root.appendChild(definition);

  const detailRows = columnDetailRows(target);
  if (detailRows.length === 0) {
    return;
  }

  const detail = document.createElement("div");
  detail.className = "sql-metadata-column-detail";
  for (const row of detailRows) {
    appendText(detail, "div", "sql-metadata-detail-line", row);
  }
  root.appendChild(detail);
}

function columnDetailRows(
  target: Extract<SqlMetadataTarget, { kind: "column" }>,
): string[] {
  const targetColumnName = target.column.name;
  const foreignKey = target.object.foreignKeys.find((fk) =>
    fk.columns.some((column) => sameIdentifier(column, targetColumnName)),
  );
  const indexes = target.object.indexes
    .filter((index) =>
      index.columns.some((column) => sameIdentifier(column, targetColumnName)),
    )
    .map(formatIndexName);
  const reference = foreignKey
    ? formatForeignKeyReference(target.object, foreignKey)
    : null;

  return [
    target.column.comment,
    indexes.length ? `index ${indexes.join(", ")}` : null,
    reference ? `references ${reference}` : null,
    ...sqlColumnSampleValues(target.object, target.column).map(
      (value) => `sample ${value}`,
    ),
  ].filter((line): line is string => Boolean(line));
}

function formatForeignKeySummary(
  object: MetadataObject,
  foreignKey: MetadataForeignKey,
): string {
  const columns = foreignKey.columns.join(", ");
  return `${columns} -> ${formatForeignKeyReference(object, foreignKey)}`;
}

function formatForeignKeyReference(
  object: MetadataObject,
  foreignKey: MetadataForeignKey,
): string {
  const schema = foreignKey.referencesSchema ?? object.schema;
  const columns = foreignKey.referencesColumns.join(", ");
  return `${schema}.${foreignKey.referencesTable}(${columns})`;
}

function formatIndexSummary(index: MetadataIndex): string {
  return `${formatIndexName(index)} (${index.columns.join(", ")})`;
}

function formatIndexName(index: MetadataIndex): string {
  return `${index.unique ? "unique " : ""}${index.name}`;
}

function sameIdentifier(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function appendLimitedDetailSection(
  root: HTMLElement,
  className: string,
  title: string,
  overflowLabel: string,
  rows: readonly string[],
  limit: number,
) {
  if (rows.length === 0) {
    return;
  }

  const section = document.createElement("div");
  section.className = className;
  appendText(section, "div", "sql-metadata-section-title", title);
  for (const row of rows.slice(0, limit)) {
    appendText(section, "div", "sql-metadata-detail-line", row);
  }
  if (rows.length > limit) {
    appendText(
      section,
      "div",
      "sql-metadata-detail-line",
      `... ${rows.length - limit} more ${overflowLabel}(s)`,
    );
  }
  root.appendChild(section);
}

function appendMetadataLinks(
  root: HTMLElement,
  links: readonly SqlMetadataTooltipLink[],
  onLinkClick: ((target: SqlMetadataTarget) => void) | undefined,
) {
  if (links.length === 0) {
    return;
  }

  const section = document.createElement("div");
  section.className = "sql-metadata-links";
  appendText(section, "div", "sql-metadata-section-title", "links");
  for (const link of links) {
    const button = document.createElement("button");
    button.className = "sql-metadata-link";
    button.type = "button";
    button.textContent = link.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onLinkClick?.(link.target);
    });
    section.appendChild(button);
  }
  root.appendChild(section);
}

function appendTitle(
  root: HTMLElement,
  target: SqlMetadataTarget,
  onTitleClick: ((target: SqlMetadataTarget) => void) | undefined,
) {
  const title = sqlMetadataTargetTitle(target);
  if (!onTitleClick) {
    appendText(root, "div", "sql-metadata-title", title);
    return;
  }

  const button = document.createElement("button");
  button.className = "sql-metadata-title sql-metadata-title-link";
  button.type = "button";
  button.textContent = title;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onTitleClick(target);
  });
  root.appendChild(button);
}

function appendText(
  root: HTMLElement,
  tag: "div" | "span",
  className: string,
  text: string,
) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  root.appendChild(element);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength).trimEnd()}\n...`;
}
