use crate::metadata::{
    ColumnMetadata, ForeignKeyMetadata, IndexMetadata, MetadataCache, MetadataObjectKind,
    ObjectMetadata, QuickSample,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InspectionCard {
    Object(ObjectInspection),
    Column(ColumnInspection),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectInspection {
    pub schema: String,
    pub name: String,
    pub kind: MetadataObjectKind,
    pub comment: Option<String>,
    pub ddl: Option<String>,
    pub row_estimate: Option<u64>,
    pub columns: Vec<ColumnInspection>,
    pub indexes: Vec<IndexMetadata>,
    pub foreign_keys: Vec<ForeignKeyMetadata>,
    pub sample: Option<QuickSample>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnInspection {
    pub schema: String,
    pub object: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub ordinal: u32,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub primary_key: bool,
    pub indexes: Vec<String>,
    pub references: Vec<ColumnReference>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnReference {
    pub schema: String,
    pub object: String,
    pub column: String,
}

pub fn inspect_object(
    cache: &MetadataCache,
    connection_id: &str,
    schema: &str,
    object: &str,
) -> Option<InspectionCard> {
    let object = cache.lookup_object(connection_id, schema, object)?;
    Some(InspectionCard::Object(object_inspection(schema, object)))
}

pub fn inspect_column(
    cache: &MetadataCache,
    connection_id: &str,
    schema: &str,
    object: &str,
    column: &str,
) -> Option<InspectionCard> {
    let object = cache.lookup_object(connection_id, schema, object)?;
    let column = object.column(column)?;
    Some(InspectionCard::Column(column_inspection(
        schema, object, column,
    )))
}

fn object_inspection(schema: &str, object: &ObjectMetadata) -> ObjectInspection {
    ObjectInspection {
        schema: schema.to_string(),
        name: object.name.clone(),
        kind: object.kind,
        comment: object.comment.clone(),
        ddl: object.ddl.clone(),
        row_estimate: object.row_estimate,
        columns: object
            .columns
            .iter()
            .map(|column| column_inspection(schema, object, column))
            .collect(),
        indexes: object.indexes.clone(),
        foreign_keys: object.foreign_keys.clone(),
        sample: object.sample.clone(),
    }
}

fn column_inspection(
    schema: &str,
    object: &ObjectMetadata,
    column: &ColumnMetadata,
) -> ColumnInspection {
    let indexes = object
        .indexes
        .iter()
        .filter(|index| index.columns.iter().any(|name| name == &column.name))
        .map(|index| index.name.clone())
        .collect::<Vec<_>>();

    let primary_key = object
        .indexes
        .iter()
        .any(|index| index.primary && index.columns.iter().any(|name| name == &column.name));

    let references = object
        .foreign_keys
        .iter()
        .flat_map(|fk| {
            fk.columns
                .iter()
                .zip(fk.references_columns.iter())
                .filter_map(|(local, remote)| {
                    (local == &column.name).then(|| ColumnReference {
                        schema: fk.references_schema.clone(),
                        object: fk.references_object.clone(),
                        column: remote.clone(),
                    })
                })
        })
        .collect();

    ColumnInspection {
        schema: schema.to_string(),
        object: object.name.clone(),
        name: column.name.clone(),
        data_type: column.data_type.clone(),
        nullable: column.nullable,
        ordinal: column.ordinal,
        default_value: column.default_value.clone(),
        comment: column.comment.clone(),
        primary_key,
        indexes,
        references,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::{
        ColumnMetadata, ForeignKeyMetadata, IndexMetadata, MetadataSnapshot, ObjectMetadata,
        SchemaMetadata,
    };
    use std::time::SystemTime;

    const CONN: &str = "conn-1";

    fn cache() -> MetadataCache {
        let mut id = ColumnMetadata::new("id", "integer", false, 1);
        id.comment = Some("stable account id".to_string());

        let mut org_id = ColumnMetadata::new("org_id", "integer", false, 2);
        org_id.default_value = Some("0".to_string());

        let mut email = ColumnMetadata::new("email", "text", false, 3);
        email.comment = Some("login email".to_string());

        let mut table = ObjectMetadata::table("accounts");
        table.comment = Some("customer accounts".to_string());
        table.ddl = Some("create table accounts (id integer primary key)".to_string());
        table.row_estimate = Some(42);
        table.columns.extend([id, org_id, email]);
        table.indexes.push(IndexMetadata {
            name: "accounts_pkey".to_string(),
            columns: vec!["id".to_string()],
            unique: true,
            primary: true,
        });
        table.indexes.push(IndexMetadata {
            name: "accounts_email_idx".to_string(),
            columns: vec!["email".to_string()],
            unique: true,
            primary: false,
        });
        table.foreign_keys.push(ForeignKeyMetadata::new(
            vec!["org_id".to_string()],
            "public",
            "organizations",
            vec!["id".to_string()],
        ));
        table.sample = Some(QuickSample {
            columns: vec!["id".to_string(), "email".to_string()],
            rows: vec![vec!["1".to_string(), "a@example.test".to_string()]],
            truncated: false,
        });

        let mut schema = SchemaMetadata::new("public");
        schema.objects.push(table);

        let mut snapshot = MetadataSnapshot::new(CONN, 1, SystemTime::UNIX_EPOCH);
        snapshot.schemas.push(schema);

        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(snapshot);
        cache
    }

    #[test]
    fn object_inspection_collects_hover_card_details() {
        let Some(InspectionCard::Object(card)) =
            inspect_object(&cache(), CONN, "public", "accounts")
        else {
            panic!("object inspection missing");
        };

        assert_eq!(card.schema, "public");
        assert_eq!(card.name, "accounts");
        assert_eq!(card.comment.as_deref(), Some("customer accounts"));
        assert_eq!(card.row_estimate, Some(42));
        assert_eq!(card.columns.len(), 3);
        assert_eq!(card.indexes.len(), 2);
        assert_eq!(card.foreign_keys.len(), 1);
        assert_eq!(card.sample.as_ref().unwrap().rows.len(), 1);
    }

    #[test]
    fn column_inspection_marks_keys_indexes_defaults_and_references() {
        let Some(InspectionCard::Column(id)) =
            inspect_column(&cache(), CONN, "public", "accounts", "id")
        else {
            panic!("column inspection missing");
        };
        assert!(id.primary_key);
        assert_eq!(id.indexes, vec!["accounts_pkey"]);
        assert_eq!(id.comment.as_deref(), Some("stable account id"));

        let Some(InspectionCard::Column(org_id)) =
            inspect_column(&cache(), CONN, "public", "accounts", "org_id")
        else {
            panic!("column inspection missing");
        };
        assert_eq!(org_id.default_value.as_deref(), Some("0"));
        assert_eq!(
            org_id.references,
            vec![ColumnReference {
                schema: "public".to_string(),
                object: "organizations".to_string(),
                column: "id".to_string(),
            }]
        );
    }

    #[test]
    fn missing_object_or_column_returns_none() {
        assert_eq!(inspect_object(&cache(), CONN, "public", "missing"), None);
        assert_eq!(
            inspect_column(&cache(), CONN, "public", "accounts", "missing"),
            None
        );
    }
}
