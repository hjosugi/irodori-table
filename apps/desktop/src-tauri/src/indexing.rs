//! JOB-002 + JOB-004 desktop wiring: index a connection's schema as a real
//! background batch job, and search it.
//!
//! This is the "wire a real workflow into the dashboard" half of JOB-004. The
//! index build runs through the shared batch-operation contract
//! (`irodori_core::batch` via `irodori_knowledge::index::build_index`), submitted
//! against the same `JobRuntime` the desktop jobs dashboard already polls — so the
//! job appears there with live progress, is cancellable, and finishes with an
//! output artifact. The resulting index is retained per connection so the UI can
//! search schema objects by name or column.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use irodori_core::{IrodoriError, IrodoriErrorKind, JobKind, JobRuntime, JobSpec};
use irodori_knowledge::index::{build_index, Document, IndexBuildConfig, IndexStore};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::db::{list_objects_impl, DatabaseMetadata, DbState};
use crate::jobs::JobState;

/// Retains the most recent schema index per connection so searches can read it
/// after the build job finishes.
#[derive(Default)]
pub struct SchemaIndexState {
    stores: Mutex<HashMap<String, IndexStore>>,
    seq: AtomicU64,
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
        ..JobSpec::new(JobKind::IndexBuild, format!("index schema: {connection_id}"))
    }
}

/// Load metadata, build documents, open + register an index store, and submit the
/// job. The actual build is run separately so the command can background it while
/// tests await it deterministically.
async fn prepare_schema_index(
    db: &DbState,
    jobs: &JobRuntime,
    index: &SchemaIndexState,
    connection_id: String,
) -> Result<(String, IndexStore, Vec<Document>), IrodoriError> {
    let metadata = list_objects_impl(db, connection_id.clone())
        .await
        .map_err(IrodoriError::from)?;
    let documents = schema_documents(&metadata);
    let store = IndexStore::open_in_memory().await?;
    index.register(&connection_id, store.clone()).await;
    let job_id = index.next_job_id(&connection_id);
    jobs.submit_with_id(&job_id, schema_index_spec(&connection_id))?;
    Ok((job_id, store, documents))
}

/// Index a connection's schema in the background. Returns the job id immediately;
/// progress, cancellation, and the output artifact are visible in the jobs
/// dashboard while the build runs.
pub async fn index_schema_impl(
    db: &DbState,
    jobs: &JobState,
    index: &SchemaIndexState,
    connection_id: String,
) -> Result<String, IrodoriError> {
    let (job_id, store, documents) =
        prepare_schema_index(db, jobs.runtime(), index, connection_id).await?;
    let runtime = jobs.runtime_arc();
    let spawned_id = job_id.clone();
    tokio::spawn(async move {
        let _ = build_index(
            &runtime,
            &spawned_id,
            &store,
            documents,
            IndexBuildConfig::default(),
        )
        .await;
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

/// Start a background schema-index job; returns the job id for the dashboard.
#[tauri::command]
pub async fn db_index_schema(
    db: tauri::State<'_, DbState>,
    jobs: tauri::State<'_, JobState>,
    index: tauri::State<'_, SchemaIndexState>,
    connection_id: String,
) -> Result<String, IrodoriError> {
    index_schema_impl(db.inner(), jobs.inner(), index.inner(), connection_id).await
}

/// Search a connection's schema index built by `db_index_schema`.
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

        // Run the build inline (no spawn) so the test is deterministic.
        let (job_id, store, documents) =
            prepare_schema_index(&db, jobs.runtime(), &index, "idx".into())
                .await
                .expect("prepare");
        assert!(documents.len() >= 2, "indexed both tables");
        build_index(
            jobs.runtime(),
            &job_id,
            &store,
            documents,
            IndexBuildConfig::default(),
        )
        .await
        .expect("build");

        // The job ran through the batch envelope to a successful terminal state
        // with an output artifact — exactly what the dashboard renders.
        let job = jobs.runtime().get(&job_id).expect("job");
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
        assert!(orders.iter().any(|hit| hit.object.contains("orders")));
        assert!(search_schema_impl(&index, "idx".into(), "nope".into(), None)
            .await
            .expect("search")
            .is_empty());
    }

    #[tokio::test]
    async fn searching_without_an_index_is_a_clear_error() {
        let index = SchemaIndexState::default();
        let error = search_schema_impl(&index, "missing".into(), "x".into(), None)
            .await
            .expect_err("no index");
        assert_eq!(error.kind, IrodoriErrorKind::NotFound);
    }
}
