//! MongoDB (document store) via the official `mongodb` crate.
//!
//! This is the proof that the [`super::Connection`] trait extends beyond SQL: a
//! document store joins through exactly the same trait, no enum to edit. A "query"
//! here is a collection name, or a JSON `{ "collection": "...", "filter": { ... } }`,
//! and documents are projected to a table by the ordered union of their top-level
//! keys (missing keys become null), the way a document grid shows them.

use futures_util::TryStreamExt;
use mongodb::bson::{doc, to_document, Bson, Document};
use mongodb::Client;

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind,
    IndexMetadata, RowSet, SchemaMetadata,
};

pub struct MongoHandle {
    client: Client,
    db: String,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<MongoHandle, String> {
    let uri = match &profile.url {
        Some(u) => u.clone(),
        None => {
            let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
            let port = profile.port.unwrap_or(27017);
            let auth = match (&profile.user, &profile.password) {
                (Some(u), Some(p)) if !p.is_empty() => format!("{u}:{p}@"),
                (Some(u), _) if !u.is_empty() => format!("{u}@"),
                _ => String::new(),
            };
            let db = profile.database.clone().unwrap_or_default();
            format!("mongodb://{auth}{host}:{port}/{db}")
        }
    };
    let client = Client::with_uri_str(&uri)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let db = profile
        .database
        .clone()
        .or_else(|| client.default_database().map(|d| d.name().to_string()))
        .unwrap_or_else(|| "test".into());
    Ok(MongoHandle { client, db })
}

pub async fn version(h: &MongoHandle) -> Option<String> {
    let res = h
        .client
        .database(&h.db)
        .run_command(doc! { "buildInfo": 1 })
        .await
        .ok()?;
    res.get_str("version").ok().map(|v| format!("MongoDB {v}"))
}

pub async fn run_query(h: &MongoHandle, input: &str, cap: usize) -> Result<RowSet, String> {
    let (coll_name, filter) = parse_input(input)?;
    let coll = h.client.database(&h.db).collection::<Document>(&coll_name);
    let mut cursor = coll
        .find(filter)
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let mut docs: Vec<Document> = Vec::new();
    let mut truncated = false;
    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if docs.len() >= cap {
            truncated = true;
            break;
        }
        docs.push(doc);
    }

    // Project documents to a table: ordered union of top-level keys.
    let mut columns: Vec<String> = Vec::new();
    for d in &docs {
        for k in d.keys() {
            if !columns.iter().any(|c| c == k) {
                columns.push(k.clone());
            }
        }
    }
    let rows = docs
        .iter()
        .map(|d| {
            columns
                .iter()
                .map(|k| match d.get(k) {
                    Some(b) => b.clone().into_relaxed_extjson(),
                    None => serde_json::Value::Null,
                })
                .collect()
        })
        .collect();

    Ok((columns, rows, truncated))
}

pub async fn metadata(h: &MongoHandle) -> Result<DatabaseMetadata, String> {
    let db = h.client.database(&h.db);
    let names = db
        .list_collection_names()
        .await
        .map_err(|e| format!("metadata collections failed: {e}"))?;

    let mut objects = Vec::new();
    for name in names {
        let coll = db.collection::<Document>(&name);
        let mut keys: Vec<(String, String)> = Vec::new();
        let mut cursor = coll
            .find(Document::new())
            .limit(20)
            .await
            .map_err(|e| format!("metadata sample failed for {name}: {e}"))?;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| format!("metadata sample failed for {name}: {e}"))?
        {
            for (key, value) in doc.iter() {
                if !keys.iter().any(|(existing, _)| existing == key) {
                    keys.push((key.clone(), bson_type_name(value).to_string()));
                }
            }
        }

        let mut indexes = Vec::new();
        let mut index_cursor = coll
            .list_indexes()
            .await
            .map_err(|e| format!("metadata indexes failed for {name}: {e}"))?;
        while let Some(index) = index_cursor
            .try_next()
            .await
            .map_err(|e| format!("metadata indexes failed for {name}: {e}"))?
        {
            let keys_doc = index.keys;
            indexes.push(IndexMetadata {
                name: index
                    .options
                    .as_ref()
                    .and_then(|options| options.name.clone())
                    .unwrap_or_else(|| keys_doc.keys().cloned().collect::<Vec<_>>().join("_")),
                columns: keys_doc.keys().cloned().collect(),
                unique: index
                    .options
                    .as_ref()
                    .and_then(|options| options.unique)
                    .unwrap_or(false),
            });
        }

        objects.push(DbObjectMetadata {
            schema: h.db.clone(),
            name,
            kind: DbObjectMetadataKind::Table,
            comment: None,
            ddl: None,
            row_estimate: None,
            sample: None,
            columns: keys
                .into_iter()
                .enumerate()
                .map(|(index, (name, data_type))| ColumnMetadata {
                    name,
                    data_type,
                    nullable: true,
                    ordinal: index as i32 + 1,
                    default_value: None,
                    comment: None,
                })
                .collect(),
            indexes,
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        });
    }

    Ok(DatabaseMetadata {
        schemas: vec![SchemaMetadata {
            name: h.db.clone(),
            objects,
        }],
    })
}

/// A query is either a bare collection name, or a JSON object with a `collection`
/// and an optional `filter`.
fn parse_input(input: &str) -> Result<(String, Document), String> {
    let t = input.trim();
    if t.starts_with('{') {
        let v: serde_json::Value =
            serde_json::from_str(t).map_err(|e| format!("invalid query json: {e}"))?;
        let coll = v
            .get("collection")
            .and_then(|c| c.as_str())
            .ok_or("query json needs a string \"collection\"")?
            .to_string();
        let filter = match v.get("filter") {
            Some(f) => to_document(f).map_err(|e| format!("invalid filter: {e}"))?,
            None => Document::new(),
        };
        Ok((coll, filter))
    } else {
        Ok((t.to_string(), Document::new()))
    }
}

fn bson_type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "document",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int32",
        Bson::Int64(_) => "int64",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binary",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal128",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}
