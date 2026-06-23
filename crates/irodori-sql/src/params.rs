//! Lightweight SQL parameter detection used before dialect-specific binding.
//!
//! This scanner intentionally avoids rewriting SQL. It only reports placeholders
//! outside string literals, quoted identifiers, and comments so UI/runtime layers
//! can prompt, bind, and remember values without guessing from raw text.

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
}
