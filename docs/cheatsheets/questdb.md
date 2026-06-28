<!-- seed: hand-authored QuestDB cheatsheet; target is generation from QuestDB docs + Irodori connector metadata -->

# QuestDB Cheatsheet

## At a glance

| | |
|---|---|
| Wire / driver | PostgreSQL wire protocol / sqlx `PgPool` |
| Adapter | `apps/desktop/src-tauri/src/db/postgres.rs` |
| Default port | 8812 |
| Query language | SQL with QuestDB time-series extensions |
| Irodori status | Wired through the Postgres-compatible path - see `docs/data-source-support-status.md` |
| What's different | Querying is SQL-like, but the high-value features are designated timestamps, `SAMPLE BY`, `LATEST ON`, `ASOF JOIN`, `TOLERANCE`, and metadata functions such as `tables()`. |

## Connect

Irodori accepts either a raw `url`/DSN or structured fields. QuestDB's
PostgreSQL wire endpoint defaults to port `8812`.

| Field | Example | Notes |
|---|---|---|
| `url` | `postgres://admin:quest@127.0.0.1:8812/qdb` | Uses the Postgres-compatible driver path. |
| host / port | `127.0.0.1` / `8812` | Used only when `url` is empty. |
| user / password | `admin` / `quest` | Adjust for your QuestDB deployment. |
| database | `qdb` | Common default for QuestDB PGWire connections. |

## Query model

- You type SQL and Irodori renders rows as a normal result table.
- Multiple statements use the same execution path as Postgres-compatible
  engines.
- For time-series queries, prefer tables with a **designated timestamp**. It is
  the timestamp QuestDB uses for `SAMPLE BY`, `LATEST ON`, and time-series joins.
- Add explicit time predicates early. Common QuestDB examples use
  `timestamp IN '2026-01-01'`, `BETWEEN`, or bounded `FROM ... TO` inside
  `SAMPLE BY`.

## Essential statements

```sql
-- Recent rows
SELECT *
FROM trades
WHERE timestamp IN '2026-01-01'
ORDER BY timestamp DESC
LIMIT 100;

-- Downsample by a fixed interval
SELECT timestamp, symbol, avg(price) AS avg_price, count() AS rows
FROM trades
WHERE timestamp IN '2026-01-01'
SAMPLE BY 1h;

-- Downsample with explicit output range and fill
SELECT timestamp, avg(price) AS avg_price
FROM trades
WHERE timestamp BETWEEN '2026-01-01T00:00:00Z' AND '2026-01-02T00:00:00Z'
SAMPLE BY 5m
  FROM '2026-01-01T00:00:00Z' TO '2026-01-02T00:00:00Z'
  FILL(PREV)
  ALIGN TO CALENDAR TIME ZONE 'UTC';

-- Latest row per series key
SELECT symbol, timestamp, price
FROM trades
WHERE timestamp IN '2026-01-01'
LATEST ON timestamp PARTITION BY symbol;

-- As-of join: each left row gets the nearest right row at or before its time
SELECT t.timestamp, t.symbol, t.price, q.bid_price, q.ask_price
FROM trades t
ASOF JOIN quotes q ON (symbol);

-- As-of join with a bounded lookback window
SELECT t.timestamp, t.symbol, t.price, q.bid_price
FROM trades t
ASOF JOIN quotes q ON (symbol) TOLERANCE 50T
WHERE t.timestamp IN '2026-01-01';
```

## SAMPLE BY

Shape to memorize:

```sql
SELECT timestamp_column, aggregate(...)
FROM table_name
[WHERE ...]
SAMPLE BY 5m
  [FROM 'start' TO 'end']
  [FILL(NULL | PREV | LINEAR | constant)]
  [ALIGN TO CALENDAR [TIME ZONE 'UTC'] [WITH OFFSET '...']
   | ALIGN TO FIRST OBSERVATION];
```

Operational notes:

- `SAMPLE BY` needs a designated timestamp column.
- Use `FROM ... TO` when you want missing intervals to appear in the result.
- `FILL` decides how empty buckets are represented. Common choices are
  `NULL`, `PREV`, `LINEAR`, or a constant.
