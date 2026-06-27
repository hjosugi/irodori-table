//! SVR-003 — the HTTP API: routing, auth, the read-only guard, and audit.
//!
//! [`ApiServer::dispatch`] is transport-agnostic (method + path + auth header +
//! body → status + JSON), which keeps it unit-testable without sockets; [`serve`]
//! is the thin hyper adapter on top.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use serde_json::json;
use tokio::net::TcpListener;

use crate::audit::{AuditEntry, AuditSink, StderrAuditSink};
use crate::auth::{Authenticator, Identity, Scope};
use crate::guard::{classify, SqlClass};
use crate::model::{ErrorBody, QueryBody, SourceInfo};
use crate::source::{DataError, Registry};

/// Default row cap applied when a request doesn't specify `maxRows`.
const DEFAULT_MAX_ROWS: u32 = 1000;

/// A serialized HTTP response (status + JSON body).
pub struct ApiResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The local data API.
pub struct ApiServer {
    registry: Registry,
    auth: Authenticator,
    audit: Arc<dyn AuditSink>,
    default_max_rows: u32,
}

impl ApiServer {
    pub fn new(registry: Registry, auth: Authenticator) -> Self {
        Self {
            registry,
            auth,
            audit: Arc::new(StderrAuditSink),
            default_max_rows: DEFAULT_MAX_ROWS,
        }
    }

    pub fn with_audit(mut self, audit: Arc<dyn AuditSink>) -> Self {
        self.audit = audit;
        self
    }

    pub fn with_default_max_rows(mut self, max_rows: u32) -> Self {
        self.default_max_rows = max_rows.max(1);
        self
    }

    /// Handle one request. Authenticates, routes, and always writes one audit entry.
    pub async fn dispatch(
        &self,
        method: &str,
        path: &str,
        authorization: Option<&str>,
        body: &[u8],
    ) -> ApiResponse {
        let mut entry = AuditEntry::new("anonymous", method, path);

        let identity = match self.auth.authenticate(authorization) {
            Ok(identity) => identity,
            Err(_) => {
                entry.status = 401;
                entry.action = "auth";
                self.audit.record(&entry);
                return error(401, "authentication required", "unauthorized");
            }
        };
        entry.token_id = identity.token_id.clone();

        let response = self.route(&identity, method, path, body, &mut entry).await;
        entry.status = response.status;
        self.audit.record(&entry);
        response
    }

    async fn route(
        &self,
        identity: &Identity,
        method: &str,
        path: &str,
        body: &[u8],
        entry: &mut AuditEntry,
    ) -> ApiResponse {
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        match (method, segments.as_slice()) {
            ("GET", ["health"]) => ok(&json!({ "ok": true })),
            ("GET", ["v1", "sources"]) => {
                entry.action = "list-sources";
                self.list_sources()
            }
            ("GET", ["v1", "sources", id, "objects"]) => {
                entry.action = "list-objects";
                entry.source = Some((*id).to_string());
                self.list_objects(id).await
            }
            ("POST", ["v1", "sources", id, "query"]) => {
                entry.action = "query";
                entry.source = Some((*id).to_string());
                self.query(identity, id, body, entry).await
            }
            _ => error(404, "not found", "notFound"),
        }
    }

    fn list_sources(&self) -> ApiResponse {
        let sources: Vec<SourceInfo> = self
            .registry
            .ids()
            .into_iter()
            .filter_map(|id| {
                self.registry.get(&id).map(|source| SourceInfo {
                    id,
                    engine: source.engine().to_string(),
                    read_only: source.read_only(),
                })
            })
            .collect();
        ok(&sources)
    }

    async fn list_objects(&self, id: &str) -> ApiResponse {
        let Some(source) = self.registry.get(id) else {
            return error(404, "unknown source", "notFound");
        };
        match source.list_objects().await {
            Ok(objects) => ok(&objects),
            Err(err) => data_error(err),
        }
    }

    async fn query(
        &self,
        identity: &Identity,
        id: &str,
        body: &[u8],
        entry: &mut AuditEntry,
    ) -> ApiResponse {
        let Some(source) = self.registry.get(id) else {
            return error(404, "unknown source", "notFound");
        };
        let request: QueryBody = match serde_json::from_slice(body) {
            Ok(request) => request,
            Err(err) => return error(400, &format!("invalid request body: {err}"), "badRequest"),
        };

        // Read-only-by-default guard.
        match classify(&request.sql) {
            SqlClass::Forbidden => {
                return error(400, "statement is not allowed", "forbiddenStatement");
            }
            SqlClass::Write => {
                if source.read_only() {
                    return error(403, "source is read-only", "readOnly");
                }
                if !identity.has_scope(Scope::Write) {
                    return error(403, "write scope required", "forbidden");
                }
            }
            SqlClass::ReadOnly => {}
        }

        let max_rows = request
            .max_rows
            .map(|n| n.max(1))
            .unwrap_or(self.default_max_rows);
        match source.run_query(&request.sql, max_rows).await {
            Ok(result) => {
                entry.row_count = Some(result.row_count);
                ok(&result)
            }
            Err(err) => data_error(err),
        }
    }
}

fn ok<T: Serialize>(value: &T) -> ApiResponse {
    match serde_json::to_vec(value) {
        Ok(body) => ApiResponse { status: 200, body },
        Err(err) => error(500, &format!("serialization failed: {err}"), "internal"),
    }
}

