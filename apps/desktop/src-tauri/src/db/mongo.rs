//! MongoDB (document store) via the official `mongodb` crate.
//!
//! This is the proof that the [`super::Connection`] trait extends beyond SQL: a
//! document store joins through exactly the same trait, no enum to edit. A "query"
//! here is a collection name, or a JSON `{ "collection": "...", "filter": { ... } }`,
//! and documents are projected to a table by the ordered union of their top-level
//! keys (missing keys become null), the way a document grid shows them.

use futures_util::TryStreamExt;
use mongodb::bson::{doc, to_document, Document};
use mongodb::Client;

use super::{ConnectionProfile, RowSet};

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
