# Import

Turns a data file into `CREATE TABLE` + `INSERT` SQL. **It generates SQL and
stops there** — nothing is written to the database until you run the statements
yourself.

## Starting an import

| Route | Note |
| --- | --- |
| Results toolbar ▸ **Import** | Disabled on read-only connections |
| Objects **+** menu ▸ **New Table from File** | |
| Empty-database view ▸ **Import from file** | |

No command-palette entry, no menu item, no shortcut.

## Formats

| Extension | Behaviour |
| --- | --- |
| `.csv` | Parsed, comma-delimited |
| `.tsv`, `.tab` | Parsed, tab-delimited |
| `.json` | Parsed |
| `.jsonl`, `.ndjson` | Parsed |
| `.sql` | **Loaded straight into the editor.** No preview, no SQL generation |
| `.xls`, `.xlsx` | **Rejected** — *Excel import is not available in the desktop UI yet* |

The file picker offers Excel even though it always refuses it.

Files are read as UTF-8. The first row is always the header; blank headers become
`column_1`, `column_2`, and so on. Column types are inferred as boolean, integer,
real, or text.

At most **10,000 rows** are read. Anything beyond that is dropped, signalled only
by the word *capped* in the preview's row count.

## The preview

Non-SQL files open an **Import** preview showing the file name and detected
format, a **Table** name input (pre-filled from the file name, sanitised to
`[A-Za-z0-9_]`), the first 8 rows, and the full generated SQL, which regenerates
as you edit the table name.

| Button | Effect |
| --- | --- |
| **Copy SQL** | Copies the generated statements |
| **Put SQL in editor** | Replaces the active editor tab's contents and closes the dialog |

**Put SQL in editor** overwrites the tab with no confirmation. Save first.

The output is always `CREATE TABLE IF NOT EXISTS` followed by `INSERT INTO`.
Then run it — `Mod+Enter`, or **Run All** for the whole script.

## Gaps

- **Nothing is executed.** Import is a SQL generator.
- **No column mapping.** Names and types are inferred and cannot be edited. Only
  the table name is adjustable.
- **No delimiter, header, or encoding options.** The delimiter follows the file
  extension, row 1 is always the header, and the encoding is always UTF-8.
- **No append mode.** Every import emits a create-and-insert script; there is no
  insert-only option in the UI.
- **Excel is offered and then refused.**
- **No drag-and-drop for data files.** Dropping a CSV on the editor fails with
  *Only .sql files can be dropped into the editor.* — only `.sql` can be
  dropped.
- **The 10,000-row cap is easy to miss** and there is no warning beyond the word
  *capped*.
- **The dialog is not translated** — it stays English under the Japanese
  locale.
- **Copy SQL fails silently** if the clipboard is unavailable.
- **The sidebar entries depend on the results pane being mounted.** With the
  Results panel closed, **New Table from File** and **Import from file** do
  nothing at all.
