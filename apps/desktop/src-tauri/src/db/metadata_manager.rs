use super::error::DbResult;
use super::state::refresh_metadata_after_query_if_needed;
use super::*;
use crate::jobs::JobState;
use irodori_error::IrodoriError;

pub(crate) struct MetadataManager<'a> {
    state: &'a DbState,
}

impl<'a> MetadataManager<'a> {
    pub(crate) fn new(state: &'a DbState) -> Self {
        Self { state }
    }

    pub(crate) async fn list_objects(self, connection_id: String) -> DbResult<DatabaseMetadata> {
        list_objects_impl(self.state, connection_id).await
    }

    pub(crate) async fn autocomplete(
        self,
        connection_id: String,
        prefix: String,
        schema: Option<String>,
        object: Option<String>,
        limit: Option<usize>,
    ) -> Vec<DbCompletionItem> {
        let now = std::time::SystemTime::now();

        let needs_immediate_fetch = {
            let mut cache = self.state.metadata_cache.lock().await;
            !cache.ensure_fresh(&connection_id, now)
        };

        if needs_immediate_fetch {
            let conn = {
                let guard = self.state.conns.lock().await;
                guard.get(&connection_id).cloned()
            };
            if let Some(conn) = conn {
                let generation = metadata_generation(self.state);
                if let Ok(db_meta) = conn.metadata().await {
                    let _ = upsert_metadata_snapshot_if_current(
                        self.state,
                        &connection_id,
                        &db_meta,
                        generation,
                    )
                    .await;
                }
            }
        } else {
            let is_stale = {
                let cache = self.state.metadata_cache.lock().await;
                cache
                    .snapshot(&connection_id)
                    .map(|s| s.is_stale(now))
                    .unwrap_or(false)
            };
            if is_stale {
                trigger_background_refresh(self.state.clone(), connection_id.clone());
            }
        }

        let cache = self.state.metadata_cache.lock().await;
        let engine = irodori_completion::CompletionEngine::new();
        let mut req =
            irodori_completion::CompletionRequest::new(&connection_id).with_prefix(prefix);
        if let Some(s) = schema {
            req = req.in_schema(s);
        }
        if let Some(o) = object {
            req = req.for_object(o);
        }
        if let Some(l) = limit {
            req.limit = l;
        }

        engine
            .complete(&cache, &req)
            .into_iter()
            .map(|item| DbCompletionItem {
                label: item.label,
                insert_text: item.insert_text,
                kind: match item.kind {
                    irodori_completion::CompletionItemKind::Schema => DbCompletionItemKind::Schema,
                    irodori_completion::CompletionItemKind::Table => DbCompletionItemKind::Table,
                    irodori_completion::CompletionItemKind::View => DbCompletionItemKind::View,
                    irodori_completion::CompletionItemKind::Column => DbCompletionItemKind::Column,
                    irodori_completion::CompletionItemKind::Function => {
                        DbCompletionItemKind::Function
                    }
                    irodori_completion::CompletionItemKind::Procedure => {
                        DbCompletionItemKind::Procedure
                    }
                    irodori_completion::CompletionItemKind::Keyword => {
                        DbCompletionItemKind::Keyword
                    }
                },
                detail: item.detail,
            })
            .collect()
    }

    pub(crate) async fn inspect_object(
        self,
        connection_id: String,
        schema: String,
        object: String,
    ) -> Option<DbInspectionCard> {
        let cache = self.state.metadata_cache.lock().await;
        let card = irodori_completion::inspection::inspect_object(
            &cache,
            &connection_id,
            &schema,
            &object,
        );
        card.map(convert_inspection_card)
    }

    pub(crate) async fn inspect_column(
        self,
        connection_id: String,
        schema: String,
        object: String,
        column: String,
    ) -> Option<DbInspectionCard> {
        let cache = self.state.metadata_cache.lock().await;
        let card = irodori_completion::inspection::inspect_column(
            &cache,
            &connection_id,
            &schema,
            &object,
            &column,
        );
        card.map(convert_inspection_card)
    }

    pub(crate) async fn invalidate_cache(
        self,
        jobs: Option<&JobState>,
        connection_id: String,
        schema: Option<String>,
        object: Option<String>,
    ) -> Result<bool, IrodoriError> {
        let mut cache = self.state.metadata_cache.lock().await;
        let invalidated = if let Some(obj) = object {
            if let Some(sch) = schema {
                cache.invalidate_object(&connection_id, &sch, &obj)
            } else {
                false
            }
        } else if let Some(sch) = schema {
            cache.invalidate_schema(&connection_id, &sch)
        } else {
            cache.invalidate_connection(&connection_id)
        };

        drop(cache);
        if invalidated {
            if let Some(jobs) = jobs {
                super::state::trigger_metadata_refresh_job(
                    self.state.clone(),
                    jobs,
                    connection_id,
                )?;
            } else {
                trigger_background_refresh(self.state.clone(), connection_id);
            }
        }

        Ok(invalidated)
    }

    pub(crate) async fn refresh_after_query_if_needed(self, connection_id: &str, sql: &str) {
        refresh_metadata_after_query_if_needed(self.state, connection_id, sql).await;
    }
}
