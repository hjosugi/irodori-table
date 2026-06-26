//! CMPL-003 — context-aware statement analysis for completion.
//!
//! A lightweight, dialect-agnostic analyzer that walks a SQL statement and pulls
//! out the things completion needs to resolve a qualified name (`alias.`):
//!
//! - **table references** in `FROM`/`JOIN` with their aliases
//!   (`from users u`, `join orders as o`),
//! - **CTE definitions** with their output columns (`with c (a, b) as (...)` or
//!   inferred from the inner `select` projection),
//! - **derived tables** (subqueries in `FROM`) with their projected columns
//!   (`from (select x, y from t) s`).
//!
//! It is deliberately a tolerant scope extractor, not a full SQL parser: it favors
//! recall on the common shapes completion sees while typing over strict grammar
//! coverage. [`StatementContext::resolve`] then maps a qualifier to a real table
//! (whose columns come from the metadata cache) or a fixed column list (CTE /
//! subquery).

/// A `FROM`/`JOIN` table reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableRef {
    pub schema: Option<String>,
    pub name: String,
    pub alias: Option<String>,
}

/// A `WITH` common-table-expression and the columns it exposes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CteDef {
    pub name: String,
    /// Output columns; empty when they could not be inferred (e.g. `select *`).
    pub columns: Vec<String>,
}

/// A subquery used as a table in `FROM`, with its projected columns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedTable {
    pub alias: String,
    pub columns: Vec<String>,
}

/// What a qualifier resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSource {
    /// A real table/view; its columns come from the metadata cache.
    Table {
        schema: Option<String>,
        name: String,
    },
    /// A fixed set of columns (CTE or subquery projection).
    Columns(Vec<String>),
}

/// Everything the analyzer extracted from a statement.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StatementContext {
    pub ctes: Vec<CteDef>,
    pub tables: Vec<TableRef>,
    pub derived: Vec<DerivedTable>,
}

impl StatementContext {
    /// Resolve a qualifier (an alias or a bare table/CTE/subquery name) to its
    /// source. Case-insensitive.
    pub fn resolve(&self, qualifier: &str) -> Option<ResolvedSource> {
        let q = qualifier.trim();
        if q.is_empty() {
            return None;
        }
        // Subquery aliases first (most specific).
        if let Some(derived) = self
            .derived
            .iter()
            .find(|d| d.alias.eq_ignore_ascii_case(q))
        {
            return Some(ResolvedSource::Columns(derived.columns.clone()));
        }
        // Table references: match the alias, or the bare name when unaliased.
        for table in &self.tables {
            let matches_alias = table
                .alias
                .as_deref()
                .is_some_and(|a| a.eq_ignore_ascii_case(q));
            let matches_name = table.alias.is_none() && table.name.eq_ignore_ascii_case(q);
            if matches_alias || matches_name {
                // A `FROM cte` reference resolves to the CTE's columns.
                if let Some(cte) = self.ctes.iter().find(|c| c.name.eq_ignore_ascii_case(&table.name))
                {
                    return Some(ResolvedSource::Columns(cte.columns.clone()));
                }
                return Some(ResolvedSource::Table {
                    schema: table.schema.clone(),
                    name: table.name.clone(),
                });
            }
        }
        // A CTE referenced directly by name.
        if let Some(cte) = self.ctes.iter().find(|c| c.name.eq_ignore_ascii_case(q)) {
            return Some(ResolvedSource::Columns(cte.columns.clone()));
        }
        None
    }

    /// Names completion can suggest as sources in the current statement: table
    /// aliases (or bare names), CTE names, and subquery aliases.
    pub fn source_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for table in &self.tables {
            names.push(table.alias.clone().unwrap_or_else(|| table.name.clone()));
        }
        for cte in &self.ctes {
            names.push(cte.name.clone());
        }
        for derived in &self.derived {
            names.push(derived.alias.clone());
        }
        names.sort();
        names.dedup();
        names
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    /// An unquoted word (identifier or keyword); compared case-insensitively.
    Word(String),
    /// A quoted identifier (`"x"`, `` `x` ``, `[x]`) → its inner name.
    Quoted(String),
    LParen,
    RParen,
    Comma,
    Dot,
    Star,
    /// Any other operator/punctuation character; content is not needed.
    Symbol,
    /// A string literal (`'...'`); content is not needed.
    StringLit,
}

