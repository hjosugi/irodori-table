//! Bounded-memory result storage with optional disk offload (EXEC-010).
//!
//! A [`ResultStore`] keeps the first `memory_budget` rows of a result resident in
//! RAM — the page the desktop grid renders immediately — and spills everything
//! beyond that budget to a throwaway temp SQLite file. Browsing a result far
//! larger than RAM then stays flat in memory the way TablePlus does not: the
//! resident `Vec` never grows past the budget, and the grid pages spilled rows
//! back through [`ResultStore::window`], which reads resident rows from RAM and
//! spilled rows from disk transparently.
//!
//! The temp file is keyed on `idx INTEGER PRIMARY KEY` so a window read is an
//! indexed range scan, never a full materialization, and the file is removed when
//! the store is dropped or explicitly [`ResultStore::close`]d.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::{QueryBuilder, Row, Sqlite};

use super::error::{DbError, DbResult};

/// Rows buffered in RAM before a flush to the spill file. Keeps append latency low
/// while keeping the pending buffer bounded, so memory stays flat while streaming.
const SPILL_FLUSH_ROWS: usize = 4_096;
/// Rows per multi-row `INSERT` when flushing to the spill file. SQLite limits the
/// number of bound parameters per statement (999 by default); 256 rows × 2 columns
/// stays comfortably under that.
const SPILL_INSERT_CHUNK: usize = 256;

/// How a result should treat rows beyond the in-memory budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpillConfig {
    /// Rows kept resident in RAM. Also the size of the prefix streamed to the UI.
    pub memory_budget: usize,
    /// When `true`, rows beyond `memory_budget` spill to a temp SQLite file so the
    /// full result is browsable. When `false`, the result is capped at the budget
    /// (no file is created) and [`ResultStore::truncated`] becomes `true`.
    pub offload_enabled: bool,
    /// Absolute hard ceiling on retained rows, even when offloading, so a runaway
    /// `select *` cannot fill the disk. Rows past this are dropped and flag
    /// truncation.
    pub max_total_rows: usize,
}

impl SpillConfig {
    /// Effective number of rows the producer should fetch for this config.
    pub fn fetch_cap(&self) -> usize {
        if self.offload_enabled {
            self.max_total_rows
        } else {
            self.memory_budget.min(self.max_total_rows)
        }
    }
}

/// A streamed result with the first `memory_budget` rows resident and the rest on
/// disk. Append rows as they stream, [`finalize`](ResultStore::finalize) once, then
/// serve [`window`](ResultStore::window) reads.
pub struct ResultStore {
    columns: Vec<String>,
    config: SpillConfig,
    /// Resident prefix: rows `0..memory_budget`.
    memory: Vec<Vec<Value>>,
    /// Total rows accepted (resident + spilled).
    total: u64,
    /// `true` when rows were dropped because offload is off or the hard ceiling hit.
    truncated: bool,
    /// Buffered spilled rows `(absolute_index, encoded_cells)` awaiting a flush.
    pending: Vec<(u64, String)>,
    spill: Option<SpillFile>,
}

struct SpillFile {
    path: PathBuf,
    pool: SqlitePool,
    rows_on_disk: u64,
}

