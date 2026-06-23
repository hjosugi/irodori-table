//! Lightweight SQL parameter detection used before dialect-specific binding.
//!
//! This scanner intentionally avoids rewriting SQL. It only reports placeholders
//! outside string literals, quoted identifiers, and comments so UI/runtime layers
//! can prompt, bind, and remember values without guessing from raw text.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParameterStyle {
    Question,
    DollarNumber,
    ColonName,
    AtName,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryParameter {
    pub style: ParameterStyle,
    pub placeholder: String,
    pub name: Option<String>,
    pub position: Option<u32>,
    pub start: usize,
    pub end: usize,
}

impl QueryParameter {
    pub fn key(&self) -> ParameterKey {
        if let Some(name) = &self.name {
            ParameterKey::Name(name.clone())
        } else {
            ParameterKey::Position(self.position.unwrap_or(0))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum ParameterKey {
    Name(String),
    Position(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParameterValue {
    Null,
    Bool(bool),
    Integer(i64),
    Number(String),
    Text(String),
    Json(String),
}

impl ParameterValue {
    pub fn number(value: impl Into<String>) -> Self {
        Self::Number(value.into())
    }

    pub fn text(value: impl Into<String>) -> Self {
        Self::Text(value.into())
    }

    pub fn json(value: impl Into<String>) -> Self {
        Self::Json(value.into())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParameterValues {
    named: BTreeMap<String, ParameterValue>,
    positional: BTreeMap<u32, ParameterValue>,
}

impl ParameterValues {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_named(mut self, name: impl Into<String>, value: ParameterValue) -> Self {
        self.named.insert(name.into(), value);
        self
    }

    pub fn with_position(mut self, position: u32, value: ParameterValue) -> Self {
        self.positional.insert(position, value);
        self
    }

    pub fn get(&self, key: &ParameterKey) -> Option<&ParameterValue> {
        match key {
            ParameterKey::Name(name) => self.named.get(name),
            ParameterKey::Position(position) => self.positional.get(position),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.named.is_empty() && self.positional.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundParameter {
    pub parameter: QueryParameter,
    pub value: ParameterValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundQuery {
    pub sql: String,
    pub params: Vec<BoundParameter>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParameterBindingError {
    MissingValue {
        key: ParameterKey,
        placeholder: String,
    },
}

impl std::fmt::Display for ParameterBindingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingValue { key, placeholder } => {
                write!(f, "missing value for parameter {placeholder} ({key:?})")
            }
        }
    }
}

impl std::error::Error for ParameterBindingError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParameterPrompt {
    pub key: ParameterKey,
    pub placeholder: String,
    pub remembered_value: Option<ParameterValue>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QueryParameterMemory {
    values_by_signature: BTreeMap<String, ParameterValues>,
}

impl QueryParameterMemory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remember(&mut self, sql: &str, values: ParameterValues) {
        self.values_by_signature
            .insert(query_signature(sql), values);
    }

    pub fn recall(&self, sql: &str) -> Option<&ParameterValues> {
        self.values_by_signature.get(&query_signature(sql))
    }

    pub fn prompts(&self, sql: &str) -> Vec<ParameterPrompt> {
        parameter_prompts(sql, self.recall(sql))
    }

    pub fn clear(&mut self, sql: &str) -> bool {
        self.values_by_signature
            .remove(&query_signature(sql))
            .is_some()
    }
}

pub fn detect_parameters(sql: &str) -> Vec<QueryParameter> {
    let bytes = sql.as_bytes();
    let mut params = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'\'' => i = skip_single_quoted(sql, i),
            b'"' => i = skip_double_quoted(sql, i),
            b'`' => i = skip_backtick_quoted(sql, i),
            b'[' => i = skip_bracket_quoted(sql, i),
            b'-' if bytes.get(i + 1) == Some(&b'-') => i = skip_line_comment(bytes, i),
            b'/' if bytes.get(i + 1) == Some(&b'*') => i = skip_block_comment(bytes, i),
            b'?' if !is_json_question_operator(bytes, i) => {
                params.push(QueryParameter {
                    style: ParameterStyle::Question,
                    placeholder: "?".into(),
                    name: None,
                    position: Some(question_index(&params)),
                    start: i,
                    end: i + 1,
                });
                i += 1;
            }
            b'$' => {
                if let Some((end, position)) = scan_number(bytes, i + 1) {
                    params.push(QueryParameter {
                        style: ParameterStyle::DollarNumber,
                        placeholder: sql[i..end].to_string(),
                        name: None,
                        position: Some(position),
                        start: i,
                        end,
                    });
                    i = end;
                } else {
                    i += 1;
                }
            }
            b':' if !is_postgres_cast(bytes, i) => {
                if let Some(end) = scan_identifier(bytes, i + 1) {
                    params.push(QueryParameter {
                        style: ParameterStyle::ColonName,
                        placeholder: sql[i..end].to_string(),
                        name: Some(sql[i + 1..end].to_string()),
                        position: None,
                        start: i,
                        end,
                    });
                    i = end;
                } else {
                    i += 1;
                }
            }
            b'@' => {
                if let Some(end) = scan_identifier(bytes, i + 1) {
                    params.push(QueryParameter {
                        style: ParameterStyle::AtName,
                        placeholder: sql[i..end].to_string(),
                        name: Some(sql[i + 1..end].to_string()),
                        position: None,
                        start: i,
                        end,
                    });
                    i = end;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    params
}

pub fn bind_parameters(
    sql: &str,
    values: &ParameterValues,
) -> Result<BoundQuery, ParameterBindingError> {
    let parameters = detect_parameters(sql);
    let mut params = Vec::with_capacity(parameters.len());

    for parameter in parameters {
        let key = parameter.key();
        let value =
            values
                .get(&key)
                .cloned()
                .ok_or_else(|| ParameterBindingError::MissingValue {
                    key,
                    placeholder: parameter.placeholder.clone(),
                })?;
        params.push(BoundParameter { parameter, value });
    }

    Ok(BoundQuery {
        sql: sql.to_string(),
        params,
    })
}

pub fn parameter_prompts(
    sql: &str,
    remembered_values: Option<&ParameterValues>,
) -> Vec<ParameterPrompt> {
    let mut seen = BTreeSet::new();
    let mut prompts = Vec::new();

    for parameter in detect_parameters(sql) {
        let key = parameter.key();
        if !seen.insert(key.clone()) {
            continue;
        }
        let remembered_value = remembered_values
            .and_then(|values| values.get(&key))
            .cloned();
        prompts.push(ParameterPrompt {
            key,
            placeholder: parameter.placeholder,
            remembered_value,
        });
    }

    prompts
}

pub fn query_signature(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn question_index(params: &[QueryParameter]) -> u32 {
    params
        .iter()
        .filter(|param| param.style == ParameterStyle::Question)
        .count() as u32
        + 1
}

fn scan_number(bytes: &[u8], start: usize) -> Option<(usize, u32)> {
    let mut end = start;
    while matches!(bytes.get(end), Some(b'0'..=b'9')) {
        end += 1;
    }
    if end == start {
        return None;
    }
    let value = std::str::from_utf8(&bytes[start..end])
        .ok()?
        .parse::<u32>()
        .ok()?;
    Some((end, value))
}

fn scan_identifier(bytes: &[u8], start: usize) -> Option<usize> {
    if !matches!(bytes.get(start), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_')) {
        return None;
    }

    let mut end = start + 1;
    while matches!(
        bytes.get(end),
        Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
    ) {
        end += 1;
    }
    Some(end)
}

fn is_postgres_cast(bytes: &[u8], index: usize) -> bool {
    bytes.get(index + 1) == Some(&b':') || index > 0 && bytes.get(index - 1) == Some(&b':')
}

fn is_json_question_operator(bytes: &[u8], index: usize) -> bool {
    matches!(bytes.get(index + 1), Some(b'|' | b'&'))
}

fn skip_single_quoted(sql: &str, start: usize) -> usize {
    let bytes = sql.as_bytes();
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'\'' {
            if bytes.get(i + 1) == Some(&b'\'') {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    bytes.len()
}

fn skip_double_quoted(sql: &str, start: usize) -> usize {
    skip_repeated_quote(sql.as_bytes(), start, b'"')
}

fn skip_backtick_quoted(sql: &str, start: usize) -> usize {
    skip_repeated_quote(sql.as_bytes(), start, b'`')
}

fn skip_bracket_quoted(sql: &str, start: usize) -> usize {
    let bytes = sql.as_bytes();
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b']' {
            if bytes.get(i + 1) == Some(&b']') {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    bytes.len()
}

fn skip_repeated_quote(bytes: &[u8], start: usize, quote: u8) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == quote {
            if bytes.get(i + 1) == Some(&quote) {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    bytes.len()
}

fn skip_line_comment(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 2;
    while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
        i += 1;
    }
    i
}

fn skip_block_comment(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 2;
    while i + 1 < bytes.len() {
        if bytes[i] == b'*' && bytes[i + 1] == b'/' {
            return i + 2;
        }
        i += 1;
    }
    bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_named_and_positional_parameters_in_order() {
        let params = detect_parameters(
            "select * from orders where account_id = :accountId and status = @status and id = $1 and flag = ?",
        );

        assert_eq!(
            params
                .iter()
                .map(|param| param.placeholder.as_str())
                .collect::<Vec<_>>(),
            vec![":accountId", "@status", "$1", "?"]
        );
        assert_eq!(params[0].name.as_deref(), Some("accountId"));
        assert_eq!(params[1].name.as_deref(), Some("status"));
        assert_eq!(params[2].position, Some(1));
        assert_eq!(params[3].position, Some(1));
    }

    #[test]
    fn ignores_literals_comments_and_quoted_identifiers() {
        let params = detect_parameters(
            "select ':not_param', \"@col\", `?col`, [:$col]\n\
             -- :comment\n\
             /* @comment */\n\
             from t where id = :id",
        );

        assert_eq!(params.len(), 1);
        assert_eq!(params[0].placeholder, ":id");
    }

    #[test]
    fn ignores_postgres_casts_and_json_question_operators() {
        let params = detect_parameters(
            "select payload ?| array['a'], payload ?& array['b'], value::text, value = :value",
        );

        assert_eq!(params.len(), 1);
        assert_eq!(params[0].placeholder, ":value");
    }

    #[test]
    fn tracks_byte_spans() {
        let sql = "select * from t where a = :a and b = ?";
        let params = detect_parameters(sql);

        assert_eq!(&sql[params[0].start..params[0].end], ":a");
        assert_eq!(&sql[params[1].start..params[1].end], "?");
    }

    #[test]
    fn binds_values_without_interpolating_sql_text() {
        let sql = "select * from users where email = :email and id = $1 and active = ?";
        let values = ParameterValues::new()
            .with_named(
                "email",
                ParameterValue::text("person@example.com' or 1=1 --"),
            )
            .with_position(1, ParameterValue::Integer(42));

        let bound = bind_parameters(sql, &values).expect("bound query");

        assert_eq!(bound.sql, sql);
        assert_eq!(
            bound
                .params
                .iter()
                .map(|param| param.parameter.placeholder.as_str())
                .collect::<Vec<_>>(),
            vec![":email", "$1", "?"]
        );
        assert_eq!(
            bound.params[0].value,
            ParameterValue::text("person@example.com' or 1=1 --")
        );
        assert_eq!(bound.params[1].value, ParameterValue::Integer(42));
        assert_eq!(bound.params[2].value, ParameterValue::Integer(42));
    }

    #[test]
    fn reports_missing_values_before_execution() {
        let error =
            bind_parameters("select * from t where id = :id", &ParameterValues::new()).unwrap_err();

        assert_eq!(
            error,
            ParameterBindingError::MissingValue {
                key: ParameterKey::Name("id".to_string()),
                placeholder: ":id".to_string(),
            }
        );
    }

    #[test]
    fn prompts_are_deduplicated_and_include_remembered_values() {
        let sql = "select * from t where id = :id or parent_id = :id and flag = ?";
        let remembered = ParameterValues::new()
            .with_named("id", ParameterValue::Integer(7))
            .with_position(1, ParameterValue::Bool(true));

        let prompts = parameter_prompts(sql, Some(&remembered));

        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0].key, ParameterKey::Name("id".to_string()));
        assert_eq!(
            prompts[0].remembered_value,
            Some(ParameterValue::Integer(7))
        );
        assert_eq!(prompts[1].key, ParameterKey::Position(1));
        assert_eq!(
            prompts[1].remembered_value,
            Some(ParameterValue::Bool(true))
        );
    }

    #[test]
    fn remembers_values_by_normalized_query_signature() {
        let mut memory = QueryParameterMemory::new();
        let sql = "select *\nfrom t where id = :id";
        let same_sql = "select   * from t where id = :id";
        let values = ParameterValues::new().with_named("id", ParameterValue::Integer(9));

        memory.remember(sql, values.clone());

        assert_eq!(memory.recall(same_sql), Some(&values));
        assert_eq!(
            memory.prompts(same_sql)[0].remembered_value,
            Some(ParameterValue::Integer(9))
        );
        assert!(memory.clear(same_sql));
        assert!(memory.recall(sql).is_none());
    }
}
