use crate::metadata::{
    ForeignKeyMetadata, MetadataCache, MetadataObjectKind, MetadataPermissions, ObjectMetadata,
    RoutineKind, RoutineMetadata, SchemaMetadata,
};
use irodori_sql::dialect::{common_keywords, SqlDialect};

const DEFAULT_KEYWORDS: &[&str] = &[
    "select",
    "from",
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "on",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "insert",
    "update",
    "delete",
    "create",
    "alter",
    "drop",
    "with",
    "union",
    "returning",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionRequest {
    pub connection_id: String,
    pub prefix: String,
    pub schema: Option<String>,
    pub object: Option<String>,
    pub keyword_case: KeywordCase,
    pub include_keywords: bool,
    pub limit: usize,
}

impl CompletionRequest {
    pub fn new(connection_id: impl Into<String>) -> Self {
        Self {
            connection_id: connection_id.into(),
            prefix: String::new(),
            schema: None,
            object: None,
            keyword_case: KeywordCase::Preserve,
            include_keywords: true,
            limit: 100,
        }
    }

    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }

    pub fn in_schema(mut self, schema: impl Into<String>) -> Self {
        self.schema = Some(schema.into());
        self
    }

    pub fn for_object(mut self, object: impl Into<String>) -> Self {
        self.object = Some(object.into());
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeywordCase {
    Preserve,
    Upper,
    Lower,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionItem {
    pub label: String,
    pub insert_text: String,
    pub kind: CompletionItemKind,
    pub detail: String,
    pub score: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CompletionItemKind {
    Schema,
    Table,
    View,
    Column,
    Function,
    Procedure,
    Keyword,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinSuggestion {
    pub left_schema: String,
    pub left_object: String,
    pub right_schema: String,
    pub right_object: String,
    pub condition: String,
    pub score: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedColumnList {
    pub schema: String,
    pub object: String,
    pub columns: Vec<String>,
    pub insert_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionEngine {
    keywords: Vec<String>,
}

impl Default for CompletionEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CompletionEngine {
    pub fn new() -> Self {
        Self {
            keywords: DEFAULT_KEYWORDS
                .iter()
                .map(|keyword| keyword.to_string())
                .collect(),
        }
    }

    pub fn with_keywords(keywords: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            keywords: keywords.into_iter().map(Into::into).collect(),
        }
    }

    pub fn for_dialect(dialect: &dyn SqlDialect) -> Self {
        let mut keywords = common_keywords()
            .iter()
            .chain(dialect.extra_keywords().iter())
            .map(|keyword| keyword.to_ascii_lowercase())
            .collect::<Vec<_>>();
        keywords.sort();
        keywords.dedup();
        Self { keywords }
    }

    pub fn complete(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
    ) -> Vec<CompletionItem> {
        let mut items = Vec::new();
        let prefix = request.prefix.trim();

        if let Some(object) = request.object.as_deref() {
            self.push_object_columns(cache, request, object, prefix, &mut items);
        } else if let Some(schema) = request.schema.as_deref() {
            self.push_schema_objects(cache, request, schema, prefix, &mut items);
            self.push_schema_columns(cache, request, schema, prefix, &mut items);
            self.push_schema_routines(cache, request, schema, prefix, &mut items);
        } else {
            self.push_schemas(cache, request, prefix, &mut items);
            self.push_all_objects(cache, request, prefix, &mut items);
            self.push_all_columns(cache, request, prefix, &mut items);
            self.push_all_routines(cache, request, prefix, &mut items);
        }

        if request.include_keywords {
            self.push_keywords(request, prefix, &mut items);
        }

        items.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.kind.cmp(&right.kind))
                .then_with(|| left.label.cmp(&right.label))
        });
        items.dedup_by(|left, right| {
            left.kind == right.kind && left.label == right.label && left.detail == right.detail
        });
        if request.limit > 0 && items.len() > request.limit {
            items.truncate(request.limit);
        }
        items
    }

    pub fn expand_star(
        &self,
        cache: &MetadataCache,
        connection_id: &str,
        schema: &str,
        object: &str,
    ) -> Option<GeneratedColumnList> {
        let object_metadata = cache.lookup_object(connection_id, schema, object)?;
        if !visible(object_metadata.permissions) {
            return None;
        }
        let columns = object_metadata
            .columns
            .iter()
            .filter(|column| visible(column.permissions))
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();
        if columns.is_empty() {
            return None;
        }
        Some(GeneratedColumnList {
            schema: schema.to_string(),
            object: object.to_string(),
            insert_text: columns.join(", "),
            columns,
        })
    }

    pub fn suggest_joins(
        &self,
        cache: &MetadataCache,
        connection_id: &str,
        schema: &str,
        object: &str,
    ) -> Vec<JoinSuggestion> {
        let Some(left) = cache.lookup_object(connection_id, schema, object) else {
            return Vec::new();
        };
        if !visible(left.permissions) {
            return Vec::new();
        }

        let mut suggestions = Vec::new();
        for fk in &left.foreign_keys {
            if let Some(right) =
                cache.lookup_object(connection_id, &fk.references_schema, &fk.references_object)
            {
                if visible(right.permissions) {
                    suggestions.push(join_from_fk(schema, object, fk, 100));
                }
            }
        }

        for other_schema in cache.list_schemas(connection_id) {
            if !visible(other_schema.permissions) {
                continue;
            }
            for other in &other_schema.objects {
                if !visible(other.permissions) {
                    continue;
                }
                for fk in &other.foreign_keys {
                    if fk.references_schema == schema && fk.references_object == object {
                        suggestions.push(JoinSuggestion {
                            left_schema: schema.to_string(),
                            left_object: object.to_string(),
                            right_schema: other_schema.name.clone(),
                            right_object: other.name.clone(),
                            condition: join_condition(
                                &other.name,
                                &fk.columns,
                                object,
                                &fk.references_columns,
                            ),
                            score: 90,
                        });
                    }
                }
            }
        }

        suggestions.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.right_schema.cmp(&right.right_schema))
                .then_with(|| left.right_object.cmp(&right.right_object))
                .then_with(|| left.condition.cmp(&right.condition))
        });
        suggestions.dedup();
        suggestions
    }

    fn push_schemas(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for schema in cache.list_schemas(&request.connection_id) {
            if !visible(schema.permissions) || !matches_prefix(&schema.name, prefix) {
                continue;
            }
            items.push(item(
                schema.name.clone(),
                schema.name.clone(),
                CompletionItemKind::Schema,
                "schema".to_string(),
                score(&schema.name, prefix, 80),
            ));
        }
    }

    fn push_schema_objects(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        schema: &str,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for object in cache.list_objects(&request.connection_id, schema) {
            self.push_object(schema, object, prefix, items);
        }
    }

    fn push_all_objects(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for schema in cache.list_schemas(&request.connection_id) {
            if !visible(schema.permissions) {
                continue;
            }
            for object in &schema.objects {
                self.push_object(&schema.name, object, prefix, items);
            }
        }
    }

    fn push_object(
        &self,
        schema: &str,
        object: &ObjectMetadata,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        if !visible(object.permissions) || !matches_prefix(&object.name, prefix) {
            return;
        }
        let kind = match object.kind {
            MetadataObjectKind::Table => CompletionItemKind::Table,
            MetadataObjectKind::View | MetadataObjectKind::MaterializedView => {
                CompletionItemKind::View
            }
            MetadataObjectKind::Collection | MetadataObjectKind::Other => CompletionItemKind::Table,
        };
        items.push(item(
            object.name.clone(),
            object.name.clone(),
            kind,
            format!("{schema}.{}", object.name),
            score(&object.name, prefix, 90),
        ));
    }

    fn push_object_columns(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        object: &str,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        let Some(schema) = request.schema.as_deref() else {
            self.push_all_columns(cache, request, prefix, items);
            return;
        };
        let Some(object) = cache.lookup_object(&request.connection_id, schema, object) else {
            return;
        };
        push_columns(schema, object, prefix, items);
    }

    fn push_schema_columns(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        schema: &str,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for object in cache.list_objects(&request.connection_id, schema) {
            push_columns(schema, object, prefix, items);
        }
    }

    fn push_schema_routines(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        schema: &str,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        if let Some(schema) = cache.lookup_schema(&request.connection_id, schema) {
            if visible(schema.permissions) {
                push_routines(schema, prefix, items);
            }
        }
    }

    fn push_all_routines(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for schema in cache.list_schemas(&request.connection_id) {
            if !visible(schema.permissions) {
                continue;
            }
            push_routines(schema, prefix, items);
        }
    }

    fn push_all_columns(
        &self,
        cache: &MetadataCache,
        request: &CompletionRequest,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for schema in cache.list_schemas(&request.connection_id) {
            if !visible(schema.permissions) {
                continue;
            }
            for object in &schema.objects {
                push_columns(&schema.name, object, prefix, items);
            }
        }
    }

    fn push_keywords(
        &self,
        request: &CompletionRequest,
        prefix: &str,
        items: &mut Vec<CompletionItem>,
    ) {
        for keyword in &self.keywords {
            if !matches_prefix(keyword, prefix) {
                continue;
            }
            let insert_text = apply_keyword_casing(keyword, request.keyword_case);
            items.push(item(
                insert_text.clone(),
                insert_text,
                CompletionItemKind::Keyword,
                "keyword".to_string(),
                score(keyword, prefix, 40),
            ));
        }
    }
}