impl ResultStore {
    pub fn new(columns: Vec<String>, config: SpillConfig) -> Self {
        Self {
            columns,
            config,
            memory: Vec::new(),
            total: 0,
            truncated: false,
            pending: Vec::new(),
            spill: None,
        }
    }

    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    /// Set the column header once it is known (streaming reports it before rows).
    pub fn set_columns(&mut self, columns: Vec<String>) {
        self.columns = columns;
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    /// Rows currently resident in RAM (never exceeds `memory_budget`).
    pub fn memory_len(&self) -> usize {
        self.memory.len()
    }

    /// Whether any rows were written to disk.
    pub fn spilled(&self) -> bool {
        self.spill.is_some() || !self.pending.is_empty()
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    /// Append a batch of streamed rows. Rows up to the budget go to RAM; the rest
    /// spill to disk when offload is enabled, or are dropped (flagging truncation)
    /// when it is not. Returns `true` while the store can accept more rows, `false`
    /// once it is full so the producer can stop early.
    pub async fn append(&mut self, rows: Vec<Vec<Value>>) -> DbResult<bool> {
        for row in rows {
            if self.total as usize >= self.config.max_total_rows {
                self.truncated = true;
                return Ok(false);
            }
            if (self.total as usize) < self.config.memory_budget {
                self.memory.push(row);
            } else if self.config.offload_enabled {
                let idx = self.total;
                let encoded = serde_json::to_string(&row)
                    .map_err(|e| DbError::internal(format!("spill encode failed: {e}")))?;
                self.pending.push((idx, encoded));
                if self.pending.len() >= SPILL_FLUSH_ROWS {
                    self.flush().await?;
                }
            } else {
                // Offload off: cap at the budget and report truncation.
                self.truncated = true;
                return Ok(false);
            }
            self.total += 1;
        }
        Ok(true)
    }

    /// Flush all buffered rows and any pending writes; call once after the stream
    /// completes, before serving [`window`](ResultStore::window) reads.
    pub async fn finalize(&mut self) -> DbResult<()> {
        self.flush().await
    }

    async fn flush(&mut self) -> DbResult<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.ensure_spill().await?;
        let pending = std::mem::take(&mut self.pending);
        let written = pending.len() as u64;
        let spill = self
            .spill
            .as_ref()
            .expect("ensure_spill set the spill file");
        let mut tx = spill
            .pool
            .begin()
            .await
            .map_err(|e| DbError::internal(format!("spill begin failed: {e}")))?;
        for chunk in pending.chunks(SPILL_INSERT_CHUNK) {
            let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO rows(idx, cells) ");
            query.push_values(chunk, |mut row, (idx, cells)| {
                row.push_bind(*idx as i64).push_bind(cells);
            });
            query
                .build()
                .execute(&mut *tx)
                .await
                .map_err(|e| DbError::internal(format!("spill write failed: {e}")))?;
        }
        tx.commit()
            .await
            .map_err(|e| DbError::internal(format!("spill commit failed: {e}")))?;
        if let Some(spill) = self.spill.as_mut() {
            spill.rows_on_disk += written;
        }
        Ok(())
    }

    async fn ensure_spill(&mut self) -> DbResult<()> {
        if self.spill.is_some() {
            return Ok(());
        }
        let path = temp_spill_path();
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            // A throwaway scratch file: durability does not matter, so trade it for
            // append speed while streaming a huge result.
            .journal_mode(SqliteJournalMode::Off)
            .synchronous(SqliteSynchronous::Off);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|e| DbError::internal(format!("spill open failed: {e}")))?;
        sqlx::query("CREATE TABLE rows (idx INTEGER PRIMARY KEY, cells TEXT NOT NULL)")
            .execute(&pool)
            .await
            .map_err(|e| DbError::internal(format!("spill schema failed: {e}")))?;
        self.spill = Some(SpillFile {
            path,
            pool,
            rows_on_disk: 0,
        });
        Ok(())
    }

    /// Read `limit` rows starting at absolute `offset`, transparently reading
    /// resident rows from RAM and spilled rows from disk. Out-of-range requests are
    /// clamped and may return fewer rows than `limit`.
    pub async fn window(&self, offset: u64, limit: usize) -> DbResult<Vec<Vec<Value>>> {
        if limit == 0 || offset >= self.total {
            return Ok(Vec::new());
        }
        let end = offset.saturating_add(limit as u64).min(self.total);
        let budget = self.memory.len() as u64;
        let mut out: Vec<Vec<Value>> = Vec::with_capacity((end - offset) as usize);

        // Resident prefix.
        if offset < budget {
            let mem_end = end.min(budget);
            for i in offset..mem_end {
                out.push(self.memory[i as usize].clone());
            }
        }

        // Spilled suffix.
        let disk_start = offset.max(budget);
        if disk_start < end {
            let spill = self.spill.as_ref().ok_or_else(|| {
                DbError::internal("result has no spill file but a disk row was requested")
            })?;
            let rows =
                sqlx::query("SELECT cells FROM rows WHERE idx >= ? AND idx < ? ORDER BY idx ASC")
                    .bind(disk_start as i64)
                    .bind(end as i64)
                    .fetch_all(&spill.pool)
                    .await
                    .map_err(|e| DbError::internal(format!("spill read failed: {e}")))?;
            for row in rows {
                let cells: String = row
                    .try_get("cells")
                    .map_err(|e| DbError::internal(format!("spill decode failed: {e}")))?;
                let decoded: Vec<Value> = serde_json::from_str(&cells)
                    .map_err(|e| DbError::internal(format!("spill decode failed: {e}")))?;
                out.push(decoded);
            }
        }

        Ok(out)
    }

    /// Close the pool and remove the temp file. Best-effort; also runs on drop.
    /// Takes `&mut self` so a retained store held behind an `Arc<Mutex<..>>` can be
    /// released (the file removed) without moving it out of the registry.
    pub async fn close(&mut self) {
        if let Some(spill) = self.spill.take() {
            spill.pool.close().await;
            remove_spill_file(&spill.path);
        }
    }
}

impl Drop for ResultStore {
    fn drop(&mut self) {
        // The pool is closed asynchronously elsewhere via `close()`; on a plain drop
        // we still unlink the file best-effort (on Unix the open handle keeps the
        // bytes alive until the pool is gone, then they are freed).
        if let Some(spill) = &self.spill {
            remove_spill_file(&spill.path);
        }
    }
}

fn remove_spill_file(path: &Path) {
    let _ = std::fs::remove_file(path);
    // SQLite may leave -wal/-shm siblings; remove them too if present.
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sibling = path.as_os_str().to_os_string();
        sibling.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(sibling));
    }
}

