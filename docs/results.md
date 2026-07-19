# Results

The pane below the editor. A statement that returns rows fills the grid; a
script that returns several result sets gets a **{count} result sets** selector
above it, with **Result set {index}** tabs.

## View modes

A segmented control switches the pane between:

| Mode | Shows |
| --- | --- |
| **Data** | The row grid (default) |
| **Structure** | Column and object metadata for the queried table |
| **Chart** | A chart built from the current result |
| **Graph** | Node/edge rendering, for graph engines |

There is also a WebGL grid path for very large results; when the context cannot
be created the pane says **WebGL unavailable** and falls back.

## Sorting, filtering, and searching

- Click a column header to sort — the tooltip reads **Sort by {column}**.
- **Quick filter** is a single free-text box that matches anywhere in the row.
- **Filter** opens the rule builder. Each rule has a **Column** (or **Any
  column**), an **Operator**, and a **Value**, plus an **Enabled** checkbox and a
  **Remove filter** button. **Add rule** adds another; **Join** picks how rules
  combine; **Clear filters** empties the set. The button shows **{count}
  filters** when any are active.

Operators: contains, not contains, equals, not equals, starts with, ends with,
`>`, `>=`, `<`, `<=`, is null, is not null, is empty, is not empty, and regex.
The four null/empty operators take no value. Comparison is text-based with
numeric awareness; `is_null` matches the literal display value `NULL`, and
`is_empty` matches an empty string — the two are distinct.

With filters active and nothing matching, the grid reads **No rows match
filters** rather than **No rows returned**.

All filtering is client-side over the rows already fetched. It does not add a
`WHERE` clause or re-query.

## Copying

| Command | Shortcut |
| --- | --- |
| **Copy selected cell or row** | `Mod+C` |
| **Copy selected row as TSV** | *(unbound)* |
| **Copy visible result as TSV** | *(unbound)* |
| **Copy SQL INSERTs** | *(unbound)* |

**Copy as** in the toolbar offers the same format list as export.

## Exporting

**Export as** writes the current result to a file. `Mod+Shift+S` runs **Export
Results** when the grid has focus.

| Format | Extension | Notes |
| --- | --- | --- |
| CSV | `.csv` | UTF-8 with BOM |
| TSV | `.tsv` | UTF-8 with BOM |
| JSON | `.json` | Array of objects |
| JSONL | `.jsonl` | One object per line |
| SQL | `.sql` | `INSERT` statements |
| Excel | `.xlsx` | Real binary workbook |
| Excel-compatible | `.xls` | HTML workbook Excel can open, with BOM |
| Markdown | `.md` | Pipe table |

Note the two Excel entries are different things: **Excel** is a genuine `.xlsx`,
**Excel-compatible** is HTML with an `.xls` extension.

Files are named `irodori-<connectionId>-<ISO timestamp>.<ext>`, with `:` and `.`
replaced by `-`. In the packaged app a native Save dialog appears; cancelling it
produces no message.

Parquet and Avro are explicitly rejected with a message naming the supported
formats.

## Row detail

Opens a sidebar for the selected row. **Row Detail** shows **{count} fields**
and offers three views:

- **Fields** — label/value pairs
- **JSON** — the row as a JSON object
- **Tree** — expandable structure for nested values

**Search row fields** filters within the row, and **Copy JSON** copies the
object.

## Structure view

For a result that maps to a single table, **Structure** lists the columns with
**Name**, **Type**, **Null**, **Key**, **Default**, and **Comment**, plus
**Estimated rows**, the **Primary key** (or **No primary key**), **Indexes**
(with **Unique** flags, unnamed ones shown as **(unnamed)**), and **Foreign
keys**. Empty sections say **No indexes** / **No foreign keys**.

## Charts

**Chart** mode plots the current result. Three kinds are supported: **bar**,
**line**, and **scatter**. Axis selection is inferred from column types — date
columns become the x-axis where present, and scatter treats both axes as
continuous. The **BI** side panel (**View ▸ Toggle BI Panel**) previews whether
the current result can be charted and can switch the pane into chart mode.

Charts are display-only. There is no chart export, no saved chart definition,
and no dashboard.

## Editing data

`Mod+E` toggles **Edit data** mode. It requires a single editable table result
and a writable connection — otherwise the tooltip explains **Requires a single
editable table result** or **Read-only connection**.

| Action | Shortcut |
| --- | --- |
| **Add row** | `Mod+Shift+Enter` |
| **Undo staged edit** | `Mod+Z` |
| **Save changes ({count})** | `Mod+S` |

Edits are staged, not written immediately. The toolbar shows the pending count;
**Discard** rolls them back after a confirmation (**Discard {count} unsaved
changes?**). Deleting rows confirms with **Delete {count} rows from {table}?**.
Cell context actions include **Set NULL** and **Empty string**, which are kept
distinct. **Row SQL** generates the SQL for the selected row without running it.

These grid shortcuts share chords with editor commands — `Mod+S`, `Mod+Z`,
`Mod+Shift+Enter` — and are resolved by focus scope, so they do not collide.

## Gaps

- **Filtering and sorting never touch the server.** They reorder and hide rows
  already fetched. A result truncated by the row cap stays truncated; filtering
  cannot reach rows that were not returned.
- **Charts have no export and no configuration persistence.**
- **Several copy commands ship unbound** (marked above).
- **`\export xlsx` is rejected by the query magic** even though `.xlsx` is a
  valid export format from the toolbar. The magic accepts `csv`, `tsv`, `json`,
  `jsonl`, `sql`, `excel`, `markdown` only.
