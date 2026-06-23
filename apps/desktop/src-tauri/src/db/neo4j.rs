//! Neo4j graph database adapter via `neo4rs`.

use std::collections::BTreeMap;
use async_trait::async_trait;
use neo4rs::{Graph, ConfigBuilder, query, Node, Relation};
use serde_json::{json, Value};

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata,
    DbObjectMetadataKind, IndexMetadata, RowSet, SchemaMetadata,
};

pub struct Neo4jConn {
    graph: Graph,
    db_name: String,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<Neo4jConn, String> {
    let uri = match &profile.url {
        Some(u) => u.clone(),
        None => {
            let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
            let port = profile.port.unwrap_or(7687);
            format!("bolt://{host}:{port}")
        }
    };
    let user = profile.user.clone().unwrap_or_else(|| "neo4j".into());
    let password = profile.password.clone().unwrap_or_default();
    let db_name = profile.database.clone().unwrap_or_else(|| "neo4j".into());

    let config = ConfigBuilder::default()
        .uri(&uri)
        .user(&user)
        .password(&password)
        .db(&db_name)
        .build()
        .map_err(|e| format!("failed to build neo4j config: {e}"))?;

    let graph = Graph::connect(config)
        .await
        .map_err(|e| format!("failed to connect to neo4j: {e}"))?;

    Ok(Neo4jConn { graph, db_name })
}

pub async fn version(conn: &Neo4jConn) -> Option<String> {
    // In Neo4j, version can be queried by CALL dbms.components()
    let q = query("CALL dbms.components() YIELD name, versions, edition RETURN name, versions[0] AS version, edition");
    let mut res = conn.graph.execute(q).await.ok()?;
    if let Some(row) = res.next().await.ok().flatten() {
        let version: String = row.get("version").ok()?;
        let edition: String = row.get("edition").ok()?;
        return Some(format!("Neo4j {version} ({edition})"));
    }
    Some("Neo4j".to_string())
}

pub async fn run_query(conn: &Neo4jConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let mut result = conn.graph.execute(query(sql))
        .await
        .map_err(|e| format!("Neo4j query execution failed: {e}"))?;

    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut truncated = false;

    // Retrieve column names from the result
    // neo4rs Result has a keys() method returning &[String] or similar
    // Let's use keys() to populate the column names.
    // If keys() is not available, we can infer it. Let's check keys() first.
    // Wait, let's try calling keys() and see if it compiles.
    // We will inspect compiler errors.
    let keys = result.keys();
    for key in keys {
        columns.push(key.clone());
    }

    while let Some(row) = result.next().await.map_err(|e| format!("failed to fetch row: {e}"))? {
        if rows.len() >= cap {
            truncated = true;
            break;
        }

        let mut row_values = Vec::new();
        for col_name in &columns {
            // Try to extract value from row.
            // neo4rs::Row has a get method. If it fails, we fall back to other formats.
            let val = if let Ok(n) = row.get::<Node>(col_name) {
                let labels: Vec<Value> = n.labels().iter().map(|l| json!(l)).collect();
                let mut props = BTreeMap::new();
                for (k, v) in n.properties() {
                    props.insert(k.clone(), bolt_to_json(v));
                }
                json!({
                    "_id": n.id(),
                    "_labels": labels,
                    "_properties": props,
                })
            } else if let Ok(r) = row.get::<Relation>(col_name) {
                let mut props = BTreeMap::new();
                for (k, v) in r.properties() {
                    props.insert(k.clone(), bolt_to_json(v));
                }
                json!({
                    "_id": r.id(),
                    "_type": r.typ(),
                    "_start": r.start(),
                    "_end": r.end(),
                    "_properties": props,
                })
            } else if let Ok(s) = row.get::<String>(col_name) {
                Value::String(s)
            } else if let Ok(i) = row.get::<i64>(col_name) {
                Value::from(i)
            } else if let Ok(f) = row.get::<f64>(col_name) {
                Value::from(f)
            } else if let Ok(b) = row.get::<bool>(col_name) {
                Value::Bool(b)
            } else {
                Value::Null
            };
            row_values.push(val);
        }
        rows.push(row_values);
    }

    Ok((columns, rows, truncated))
}

fn bolt_to_json(bolt_val: &neo4rs::BoltType) -> Value {
    match bolt_val {
        neo4rs::BoltType::Null => Value::Null,
        neo4rs::BoltType::Boolean(b) => Value::Bool(*b),
        neo4rs::BoltType::Integer(i) => Value::from(*i),
        neo4rs::BoltType::Float(f) => Value::from(*f),
        neo4rs::BoltType::String(s) => Value::String(s.clone()),
        neo4rs::BoltType::List(l) => {
            Value::Array(l.iter().map(bolt_to_json).collect())
        }
        neo4rs::BoltType::Map(m) => {
            let mut map = serde_json::Map::new();
            for (k, v) in m {
                map.insert(k.clone(), bolt_to_json(v));
            }
            Value::Object(map)
        }
        _ => Value::String(format!("{:?}", bolt_val)),
    }
}

pub async fn metadata(conn: &Neo4jConn) -> Result<DatabaseMetadata, String> {
    let mut objects = Vec::new();

    // 1. Fetch Node Labels
    let label_query = query("CALL db.labels() YIELD label RETURN label");
    let mut label_res = conn.graph.execute(label_query).await.map_err(|e| e.to_string())?;
    let mut labels = Vec::new();
    while let Some(row) = label_res.next().await.map_err(|e| e.to_string())? {
        if let Ok(label) = row.get::<String>("label") {
            labels.push(label);
        }
    }

    for label in labels {
        // Sample properties for this label to populate columns
        let prop_sql = format!("MATCH (n:`{label}`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 100");
        let mut prop_res = conn.graph.execute(query(&prop_sql)).await.map_err(|e| e.to_string())?;
        let mut columns = Vec::new();
        let mut idx = 1;
        while let Some(row) = prop_res.next().await.map_err(|e| e.to_string())? {
            if let Ok(key) = row.get::<String>("key") {
                columns.push(ColumnMetadata {
                    name: key,
                    data_type: "property".to_string(),
                    nullable: true,
                    ordinal: idx,
                    default_value: None,
                });
                idx += 1;
            }
        }

        objects.push(DbObjectMetadata {
            schema: conn.db_name.clone(),
            name: label,
            kind: DbObjectMetadataKind::Table,
            columns,
            indexes: Vec::new(),
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        });
    }

    // 2. Fetch Relationship Types
    let rel_query = query("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType");
    let mut rel_res = conn.graph.execute(rel_query).await.map_err(|e| e.to_string())?;
    let mut rel_types = Vec::new();
    while let Some(row) = rel_res.next().await.map_err(|e| e.to_string())? {
        if let Ok(rel_type) = row.get::<String>("relationshipType") {
            rel_types.push(rel_type);
        }
    }

    for rel_type in rel_types {
        let prop_sql = format!("MATCH ()-[r:`{rel_type}`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 100");
        let mut prop_res = conn.graph.execute(query(&prop_sql)).await.map_err(|e| e.to_string())?;
        let mut columns = Vec::new();
        let mut idx = 1;
        while let Some(row) = prop_res.next().await.map_err(|e| e.to_string())? {
            if let Ok(key) = row.get::<String>("key") {
                columns.push(ColumnMetadata {
                    name: key,
                    data_type: "property".to_string(),
                    nullable: true,
                    ordinal: idx,
                    default_value: None,
                });
                idx += 1;
            }
        }

        objects.push(DbObjectMetadata {
            schema: conn.db_name.clone(),
            name: rel_type,
            kind: DbObjectMetadataKind::View,
            columns,
            indexes: Vec::new(),
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        });
    }

    Ok(DatabaseMetadata {
        schemas: vec![SchemaMetadata {
            name: conn.db_name.clone(),
            objects,
        }],
    })
}