fn join_from_fk(schema: &str, object: &str, fk: &ForeignKeyMetadata, score: i32) -> JoinSuggestion {
    JoinSuggestion {
        left_schema: schema.to_string(),
        left_object: object.to_string(),
        right_schema: fk.references_schema.clone(),
        right_object: fk.references_object.clone(),
        condition: join_condition(
            object,
            &fk.columns,
            &fk.references_object,
            &fk.references_columns,
        ),
        score,
    }
}

fn join_condition(
    left_object: &str,
    left_columns: &[String],
    right_object: &str,
    right_columns: &[String],
) -> String {
    left_columns
        .iter()
        .zip(right_columns)
        .map(|(left_column, right_column)| {
            format!("{left_object}.{left_column} = {right_object}.{right_column}")
        })
        .collect::<Vec<_>>()
        .join(" and ")
}

pub fn apply_keyword_casing(keyword: &str, keyword_case: KeywordCase) -> String {
    match keyword_case {
        KeywordCase::Preserve => keyword.to_string(),
        KeywordCase::Upper => keyword.to_ascii_uppercase(),
        KeywordCase::Lower => keyword.to_ascii_lowercase(),
    }
}

fn push_columns(
    schema: &str,
    object: &ObjectMetadata,
    prefix: &str,
    items: &mut Vec<CompletionItem>,
) {
    if !visible(object.permissions) {
        return;
    }
    for column in &object.columns {
        if !visible(column.permissions) || !matches_prefix(&column.name, prefix) {
            continue;
        }
        items.push(item(
            column.name.clone(),
            column.name.clone(),
            CompletionItemKind::Column,
            format!("{schema}.{}.{}", object.name, column.name),
            score(&column.name, prefix, 100) - column.ordinal as i32,
        ));
    }
}

