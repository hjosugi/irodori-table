//! JOB-002 + JOB-004 desktop wiring: index a connection's schema as a real
//! background batch job, and search it.
//!
//! This is the "wire a real workflow into the dashboard" half of JOB-004. The
//! index build runs through the shared batch-operation contract
//! (`irodori_jobs::batch` via `irodori_knowledge::index::build_index`), submitted
//! against the same `JobRuntime` the desktop jobs dashboard already polls — so the
//! job appears there with live progress, is cancellable, and finishes with an
//! output artifact. The resulting index is retained per connection so the UI can
//! search schema objects by name or column.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use irodori_core::{
    run_job, BatchOutcome, BatchResult, IrodoriError, IrodoriErrorKind, JobArtifact, JobKind,
    JobRuntime, JobSpec,
};
use irodori_knowledge::index::{
    build_index_with, Document, IndexBuildConfig, IndexBuildReport, IndexStore,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::db::{list_objects_impl, DatabaseMetadata, DbState};
use crate::jobs::JobState;

/// Retains the most recent schema index per connection so searches can read it
/// after the build job finishes.
#[derive(Clone, Default)]
pub struct SchemaIndexState {
    stores: Arc<Mutex<HashMap<String, IndexStore>>>,
    active_jobs: Arc<Mutex<HashMap<String, String>>>,
    seq: Arc<AtomicU64>,
}

enum SchemaIndexReservation {
    Existing(String),
    Reserved(String),
}

impl SchemaIndexState {
    async fn register(&self, connection_id: &str, store: IndexStore) {
        self.stores
            .lock()
            .await
            .insert(connection_id.to_string(), store);
    }

    async fn get(&self, connection_id: &str) -> Option<IndexStore> {
        self.stores.lock().await.get(connection_id).cloned()
    }

    fn next_job_id(&self, connection_id: &str) -> String {
        let sequence = self.seq.fetch_add(1, Ordering::Relaxed);
        format!("schema-index-{connection_id}-{sequence}")
    }

    async fn reserve_job(&self, jobs: &JobRuntime, connection_id: &str) -> SchemaIndexReservation {
        let mut active_jobs = self.active_jobs.lock().await;
        if let Some(job_id) = active_jobs.get(connection_id).cloned() {
            match jobs.get(&job_id) {
                Some(job) if job.status.is_active() => {
                    return SchemaIndexReservation::Existing(job_id);
                }
                _ => {
                    active_jobs.remove(connection_id);
                }
            }
        }

        let job_id = self.next_job_id(connection_id);
        active_jobs.insert(connection_id.to_string(), job_id.clone());
        SchemaIndexReservation::Reserved(job_id)
    }

    async fn clear_reserved_job(&self, connection_id: &str, job_id: &str) {
        let mut active_jobs = self.active_jobs.lock().await;
        if active_jobs
            .get(connection_id)
            .map(|active_job_id| active_job_id == job_id)
            .unwrap_or(false)
        {
            active_jobs.remove(connection_id);
        }
    }
}

/// One schema search hit returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SchemaSearchHit {
    /// The qualified object the term matched (e.g. `public.users`).
    pub object: String,
    /// How many indexed terms in that object matched.
    pub frequency: u32,
}

/// One document per table/view: its qualified name plus every column name and
/// type, so a term search surfaces matching objects.
fn schema_documents(metadata: &DatabaseMetadata) -> Vec<Document> {
    let mut documents = Vec::new();
    for schema in &metadata.schemas {
        for object in &schema.objects {
            let mut text = format!("{} {}", schema.name, object.name);
            for column in &object.columns {
                text.push(' ');
                text.push_str(&column.name);
                text.push(' ');
                text.push_str(&column.data_type);
            }
            let object_id = if schema.name.is_empty() {
                object.name.clone()
            } else {
                format!("{}.{}", schema.name, object.name)
            };
            documents.push(Document::new(object_id, schema.name.clone(), text));
        }
    }
    documents
}

