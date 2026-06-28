use std::collections::BTreeMap;

use irodori_sql::params::{detect_parameters, query_signature, ParameterKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::engine::Wire;
use super::{DEFAULT_MAX_ROWS, MAX_RESULT_ROWS, MAX_SQL_BYTES};

/// One query's decoded result: `(column names, rows of JSON cells, truncated)`.
pub(crate) type RowSet = (Vec<String>, Vec<Vec<serde_json::Value>>, bool);

#[derive(Debug, Clone)]
pub(crate) struct RawResultSet {
    pub statement_index: usize,
    pub statement: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

/// One streamed-query event forwarded to the frontend over a Tauri channel. The
/// wire shape is a `type`-tagged union (`columns` | `rows` | `done` | `error`);
/// the matching TypeScript type is hand-written in `src/db-stream.ts` because a
/// Tauri `Channel` argument is outside the generated command surface.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QueryStreamEvent {
    Columns {
        #[serde(rename = "resultSetIndex")]
        result_set_index: usize,
        columns: Vec<String>,
    },
    Rows {
        #[serde(rename = "resultSetIndex")]
        result_set_index: usize,
        rows: Vec<Vec<serde_json::Value>>,
    },
    Done {
        #[serde(rename = "rowCount")]
        row_count: u64,
        truncated: bool,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
        #[serde(rename = "resultSets")]
        result_sets: Vec<QueryStreamResultSetSummary>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStreamResultSetSummary {
    pub result_set_index: usize,
    pub row_count: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    /// True when the result was capped at `max_rows` and more rows remain on the
    /// server, so the UI can offer "load more" / run-to-file instead of silently
    /// hiding data.
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub result_sets: Vec<QueryResultSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryResultSet {
    pub statement_index: usize,
    pub statement: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

/// Outcome of a disk-offloaded run (EXEC-010). The first `in_memory_rows` rows are
/// also streamed to the UI over the channel for an immediate paint; `handle`
/// addresses the retained store so the grid can page the rest from disk via
/// `db_result_window`, and `release` it when the result is replaced.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SpillRunResult {
    /// Opaque id for `db_result_window` / `db_release_result`.
    pub handle: String,
    pub columns: Vec<String>,
    /// Total rows retained (resident + spilled).
    pub total_rows: u64,
    /// Rows kept resident in RAM and streamed to the UI (the first page).
    pub in_memory_rows: u64,
    /// Whether any rows were written to the temp spill file.
    pub spilled: bool,
    /// Whether rows were dropped (offload off and over budget, or the hard ceiling).
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// One page of a retained result, read from RAM and/or the spill file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ResultWindow {
    /// Absolute index of the first returned row.
    pub offset: u64,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum QueryParameterKey {
    Name { name: String },
    Position { position: u32 },
}

impl QueryParameterKey {
    fn from_param_key(key: ParameterKey) -> Self {
        match key {
            ParameterKey::Name(name) => Self::Name { name },
            ParameterKey::Position(position) => Self::Position { position },
        }
    }

    fn to_param_key(&self) -> ParameterKey {
        match self {
            Self::Name { name } => ParameterKey::Name(name.clone()),
            Self::Position { position } => ParameterKey::Position(*position),
        }
    }

    fn id(&self) -> String {
        match self {
            Self::Name { name } => format!("name:{name}"),
            Self::Position { position } => format!("position:{position}"),
        }
    }

    fn label(&self) -> String {
        match self {
            Self::Name { name } => name.clone(),
            Self::Position { position } => format!("${position}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryParameterInput {
    pub key: QueryParameterKey,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryParameterPrompt {
    pub key: QueryParameterKey,
    pub id: String,
    pub label: String,
    pub placeholder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryParameterPromptSet {
    pub signature: String,
    pub prompts: Vec<QueryParameterPrompt>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PreparedQuery {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

pub(crate) fn bounded_query_cap(max_rows: Option<usize>) -> Result<usize, String> {
    let cap = max_rows.unwrap_or(DEFAULT_MAX_ROWS);
    if cap == 0 {
        return Err("maxRows must be at least 1".into());
    }
    if cap > MAX_RESULT_ROWS {
        return Err(format!("maxRows must be at most {MAX_RESULT_ROWS}"));
    }
    Ok(cap)
}

pub(crate) fn query_result_set(raw: RawResultSet, cap: usize) -> QueryResultSet {
    let row_count = raw.rows.len() as u64;
    QueryResultSet {
        statement_index: raw.statement_index,
        statement: raw.statement,
        columns: raw.columns,
        rows: raw.rows,
        row_count,
        elapsed_ms: raw.elapsed_ms,
        truncated: raw.truncated,
        message: raw
            .truncated
            .then(|| format!("result capped at {cap} rows")),
    }
}

pub(crate) fn query_result_from_sets(
    mut result_sets: Vec<QueryResultSet>,
    elapsed_ms: u64,
) -> QueryResult {
    let first = result_sets
        .first()
        .cloned()
        .unwrap_or_else(|| QueryResultSet {
            statement_index: 0,
            statement: String::new(),
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: 0,
            elapsed_ms,
            truncated: false,
            message: None,
        });
    let nested = (result_sets.len() > 1)
        .then(|| std::mem::take(&mut result_sets))
        .unwrap_or_default();
    QueryResult {
        columns: first.columns,
        rows: first.rows,
        row_count: first.row_count,
        elapsed_ms,
        truncated: first.truncated,
        message: first.message,
        result_sets: nested,
    }
}

pub(crate) fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut start = 0;
    let bytes = sql.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'\'' => skip_repeated_quote(bytes, &mut index, b'\''),
            b'"' => skip_repeated_quote(bytes, &mut index, b'"'),
            b'-' if bytes.get(index + 1) == Some(&b'-') => skip_line_comment(bytes, &mut index),
            b'/' if bytes.get(index + 1) == Some(&b'*') => skip_block_comment(bytes, &mut index),
            b'$' => {
                if let Some(tag) = dollar_tag_at(sql, index) {
                    skip_dollar_quoted(sql, &tag, &mut index);
                }
            }
            b';' => {
                let statement = sql[start..index].trim();
                if !statement.is_empty() {
                    statements.push(statement.to_string());
                }
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }

    let tail = sql[start..].trim();
    if !tail.is_empty() {
        statements.push(tail.to_string());
    }
    statements
}

pub(crate) fn sql_may_change_metadata(sql: &str) -> bool {
    split_sql_statements(sql)
        .iter()
        .any(|statement| sql_tokens(statement).any(is_metadata_mutation_keyword))
}

pub(crate) fn sql_may_write(sql: &str) -> bool {
    split_sql_statements(sql)
        .iter()
        .any(|statement| sql_tokens(statement).any(is_write_keyword))
}

fn sql_tokens(sql: &str) -> impl Iterator<Item = String> + '_ {
    SqlTokenIter {
        input: sql.as_bytes(),
        offset: 0,
    }
}

fn is_metadata_mutation_keyword(token: String) -> bool {
    matches!(
        token.as_str(),
        "alter"
            | "analyze"
            | "comment"
            | "copy"
            | "create"
            | "delete"
            | "drop"
            | "grant"
            | "insert"
            | "load"
            | "merge"
            | "refresh"
            | "reindex"
            | "rename"
            | "replace"
            | "revoke"
            | "truncate"
            | "update"
            | "upsert"
            | "vacuum"
    )
}

fn is_write_keyword(token: String) -> bool {
    matches!(
        token.as_str(),
        "alter"
            | "analyze"
            | "call"
            | "comment"
            | "copy"
            | "create"
            | "delete"
            | "do"
            | "drop"
            | "execute"
            | "exec"
            | "grant"
            | "insert"
            | "load"
            | "merge"
            | "refresh"
            | "reindex"
            | "rename"
            | "replace"
            | "revoke"
            | "truncate"
            | "update"
            | "upsert"
            | "vacuum"
    )
}

struct SqlTokenIter<'a> {
    input: &'a [u8],
    offset: usize,
}

impl Iterator for SqlTokenIter<'_> {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        while self.offset < self.input.len() {
            match self.input[self.offset] {
                b'-' if self.input.get(self.offset + 1) == Some(&b'-') => {
                    self.skip_line_comment();
                }
                b'/' if self.input.get(self.offset + 1) == Some(&b'*') => {
                    self.skip_block_comment();
                }
                b'\'' | b'"' | b'`' => {
                    self.skip_quoted(self.input[self.offset]);
                }
                b'$' => {
                    if !self.skip_dollar_quoted() {
                        self.offset += 1;
                    }
                }
                byte if byte.is_ascii_alphabetic() || byte == b'_' => {
                    let start = self.offset;
                    self.offset += 1;
                    while self
                        .input
                        .get(self.offset)
                        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
                    {
                        self.offset += 1;
                    }
                    return Some(
                        String::from_utf8_lossy(&self.input[start..self.offset])
                            .to_ascii_lowercase(),
                    );
                }
                _ => {
                    self.offset += 1;
                }
            }
        }
        None
    }
}

impl SqlTokenIter<'_> {
    fn skip_line_comment(&mut self) {
        self.offset += 2;
        while self
            .input
            .get(self.offset)
            .is_some_and(|byte| !matches!(byte, b'\n' | b'\r'))
        {
            self.offset += 1;
        }
    }

    fn skip_block_comment(&mut self) {
        self.offset += 2;
        while self.offset + 1 < self.input.len() {
            if self.input[self.offset] == b'*' && self.input[self.offset + 1] == b'/' {
                self.offset += 2;
                return;
            }
            self.offset += 1;
        }
        self.offset = self.input.len();
    }

    fn skip_quoted(&mut self, quote: u8) {
        self.offset += 1;
        while self.offset < self.input.len() {
            if self.input[self.offset] == quote {
                self.offset += 1;
                if self.input.get(self.offset) == Some(&quote) {
                    self.offset += 1;
                    continue;
                }
                return;
            }
            self.offset += 1;
        }
    }

    fn skip_dollar_quoted(&mut self) -> bool {
        let start = self.offset;
        self.offset += 1;
        while self
            .input
            .get(self.offset)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            self.offset += 1;
        }
        if self.input.get(self.offset) != Some(&b'$') {
            self.offset = start;
            return false;
        }

        let tag = &self.input[start..=self.offset];
        self.offset += 1;
        while self.offset + tag.len() <= self.input.len() {
            if &self.input[self.offset..self.offset + tag.len()] == tag {
                self.offset += tag.len();
                return true;
            }
            self.offset += 1;
        }
        self.offset = self.input.len();
        true
    }
}

fn skip_repeated_quote(bytes: &[u8], index: &mut usize, quote: u8) {
    *index += 1;
    while *index < bytes.len() {
        if bytes[*index] == quote {
            if bytes.get(*index + 1) == Some(&quote) {
                *index += 2;
                continue;
            }
            break;
        }
        *index += 1;
    }
}

fn skip_line_comment(bytes: &[u8], index: &mut usize) {
    *index += 2;
    while *index < bytes.len() && bytes[*index] != b'\n' {
        *index += 1;
    }
}

fn skip_block_comment(bytes: &[u8], index: &mut usize) {
    *index += 2;
    while *index + 1 < bytes.len() {
        if bytes[*index] == b'*' && bytes[*index + 1] == b'/' {
            *index += 1;
            break;
        }
        *index += 1;
    }
}

fn dollar_tag_at(sql: &str, index: usize) -> Option<String> {
    let rest = sql.get(index..)?;
    if rest.starts_with("$$") {
        return Some("$$".to_string());
    }
    let bytes = rest.as_bytes();
    if bytes.first() != Some(&b'$') {
        return None;
    }
    let mut end = 1;
    while end < bytes.len() {
        let byte = bytes[end];
        if byte == b'$' {
            return (end > 1).then(|| rest[..=end].to_string());
        }
        if !(byte == b'_' || byte.is_ascii_alphanumeric()) {
            return None;
        }
        end += 1;
    }
    None
}

fn skip_dollar_quoted(sql: &str, tag: &str, index: &mut usize) {
    let body_start = *index + tag.len();
    if let Some(offset) = sql[body_start..].find(tag) {
        *index = body_start + offset + tag.len() - 1;
    }
}

pub fn query_parameter_prompt_set(sql: &str) -> Result<QueryParameterPromptSet, String> {
    if sql.len() > MAX_SQL_BYTES {
        return Err(format!("query text must be at most {MAX_SQL_BYTES} bytes"));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut prompts = Vec::new();
    for parameter in detect_parameters(sql) {
        let key = QueryParameterKey::from_param_key(parameter.key());
        if !seen.insert(key.clone()) {
            continue;
        }
        prompts.push(QueryParameterPrompt {
            id: key.id(),
            label: key.label(),
            key,
            placeholder: parameter.placeholder,
        });
    }
    Ok(QueryParameterPromptSet {
        signature: query_signature(sql),
        prompts,
    })
}

fn bind_placeholder(wire: Wire, index: usize) -> String {
    match wire {
        Wire::Postgres => format!("${index}"),
        Wire::SqlServer => format!("@P{index}"),
        Wire::Oracle => format!(":{index}"),
        Wire::Mysql | Wire::Sqlite | Wire::DuckDb => "?".to_string(),
        Wire::Mongo
        | Wire::ClickHouse
        | Wire::Snowflake
        | Wire::BigQuery
        | Wire::Bigtable
        | Wire::Redis
        | Wire::Cassandra
        | Wire::Neo4j
        | Wire::Memgraph
        | Wire::InfluxDb
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Pinecone
        | Wire::Jdbc
        | Wire::Search
        | Wire::Document
        | Wire::KeyValue
        | Wire::CloudSpanner
        | Wire::Graph
        | Wire::TimeSeries
        | Wire::Lakehouse
        | Wire::ObjectStore => "?".to_string(),
    }
}

pub(crate) fn prepare_query(
    wire: Wire,
    sql: &str,
    params: Option<&[QueryParameterInput]>,
) -> Result<PreparedQuery, String> {
    let detected = detect_parameters(sql);
    if detected.is_empty() {
        return Ok(PreparedQuery {
            sql: sql.to_string(),
            params: Vec::new(),
        });
    }

    let supplied = params.ok_or_else(|| "query parameters are required".to_string())?;
    let values = supplied
        .iter()
        .map(|input| (input.key.to_param_key(), input.value.clone()))
        .collect::<BTreeMap<_, _>>();

    if split_sql_statements(sql).len() > 1 {
        return Err("query parameters are supported for one statement at a time".to_string());
    }

    let mut rewritten = String::with_capacity(sql.len() + detected.len() * 2);
    let mut bound = Vec::with_capacity(detected.len());
    let mut cursor = 0;
    for parameter in detected {
        let value = values
            .get(&parameter.key())
            .cloned()
            .ok_or_else(|| format!("missing value for parameter {}", parameter.placeholder))?;
        rewritten.push_str(&sql[cursor..parameter.start]);
        rewritten.push_str(&bind_placeholder(wire, bound.len() + 1));
        cursor = parameter.end;
        bound.push(value);
    }
    rewritten.push_str(&sql[cursor..]);
    Ok(PreparedQuery {
        sql: rewritten,
        params: bound,
    })
}