impl Token {
    /// The identifier text for `Word`/`Quoted`, else `None`.
    fn ident(&self) -> Option<&str> {
        match self {
            Token::Word(w) => Some(w),
            Token::Quoted(q) => Some(q),
            _ => None,
        }
    }

    fn is_keyword(&self, keyword: &str) -> bool {
        matches!(self, Token::Word(w) if w.eq_ignore_ascii_case(keyword))
    }
}

fn tokenize(sql: &str) -> Vec<Token> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\'' {
                        if bytes.get(i + 1) == Some(&b'\'') {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                tokens.push(Token::StringLit);
            }
            b'"' | b'`' => {
                let close = c;
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i] != close {
                    i += 1;
                }
                let inner = sql[start..i.min(sql.len())].to_string();
                i += 1;
                tokens.push(Token::Quoted(inner));
            }
            b'[' => {
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i] != b']' {
                    i += 1;
                }
                let inner = sql[start..i.min(sql.len())].to_string();
                i += 1;
                tokens.push(Token::Quoted(inner));
            }
            b'(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            b')' => {
                tokens.push(Token::RParen);
                i += 1;
            }
            b',' => {
                tokens.push(Token::Comma);
                i += 1;
            }
            b'.' => {
                tokens.push(Token::Dot);
                i += 1;
            }
            b'*' => {
                tokens.push(Token::Star);
                i += 1;
            }
            _ if c == b'_' || c.is_ascii_alphanumeric() => {
                let start = i;
                while i < bytes.len()
                    && (bytes[i] == b'_' || bytes[i] == b'$' || bytes[i].is_ascii_alphanumeric())
                {
                    i += 1;
                }
                tokens.push(Token::Word(sql[start..i].to_string()));
            }
            _ => {
                tokens.push(Token::Symbol);
                i += 1;
            }
        }
    }
    tokens
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/// Keywords that end a table reference / cannot be an alias.
const REF_STOP_KEYWORDS: &[&str] = &[
    "where", "group", "order", "having", "limit", "offset", "union", "intersect", "except", "join",
    "inner", "left", "right", "full", "outer", "cross", "on", "using", "as", "natural", "into",
    "values", "set", "returning", "window", "qualify", "fetch",
];

fn is_stop_keyword(token: &Token) -> bool {
    matches!(token, Token::Word(w) if REF_STOP_KEYWORDS.iter().any(|k| w.eq_ignore_ascii_case(k)))
}

/// Analyze a statement into its completion-relevant scope.
pub fn analyze_statement(sql: &str) -> StatementContext {
    let tokens = tokenize(sql);
    let mut context = StatementContext::default();

    if tokens.first().is_some_and(|t| t.is_keyword("with")) {
        parse_ctes(&tokens, 1, &mut context);
    }
    parse_table_refs(&tokens, &mut context);
    context
}

/// Parse `name [(cols)] AS ( subquery )` entries after a leading `WITH`.
fn parse_ctes(tokens: &[Token], mut i: usize, context: &mut StatementContext) {
    loop {
        // CTE name.
        let Some(name) = tokens.get(i).and_then(Token::ident) else {
            return;
        };
        let name = name.to_string();
        i += 1;

        // Optional explicit column list: ( a, b, c )
        let mut explicit_columns = Vec::new();
        if matches!(tokens.get(i), Some(Token::LParen)) {
            let (cols, next) = read_ident_list(tokens, i + 1);
            explicit_columns = cols;
            i = next;
        }

        // Expect AS.
        if !tokens.get(i).is_some_and(|t| t.is_keyword("as")) {
            return;
        }
        i += 1;

        // Expect the subquery in parens.
        if !matches!(tokens.get(i), Some(Token::LParen)) {
            return;
        }
        let (inner, after) = paren_span(tokens, i);
        let columns = if explicit_columns.is_empty() {
            projection_columns(inner)
        } else {
            explicit_columns
        };
        context.ctes.push(CteDef { name, columns });
        i = after;

        // Another CTE?
        if matches!(tokens.get(i), Some(Token::Comma)) {
            i += 1;
            continue;
        }
        return;
    }
}

