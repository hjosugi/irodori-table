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

Built-in engines use `builtin-engine-connection-config.json`. Installable native
connectors use the `connector.connection` model shipped by that extension, so
endpoint modes, fields, authentication methods, TLS controls, defaults, and
labels can evolve without adding connector-specific settings to the desktop
app. Common to all:

- **Connection name** — free text, used for grouping and for the tab badge.
- **Color tag** — a swatch grid plus a custom hex picker (**More colors**). The
  colour tints the connection's UI so production is visually distinct.
- **Read-only mode** — see below.

Each built-in layout or extension model chooses an input mode:

- **URL / DSN** — one connection string.
- **Fields** — discrete **Host**, **Port**, **User**, **Password**, **Database**
  inputs for built-ins, or the endpoint fields declared by an installed
  connector. Engines hide fields that do not apply.

Examples of the relabelling, all from the shipped config:

| Engine | Host label | Database label |
| --- | --- | --- |
| PostgreSQL | Host | Database |
| SQLite | File | SQLite file / :memory: |
| SQL Server | Server | Database |
| Oracle | Host | Service name / SID |
| Snowflake | Account / host | Database / schema |

A **Transport** row at the bottom of the form states how the connection is made.
Built-ins use their configured label; extensions use the first declared
transport (or their wire identifier when no transport is declared). It is a
readout, not a control.

### Unix sockets

Engines that support socket transport show a **Direct TCP** / **Unix socket**
toggle. Choosing **Unix socket** replaces the host and port inputs with a single
socket-path field.

### SSH tunnels

Engines that dial a host and a port show an **SSH tunnel** block. Ticking
**Use an SSH tunnel for this connection** reveals the SSH server fields; the app then
opens a local forwarder for the connection and dials the database through it.

| Field | Meaning |
| --- | --- |
| **SSH host** / **SSH port** | The SSH server to log in to. Port defaults to 22 |
| **SSH user** | The login name on that server |
| **Authentication** | **Password**, **Private key file**, or **SSH agent** |
| **SSH password** | Shown for password authentication. Session only |
| **Private key file** | Path to an OpenSSH private key. **Browse** opens the file picker |
| **Key passphrase** | Shown for key authentication. Session only |
| **Verify the SSH server host key** | Compares the server's key against **Expected host key** and refuses the session on a mismatch |
| **Expected host key** | Hex or base64. Required once verification is on |

**The host and port above the block stay the database endpoint, addressed as the
SSH server sees it.** A database that the bastion reaches at `10.0.0.5:5432`
goes in those fields even when that address means nothing on your own machine.

The local forwarding port is taken automatically per connection, so nothing has
to be reserved and two profiles can tunnel to the same database at once. The
**Transport** row at the bottom of the form reads **SSH tunnel via {host}**
while the block is on.

Two limits are worth knowing before you rely on it:

- **Field mode only.** A URL/DSN carries the user, database, and driver options
  in the same string that holds the host, so the tunnel is offered for the
  field form and hidden in URL mode.
- **Windows caps the key size.** Private keys are handed to the OS credential
  store for the length of one connect call, and Windows generic credentials stop
  at 2560 bytes. Ed25519 and 2048-bit RSA keys fit; a 4096-bit RSA key does not.

### Connector settings

Settings outside the standard profile columns appear in a **Connector settings**
block below the main grid. For extensions, the installed model is the sole
source of those fields; the app does not maintain a second per-connector list.
Built-in Snowflake keeps its native settings in the built-in config:

| Engine | Fields |
| --- | --- |
| Snowflake | **Warehouse**, **Role**, **Schema** |
| MySQL, MariaDB, TiDB | **Character set** |

**Character set** is the charset the MySQL handshake settles on — `utf8mb4`,
`utf8mb3`, `latin1` or `binary`, with the driver default when left empty. It is
offered for the MySQL wire only: PostgreSQL takes its client encoding as a
session setting rather than a connect parameter, so there is nothing to send at
connect time.

Engines with no declared settings do not grow an empty section. These values are
forwarded under the exact option names declared by the built-in config or
extension model. Secret extension fields remain session-only. See [Lakehouse
connections](lakehouse.md).

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

The same rule applies to extension-declared tokens, private keys, passphrases,
and custom driver options. They live only in the open form and are added to one
connect request; save, import, and export never persist them. Non-secret options
such as a region or warehouse can be saved with the profile.

**SSH credentials follow the same rule**, by a slightly longer route. The tunnel
config carries keychain handles rather than values, so the SSH password, the
private key contents, and the key passphrase are written to the OS keychain just
before the connect call and deleted again as soon as it returns — success or
failure. Nothing survives the attempt. What *is* saved with the profile is the
non-secret part: the SSH host, port, user, authentication method, the path to
the key file, and the host key to verify against. The key file itself is read
again on every connection.

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
   A build without them reports that the data source is not available and links
   to the availability table. Installing the matching native connector supplies
   the missing runtime and enables **Test** and **Connect**.

3. **Provided by a connector extension.** Everything lakehouse, vector, search,
   or document-oriented: DuckDB, MotherDuck, Databricks, Trino/Presto, Firebird,
   Elasticsearch,
   OpenSearch, Couchbase, DynamoDB, ArangoDB, IoTDB, Memgraph, Qdrant, Milvus,
   Pinecone, Cloud Spanner — plus Iceberg, Delta Lake, Hudi, Hive, Athena and S3
   Tables, whose connectors now ship from
   [irodori-lakehouse](https://github.com/irodori-table/irodori-lakehouse).
   Connecting without the extension installed fails
   with:

   > This data source needs the `irodori.<name>` connector extension. Install it
   > from Extensions, then try again.

   Install it from **Settings ▸ Extensions** first — see
   [Extensions](extensions.md).

When an enabled marketplace connector is installed for an engine that also has
a compiled implementation, the connector takes precedence. Its connection model
and its native runtime therefore stay paired; disabling or uninstalling it
returns that engine to the compiled implementation and built-in form.

The authoritative inventory, including which wire each engine speaks and how far
it has been verified, is
[`registry/data-source-support-status.md`](../registry/data-source-support-status.md).

## Starter profiles

The app ships with sample profiles. `sqlite-memory` opens an in-memory SQLite
database seeded with a small `products` / `orders` schema, which is enough to
exercise the editor, results grid, and ERD without any server. There are also
local Postgres and MySQL profiles pointing at the sample containers from the
[`irodori-samples`](https://github.com/irodori-table/irodori-samples) repository
(`task db-up DB=postgres`).

## Gaps

- **SSH tunnels are field-mode only**, and a URL/DSN profile has to be rewritten
  as fields before it can use one. Structured TLS controls cover the
  PostgreSQL/MySQL wires and the fields declared by an installed connector;
  dedicated compiled connectors used without an extension still need
  connector-specific TLS work.
- **SSH tunnels have no jump-host chain and no local-port control.** One hop,
  and the local port is always chosen for you.
- **No connection folders.** Grouping is inferred from the profile name and
  cannot be set explicitly.
- **No per-profile query timeout or session variables.**
- **Passwords cannot be remembered**, even optionally. Connection secrets reach
  the keychain only for the length of one connect call, unlike the AI provider
  key, which is stored.