fn push_routines(schema: &SchemaMetadata, prefix: &str, items: &mut Vec<CompletionItem>) {
    for routine in &schema.routines {
        if !visible(routine.permissions) || !matches_prefix(&routine.name, prefix) {
            continue;
        }
        items.push(routine_item(&schema.name, routine, prefix));
    }
}

fn routine_item(schema: &str, routine: &RoutineMetadata, prefix: &str) -> CompletionItem {
    let kind = match routine.kind {
        RoutineKind::Function => CompletionItemKind::Function,
        RoutineKind::Procedure => CompletionItemKind::Procedure,
    };
    let mut detail = format!("{schema}.{}{}", routine.name, routine.signature);
    if let Some(return_type) = routine.return_type.as_deref() {
        detail.push_str(" -> ");
        detail.push_str(return_type);
    }
    item(
        routine.name.clone(),
        routine.name.clone(),
        kind,
        detail,
        score(&routine.name, prefix, 75),
    )
}

fn item(
    label: String,
    insert_text: String,
    kind: CompletionItemKind,
    detail: String,
    score: i32,
) -> CompletionItem {
    CompletionItem {
        label,
        insert_text,
        kind,
        detail,
        score,
    }
}

fn visible(permissions: MetadataPermissions) -> bool {
    permissions.can_introspect || permissions.can_read
}

fn matches_prefix(candidate: &str, prefix: &str) -> bool {
    prefix.is_empty()
        || candidate
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase())
}