/// Scan the whole token stream for `FROM`/`JOIN` and collect their table refs.
fn parse_table_refs(tokens: &[Token], context: &mut StatementContext) {
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i].is_keyword("from") {
            i = parse_ref_list(tokens, i + 1, context, true);
        } else if tokens[i].is_keyword("join") {
            i = parse_ref_list(tokens, i + 1, context, false);
        } else {
            i += 1;
        }
    }
}

/// Parse one ref (JOIN) or a comma-separated list (FROM). Returns the index after.
fn parse_ref_list(
    tokens: &[Token],
    mut i: usize,
    context: &mut StatementContext,
    allow_comma: bool,
) -> usize {
    loop {
        i = parse_one_ref(tokens, i, context);
        if allow_comma && matches!(tokens.get(i), Some(Token::Comma)) {
            i += 1;
            continue;
        }
        return i;
    }
}

fn parse_one_ref(tokens: &[Token], i: usize, context: &mut StatementContext) -> usize {
    match tokens.get(i) {
        // Derived table: ( subquery ) [AS] alias
        Some(Token::LParen) => {
            let (inner, after) = paren_span(tokens, i);
            let columns = projection_columns(inner);
            let (alias, next) = read_optional_alias(tokens, after);
            if let Some(alias) = alias {
                context.derived.push(DerivedTable { alias, columns });
            }
            next
        }
        // Named table: [schema .] name [AS] alias
        Some(token) if token.ident().is_some() => {
            let first = token.ident().unwrap().to_string();
            let mut idx = i + 1;
            let (schema, name) = if matches!(tokens.get(idx), Some(Token::Dot)) {
                match tokens.get(idx + 1).and_then(Token::ident) {
                    Some(second) => {
                        idx += 2;
                        (Some(first), second.to_string())
                    }
                    None => (None, first),
                }
            } else {
                (None, first)
            };
            let (alias, next) = read_optional_alias(tokens, idx);
            context.tables.push(TableRef {
                schema,
                name,
                alias,
            });
            next
        }
        _ => i + 1,
    }
}

/// Read an optional alias at `i`: `AS x` or a bare `x` (unless `x` is a keyword).
fn read_optional_alias(tokens: &[Token], i: usize) -> (Option<String>, usize) {
    if tokens.get(i).is_some_and(|t| t.is_keyword("as")) {
        if let Some(alias) = tokens.get(i + 1).and_then(Token::ident) {
            return (Some(alias.to_string()), i + 2);
        }
        return (None, i + 1);
    }
    match tokens.get(i) {
        Some(token) if token.ident().is_some() && !is_stop_keyword(token) => {
            (Some(token.ident().unwrap().to_string()), i + 1)
        }
        _ => (None, i),
    }
}

/// Read `a, b, c )` — identifiers up to the closing paren. Returns the names and
/// the index after the `)`.
fn read_ident_list(tokens: &[Token], mut i: usize) -> (Vec<String>, usize) {
    let mut names = Vec::new();
    while i < tokens.len() {
        match &tokens[i] {
            Token::RParen => return (names, i + 1),
            Token::Comma => i += 1,
            token if token.ident().is_some() => {
                names.push(token.ident().unwrap().to_string());
                i += 1;
            }
            _ => i += 1,
        }
    }
    (names, i)
}

