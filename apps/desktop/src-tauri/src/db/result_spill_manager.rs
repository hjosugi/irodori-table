use std::sync::Arc;

use super::error::DbResult;
use super::runner::release_results_for_connection;
use super::spill::ResultStore;
use super::*;
use tokio::sync::{mpsc, Mutex};

/// A retained result store plus the bookkeeping eviction and disconnect-cleanup
/// need.
pub(super) struct ResultEntry {
    pub(super) seq: u64,
    pub(super) connection_id: String,
    pub(super) store: Arc<Mutex<ResultStore>>,
}

pub(crate) struct ResultSpillManager<'a> {
    state: &'a DbState,
}

impl<'a> ResultSpillManager<'a> {
    pub(crate) fn new(state: &'a DbState) -> Self {
        Self { state }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn run_query_spill(
        self,
        connection_id: String,
        sql: String,
        config: SpillConfig,
        timeout_ms: Option<u64>,
        query_id: Option<String>,
        params: Option<Vec<QueryParameterInput>>,
        ui_sink: mpsc::Sender<stream::FetchEvent>,
    ) -> DbResult<SpillRunResult> {
        run_query_spill_impl(
            self.state,
            connection_id,
            sql,
            config,
            timeout_ms,
            query_id,
            params,
            ui_sink,
        )
        .await
    }

    pub(crate) async fn result_window(
        self,
        handle: String,
        offset: u64,
        limit: usize,
    ) -> DbResult<ResultWindow> {
        result_window_impl(self.state, handle, offset, limit).await
    }

    pub(crate) async fn release_result(self, handle: String) -> bool {
        release_result_impl(self.state, handle).await
    }

    pub(crate) async fn release_for_connection(self, connection_id: &str) {
        release_results_for_connection(self.state, connection_id).await;
    }
}
