# Web app architecture

The web app lives in `apps/web` as an independent Vite/React app. It is kept
separate from the Tauri desktop shell so browser-only database runtimes, mobile
layout, and online proxy contracts can evolve without adding conditional paths to
the desktop app.

## Runtime model

- Local SQLite runs in a dedicated Web Worker through `sql.js`.
- SQLite database bytes are persisted in IndexedDB and can be exported or
  imported as `.sqlite`, `.sqlite3`, or `.db` files.
- Local DuckDB runs through `@duckdb/duckdb-wasm` behind the same worker pool
  boundary. It is currently an in-memory local analytics surface.
- Online connections use an HTTP endpoint contract instead of direct TCP from
  the browser.
- The browser keeps one worker per local connection and evicts idle workers when
  the pool reaches its configured limit.

## Online endpoint contract

The web app posts JSON to the configured endpoint:

```json
{
  "connectionId": "online-api",
  "engine": "postgres",
  "sql": "select 1",
  "maxRows": 500
}
```

The endpoint should return either array rows:

```json
{
  "columns": ["id", "name"],
  "rows": [[1, "one"]],
  "rowCount": 1,
  "elapsedMs": 12,
  "truncated": false
}
```

or object rows:

```json
{
  "rows": [{ "id": 1, "name": "one" }]
}
```

Authentication tokens are sent as `Authorization: Bearer ...`; they are not
included in the JSON request body.

## Repo split criteria

Keep the app in this repo while it shares product direction, tests, SQL/result
modeling, and release notes with the desktop app.

Split it into a separate repo if any of these become true:

- The web app needs an independent hosted release cadence.
- The online proxy requires separate security ownership or deployment secrets.
- Browser database packages dominate install/build time for desktop work.
- A mobile-first UX diverges enough that shared UI code creates more coupling
  than reuse.

Before splitting, extract shared TypeScript types and result-grid utilities into
`packages/` so both repos can keep a stable compatibility surface.