fn temp_spill_path() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("irodori-spill-{pid}-{nanos}-{n}.sqlite"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config(budget: usize, offload: bool) -> SpillConfig {
        SpillConfig {
            memory_budget: budget,
            offload_enabled: offload,
            max_total_rows: 10_000_000,
        }
    }

    fn row(i: u64) -> Vec<Value> {
        vec![json!(i as i64), json!(format!("row_{i}"))]
    }

    async fn fill(store: &mut ResultStore, count: u64, batch: usize) {
        let mut next = 0u64;
        while next < count {
            let end = (next + batch as u64).min(count);
            let rows: Vec<Vec<Value>> = (next..end).map(row).collect();
            store.append(rows).await.expect("append");
            next = end;
        }
        store.finalize().await.expect("finalize");
    }

    #[tokio::test]
    async fn small_result_stays_entirely_in_memory() {
        let mut store = ResultStore::new(vec!["id".into(), "name".into()], config(100, true));
        fill(&mut store, 10, 4).await;
        assert_eq!(store.total(), 10);
        assert_eq!(store.memory_len(), 10);
        assert!(!store.spilled(), "no overflow means no temp file");
        let all = store.window(0, 100).await.expect("window");
        assert_eq!(all.len(), 10);
        assert_eq!(all[0], row(0));
        assert_eq!(all[9], row(9));
    }

    #[tokio::test]
    async fn overflow_spills_to_disk_and_windows_transparently() {
        let mut store = ResultStore::new(vec!["id".into(), "name".into()], config(4, true));
        fill(&mut store, 12, 5).await;
        assert_eq!(store.total(), 12);
        assert_eq!(store.memory_len(), 4, "RAM stays bounded by the budget");
        assert!(store.spilled());
        assert!(!store.truncated());

        // A window spanning the RAM/disk boundary stitches both halves in order.
        let across = store.window(2, 6).await.expect("window");
        assert_eq!(across.len(), 6);
        for (offset, got) in across.iter().enumerate() {
            assert_eq!(got, &row(2 + offset as u64));
        }
        // A pure-disk window reads only spilled rows.
        let tail = store.window(8, 10).await.expect("window");
        assert_eq!(tail.len(), 4);
        assert_eq!(tail[0], row(8));
        assert_eq!(tail[3], row(11));
        // Past the end clamps to empty.
        assert!(store.window(12, 10).await.expect("window").is_empty());
    }

    #[tokio::test]
    async fn offload_disabled_caps_at_budget_without_a_file() {
        let mut store = ResultStore::new(vec!["id".into()], config(3, false));
        fill(&mut store, 20, 7).await;
        assert_eq!(store.total(), 3, "capped at the budget");
        assert_eq!(store.memory_len(), 3);
        assert!(!store.spilled(), "offload off never creates a temp file");
        assert!(store.truncated(), "dropping rows flags truncation");
    }

    #[tokio::test]
    async fn hard_ceiling_truncates_even_when_offloading() {
        let config = SpillConfig {
            memory_budget: 2,
            offload_enabled: true,
            max_total_rows: 6,
        };
        let mut store = ResultStore::new(vec!["id".into()], config);
        fill(&mut store, 100, 8).await;
        assert_eq!(store.total(), 6);
        assert!(store.truncated());
        let all = store.window(0, 100).await.expect("window");
        assert_eq!(all.len(), 6);
        assert_eq!(all[5], row(5));
    }

    #[tokio::test]
    async fn memory_stays_flat_while_total_grows_large() {
        // The anti-TablePlus guarantee: resident RAM is bounded by the budget no
        // matter how many rows stream through, and deep disk pages read correctly.
        let budget = 1_000;
        let total = 60_000;
        let mut store = ResultStore::new(vec!["id".into(), "name".into()], config(budget, true));
        fill(&mut store, total, 2_500).await;

        assert_eq!(store.total(), total);
        assert_eq!(
            store.memory_len(),
            budget,
            "resident rows never exceed the budget regardless of total"
        );
        assert!(store.spilled());

        // Spot-check windows deep in the spilled region.
        for &offset in &[0u64, 999, 1_000, 1_001, 30_000, 59_990] {
            let page = store.window(offset, 5).await.expect("window");
            let expected = (5).min((total - offset) as usize);
            assert_eq!(page.len(), expected, "offset {offset}");
            for (i, got) in page.iter().enumerate() {
                assert_eq!(got, &row(offset + i as u64), "offset {offset} row {i}");
            }
        }
    }

    #[tokio::test]
    async fn close_removes_the_temp_file() {
        let mut store = ResultStore::new(vec!["id".into()], config(1, true));
        fill(&mut store, 10, 4).await;
        let path = store
            .spill
            .as_ref()
            .map(|s| s.path.clone())
            .expect("spilled");
        assert!(path.exists(), "spill file exists while the store is live");
        store.close().await;
        assert!(!path.exists(), "close removes the spill file");
    }
}