fn error(status: u16, message: &str, code: &'static str) -> ApiResponse {
    let body = serde_json::to_vec(&ErrorBody {
        error: message.to_string(),
        code,
    })
    .unwrap_or_else(|_| b"{\"error\":\"internal\",\"code\":\"internal\"}".to_vec());
    ApiResponse { status, body }
}

fn data_error(err: DataError) -> ApiResponse {
    match err {
        DataError::NotFound(message) => error(404, &message, "notFound"),
        DataError::Backend(message) => error(500, &message, "backend"),
    }
}

/// Run the API over HTTP until the process ends.
pub async fn serve(addr: SocketAddr, server: Arc<ApiServer>) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    eprintln!("irodori-server listening on http://{addr}");
    loop {
        let (stream, _peer) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            let service = service_fn(move |req| handle(Arc::clone(&server), req));
            if let Err(err) = http1::Builder::new().serve_connection(io, service).await {
                eprintln!("connection error: {err}");
            }
        });
    }
}

async fn handle(
    server: Arc<ApiServer>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let authorization = req
        .headers()
        .get(hyper::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let body = req
        .into_body()
        .collect()
        .await
        .map(|collected| collected.to_bytes())
        .unwrap_or_default();

    let response = server
        .dispatch(&method, &path, authorization.as_deref(), &body)
        .await;

    let built = Response::builder()
        .status(response.status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(response.body)))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::from_static(b"{}"))));
    Ok(built)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::MemoryAuditSink;
    use crate::auth::Token;
    use crate::source::{DataSource, SqliteDataSource};

    async fn writable_server() -> (ApiServer, Arc<MemoryAuditSink>) {
        let source = SqliteDataSource::open(":memory:", false).expect("open");
        // Seed a table.
        source
            .run_query("CREATE TABLE t (id INTEGER, name TEXT)", 10)
            .await
            .expect("create");
        source
            .run_query("INSERT INTO t VALUES (1, 'a'), (2, 'b')", 10)
            .await
            .expect("insert");

        let registry = Registry::new().with("default", Arc::new(source));
        let auth = Authenticator::new(vec![Token::new("ci", "secret", [Scope::Read, Scope::Write])]);
        let audit = Arc::new(MemoryAuditSink::default());
        let server = ApiServer::new(registry, auth).with_audit(audit.clone());
        (server, audit)
    }

    fn body_json(response: &ApiResponse) -> serde_json::Value {
        serde_json::from_slice(&response.body).expect("json body")
    }

    #[tokio::test]
    async fn health_is_open() {
        let (server, _) = writable_server().await;
        let response = server.dispatch("GET", "/health", None, b"").await;
        assert_eq!(response.status, 401, "tokens configured -> auth required");

        // With a valid token, health responds.
        let ok = server
            .dispatch("GET", "/health", Some("Bearer secret"), b"")
            .await;
        assert_eq!(ok.status, 200);
        assert_eq!(body_json(&ok), json!({ "ok": true }));
    }

    #[tokio::test]
    async fn read_query_returns_rows() {
        let (server, audit) = writable_server().await;
        let response = server
            .dispatch(
                "POST",
                "/v1/sources/default/query",
                Some("Bearer secret"),
                br#"{"sql":"SELECT id, name FROM t ORDER BY id"}"#,
            )
            .await;
        assert_eq!(response.status, 200, "{:?}", String::from_utf8_lossy(&response.body));
        let body = body_json(&response);
        assert_eq!(body["columns"], json!(["id", "name"]));
        assert_eq!(body["rows"], json!([[1, "a"], [2, "b"]]));
        assert_eq!(body["rowCount"], json!(2));
        assert!(audit.entries().iter().any(|e| e.action == "query"));
    }

    #[tokio::test]
    async fn forbidden_and_unknown_source() {
        let (server, _) = writable_server().await;
        let multi = server
            .dispatch(
                "POST",
                "/v1/sources/default/query",
                Some("Bearer secret"),
                br#"{"sql":"SELECT 1; DROP TABLE t"}"#,
            )
            .await;
        assert_eq!(multi.status, 400);

        let missing = server
            .dispatch(
                "POST",
                "/v1/sources/nope/query",
                Some("Bearer secret"),
                br#"{"sql":"SELECT 1"}"#,
            )
            .await;
        assert_eq!(missing.status, 404);
    }

    #[tokio::test]
    async fn writes_need_scope_and_writable_source() {
        // Read-only token against a writable source: write rejected.
        let source = SqliteDataSource::open(":memory:", false).unwrap();
        source.run_query("CREATE TABLE t (id INTEGER)", 10).await.unwrap();
        let registry = Registry::new().with("default", Arc::new(source));
        let auth = Authenticator::new(vec![Token::new("ro", "ro-secret", [Scope::Read])]);
        let server = ApiServer::new(registry, auth);

        let rejected = server
            .dispatch(
                "POST",
                "/v1/sources/default/query",
                Some("Bearer ro-secret"),
                br#"{"sql":"INSERT INTO t VALUES (1)"}"#,
            )
            .await;
        assert_eq!(rejected.status, 403);
    }

    #[tokio::test]
    async fn invalid_token_is_unauthorized() {
        let (server, _) = writable_server().await;
        let response = server
            .dispatch("GET", "/v1/sources", Some("Bearer wrong"), b"")
            .await;
        assert_eq!(response.status, 401);
    }
}
