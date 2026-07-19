# Connections

Connection profiles are managed in one dialog: **File ▸ Open Connection
Manager**, or **Open Connection Manager** from the command palette
(`Mod+Shift+P`). No default keyboard shortcut is bound to it.

## The dialog

The left column lists saved profiles, grouped and searchable. The right column
is the form for whichever profile is selected. The footer holds the actions.

| Footer button | Effect |
| --- | --- |
| **Delete** | Removes the selected profile, or all selected profiles when several are picked |
| **Disconnect** | Closes the active session; disabled when nothing is connected |
| **Save** | Stores the profile without connecting |
| **Test** | Validates the profile against the server without opening a session |
| **Connect** | Opens the session and loads the object browser |

**Test** and **Connect** are disabled when the selected engine is not available
in the running build — see [Engine availability](#engine-availability).

### Profile list

- **Search connections** filters by name.
- Profiles are grouped by environment inferred from the name: **PRD /
  Production**, **STG / Staging**, **DEV / Development**, **Local**, **Other**.
  Group headers show `{connected} connected · {total} total`. Groups collapse.
- Click selects. `Shift`+click selects a range across expanded groups,
  `Ctrl`/`Cmd`+click toggles one. With several selected, **Delete** becomes
  **Delete selected ({count})**.
- The **+** button in the list header adds a profile.

## The form

Fields are driven by `engine-connection-config.json`, so the labels change with
the engine. Common to all:

- **Connection name** — free text, used for grouping and for the tab badge.
- **Color tag** — a swatch grid plus a custom hex picker (**More colors**). The
  colour tints the connection's UI so production is visually distinct.
- **Read-only mode** — see below.

Each engine chooses a preferred input mode:

- **URL / DSN** — one connection string. The label varies: **MotherDuck DSN**,
  **Athena DSN / AWS profile**, **Project / credentials JSON / DSN** for
  BigQuery, **Table path** for Iceberg-family engines.
- **Fields** — discrete **Host**, **Port**, **User**, **Password**, **Database**
  inputs. Engines hide the ones that do not apply: SQLite and DuckDB show only a
  file path; Snowflake, Athena, BigQuery, and the lakehouse engines hide the
  port.

Examples of the relabelling, all from the shipped config:

| Engine | Host label | Database label |
| --- | --- | --- |
| PostgreSQL | Host | Database |
| SQLite | File | SQLite file / :memory: |
| DuckDB | Host | DuckDB file / :memory: |
| SQL Server | Server | Database |
| Oracle | Host | Service name / SID |
| Snowflake | Account / host | Database / schema |
| Athena | Region | Catalog / database |
| Iceberg, Delta Lake, Hudi | *(hidden)* | Namespace / table |

A **Transport** row at the bottom of the form states how the connection is made
— **Direct TCP**, **Local file**, **Lakehouse catalog**, **Snowflake HTTPS
API**, and so on. It is a readout, not a control.

### Unix sockets

Engines that support socket transport show a **Direct TCP** / **Unix socket**
toggle. Choosing **Unix socket** replaces the host and port inputs with a single
socket-path field.

### Connector settings

Some engines carry settings that belong to the connector rather than to a
standard profile column. They appear in a **Connector settings** block below the
main grid:

| Engines | Fields |
| --- | --- |
| Iceberg, Delta Lake, Hudi, Hive | **Catalog URI**, **Warehouse path** |
| Athena, S3 Tables, DynamoDB | **AWS region** (required) |
| Snowflake | **Warehouse**, **Role**, **Schema** |

Engines with no declared settings do not grow an empty section. These values are
forwarded to the connector verbatim as the profile's `options` map. See
[Lakehouse connections](lakehouse.md).

### Read-only mode

Ticking **Read-only mode** marks the profile read-only. The connection then
carries a **read-only** badge, grid editing is refused, and the **Import** button
in the results toolbar is disabled with the tooltip **Read-only connection**.

It is a client-side guard on Irodori's own write paths, not a server-side
permission. It does not stop you typing and running `DELETE` in the editor. For
a real guarantee, use a database role with restricted rights.

## Where credentials go

**Connection passwords are not saved.** The password placeholder reads **Session
only** and that is literal: profiles are persisted to browser local storage under
`irodori.connectionProfiles.v1` after being passed through a sanitiser that
blanks the password field, strips `password=` / `pwd=` / `pass=` /
`passphrase=` parameters from connection strings, and clears the userinfo
password from URLs. You re-enter the password each time the app starts.

This is different from the AI provider API key, which *is* written to the OS
keychain — see [AI chat](ai-chat.md).

## Import and export

The **…** button beside the profile search opens **Connection import and
export**.

**Import Connections…** reads a file. **Export {format}** writes one. Eight
formats are supported: **Irodori JSON**, **DBeaver**, **DataGrip**,
**TablePlus**, **pgAdmin**, **MySQL Workbench**, **HeidiSQL**, and
**SQLTools**. Irodori's own export is JSON (`irodori-connections-<timestamp>.json`);
the DBeaver export is CSV.

Exports never contain passwords, for the reason above.

## Engine availability

46 engines are selectable. They reach a database by one of three routes, and the
failure mode differs:

1. **Compiled into this build.** PostgreSQL, MySQL/MariaDB/TiDB, SQLite,
   CockroachDB, YugabyteDB, Redshift, TimescaleDB, Neon, H2, ClickHouse,
   Snowflake, InfluxDB, QuestDB. These work with no extra steps.

2. **Compiled in only when the build enables the optional feature set.** Oracle,
   SQL Server, MongoDB, Neo4j, Redis, Cassandra, ScyllaDB, BigQuery, Bigtable.
   A build without them reports that the data source is not available in this
   desktop build and links to the availability table; **Test** and **Connect**
   are disabled for that engine.

3. **Provided by a connector extension.** Everything lakehouse, vector, search,
   or document-oriented: DuckDB, MotherDuck, Iceberg, Delta Lake, Hudi, Hive,
   Athena, S3 Tables, Databricks, Trino/Presto, Firebird, Elasticsearch,
   OpenSearch, Couchbase, DynamoDB, ArangoDB, IoTDB, Memgraph, Qdrant, Milvus,
   Pinecone, Cloud Spanner. Connecting without the extension installed fails
   with:

   > This data source needs the `irodori.<name>` connector extension. Install it
   > from Extensions, then try again.

   Install it from **Settings ▸ Extensions** first — see
   [Extensions](extensions.md).

The authoritative inventory, including which wire each engine speaks and how far
it has been verified, is
[`registry/data-source-support-status.md`](../registry/data-source-support-status.md).

## Starter profiles

The app ships with sample profiles. `sqlite-memory` opens an in-memory SQLite
database seeded with a small `products` / `orders` schema, which is enough to
exercise the editor, results grid, and ERD without any server. There are also
local Postgres and MySQL profiles pointing at the sample containers from the
[`irodori-samples`](https://github.com/hjosugi/irodori-samples) repository
(`make db-up DB=postgres`).

## Gaps

- **No SSH tunnelling and no SSL/TLS configuration UI.** Certificates and
  tunnels have to be arranged outside the app, or expressed inside the
  connection string where the driver supports it.
- **No connection folders.** Grouping is inferred from the profile name and
  cannot be set explicitly.
- **No per-profile query timeout or session variables.**
- **Passwords cannot be remembered**, even optionally. There is no keychain path
  for connection secrets, though one exists for the AI provider key.
