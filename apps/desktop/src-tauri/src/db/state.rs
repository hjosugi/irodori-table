use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use irodori_completion::metadata::MetadataCache;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::connection::Connection;
use super::meta::convert_metadata_to_snapshot;
use super::metadata_manager::MetadataManager;
use super::query::{sql_may_change_metadata, sql_may_write};
use super::query_executor::QueryExecutor;
use super::result_spill_manager::{ResultEntry, ResultSpillManager};
use super::DatabaseMetadata;

/// Finished result stores kept for windowed paging before the oldest is evicted
/// (closing its temp file). One per recent run/tab is plenty.
pub(super) const MAX_RETAINED_RESULTS: usize = 16;

/// Open connections keyed by connection id. Lives in Tauri managed state.
#[derive(Clone)]
pub struct DbState {
    pub(super) conns: Arc<Mutex<HashMap<String, Arc<dyn Connection>>>>,
    pub(super) read_only_connections: Arc<Mutex<HashSet<String>>>,
    /// In-flight cancellable queries keyed by a caller-supplied `query_id`, so
    /// `db_cancel` can stop a specific run. Entries are removed when the run ends.
    pub(super) cancels: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub metadata_cache: Arc<Mutex<MetadataCache>>,
    metadata_generation: Arc<AtomicU64>,
    pub(super) tunnels: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Retained disk-offloaded results (EXEC-010), keyed by handle, for windowed
    /// paging. Bounded by `MAX_RETAINED_RESULTS`; evicting an entry closes its file.
    pub(super) results: Arc<Mutex<HashMap<String, ResultEntry>>>,
    /// Monotonic counter for handle generation and oldest-first eviction.
    pub(super) result_seq: Arc<AtomicU64>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            conns: Arc::new(Mutex::new(HashMap::new())),
            read_only_connections: Arc::new(Mutex::new(HashSet::new())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            metadata_cache: Arc::new(Mutex::new(MetadataCache::new())),
            metadata_generation: Arc::new(AtomicU64::new(0)),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            results: Arc::new(Mutex::new(HashMap::new())),
            result_seq: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl DbState {
    pub(crate) fn query_executor(&self) -> QueryExecutor<'_> {
        QueryExecutor::new(self)
    }

    pub(crate) fn metadata_manager(&self) -> MetadataManager<'_> {
        MetadataManager::new(self)
    }

    pub(crate) fn result_spill_manager(&self) -> ResultSpillManager<'_> {
        ResultSpillManager::new(self)
    }
}

pub(super) async fn ensure_connection_can_run_sql(
    state: &DbState,
    connection_id: &str,
    sql: &str,
) -> Result<(), String> {
    if !sql_may_write(sql) || !is_connection_read_only(state, connection_id).await {
        return Ok(());
    }
    Err("read-only connection: write statements are blocked".into())
}

pub(super) async fn ensure_connection_writable(
    state: &DbState,
    connection_id: &str,
) -> Result<(), String> {
    if is_connection_read_only(state, connection_id).await {
        return Err("read-only connection: write operations are blocked".into());
    }
    Ok(())
}

pub(super) fn trigger_background_refresh(state: DbState, connection_id: String) {
    let generation = metadata_generation(&state);
    tokio::spawn(async move {
        let conn = {
            let guard = state.conns.lock().await;
            guard.get(&connection_id).cloned()
        };
        if let Some(conn) = conn {
            match conn.metadata().await {
                Ok(db_meta) => {
                    let _ = upsert_metadata_snapshot_if_current(
                        &state,
                        &connection_id,
                        &db_meta,
                        generation,
                    )
                    .await;
                }
                Err(e) => {
                    eprintln!(
                        "background metadata refresh failed for connection {connection_id}: {e}"
                    );
                }
            }
        }
    });
}

pub(super) fn metadata_generation(state: &DbState) -> u64 {
    state.metadata_generation.load(Ordering::SeqCst)
}

pub(super) async fn upsert_metadata_snapshot_if_current(
    state: &DbState,
    connection_id: &str,
    db_meta: &DatabaseMetadata,
    generation: u64,
) -> bool {
    if metadata_generation(state) != generation {
        return false;
    }

    let mut cache = state.metadata_cache.lock().await;
    if metadata_generation(state) != generation {
        return false;
    }
    let snapshot = convert_metadata_to_snapshot(connection_id, db_meta);
    cache.upsert_snapshot(snapshot);
    let _ = cache.drain_refresh_requests();
    true
}

pub(super) async fn refresh_metadata_after_query_if_needed(
    state: &DbState,
    connection_id: &str,
    sql: &str,
) {
    if !sql_may_change_metadata(sql) {
        return;
    }

    bump_metadata_generation(state);
    state
        .metadata_cache
        .lock()
        .await
        .invalidate_connection(connection_id);
    trigger_background_refresh(state.clone(), connection_id.to_string());
}

async fn is_connection_read_only(state: &DbState, connection_id: &str) -> bool {
    state
        .read_only_connections
        .lock()
        .await
        .contains(connection_id)
}

fn bump_metadata_generation(state: &DbState) {
    state.metadata_generation.fetch_add(1, Ordering::SeqCst);
}
