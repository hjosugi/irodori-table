# Migration Studio

Plans a table migration between two engines and generates the SQL, diff queries,
and a runbook to carry it out.

**It never touches a database.** It reads no connections, introspects no schema,
and executes nothing. Every input is typed by hand and every output is text. The
planner is a pure transform: strings in, strings out.

## Opening it

- **Tools ▸ Open Migration Studio**
- Command palette ▸ **Open Migration Studio**

No default keyboard shortcut. The dialog is lazily loaded, so **Loading…** may
flash the first time.

## Inputs

The left column, **Migration inputs**, arrives pre-filled with a worked
Hive-to-Snowflake example so you can see the shape of a plan immediately.

| Field | Default |
| --- | --- |
| **Source** / **Source version** | Apache Hive / `Hive 2/3` |
| **Target** / **Target version** | Snowflake / `Snowflake` |
| **Source table** | `legacy.orders` |
| **Target table** | `analytics.orders` |
| **Key columns** | `order_id`, `line_id` |
| **Compare columns** | six columns |
| **Partition column** | `sales_dt` |
| **Predicate** | `sales_dt >= '2026-01-01'` |
| **Export** | Parquet, CSV, or TSV |
| **Batch rows** | 5,000,000 |
| **Diff limit** | 1,000 |
| **Delimiter** | `|#|` |
| **Normalize whitespace** | On |
| **Normalize case** | Off |

Twelve engines are selectable on each side: Apache Hive, Snowflake, DuckDB /
DuckDB-Wasm, Apache Iceberg REST, AWS S3 Tables, PostgreSQL, Oracle, MySQL,
MariaDB, Redshift, Databricks / Spark SQL, Trino / Presto.

**There is no Build button.** The plan rebuilds on every change, so the header
flickers **Building** as you type.

**Key columns** is required — clearing it makes the plan fail, and the failure
appears inside the dialog with the backend's message in the **Warnings** block.

**Batch rows** and **Diff limit** are silently clamped to their supported ranges;
the input keeps showing whatever you typed.

## Outputs

The right column, **Migration output**, has five tabs:

| Tab | Contents |
| --- | --- |
| **Overview** | **Route**, **Keys**, **Hash columns**, **Hash**, **Warnings**, then a task list, engine notes, and any warnings |
| **Source SQL** | Extract SQL for the source engine |
| **Target SQL** | Load SQL for the target engine |
| **Diff** | Diff *queries* — not diff results |
| **Runbook** | Step-by-step prose procedure |

Tasks are marked ready, manual, or risk.

The footer has **Copy** and either **Put text in editor** (Overview, Runbook) or
**Put SQL in editor** (the three SQL tabs). Putting output in the editor
**replaces the active tab's contents** without confirmation.

## Saving a plan

There is no save or export. To keep a plan, send each tab to the editor in turn
and use **Save As** (`Mod+Shift+S`) — five separate operations, one per tab.

## Gaps

- **Nothing is executed or verified.** Table names, key columns, and compare
  columns are typed by hand and never checked against a real database. The
  **Diff** tab is generated SQL you run yourself.
- **A misleading message appears while the plan is building.** During each
  rebuild the Overview briefly shows a task claiming *"The planner backend is
  unavailable in this build; populate a plan to preview the workflow."* The
  planner is working normally — ignore it unless it persists.
- **No export and no save.** Clipboard or editor only, one tab at a time.
- **The hash algorithm is fixed at MD5** and always displays as MD5, with no
  selector.
- **A null-token placeholder is hidden.** The generated SQL contains
  `__IRODORI_NULL__` as its null sentinel, and there is no field to change it.
- **No debounce.** Every keystroke rebuilds the whole plan.
- **Plan failures are silent outside the dialog** — no notification is raised.
