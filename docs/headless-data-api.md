# Headless local data API (`irodori-server`)

An optional local HTTP server that exposes read and safe-write data operations
over the same token-scoped auth, read-only-by-default SQL guard, and audit trail
the desktop uses — for scripting, tests, and external tools. (PostgREST / DuckDB
httpserver were behavior references; the implementation is independent.)

## Endpoints

| Method + path | Purpose | Scope |
| --- | --- | --- |
| `GET /health` | liveness | read |
| `GET /v1/sources` | list configured sources | read |
| `GET /v1/sources/{id}/objects` | list tables/views | read |
| `POST /v1/sources/{id}/query` | run SQL (`{ "sql": "...", "maxRows": 1000 }`) | read / write |

Every response is JSON; errors use `{ "error", "code" }`. A query returns
`{ columns, rows, rowCount, elapsedMs, truncated }` (rows are a row-major matrix
of JSON cells, the same shape the desktop/web grids consume).

## Safety model (layered, all pre-existing + now wired)

- **Auth** (`auth.rs`): bearer tokens → scopes (`read`/`write`), constant-time
  compare. No tokens = open mode = read-only for anyone (localhost/dev); writes
  always require an explicit `write`-scoped token.
- **Read-only guard** (`guard.rs`): classifies each statement
  (ReadOnly/Write/Forbidden) after blanking strings/comments; multiple statements
  are forbidden. A `Write` statement needs the `write` scope **and** a writable
  source; otherwise `403`.
- **Audit** (`audit.rs`): one structured entry per request (JSON lines to stderr
  by default), success or rejection.

## Architecture

- `server.rs` — `ApiServer::dispatch(method, path, auth, body) -> ApiResponse` is
  transport-agnostic (unit-tested without sockets); `serve(addr, server)` is the
  hyper adapter.
- `source.rs` — the `DataSource` trait + a built-in `SqliteDataSource` (synchronous
  `rusqlite` on `spawn_blocking`, so it owns the statement and avoids the
  `'static`/`Send` borrow constraints async SQLite drivers impose inside an
  `async_trait` future). The desktop can implement `DataSource` over its live
  connection registry to expose the same adapters/proxy/security.
- `Registry` maps source ids → `Arc<dyn DataSource>`.

## Run standalone

```bash
IRODORI_SERVER_ADDR=127.0.0.1:8787 \
IRODORI_SERVER_SQLITE=/path/to.db \
IRODORI_SERVER_WRITABLE=1 \
IRODORI_SERVER_TOKEN=secret \
cargo run -p irodori-server
```

```bash
curl -s -H 'authorization: Bearer secret' \
  -d '{"sql":"select * from users limit 10"}' \
  http://127.0.0.1:8787/v1/sources/default/query
```

## Follow-ups
- Bounded streaming for large result sets (current SQLite source caps + flags
  `truncated`; a streaming/cursor path mirrors the desktop's spill design).
- Parameterized queries (`params`) and dedicated row read/insert/update/delete
  endpoints.
- A desktop `DataSource` impl over the live connection registry + a Tauri
  `server_start`/`server_stop` command.