fn schema_index_spec(connection_id: &str) -> JobSpec {
    JobSpec {
        resumable: true,
        source: Some(connection_id.to_string()),
        ..JobSpec::new(
            JobKind::IndexBuild,
            format!("index schema: {connection_id}"),
        )
    }
}

fn schema_index_config() -> IndexBuildConfig {
    IndexBuildConfig {
        flush_postings: 100_000,
        progress_every_docs: 2_500,
        checkpoint_every_docs: 25_000,
    }
}

async fn run_schema_index_job(
    db: DbState,
    runtime: Arc<JobRuntime>,
    index: SchemaIndexState,
    connection_id: String,
    job_id: String,
    store: IndexStore,
) -> Result<IndexBuildReport, IrodoriError> {
    let job_connection_id = connection_id.clone();
    let result = run_job(&runtime, &job_id, |ctx| async move {
        ctx.report_progress(0, None, "metadata", "loading schema metadata")?;
        let metadata = list_objects_impl(&db, job_connection_id.clone())
            .await
            .map_err(|message| IrodoriError::new(IrodoriErrorKind::Metadata, message))?;
        let documents = schema_documents(&metadata);
        ctx.report_progress(
            0,
            Some(documents.len() as u64),
            "documents",
            "schema metadata loaded",
        )?;
        let report = build_index_with(&ctx, &store, documents, schema_index_config()).await?;
        let outcome = if report.cancelled {
            BatchOutcome::cancelled(format!(
                "cancelled after {} documents",
                report.documents_indexed
            ))
        } else {
            BatchOutcome::completed_with(
                format!(
                    "indexed {} documents ({} postings)",
                    report.documents_indexed, report.postings_written
                ),
                vec![JobArtifact {
                    id: "index".to_string(),
                    name: "inverted-index".to_string(),
                    path: "index_postings".to_string(),
                    media_type: Some("application/x-sqlite3".to_string()),
                    size_bytes: Some(report.postings_written),
                }],
            )
        };
        Ok(BatchResult::new(outcome, report))
    })
    .await
    .map(|(_record, report)| report);
    index.clear_reserved_job(&connection_id, &job_id).await;
    result
}

/// Index a connection's schema in the background. This is intentionally kept out
/// of the UI command surface; app screens should read prebuilt indexes instead
/// of letting users start heavy jobs repeatedly.
pub async fn index_schema_impl(
    db: &DbState,
    jobs: &JobState,
    index: &SchemaIndexState,
    connection_id: String,
) -> Result<String, IrodoriError> {
    let job_id = match index.reserve_job(jobs.runtime(), &connection_id).await {
        SchemaIndexReservation::Existing(job_id) => return Ok(job_id),
        SchemaIndexReservation::Reserved(job_id) => job_id,
    };
    let store = match IndexStore::open_in_memory().await {
        Ok(store) => store,
        Err(error) => {
            index.clear_reserved_job(&connection_id, &job_id).await;
            return Err(error);
        }
    };
    if let Err(error) = jobs
        .runtime()
        .submit_with_id(&job_id, schema_index_spec(&connection_id))
    {
        index.clear_reserved_job(&connection_id, &job_id).await;
        return Err(error);
    }
    index.register(&connection_id, store.clone()).await;

    let runtime = jobs.runtime_arc();
    let spawned_id = job_id.clone();
    let db = db.clone();
    let index = index.clone();
    tokio::spawn(async move {
        let _ = run_schema_index_job(db, runtime, index, connection_id, spawned_id, store).await;
    });
    Ok(job_id)
}

/// Search a connection's retained schema index for `term`.
pub async fn search_schema_impl(
    index: &SchemaIndexState,
    connection_id: String,
    term: String,
    limit: Option<usize>,
) -> Result<Vec<SchemaSearchHit>, IrodoriError> {
    let Some(store) = index.get(&connection_id).await else {
        return Err(IrodoriError::new(
            IrodoriErrorKind::NotFound,
            format!("no schema index for connection: {connection_id}"),
        ));
    };
    let limit = limit.unwrap_or(50).min(500);
    let hits = store
        .search(&term)
        .await?
        .into_iter()
        .take(limit)
        .map(|posting| SchemaSearchHit {
            object: posting.doc_id,
            frequency: posting.frequency,
        })
        .collect();
    Ok(hits)
}