/// Given the index of a `(`, return the tokens inside it and the index just after
/// the matching `)`.
fn paren_span(tokens: &[Token], open: usize) -> (&[Token], usize) {
    debug_assert!(matches!(tokens.get(open), Some(Token::LParen)));
    let mut depth = 0;
    let mut i = open;
    while i < tokens.len() {
        match tokens[i] {
            Token::LParen => depth += 1,
            Token::RParen => {
                depth -= 1;
                if depth == 0 {
                    return (&tokens[open + 1..i], i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    (&tokens[open + 1..], tokens.len())
}

/// Infer output column names from a `SELECT` projection: the tokens between the
/// (depth-0) `select` and its `from`, split on top-level commas.
fn projection_columns(tokens: &[Token]) -> Vec<String> {
    // Locate the depth-0 SELECT ... FROM span.
    let mut depth = 0;
    let mut select_at = None;
    let mut from_at = tokens.len();
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::LParen => depth += 1,
            Token::RParen => depth -= 1,
            Token::Word(_) if depth == 0 && select_at.is_none() && token.is_keyword("select") => {
                select_at = Some(i + 1);
            }
            Token::Word(_) if depth == 0 && select_at.is_some() && token.is_keyword("from") => {
                from_at = i;
                break;
            }
            _ => {}
        }
    }
    let Some(start) = select_at else {
        return Vec::new();
    };
    let projection = &tokens[start..from_at];

    let mut columns = Vec::new();
    for item in split_top_level_commas(projection) {
        if let Some(name) = projection_item_name(item) {
            columns.push(name);
        }
    }
    columns
}

/// Output name of one projection item: `expr AS x` → x; otherwise the last bare
/// identifier (covers `col`, `t.col` → col, and `expr alias` → alias). Items that
/// end in `*`, a paren, or a literal yield no inferable name.
fn projection_item_name(item: &[Token]) -> Option<String> {
    // `... AS name` at depth 0.
    let mut depth = 0;
    for (i, token) in item.iter().enumerate() {
        match token {
            Token::LParen => depth += 1,
            Token::RParen => depth -= 1,
            Token::Word(_) if depth == 0 && token.is_keyword("as") => {
                return item.get(i + 1).and_then(Token::ident).map(str::to_string);
            }
            _ => {}
        }
    }
    // Otherwise the final token, if it is a plain identifier that is not a keyword.
    match item.last() {
        Some(token) if token.ident().is_some() && !is_stop_keyword(token) => {
            Some(token.ident().unwrap().to_string())
        }
        _ => None,
    }
}

fn split_top_level_commas(tokens: &[Token]) -> Vec<&[Token]> {
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut start = 0;
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::LParen => depth += 1,
            Token::RParen => depth -= 1,
            Token::Comma if depth == 0 => {
                parts.push(&tokens[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < tokens.len() {
        parts.push(&tokens[start..]);
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(sql: &str) -> StatementContext {
        analyze_statement(sql)
    }

    #[test]
    fn extracts_table_aliases_from_and_join() {
        let c = ctx("select * from public.users u join orders as o on u.id = o.user_id");
        assert_eq!(c.tables.len(), 2);
        assert_eq!(
            c.tables[0],
            TableRef {
                schema: Some("public".into()),
                name: "users".into(),
                alias: Some("u".into()),
            }
        );
        assert_eq!(
            c.tables[1],
            TableRef {
                schema: None,
                name: "orders".into(),
                alias: Some("o".into()),
            }
        );
        // Alias resolves to the real table (columns come from the cache).
        assert_eq!(
            c.resolve("u"),
            Some(ResolvedSource::Table {
                schema: Some("public".into()),
                name: "users".into()
            })
        );
        // Case-insensitive, and the bare table name resolves too.
        assert_eq!(
            c.resolve("O"),
            Some(ResolvedSource::Table {
                schema: None,
                name: "orders".into()
            })
        );
    }

    #[test]
    fn unaliased_table_resolves_by_name_but_not_a_wrong_name() {
        let c = ctx("select * from accounts where x = 1");
        assert_eq!(
            c.resolve("accounts"),
            Some(ResolvedSource::Table {
                schema: None,
                name: "accounts".into()
            })
        );
        assert_eq!(c.resolve("nope"), None);
    }

    #[test]
    fn comma_separated_from_list() {
        let c = ctx("select * from a x, b y, c");
        assert_eq!(c.tables.len(), 3);
        assert_eq!(c.source_names(), vec!["c", "x", "y"]);
    }

    #[test]
    fn cte_columns_from_inner_projection() {
        let c = ctx(
            "with recent as (select id, email, count(*) as orders from t group by id) \
             select * from recent r",
        );
        let cte = &c.ctes[0];
        assert_eq!(cte.name, "recent");
        assert_eq!(cte.columns, vec!["id", "email", "orders"]);
        // The CTE alias resolves to its inferred columns.
        assert_eq!(
            c.resolve("r"),
            Some(ResolvedSource::Columns(vec![
                "id".into(),
                "email".into(),
                "orders".into()
            ]))
        );
        // And so does the CTE name used directly.
        assert_eq!(
            c.resolve("recent"),
            Some(ResolvedSource::Columns(vec![
                "id".into(),
                "email".into(),
                "orders".into()
            ]))
        );
    }

    #[test]
    fn cte_explicit_column_list_wins() {
        let c = ctx("with c (alpha, beta) as (select 1, 2) select * from c");
        assert_eq!(c.ctes[0].columns, vec!["alpha", "beta"]);
    }

    #[test]
    fn multiple_ctes() {
        let c = ctx(
            "with a as (select x from t1), b as (select y, z from t2) \
             select * from a join b on a.x = b.y",
        );
        assert_eq!(c.ctes.len(), 2);
        assert_eq!(c.ctes[0].columns, vec!["x"]);
        assert_eq!(c.ctes[1].columns, vec!["y", "z"]);
    }

    #[test]
    fn derived_subquery_columns() {
        let c = ctx("select * from (select a, b as bee, t.c from t) sub");
        assert_eq!(c.derived.len(), 1);
        assert_eq!(c.derived[0].alias, "sub");
        assert_eq!(c.derived[0].columns, vec!["a", "bee", "c"]);
        assert_eq!(
            c.resolve("sub"),
            Some(ResolvedSource::Columns(vec![
                "a".into(),
                "bee".into(),
                "c".into()
            ]))
        );
    }

    #[test]
    fn star_projection_yields_no_named_columns() {
        let c = ctx("with c as (select * from t) select * from c");
        assert_eq!(c.ctes[0].columns, Vec::<String>::new());
    }

    #[test]
    fn quoted_identifiers_and_comments() {
        let c = ctx(
            "-- a comment\nselect * from \"My Schema\".\"User Table\" as \"u\" /* x */ where 1=1",
        );
        assert_eq!(
            c.tables[0],
            TableRef {
                schema: Some("My Schema".into()),
                name: "User Table".into(),
                alias: Some("u".into()),
            }
        );
    }

    #[test]
    fn keyword_after_table_is_not_an_alias() {
        let c = ctx("select * from users where id = 1");
        assert_eq!(c.tables[0].alias, None);
        let c2 = ctx("select * from a join b on a.id = b.id");
        assert_eq!(c2.tables[0].alias, None);
        assert_eq!(c2.tables[1].alias, None);
    }

    #[test]
    fn nested_subquery_projection_picks_outer_columns() {
        // The outer projection is `id, (select max(x) from y) as mx`.
        let c = ctx("select id, (select max(x) from y) as mx from t");
        // No CTE/derived here, but the projection helper must not be confused by the
        // inner FROM — exercised via a CTE wrapper:
        let c2 = ctx("with w as (select id, (select max(x) from y) as mx from t) select * from w");
        assert_eq!(c2.ctes[0].columns, vec!["id", "mx"]);
        assert!(c.ctes.is_empty());
    }
}
