//! Shared, memory-bounded row streaming for the sqlx-backed engines
//! (Postgres / MySQL / SQLite).
//!
//! Those three differ only in how a cell is decoded by column type; the
//! streaming loop — read rows, capture the header once, stop at `cap` and flag
//! truncation — is identical, so it lives here. Capping mid-stream is the
//! anti-"load a 10M-row table into RAM" guarantee (the TablePlus problem); each
//! engine just supplies its decoder. Engines on other drivers (tiberius, DuckDB)
//! keep their own loops because their row/streaming models differ.

use futures_util::{Stream, TryStreamExt};
use sqlx::{Column, Row};

use super::RowSet;

/// Drain `stream` into a [`RowSet`], decoding each cell with `decode`, keeping at
/// most `cap` rows and setting `truncated` when more remain.
pub(crate) async fn collect_capped<R, S, F>(
    mut stream: S,
    cap: usize,
    decode: F,
) -> Result<RowSet, String>
where
    R: Row,
    S: Stream<Item = Result<R, sqlx::Error>> + Unpin,
    F: Fn(&R, usize) -> serde_json::Value,
{
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if columns.is_empty() {
            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
        }
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let count = row.columns().len();
        let mut cells = Vec::with_capacity(count);
        for i in 0..count {
            cells.push(decode(&row, i));
        }
        rows.push(cells);
    }
    Ok((columns, rows, truncated))
}
