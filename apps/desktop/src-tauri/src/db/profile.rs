use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::engine::{DbEngine, Wire};

const MAX_CONNECTION_ID_LEN: usize = 128;

/// How to reach a database. Either give structured fields or a raw `url`/DSN.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub engine: DbEngine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub database: Option<String>,
    /// Raw connection URL/DSN. Overrides the structured fields when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transport: Option<irodori_core::TransportConfig>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub(super) fn normalize_profile(
    mut profile: ConnectionProfile,
) -> Result<ConnectionProfile, String> {
    profile.id = profile.id.trim().to_string();
    if profile.id.is_empty() {
        return Err("connection id is required".into());
    }
    if profile.id.len() > MAX_CONNECTION_ID_LEN {
        return Err(format!(
            "connection id must be at most {MAX_CONNECTION_ID_LEN} bytes"
        ));
    }
    if profile.id.chars().any(char::is_control) {
        return Err("connection id cannot contain control characters".into());
    }

    normalize_optional_text(&mut profile.url);
    normalize_optional_text(&mut profile.host);
    normalize_optional_text(&mut profile.user);
    normalize_optional_text(&mut profile.database);

    let wire = profile.engine.wire();
    if is_unimplemented_wire(wire) {
        return Err(connector_extension_required_message(profile.engine));
    }

    if profile.url.is_some() {
        return Ok(profile);
    }

    match wire {
        Wire::Sqlite => {
            if profile.database.is_none() && profile.host.is_none() {
                return Err("SQLite needs a database file path or :memory:".into());
            }
        }
        Wire::DuckDb => {
            // Empty DuckDB profiles intentionally open an in-memory database.
        }
        Wire::Postgres
        | Wire::Mysql
        | Wire::SqlServer
        | Wire::Mongo
        | Wire::Oracle
        | Wire::ClickHouse
        | Wire::Snowflake
        | Wire::BigQuery
        | Wire::Bigtable
        | Wire::Redis
        | Wire::Cassandra
        | Wire::Neo4j
        | Wire::InfluxDb => {
            if profile.host.is_none() {
                return Err("host is required when URL/DSN is not provided".into());
            }
        }
        Wire::Memgraph
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Pinecone
        | Wire::Jdbc
        | Wire::Search
        | Wire::Document
        | Wire::KeyValue
        | Wire::CloudSpanner
        | Wire::Graph
        | Wire::TimeSeries
        | Wire::Lakehouse
        | Wire::ObjectStore => {
            unreachable!("unimplemented wires are rejected above")
        }
    }

    Ok(profile)
}

pub(super) fn redact_secret_text(text: &str, profile: &ConnectionProfile) -> String {
    let mut redacted = redact_sensitive_assignments(text);
    if let Some(url) = &profile.url {
        let redacted_url = redact_url_password(url);
        redacted = redacted.replace(url, &redacted_url);
    }
    if let Some(password) = &profile.password {
        if !password.is_empty() {
            redacted = redacted.replace(password, "****");
        }
    }
    redacted
}

fn normalize_optional_text(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
}

fn is_unimplemented_wire(wire: Wire) -> bool {
    matches!(
        wire,
        Wire::Memgraph
            | Wire::Qdrant
            | Wire::Milvus
            | Wire::Pinecone
            | Wire::Jdbc
            | Wire::Search
            | Wire::Document
            | Wire::KeyValue
            | Wire::CloudSpanner
            | Wire::Graph
            | Wire::TimeSeries
            | Wire::Lakehouse
            | Wire::ObjectStore
    )
}

fn connector_extension_required_message(engine: DbEngine) -> String {
    match engine.connector_extension_id() {
        Some(extension_id) => format!(
            "{engine:?} is recognized, but its connector is not built into the core app. Install connector extension `{extension_id}`."
        ),
        None => format!(
            "{engine:?} is recognized as an internal connector target, but no public connector extension is published for it."
        ),
    }
}