- `FILL` comes before `ALIGN`.
- Calendar alignment is the default mental model for reporting buckets; first
  observation alignment is useful when the first row should define bucket edges.

## ASOF JOIN

Common forms:

```sql
-- Keyless: nearest right timestamp at or before the left timestamp
SELECT *
FROM left_table
ASOF JOIN right_table;

-- Keyed: match both time and one or more series keys
SELECT *
FROM left_table l
ASOF JOIN right_table r ON (symbol);

-- Limit stale matches
SELECT *
FROM left_table l
ASOF JOIN right_table r ON (symbol) TOLERANCE 1s;
```

Operational notes:

- The time comparison is implicit: QuestDB uses designated timestamps from the
  left and right inputs.
- Add `ON (...)` when a join must match by series key, such as `symbol`.
- `TOLERANCE` limits how far back QuestDB can look in the right-side input.
- If a subquery should join on a non-designated timestamp, order it by that
  timestamp so QuestDB can use it as the time axis.

## LATEST ON

```sql
SELECT *
FROM balances
LATEST ON ts PARTITION BY cust_id;

SELECT cust_id, balance_ccy, balance
FROM balances
LATEST ON ts PARTITION BY cust_id, balance_ccy;
```

Use `LATEST ON` for "most recent row per key". The order of `WHERE` and
`LATEST ON` matters. Without parentheses, a `WHERE` before `LATEST ON` filters
first and then picks the latest row. Wrap a `LATEST ON` query in parentheses when
you want to pick latest first and filter afterward.

## Introspection

```sql
-- Table inventory, row counts, timestamp range, WAL state
SELECT table_name,
       table_row_count,
       table_min_timestamp,
       table_max_timestamp,
       walEnabled,
       wal_pending_row_count
FROM tables()
ORDER BY table_max_timestamp DESC
LIMIT 20;

-- Partitions and disk footprint
SELECT *
FROM table_partitions('trades')
ORDER BY minTimestamp DESC;

SELECT size_pretty(sum(diskSize)) AS disk_size
FROM table_partitions('trades');

-- Active queries
SELECT *
FROM query_activity();

-- Materialized views
SELECT *
FROM materialized_views();
```

## Irodori-specific behavior

- QuestDB is exposed as the `questdb` engine but uses the same Postgres-wire
  execution path as `postgres.rs`.
- The SQL editor completion is QuestDB-aware for `SAMPLE BY`, `LATEST ON`,
  `ASOF JOIN`, `TOLERANCE`, `FILL`, and metadata helpers.
- Default snippets include `sampleby`, `samplebyfill`, `lateston`,
  `asofjoin`, `asofjointol`, and `qdbmeta`.
- Generic result handling still applies: rows render as tables, and large result
  sets should use explicit `LIMIT` or bounded time predicates.

## Gotchas

- Do not treat QuestDB as "just Postgres". Query syntax is compatible enough for
  the wire protocol, but time-series SQL extensions are QuestDB-specific.
- `SAMPLE BY` and `LATEST ON` work best with a designated timestamp. If you are
  querying imported or derived data without one, use subqueries carefully.
- `FILL(NONE)` is exclusive; do not mix it with other fill strategies.
- For `ASOF JOIN`, forgetting `ON (symbol)` can silently join across different
  series because only time is considered.
- Use `TOLERANCE` when stale right-side values would be dangerous.
- Prefer partition/time-bounded reads in production. Unbounded scans over hot
  time-series tables can be very large.

## Sources

- QuestDB `SAMPLE BY` docs - https://questdb.com/docs/query/sql/sample-by/
- QuestDB `ASOF JOIN` docs - https://questdb.com/docs/query/sql/asof-join/
- QuestDB `LATEST ON` docs - https://questdb.com/docs/query/sql/latest-on/
- QuestDB metadata functions - https://questdb.com/docs/reference/function/meta/
- Irodori support matrix - `docs/data-source-support-status.md`
