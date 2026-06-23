//! SQL dialect quoting, placeholders, paging, and diagnostics formatting.

const COMMON_KEYWORDS: &[&str] = &[
    "ALL", "ALTER", "AND", "AS", "ASC", "BETWEEN", "BY", "CASE", "CREATE", "DELETE", "DESC",
    "DISTINCT", "DROP", "ELSE", "END", "EXISTS", "FALSE", "FROM", "GROUP", "HAVING", "IN", "INNER",
    "INSERT", "INTO", "IS", "JOIN", "LEFT", "LIKE", "LIMIT", "NOT", "NULL", "OFFSET", "ON", "OR",
    "ORDER", "OUTER", "RIGHT", "SELECT", "SET", "TABLE", "THEN", "TRUE", "UNION", "UPDATE",
    "VALUES", "VIEW", "WHEN", "WHERE", "WITH",
];

const POSTGRES_KEYWORDS: &[&str] = &[
    "BIGSERIAL",
    "ILIKE",
    "JSONB",
    "RETURNING",
    "SERIAL",
    "SIMILAR",
    "UUID",
];
const MYSQL_KEYWORDS: &[&str] = &[
    "AUTO_INCREMENT",
    "ENGINE",
    "LOCK",
    "REPLACE",
    "UNSIGNED",
    "USE",
];
const SQLITE_KEYWORDS: &[&str] = &[
    "AUTOINCREMENT",
    "GLOB",
    "PRAGMA",
    "REINDEX",
    "ROWID",
    "VACUUM",
];
const SQLSERVER_KEYWORDS: &[&str] = &[
    "IDENTITY",
    "MERGE",
    "NVARCHAR",
    "OFFSET",
    "TOP",
    "TRY_CONVERT",
];
const ORACLE_KEYWORDS: &[&str] = &[
    "CONNECT", "DUAL", "FETCH", "MINUS", "ROWNUM", "START", "VARCHAR2",
];
const SNOWFLAKE_KEYWORDS: &[&str] = &["QUALIFY", "SAMPLE", "TABLESAMPLE", "VARIANT", "WAREHOUSE"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Page {
    pub limit: u64,
    pub offset: u64,
}

impl Page {
    pub fn first(limit: u64) -> Self {
        Self { limit, offset: 0 }
    }
}

pub trait SqlDialect: Send + Sync {
    /// Quote an identifier (e.g. table or column name) doubling the close-quote to escape.
    fn quote_identifier(&self, ident: &str) -> String;

    /// Quote each part of a schema-qualified identifier.
    fn quote_qualified_identifier(&self, parts: &[&str]) -> String {
        parts
            .iter()
            .map(|part| self.quote_identifier(part))
            .collect::<Vec<_>>()
            .join(".")
    }

    /// Quote only when an identifier is not a simple unreserved bare word.
    fn quote_identifier_if_needed(&self, ident: &str) -> String {
        if is_bare_identifier(ident) && !self.is_keyword(ident) {
            ident.to_string()
        } else {
            self.quote_identifier(ident)
        }
    }

    /// Positional placeholder for parameters. Postgres uses `$1`, Oracle uses `:1`, others use `?`.
    fn placeholder(&self, n: usize) -> String;

    /// Prefix to explain/analyze query.
    fn explain_prefix(&self, analyze: bool) -> String;

    /// Dialect-specific keywords for offline completion and quote decisions.
    fn extra_keywords(&self) -> &'static [&'static str] {
        &[]
    }

    fn is_keyword(&self, word: &str) -> bool {
        contains_keyword(COMMON_KEYWORDS, word) || contains_keyword(self.extra_keywords(), word)
    }

    /// Append dialect-specific paging to a select-like query.
    fn page_query(&self, sql: &str, page: Page) -> String {
        limit_offset_page(sql, page)
    }
}

pub fn common_keywords() -> &'static [&'static str] {
    COMMON_KEYWORDS
}

pub struct PostgresDialect;
impl SqlDialect for PostgresDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
    fn placeholder(&self, n: usize) -> String {
        format!("${n}")
    }
    fn explain_prefix(&self, analyze: bool) -> String {
        if analyze {
            "EXPLAIN ANALYZE ".to_string()
        } else {
            "EXPLAIN ".to_string()
        }
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        POSTGRES_KEYWORDS
    }
}

pub struct MySqlDialect;
impl SqlDialect for MySqlDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("`{}`", ident.replace('`', "``"))
    }
    fn placeholder(&self, _n: usize) -> String {
        "?".to_string()
    }
    fn explain_prefix(&self, analyze: bool) -> String {
        if analyze {
            "EXPLAIN ANALYZE ".to_string()
        } else {
            "EXPLAIN ".to_string()
        }
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        MYSQL_KEYWORDS
    }
}

pub struct SqliteDialect;
impl SqlDialect for SqliteDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
    fn placeholder(&self, _n: usize) -> String {
        "?".to_string()
    }
    fn explain_prefix(&self, _analyze: bool) -> String {
        "EXPLAIN QUERY PLAN ".to_string()
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        SQLITE_KEYWORDS
    }
}

