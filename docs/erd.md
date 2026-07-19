# ERD

A generated entity-relationship diagram of the connected database. It is
**read-only** — a picture of what the object browser already loaded, with
exports.

## Opening it

| Route | Notes |
| --- | --- |
| `Mod+Shift+D` | **Show ERD** |
| Command palette ▸ **Show ERD** | |
| Sidebar network icon in the objects header | Disabled until metadata is loaded |
| Object context menu ▸ **Show in ERD** | Opens filtered to that object |
| `\erd` or `\erd <search>` in the editor | The only route that fetches metadata on demand |

The title bar reads **ER Diagram**, with a summary of
`{connection} · {tables}/{total} tables · {edges} edges`.

## Filtering

- The filter box (**Filter schemas, tables, columns**) matches schema names,
  table names, qualified names, and every column name and data type.
- Schema chips toggle individual schemas, with **All** and **None**.
- Zoom runs 25%–200%; **Fit** scales the diagram to the viewport.

With nothing matching you get **No tables match the current diagram filters**.

Filters, schema selection, and zoom reset every time the dialog is reopened.

## Exports

| Button | Produces |
| --- | --- |
| **SVG** (copy icon) | Diagram SVG to the clipboard |
| **PNG** (copy icon) | Diagram PNG to the clipboard |
| **SVG** (download icon) | `irodori-erd-<connectionId>-<timestamp>.svg` |
| **PNG** (download icon) | `irodori-erd-<connectionId>-<timestamp>.png` |
| **Spec MD** | `irodori-table-spec-<connectionId>-<timestamp>.md` |
| **Spec JSON** | `irodori-table-spec-<connectionId>-<timestamp>.irodori-schema.json` |
| **Copy Mermaid** | Mermaid `erDiagram` source to the clipboard |

The two **SVG** buttons and the two **PNG** buttons carry the same label; copy
and download are distinguished only by icon and tooltip.

PNG resolution follows your display scaling and is capped; an oversized diagram
fails with a message suggesting SVG instead.

## From diagram to SQL

| Button | Effect |
| --- | --- |
| **Designer** | Opens the current diagram in the [canvas designer](schema-diagram.md) |
| **Create DB** | Generates a runnable `CREATE` script into the editor |
| **Spec to DDL** | Reads a previously exported spec JSON and generates DDL |

Clicking a table box opens the [Schema designer](schema-designer.md) for that
table. Table boxes are keyboard reachable — `Enter` or `Space` does the same.

**Create DB** and **Spec to DDL** **replace the entire contents of the active
editor tab**, with no confirmation. Save your work first.

## Gaps

- **Tables are truncated to 12 columns** in the rendering, shown as *+ N more
  columns*. The hidden columns are missing from the SVG and PNG exports too. The
  limit is not configurable. Mermaid export is the exception — it includes every
  column.
- **Copy Mermaid ignores your filters** and always exports the whole database,
  unlike every other export.
- **Copy Mermaid reports nothing** — no success or failure notice, and it fails
  silently where the clipboard is unavailable.
- **The layout is fixed.** Tables are grid-packed per schema; there is no
  dragging, no manual arrangement, and no way to save a layout.
- **Show in ERD filters by bare table name**, and because the filter also
  matches column names, choosing it on a table called `orders` also surfaces
  every table containing a column named `orders`.
- **Cancelling the native save dialog shows no message.**
- **The round trip through a table spec is lossy** — indexes matching the
  primary key are dropped, foreign keys pointing outside the current filter are
  dropped, and `ON DELETE` is never carried.
- **Several error strings are hardcoded English** inside an otherwise
  translated dialog.
