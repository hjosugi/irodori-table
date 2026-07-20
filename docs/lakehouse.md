# Lakehouse connections

Iceberg, Delta Lake, Hudi, Hive, Athena, S3 Tables, Databricks, DuckDB, and
MotherDuck are **extension-first**: the core desktop build has no driver for any
of them. Nothing works until the matching connector extension is installed, and
the connection dialog will not tell you that until you try to connect.

This page is the whole path, in order.

## Step 1 — install the connector extension

1. Open **Settings ▸ Extensions**. Reachable from **Tools ▸ Open Extensions**,
   from the command palette as **Open Extensions**, or from **Settings** (the
   gear, `Mod+,`) by choosing the Extensions tab.
2. The tab lists **Installed**, **Marketplace**, and **Recommended**. Use
   **Search Extensions in Marketplace** to find the one you need.
3. Press **Install** on the matching connector and confirm the **Install
   {name}?** dialog.

Each engine maps to exactly one extension id:

| Engine | Extension id |
| --- | --- |
| Apache Iceberg | `irodori.iceberg` |
| Delta Lake | `irodori.delta-lake` |
| Apache Hudi | `irodori.hudi` |
| Apache Hive | `irodori.hive` |
| Amazon Athena | `irodori.athena` |
| AWS S3 Tables | `irodori.s3-tables` |
| Databricks / Spark SQL | `irodori.databricks` |
| Trino / Presto | `irodori.trino-presto` |
| DuckDB | `irodori.duckdb` |
| MotherDuck | `irodori.motherduck` |

If you skip this step, **Connect** fails with:

> This data source needs the `irodori.iceberg` connector extension. Install it
> from Extensions, then try again. Build availability: …

That message is the intended signal. Note that the connection form itself gives
no earlier warning — the engine appears in the dropdown, the fields fill in, and
**Test** and **Connect** stay enabled right up to the point of failure. See
[Extensions](extensions.md) for how installation, platform targets, and checksum
verification work.

## Step 2 — create the profile

**File ▸ Open Connection Manager**, then the **+** button above the profile
list. Give it a **Connection name** and pick the engine.

The form re-shapes itself per engine. For **Iceberg**, **Delta Lake**, and
**Hudi** you get:

| Field | Notes |
| --- | --- |
| **Access key ID / client ID** | Placeholder `AKIAIOSFODNN7EXAMPLE` |
| **Secret access key / token** | Masked input |
| **Namespace / table** | Placeholder `namespace.table` |
| **Catalog URI** | Under **Connector settings**, e.g. `https://catalog.example.com/v1` |
| **Warehouse path** | Under **Connector settings**, e.g. `s3://bucket/warehouse` |

**Iceberg** additionally carries OAuth2 client-credentials settings for REST
catalogs: **OAuth2 token endpoint** (`oauth2ServerUri`, defaults to the
catalog's `/v1/oauth/tokens`), **OAuth2 client ID** (`oauth2ClientId`), and
**OAuth2 scope** (`scope`, default `catalog`). Its credential pair is labeled
**Access key ID / OAuth2 client ID** and **Secret access key / OAuth2 client
secret**: once any OAuth2 setting is present the connector falls back to these
profile fields for the client id and secret. The client secret is deliberately
not a connector setting — options are persisted in the clear, while the
password column stays session-only.

Host and port are hidden for these engines — the catalog endpoint goes in
**Catalog URI**, not in a host field. The **Transport** readout says **Lakehouse
catalog**.

Switching to URL mode instead gives a single **Table path** field
(`s3://bucket/warehouse/namespace/table`).

The other lakehouse engines differ:

- **Athena** — prefers URL mode (**Athena DSN / AWS profile**). In fields mode:
  **Region**, **AWS profile / access key**, **Secret / session token**, **Catalog
  / database** (`AwsDataCatalog/default`). Connector setting: **AWS region**,
  which is required.
- **S3 Tables** — **Region**, **Access key**, **Secret / token**, **Table /
  bucket**. Connector setting: **AWS region**, required.
- **Hive** — ordinary host/port form, default port `10000`, **Catalog / schema**.
  Connector settings: **Catalog URI**, **Warehouse path**.
- **Databricks** — **Workspace host**, **Token user**, **Access token**,
  **Catalog / schema**.
- **MotherDuck** — prefers URL mode: **MotherDuck DSN**, `md:` or
  `motherduck://token@md/database`.

### What connector settings actually are

**Connector settings** is not decoration. Those values are stored on the profile
as an `options` map and forwarded to the connector process verbatim, so the keys
have to match what that connector reads. The credentials, by contrast, ride the
ordinary profile columns — earlier builds hid those outright for lakehouse
engines, which is why a lakehouse profile now shows both a credentials pair and a
connector block.

## Step 3 — test and connect

**Test** validates without opening a session; **Connect** opens it. On success
the object browser populates from the connector's own metadata response —
catalogs and namespaces arrive as schemas, tables and views as objects.

Remember that connection passwords are session-only. The access key and secret
are cleared from storage when the app closes and must be re-entered next launch.
See [Connections](connections.md).

## The Lakehouse side panel is not a catalog browser

There is a **Lakehouse** panel in the sidebar. Despite appearances it does not
browse anything and makes no backend calls at all. It is a **SQL snippet
clipboard** with five fixed entries:

| Entry | What it pastes |
| --- | --- |
| **DuckDB Iceberg** | `INSTALL httpfs; INSTALL iceberg;` … `iceberg_scan('s3://…')` |
| **REST Catalog** | `CREATE SECRET … (TYPE iceberg …)` plus `ATTACH … (TYPE iceberg)` |
| **MotherDuck** | `INSTALL motherduck; ATTACH 'md:' AS md;` |
| **Athena** | A commented profile checklist and a `SELECT … LIMIT 100` |
| **Maintenance** | Commented `OPTIMIZE` / `VACUUM` / `expire_snapshots` reminders |

Each has **Load** (replaces the active editor tab), **Insert** (inserts at the
cursor), and a copy button. Right-clicking gives the same three actions. The
order of the five changes with the active engine; the content never does.

The panel also shows a status line — **connected** / **not connected** and an
object count — and a **Catalog** list of up to six schema names. Both are read
off metadata the connection already loaded for the object browser. Nothing in the
panel queries the catalog, refreshes, or drills down.

Treat the snippets as templates: they contain placeholder buckets, table names,
and credentials that you must edit before running.

## Gaps

- **No pre-connect warning for a missing connector.** The engine is selectable
  and the form is fully interactive; the failure only arrives at **Connect**.
- **The Lakehouse panel is static.** No catalog browsing, no namespace
  expansion, no snapshot/branch inspection, no table-format metadata — despite
  the `lakehouse` source-type contract in the extension catalog declaring
  catalog browsing, table-format metadata, execution-backend selection, and
  catalog credentials as workflows.
- **The Lakehouse panel is not translated.** Its strings — **Lakehouse**,
  **connected**, **no catalog loaded**, **Load**, **Insert** — are hardcoded
  English and stay English under the Japanese locale.
- **No credential chain / SSO / assume-role support** in the form. Only static
  key-and-secret pairs, or whatever the connector accepts inside a DSN.
- **Table maintenance is documentation, not a feature.** The **Maintenance**
  snippet is a comment block; there are no compaction, snapshot-expiry, or
  retention actions in the UI.