pub struct SqlServerDialect;
impl SqlDialect for SqlServerDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("[{}]", ident.replace(']', "]]"))
    }
    fn placeholder(&self, _n: usize) -> String {
        "?".to_string()
    }
    fn explain_prefix(&self, _analyze: bool) -> String {
        "EXPLAIN ".to_string()
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        SQLSERVER_KEYWORDS
    }
    fn page_query(&self, sql: &str, page: Page) -> String {
        sql_server_page(sql, page)
    }
}

pub struct OracleDialect;
impl SqlDialect for OracleDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
    fn placeholder(&self, n: usize) -> String {
        format!(":{n}")
    }
    fn explain_prefix(&self, _analyze: bool) -> String {
        "EXPLAIN PLAN FOR ".to_string()
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        ORACLE_KEYWORDS
    }
    fn page_query(&self, sql: &str, page: Page) -> String {
        format!(
            "{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            trim_trailing_semicolon(sql),
            page.offset,
            page.limit
        )
    }
}

pub struct SnowflakeDialect;
impl SqlDialect for SnowflakeDialect {
    fn quote_identifier(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
    fn placeholder(&self, _n: usize) -> String {
        "?".to_string()
    }
    fn explain_prefix(&self, _analyze: bool) -> String {
        "EXPLAIN ".to_string()
    }
    fn extra_keywords(&self) -> &'static [&'static str] {
        SNOWFLAKE_KEYWORDS
    }
}

fn limit_offset_page(sql: &str, page: Page) -> String {
    format!(
        "{} LIMIT {} OFFSET {}",
        trim_trailing_semicolon(sql),
        page.limit,
        page.offset
    )
}

fn sql_server_page(sql: &str, page: Page) -> String {
    let sql = trim_trailing_semicolon(sql);
    if contains_order_by(sql) {
        format!(
            "{sql} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            page.offset, page.limit
        )
    } else {
        format!(
            "{sql} ORDER BY (SELECT 0) OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            page.offset, page.limit
        )
    }
}

fn contains_keyword(keywords: &[&str], word: &str) -> bool {
    keywords
        .iter()
        .any(|keyword| keyword.eq_ignore_ascii_case(word))
}

fn is_bare_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn trim_trailing_semicolon(sql: &str) -> &str {
    sql.trim().trim_end_matches(';').trim_end()
}

fn contains_order_by(sql: &str) -> bool {
    let lower = sql.to_ascii_lowercase();
    lower
        .split_whitespace()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| matches!(pair, ["order", "by"]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_identifier_per_engine() {
        assert_eq!(
            PostgresDialect.quote_identifier("weird\"name"),
            "\"weird\"\"name\""
        );
        assert_eq!(MySqlDialect.quote_identifier("weird`name"), "`weird``name`");
        assert_eq!(
            SqlServerDialect.quote_identifier("weird]name"),
            "[weird]]name]"
        );
        assert_eq!(
            OracleDialect.quote_qualified_identifier(&["APP", "ORDER"]),
            "\"APP\".\"ORDER\""
        );
    }

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(
            PostgresDialect.quote_identifier_if_needed("customer_id"),
            "customer_id"
        );
        assert_eq!(
            PostgresDialect.quote_identifier_if_needed("select"),
            "\"select\""
        );
        assert_eq!(
            PostgresDialect.quote_identifier_if_needed("Order Line"),
            "\"Order Line\""
        );
    }

    #[test]
    fn recognizes_common_and_dialect_keywords_case_insensitively() {
        assert!(PostgresDialect.is_keyword("select"));
        assert!(PostgresDialect.is_keyword("jsonb"));
        assert!(MySqlDialect.is_keyword("auto_increment"));
        assert!(OracleDialect.is_keyword("varchar2"));
        assert!(!SqliteDialect.is_keyword("customer_id"));
    }

    #[test]
    fn renders_limit_offset_paging_for_limit_dialects() {
        assert_eq!(
            PostgresDialect.page_query(
                "select * from t;",
                Page {
                    limit: 50,
                    offset: 100
                }
            ),
            "select * from t LIMIT 50 OFFSET 100"
        );
        assert_eq!(
            MySqlDialect.page_query("select * from t", Page::first(25)),
            "select * from t LIMIT 25 OFFSET 0"
        );
    }

    #[test]
    fn renders_oracle_and_sql_server_paging() {
        assert_eq!(
            OracleDialect.page_query(
                "select * from t",
                Page {
                    limit: 10,
                    offset: 20
                }
            ),
            "select * from t OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"
        );
        assert_eq!(
            SqlServerDialect.page_query(
                "select * from t",
                Page {
                    limit: 10,
                    offset: 20
                }
            ),
            "select * from t ORDER BY (SELECT 0) OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"
        );
        assert_eq!(
            SqlServerDialect.page_query(
                "select * from t order by id",
                Page {
                    limit: 10,
                    offset: 20
                }
            ),
            "select * from t order by id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"
        );
    }
}