fn score(candidate: &str, prefix: &str, base: i32) -> i32 {
    if prefix.is_empty() {
        return base;
    }
    if candidate == prefix {
        base + 30
    } else if candidate.eq_ignore_ascii_case(prefix) {
        base + 25
    } else if candidate.starts_with(prefix) {
        base + 15
    } else {
        base + 10
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::{
        ColumnMetadata, ForeignKeyMetadata, MetadataSnapshot, ObjectMetadata, RoutineMetadata,
        SchemaMetadata,
    };
    use irodori_sql::dialect::PostgresDialect;
    use std::time::SystemTime;

    const CONN: &str = "conn-1";

    fn cache() -> MetadataCache {
        let mut accounts = ObjectMetadata::table("accounts");
        accounts
            .columns
            .push(ColumnMetadata::new("id", "integer", false, 1));
        accounts
            .columns
            .push(ColumnMetadata::new("email", "text", false, 2));

        let mut orders = ObjectMetadata::table("orders");
        orders
            .columns
            .push(ColumnMetadata::new("id", "integer", false, 1));
        orders
            .columns
            .push(ColumnMetadata::new("account_id", "integer", false, 2));
        orders.foreign_keys.push(ForeignKeyMetadata::new(
            vec!["account_id".to_string()],
            "public",
            "accounts",
            vec!["id".to_string()],
        ));

        let mut audit = ObjectMetadata::table("audit_log");
        audit
            .columns
            .push(ColumnMetadata::new("event_id", "integer", false, 1));
        audit.permissions = MetadataPermissions::denied();

        let mut public = SchemaMetadata::new("public");
        public.objects.push(accounts);
        public.objects.push(orders);
        public.objects.push(audit);
        let mut routine = RoutineMetadata::new("normalize_email", "(email text)");
        routine.return_type = Some("text".to_string());
        public.routines.push(routine);

        let mut analytics = SchemaMetadata::new("analytics");
        analytics
            .objects
            .push(ObjectMetadata::view("account_summary"));

        let mut snapshot = MetadataSnapshot::new(CONN, 1, SystemTime::UNIX_EPOCH);
        snapshot.schemas.push(public);
        snapshot.schemas.push(analytics);

        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(snapshot);
        cache
    }

    #[test]
    fn completes_schemas_tables_columns_and_keywords() {
        let engine = CompletionEngine::new();
        let items = engine.complete(&cache(), &CompletionRequest::new(CONN).with_prefix("acc"));

        assert!(items
            .iter()
            .any(|item| item.kind == CompletionItemKind::Table && item.label == "accounts"));
        assert!(items
            .iter()
            .any(|item| item.kind == CompletionItemKind::View && item.label == "account_summary"));
        assert!(
            items
                .iter()
                .any(|item| item.kind == CompletionItemKind::Column && item.label == "email")
                == false
        );
    }

    #[test]
    fn completes_columns_for_a_known_object() {
        let engine = CompletionEngine::new();
        let request = CompletionRequest::new(CONN)
            .in_schema("public")
            .for_object("accounts")
            .with_prefix("e");
        let items = engine.complete(&cache(), &request);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, CompletionItemKind::Column);
        assert_eq!(items[0].label, "email");
        assert_eq!(items[0].detail, "public.accounts.email");
    }

    #[test]
    fn filters_inaccessible_metadata() {
        let engine = CompletionEngine::new();
        let request = CompletionRequest::new(CONN).with_prefix("audit");
        let items = engine.complete(&cache(), &request);

        assert!(items.is_empty());
    }

    #[test]
    fn applies_keyword_casing_and_limit() {
        let engine = CompletionEngine::with_keywords(["select", "set", "show"]);
        let mut request = CompletionRequest::new(CONN).with_prefix("s");
        request.keyword_case = KeywordCase::Upper;
        request.limit = 2;

        let items = engine.complete(&cache(), &request);

        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .all(|item| item.kind != CompletionItemKind::Keyword
                || item.insert_text == item.insert_text.to_ascii_uppercase()));
    }

    #[test]
    fn can_seed_keywords_from_a_sql_dialect() {
        let engine = CompletionEngine::for_dialect(&PostgresDialect);
        let mut request = CompletionRequest::new(CONN).with_prefix("ret");
        request.keyword_case = KeywordCase::Upper;

        let items = engine.complete(&cache(), &request);

        assert!(items.iter().any(|item| {
            item.kind == CompletionItemKind::Keyword && item.insert_text == "RETURNING"
        }));
    }

    #[test]
    fn completes_routines_with_signatures() {
        let engine = CompletionEngine::new();
        let request = CompletionRequest::new(CONN)
            .in_schema("public")
            .with_prefix("norm");

        let items = engine.complete(&cache(), &request);

        assert!(items.iter().any(|item| {
            item.kind == CompletionItemKind::Function
                && item.label == "normalize_email"
                && item.detail == "public.normalize_email(email text) -> text"
        }));
    }

    #[test]
    fn suggests_joins_from_foreign_keys() {
        let engine = CompletionEngine::new();
        let suggestions = engine.suggest_joins(&cache(), CONN, "public", "orders");

        assert_eq!(
            suggestions,
            vec![JoinSuggestion {
                left_schema: "public".to_string(),
                left_object: "orders".to_string(),
                right_schema: "public".to_string(),
                right_object: "accounts".to_string(),
                condition: "orders.account_id = accounts.id".to_string(),
                score: 100,
            }]
        );
    }

    #[test]
    fn expands_star_to_visible_columns() {
        let engine = CompletionEngine::new();
        let list = engine
            .expand_star(&cache(), CONN, "public", "accounts")
            .expect("column list");

        assert_eq!(list.columns, vec!["id", "email"]);
        assert_eq!(list.insert_text, "id, email");
    }
}