/// Search a connection's retained schema index.
#[tauri::command]
pub async fn db_search_schema(
    index: tauri::State<'_, SchemaIndexState>,
    connection_id: String,
    term: String,
    limit: Option<usize>,
) -> Result<Vec<SchemaSearchHit>, IrodoriError> {
    search_schema_impl(index.inner(), connection_id, term, limit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{connect_impl, run_query_impl, ConnectionProfile, DbEngine};
    use crate::security::SecurityState;
    use irodori_core::JobStatus;
    use tokio::time::{sleep, Duration};

    fn memory_profile(id: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.to_string(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            url: None,
            transport: None,
            read_only: false,
            options: Default::default(),
        }
    }

    #[tokio::test]
    async fn indexes_schema_as_a_job_and_searches_it() {
        let db = DbState::default();
        connect_impl(&db, &SecurityState::default(), memory_profile("idx"))
            .await
            .expect("connect");
        run_query_impl(
            &db,
            "idx".into(),
            "create table users(id integer primary key, email text, full_name text)".into(),
            None,
        )
        .await
        .expect("create users");
        run_query_impl(
            &db,
            "idx".into(),
            "create table orders(id integer primary key, user_id integer, total real)".into(),
            None,
        )
        .await
        .expect("create orders");

        let jobs = JobState::default();
        let index = SchemaIndexState::default();

        let job_id = index_schema_impl(&db, &jobs, &index, "idx".into())
            .await
            .expect("start index");
        let job = wait_for_terminal_job(jobs.runtime(), &job_id).await;

        // The job ran through the batch envelope to a successful terminal state
        // with an output artifact — exactly what the dashboard renders.
        assert_eq!(job.status, JobStatus::Succeeded);
        assert!(!job.artifacts.is_empty());

        // The index is searchable: "email" only appears on `users`.
        let hits = search_schema_impl(&index, "idx".into(), "email".into(), None)
            .await
            .expect("search");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].object.contains("users"));

        // A table name is indexed too, and an unknown term returns nothing.
        let orders = search_schema_impl(&index, "idx".into(), "orders".into(), None)
            .await
            .expect("search");
        assert!(
            orders.iter().any(|hit| hit.object.contains("orders")),
            "expected `orders` table hit, got {orders:?}"
        );
        assert!(
            search_schema_impl(&index, "idx".into(), "nope".into(), None)
                .await
                .expect("search")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn repeated_schema_index_requests_reuse_active_job() {
        let jobs = JobState::default();
        let index = SchemaIndexState::default();

        let job_id = match index.reserve_job(jobs.runtime(), "idx").await {
            SchemaIndexReservation::Reserved(job_id) => job_id,
            SchemaIndexReservation::Existing(_) => panic!("unexpected existing schema index job"),
        };
        jobs.runtime()
            .submit_with_id(&job_id, schema_index_spec("idx"))
            .expect("submit");

        let repeated = index.reserve_job(jobs.runtime(), "idx").await;
        match repeated {
            SchemaIndexReservation::Existing(existing_id) => assert_eq!(existing_id, job_id),
            SchemaIndexReservation::Reserved(new_id) => {
                panic!("expected existing active job, got new reservation {new_id}")
            }
        }
    }

    #[tokio::test]
    async fn searching_without_an_index_is_a_clear_error() {
        let index = SchemaIndexState::default();
        let error = search_schema_impl(&index, "missing".into(), "x".into(), None)
            .await
            .expect_err("no index");
        assert_eq!(error.kind, IrodoriErrorKind::NotFound);
    }

    async fn wait_for_terminal_job(runtime: &JobRuntime, job_id: &str) -> irodori_core::JobRecord {
        for _ in 0..100 {
            let job = runtime.get(job_id).expect("job");
            if job.status.is_terminal() {
                return job;
            }
            sleep(Duration::from_millis(10)).await;
        }
        runtime.get(job_id).expect("job")
    }
}