fn redact_url_password(input: &str) -> String {
    let Some(scheme_at) = input.find("://") else {
        return input.to_string();
    };
    let authority_start = scheme_at + 3;
    let authority_end = input[authority_start..]
        .find(['/', '?', '#'])
        .map(|offset| authority_start + offset)
        .unwrap_or(input.len());
    let Some(at_offset) = input[authority_start..authority_end].rfind('@') else {
        return input.to_string();
    };
    let userinfo_end = authority_start + at_offset;
    let Some(colon_offset) = input[authority_start..userinfo_end].find(':') else {
        return input.to_string();
    };
    let password_start = authority_start + colon_offset + 1;
    format!("{}****{}", &input[..password_start], &input[userinfo_end..])
}

fn redact_sensitive_assignments(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let keys = [
        "password=",
        "pwd=",
        "pass=",
        "passphrase=",
        "token=",
        "secret=",
        "api_key=",
        "apikey=",
        "access_key=",
        "accesskey=",
        "private_key=",
        "privatekey=",
    ];
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;

    while cursor < input.len() {
        let Some((key_start, key_len)) = keys
            .iter()
            .filter_map(|key| {
                lower[cursor..]
                    .find(key)
                    .map(|offset| (cursor + offset, key.len()))
            })
            .min_by_key(|(start, _)| *start)
        else {
            out.push_str(&input[cursor..]);
            break;
        };
        let value_start = key_start + key_len;
        let value_end = input[value_start..]
            .find([';', '&', ' ', '\t', '\r', '\n'])
            .map(|offset| value_start + offset)
            .unwrap_or(input.len());

        out.push_str(&input[cursor..value_start]);
        out.push_str("****");
        cursor = value_end;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> ConnectionProfile {
        ConnectionProfile {
            id: "redact".into(),
            engine: DbEngine::Postgres,
            host: None,
            port: None,
            user: Some("user".into()),
            password: Some("secret".into()),
            database: None,
            url: Some("postgres://user:secret@localhost/samples".into()),
            transport: None,
            read_only: false,
            options: Default::default(),
        }
    }

    #[test]
    fn normalize_profile_trims_optional_text_fields() {
        let normalized = normalize_profile(ConnectionProfile {
            id: "  demo  ".into(),
            engine: DbEngine::Postgres,
            host: Some("  localhost  ".into()),
            port: None,
            user: Some("  user  ".into()),
            password: Some("  secret  ".into()),
            database: Some("  samples  ".into()),
            url: None,
            transport: None,
            read_only: false,
            options: Default::default(),
        })
        .expect("valid profile");

        assert_eq!(normalized.id, "demo");
        assert_eq!(normalized.host.as_deref(), Some("localhost"));
        assert_eq!(normalized.user.as_deref(), Some("user"));
        assert_eq!(normalized.password.as_deref(), Some("  secret  "));
        assert_eq!(normalized.database.as_deref(), Some("samples"));
    }

    #[test]
    fn secret_redaction_handles_urls_and_connection_strings() {
        let message = "connect failed for postgres://user:secret@localhost/samples; Password=secret; PWD=other; token=abc&secret=def api_key=ghi";
        let redacted = redact_secret_text(message, &profile());
        assert!(!redacted.contains("user:secret"), "{redacted}");
        assert!(!redacted.contains("Password=secret"), "{redacted}");
        assert!(!redacted.contains("other"), "{redacted}");
        assert!(!redacted.contains("abc"), "{redacted}");
        assert!(!redacted.contains("def"), "{redacted}");
        assert!(!redacted.contains("ghi"), "{redacted}");
        assert!(redacted.contains("postgres://user:****@localhost/samples"));
        assert!(redacted.contains("Password=****;"));
        assert!(redacted.contains("PWD=****;"));
        assert!(redacted.contains("token=****&"));
        assert!(redacted.contains("api_key=****"));
    }
}
