# Query history

Every query you run is recorded locally, with the SQL, how it went, and
optionally a snapshot of the rows it returned.

## Opening it

| Route | Opens |
| --- | --- |
| Sidebar **History** tab | The panel |
| **View ▸ Show history** / **Hide history** | The panel |
| **View ▸ Open Query History** | The full dialog |
| The expand button inside the History panel (**Open query history**) | The full dialog |
| Command palette ▸ **Open Query History** or **Toggle History Panel** | Either |

There is no keyboard shortcut for query history. You can assign one in
**Settings ▸ Keyboard Shortcuts**.

## What is recorded

Successful **and** failed runs. Cancelled runs are not recorded.

Each entry stores the connection and engine, the SQL, the outcome, the row
count, the elapsed time, whether the result was truncated, the error message
where there was one, and the time it started. Successful runs also keep a
snapshot of the first rows.

Storage is local — browser local storage, nothing server-side and no database.

## Retention

| Setting (Settings ▸ General) | Meaning | Default | Max |
| --- | --- | --- | --- |
| **Query history** | *Number of query runs retained locally. Set to 0 to disable history.* | 200 | 500 |
| **History result rows** | *Rows saved with each successful query. Set to 0 to keep SQL only.* | 50 | 500 |

Setting **Query history** to 0 does not only stop recording — it clears
everything already stored, immediately.

The sidebar list shows at most **25** entries however many are retained; open the
dialog to see the rest.

## Searching

The search box matches case-insensitively across the SQL, the error, the result
columns and the first few stored rows, the status, the engine, and the
connection name. So you can find a query by a value you remember seeing in its
output.

Substring only — no regex.

The sidebar is locked to the active connection. The dialog adds a **Scope**
toggle: **Active** or **All**. The search text is shared between the two.

## Acting on an entry

In the dialog:

| Button | Effect |
| --- | --- |
| **Load** | Puts the SQL in the editor, switching connection if needed, and closes the dialog |
| **Restore result** | Repaints the grid from the stored snapshot without touching the database. Disabled when no rows were retained |
| **Run again** | Re-executes against the database |
| **Delete** | Removes that entry |
| **Clear visible** | Deletes exactly the entries currently shown by your filter, after a confirmation |

**Restore result** shows data as it was when the query ran. It can be
arbitrarily stale — it never re-queries.

**Run again** is disabled when the entry belongs to a different connection, when
that connection is closed, or while another query is running. In the
cross-connection case, use **Load** first.

In the sidebar, clicking an entry loads its SQL. It does not switch connection —
only the dialog does that.

## Gaps

- **No copy button and no export.** The SQL is shown as selectable text; copy it
  by hand. Settings export carries the two retention numbers, never the entries.
- **No favourites, tags, or pinning**, and no way to keep an entry beyond the
  retention window.
- **The sidebar cap of 25 is fixed** and not explained in the UI.
- **History search only scans the first 8 stored rows** of a result, so a value
  further down will not be found.
- **Three labels render broken placeholder text**: the entry list's accessible
  name reads the literal `{count} entries`, the saved-result header reads
  `{count} retained rows`, and the dialog header shows the bare words **Visible
  saved** where a saved/visible count was intended.
- **The "Run again" tooltip contradicts the button.** When an entry belongs to
  another connection the tooltip says to load the SQL first, and the underlying
  action would in fact switch connection — but the button is disabled, so that
  path is unreachable.
