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
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::RowSet;

/// One row's decoded cells.
pub(crate) type Cells = Vec<serde_json::Value>;

/// A unit of streamed output. Column names arrive once (just before the first
/// rows); rows then arrive in capped batches.
pub(crate) enum FetchEvent {
    Columns {
        result_set_index: usize,
        columns: Vec<String>,
    },
    Rows {
        result_set_index: usize,
        rows: Vec<Cells>,
    },
}

/// Per-run streaming controls threaded into an engine's fetch loop: the row cap,
/// the batch size, a cooperative [`CancellationToken`], and the sink the streaming
/// command forwards to the frontend channel.
pub(crate) struct StreamCtx {
    pub cap: usize,
    pub batch_rows: usize,
    pub result_set_index: usize,
    pub token: CancellationToken,
    pub sink: mpsc::Sender<FetchEvent>,
}

/// Outcome of a streamed run — the rows themselves were delivered via the sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamResultSetSummary {
    pub result_set_index: usize,
    pub row_count: u64,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// Outcome of a streamed run — the rows themselves were delivered via the sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamSummary {
    pub result_sets: Vec<StreamResultSetSummary>,
    pub truncated: bool,
    pub row_count: u64,
}

impl StreamCtx {
    pub(crate) fn for_result_set(&self, result_set_index: usize) -> Self {
        Self {
            cap: self.cap,
            batch_rows: self.batch_rows,
            result_set_index,
            token: self.token.clone(),
            sink: self.sink.clone(),
        }
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    pub(crate) async fn columns(&self, columns: Vec<String>) -> Result<(), String> {
        self.send(FetchEvent::Columns {
            result_set_index: self.result_set_index,
            columns,
        })
        .await
    }

    /// Emit a batch of rows; an empty batch is a no-op so callers can flush freely.
    pub(crate) async fn rows(&self, rows: Vec<Cells>) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        self.send(FetchEvent::Rows {
            result_set_index: self.result_set_index,
            rows,
        })
        .await
    }

    async fn send(&self, event: FetchEvent) -> Result<(), String> {
        self.sink
            .send(event)
            .await
            .map_err(|_| "stream receiver closed".to_string())
    }
}

/// Streaming twin of [`collect_capped`]: drive `stream`, emit the header once and
/// rows in `batch_rows`-sized batches through `ctx.sink`, stop at `ctx.cap` (the
/// anti-OOM cap), and check `ctx.token` each row so a cancel stops the fetch
/// promptly — cooperative server-side cancel even for the non-pooled drivers.
pub(crate) async fn stream_capped<R, S, F>(
    mut stream: S,
    ctx: &StreamCtx,
    decode: F,
) -> Result<StreamSummary, String>
where
    R: Row,
    S: Stream<Item = Result<R, sqlx::Error>> + Unpin,
    F: Fn(&R, usize) -> serde_json::Value,
{
    let mut columns_sent = false;
    let mut batch: Vec<Cells> = Vec::new();
    let mut row_count: u64 = 0;
    let mut truncated = false;
    loop {
        if ctx.cancelled() {
            return Err("query cancelled".to_string());
        }
        let Some(row) = stream
            .try_next()
            .await
            .map_err(|e| format!("query failed: {e}"))?
        else {
            break;
        };
        if !columns_sent {
            ctx.columns(row.columns().iter().map(|c| c.name().to_string()).collect())
                .await?;
            columns_sent = true;
        }
        if row_count as usize >= ctx.cap {
            truncated = true;
            break;
        }
        let count = row.columns().len();
        let mut cells = Vec::with_capacity(count);
        for i in 0..count {
            cells.push(decode(&row, i));
        }
        batch.push(cells);
        row_count += 1;
        if batch.len() >= ctx.batch_rows {
            ctx.rows(std::mem::take(&mut batch)).await?;
        }
    }
    ctx.rows(batch).await?;
    // An empty result still needs a header so the grid can render its columns.
    if !columns_sent {
        ctx.columns(Vec::new()).await?;
    }
    Ok(StreamSummary {
        result_sets: vec![StreamResultSetSummary {
            result_set_index: ctx.result_set_index,
            row_count,
            truncated,
            elapsed_ms: 0,
        }],
        truncated,
        row_count,
    })
}

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
