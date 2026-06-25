//! Read-only-by-default SQL safety guard.
//!
//! The API refuses anything that could mutate data unless the caller holds the
//! `write` scope AND the source allows writes. Classification is conservative:
//! comments and string literals are blanked before keyword scanning, multiple
//! statements are rejected outright, and only `SELECT`/`VALUES`/`WITH`/`EXPLAIN`
//! (with no write keyword anywhere) count as read-only.

/// How a statement is allowed to be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlClass {
    /// Pure read; safe under the default read-only policy.
    ReadOnly,
    /// Mutates state; requires the `write` scope and a writable source.
    Write,
    /// Never allowed through this API (e.g. multiple statements, empty).
    Forbidden,
}

const WRITE_KEYWORDS: &[&str] = &[
    "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER", "TRUNCATE", "ATTACH",
    "DETACH", "REINDEX", "VACUUM", "PRAGMA", "MERGE", "GRANT", "REVOKE", "BEGIN", "COMMIT",
    "ROLLBACK", "SAVEPOINT", "RELEASE", "UPSERT",
];

/// Classify a single SQL statement.
pub fn classify(sql: &str) -> SqlClass {
    let blanked = blank_strings_and_comments(sql);
    let trimmed = blanked.trim();
    if trimmed.is_empty() {
        return SqlClass::Forbidden;
    }
    if has_extra_statement(&blanked) {
        return SqlClass::Forbidden;
    }

    let first = first_keyword(trimmed);
    match first.as_str() {
        "SELECT" | "VALUES" | "TABLE" => SqlClass::ReadOnly,
        "WITH" | "EXPLAIN" => {
            if contains_write_keyword(trimmed) {
                SqlClass::Write
            } else {
                SqlClass::ReadOnly
            }
        }
        _ => SqlClass::Write,
    }
}

/// A SQL identifier safe to interpolate when wrapped in double quotes. Accepts a
/// single name or a `schema.name` pair; each part must be `[A-Za-z_][A-Za-z0-9_]*`.
pub fn is_valid_identifier(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    name.split('.').all(|part| {
        let mut chars = part.chars();
        match chars.next() {
            Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
            _ => return false,
        }
        chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
    })
}

/// Quote an identifier (already validated) for use in SQL: `schema.tbl` ->
/// `"schema"."tbl"`.
pub fn quote_identifier(name: &str) -> String {
    name.split('.')
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(".")
}

fn first_keyword(sql: &str) -> String {
    sql.chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

fn contains_write_keyword(sql: &str) -> bool {
    let upper = sql.to_ascii_uppercase();
    WRITE_KEYWORDS.iter().any(|kw| has_word(&upper, kw))
}

/// Whole-word search in already-uppercased text.
fn has_word(haystack: &str, word: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut from = 0;
    while let Some(pos) = haystack[from..].find(word) {
        let start = from + pos;
        let end = start + word.len();
        let before_ok = start == 0 || !is_word_byte(bytes[start - 1]);
        let after_ok = end == bytes.len() || !is_word_byte(bytes[end]);
        if before_ok && after_ok {
            return true;
        }
        from = start + 1;
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b == b'_' || b.is_ascii_alphanumeric()
}

/// True if there is a statement separator with real content after it.
fn has_extra_statement(blanked: &str) -> bool {
    if let Some(idx) = blanked.find(';') {
        return blanked[idx + 1..].chars().any(|c| !c.is_whitespace());
    }
    false
}

/// Replace the *contents* of string literals and comments with spaces, preserving
/// length and structure so keyword/`;` scanning never matches inside them.
fn blank_strings_and_comments(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'\'' | b'"' | b'`' => {
                let quote = b;
                out.push(b as char);
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == quote {
                        // doubled quote is an escape inside the string
                        if i + 1 < bytes.len() && bytes[i + 1] == quote {
                            out.push(' ');
                            out.push(' ');
                            i += 2;
                            continue;
                        }
                        out.push(quote as char);
                        i += 1;
                        break;
                    }
                    out.push(' ');
                    i += 1;
                }
            }
            b'-' if i + 1 < bytes.len() && bytes[i + 1] == b'-' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    out.push(' ');
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                out.push(' ');
                out.push(' ');
                i += 2;
                while i < bytes.len() {
                    if bytes[i] == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                        out.push(' ');
                        out.push(' ');
                        i += 2;
                        break;
                    }
                    out.push(if bytes[i] == b'\n' { '\n' } else { ' ' });
                    i += 1;
                }
            }
            _ => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_selects_are_read_only() {
        assert_eq!(classify("SELECT 1"), SqlClass::ReadOnly);
        assert_eq!(classify("  select * from t where a = 'x'"), SqlClass::ReadOnly);
        assert_eq!(classify("VALUES (1,2)"), SqlClass::ReadOnly);
    }

    #[test]
    fn cte_select_is_read_only_but_cte_write_is_write() {
        assert_eq!(
            classify("WITH c AS (SELECT 1) SELECT * FROM c"),
            SqlClass::ReadOnly
        );
        assert_eq!(
            classify("WITH c AS (SELECT 1) DELETE FROM t"),
            SqlClass::Write
        );
    }

    #[test]
    fn mutations_are_write() {
        for sql in [
            "INSERT INTO t VALUES (1)",
            "update t set a = 1",
            "DELETE FROM t",
            "drop table t",
            "ALTER TABLE t ADD COLUMN c int",
            "PRAGMA journal_mode = WAL",
            "attach database 'x' as y",
        ] {
            assert_eq!(classify(sql), SqlClass::Write, "{sql}");
        }
    }

    #[test]
    fn multiple_statements_are_forbidden() {
        assert_eq!(classify("SELECT 1; DROP TABLE t"), SqlClass::Forbidden);
        assert_eq!(classify("SELECT 1;"), SqlClass::ReadOnly); // trailing ; is fine
        assert_eq!(classify("   "), SqlClass::Forbidden);
    }

    #[test]
    fn keywords_inside_strings_and_comments_do_not_count() {
        assert_eq!(classify("SELECT 'delete from t' AS note"), SqlClass::ReadOnly);
        assert_eq!(classify("SELECT 1 -- drop table t"), SqlClass::ReadOnly);
        assert_eq!(classify("SELECT 1 /* insert */ + 1"), SqlClass::ReadOnly);
        // a semicolon inside a string is not a statement separator
        assert_eq!(classify("SELECT ';drop' AS x"), SqlClass::ReadOnly);
    }

    #[test]
    fn identifier_validation() {
        assert!(is_valid_identifier("users"));
        assert!(is_valid_identifier("_t1"));
        assert!(is_valid_identifier("public.users"));
        assert!(!is_valid_identifier("users; drop"));
        assert!(!is_valid_identifier("1users"));
        assert!(!is_valid_identifier("user-name"));
        assert!(!is_valid_identifier(""));
        assert_eq!(quote_identifier("public.users"), "\"public\".\"users\"");
    }
}
