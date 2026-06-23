//! Generic `information_schema` metamodel query builders.
//!
//! Engines can use the standard implementation directly, then override only the
//! handful of catalog differences they need in their adapter layer.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogQuery {
    pub sql: String,
}

impl CatalogQuery {
    pub fn new(sql: impl Into<String>) -> Self {
        Self { sql: sql.into() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InformationSchemaCapabilities {
    pub schemata: bool,
    pub tables: bool,
    pub columns: bool,
    pub routines: bool,
    pub primary_keys: bool,
}

impl InformationSchemaCapabilities {
    pub const STANDARD: Self = Self {
        schemata: true,
        tables: true,
        columns: true,
        routines: true,
        primary_keys: true,
    };

    pub const MINIMAL: Self = Self {
        schemata: true,
        tables: true,
        columns: true,
        routines: false,
        primary_keys: false,
    };
}

pub trait InformationSchemaMetamodel {
    fn capabilities(&self) -> InformationSchemaCapabilities {
        InformationSchemaCapabilities::STANDARD
    }

    fn excluded_schemas(&self) -> &'static [&'static str] {
        &["information_schema"]
    }

    fn list_schemas(&self) -> CatalogQuery {
        CatalogQuery::new(format!(
            "select schema_name \
             from information_schema.schemata{} \
             order by schema_name",
            self.excluded_schema_filter("schema_name")
        ))
    }

    fn list_objects(&self, schema: Option<&str>) -> CatalogQuery {
        CatalogQuery::new(format!(
            "select table_schema, table_name, table_type \
             from information_schema.tables \
             where table_type in ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW'){}{} \
             order by table_schema, table_name",
            self.excluded_schema_filter("table_schema"),
            self.optional_eq_filter("table_schema", schema)
        ))
    }

    fn list_columns(&self, schema: &str, object: &str) -> CatalogQuery {
        CatalogQuery::new(format!(
            "select table_schema, table_name, column_name, data_type, is_nullable, ordinal_position \
             from information_schema.columns \
             where table_schema = {} and table_name = {} \
             order by ordinal_position",
            sql_string(schema),
            sql_string(object)
        ))
    }

    fn list_routines(&self, schema: Option<&str>) -> CatalogQuery {
        CatalogQuery::new(format!(
            "select routine_schema, routine_name, routine_type, data_type \
             from information_schema.routines \
             where 1 = 1{}{} \
             order by routine_schema, routine_name",
            self.excluded_schema_filter("routine_schema"),
            self.optional_eq_filter("routine_schema", schema)
        ))
    }

    fn list_primary_keys(&self, schema: &str, object: &str) -> CatalogQuery {
        CatalogQuery::new(format!(
            "select kcu.table_schema, kcu.table_name, kcu.column_name, kcu.ordinal_position \
             from information_schema.table_constraints tc \
             join information_schema.key_column_usage kcu \
               on tc.constraint_schema = kcu.constraint_schema \
              and tc.constraint_name = kcu.constraint_name \
              and tc.table_schema = kcu.table_schema \
              and tc.table_name = kcu.table_name \
             where tc.constraint_type = 'PRIMARY KEY' \
               and tc.table_schema = {} \
               and tc.table_name = {} \
             order by kcu.ordinal_position",
            sql_string(schema),
            sql_string(object)
        ))
    }

    fn optional_eq_filter(&self, column: &str, value: Option<&str>) -> String {
        value
            .map(|value| format!(" and {column} = {}", sql_string(value)))
            .unwrap_or_default()
    }

    fn excluded_schema_filter(&self, column: &str) -> String {
        let excluded = self.excluded_schemas();
        if excluded.is_empty() {
            return String::new();
        }
        let values = excluded
            .iter()
            .map(|schema| sql_string(schema))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" where {column} not in ({values})")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StandardInformationSchema;

impl InformationSchemaMetamodel for StandardInformationSchema {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PostgresInformationSchema;

impl InformationSchemaMetamodel for PostgresInformationSchema {
    fn excluded_schemas(&self) -> &'static [&'static str] {
        &["information_schema", "pg_catalog"]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MySqlInformationSchema;

impl InformationSchemaMetamodel for MySqlInformationSchema {
    fn excluded_schemas(&self) -> &'static [&'static str] {
        &["information_schema", "mysql", "performance_schema", "sys"]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteCatalogMetamodel;

impl InformationSchemaMetamodel for SqliteCatalogMetamodel {
    fn capabilities(&self) -> InformationSchemaCapabilities {
        InformationSchemaCapabilities {
            schemata: false,
            tables: true,
            columns: false,
            routines: false,
            primary_keys: false,
        }
    }

    fn list_schemas(&self) -> CatalogQuery {
        CatalogQuery::new("select 'main' as schema_name")
    }

    fn list_objects(&self, _schema: Option<&str>) -> CatalogQuery {
        CatalogQuery::new(
            "select 'main' as table_schema, name as table_name, type as table_type \
             from sqlite_schema \
             where type in ('table', 'view') \
               and name not like 'sqlite_%' \
             order by name",
        )
    }
}

pub fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_queries_information_schema_objects() {
        let sql = StandardInformationSchema.list_objects(Some("public")).sql;

        assert!(sql.contains("from information_schema.tables"));
        assert!(sql.contains("table_schema = 'public'"));
        assert!(sql.contains("table_type in"));
    }

    #[test]
    fn string_literals_are_escaped() {
        assert_eq!(sql_string("customer's data"), "'customer''s data'");
        assert!(StandardInformationSchema
            .list_columns("app", "customer's data")
            .sql
            .contains("table_name = 'customer''s data'"));
    }

    #[test]
    fn postgres_excludes_pg_catalog() {
        let sql = PostgresInformationSchema.list_schemas().sql;

        assert!(sql.contains("'information_schema'"));
        assert!(sql.contains("'pg_catalog'"));
    }

    #[test]
    fn primary_key_query_uses_standard_constraint_tables() {
        let sql = StandardInformationSchema
            .list_primary_keys("public", "accounts")
            .sql;

        assert!(sql.contains("information_schema.table_constraints"));
        assert!(sql.contains("information_schema.key_column_usage"));
        assert!(sql.contains("constraint_type = 'PRIMARY KEY'"));
    }

    #[test]
    fn sqlite_override_uses_sqlite_schema() {
        let model = SqliteCatalogMetamodel;

        assert!(!model.capabilities().columns);
        assert!(model.list_objects(None).sql.contains("from sqlite_schema"));
        assert_eq!(model.list_schemas().sql, "select 'main' as schema_name");
    }
}
