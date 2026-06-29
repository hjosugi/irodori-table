use super::*;

pub(crate) struct QueryExecutor<'a> {
    state: &'a DbState,
}

impl<'a> QueryExecutor<'a> {
    pub(crate) fn new(state: &'a DbState) -> Self {
        Self { state }
    }

    pub(crate) async fn run_managed_with_params(
        self,
        connection_id: String,
        sql: String,
        max_rows: Option<usize>,
        timeout_ms: Option<u64>,
        query_id: Option<String>,
        params: Option<Vec<QueryParameterInput>>,
    ) -> Result<QueryResult, String> {
        run_query_managed_with_params_impl(
            self.state,
            connection_id,
            sql,
            max_rows,
            timeout_ms,
            query_id,
            params,
        )
        .await
    }

    pub(crate) async fn stream_with_params(
        self,
        connection_id: String,
        sql: String,
        max_rows: Option<usize>,
        timeout_ms: Option<u64>,
        query_id: Option<String>,
        params: Option<Vec<QueryParameterInput>>,
        sink: mpsc::Sender<stream::FetchEvent>,
    ) -> Result<stream::StreamSummary, String> {
        run_query_stream_with_params_impl(
            self.state,
            connection_id,
            sql,
            max_rows,
            timeout_ms,
            query_id,
            params,
            sink,
        )
        .await
    }

    pub(crate) async fn cancel(self, query_id: String) -> bool {
        cancel_query_impl(self.state, query_id).await
    }

    pub(crate) async fn explain(
        self,
        connection_id: String,
        sql: String,
        mode: QueryPlanMode,
    ) -> Result<QueryPlanAnalysis, String> {
        explain_query_impl(self.state, connection_id, sql, mode).await
    }
}
