# External DB contract and verification runbook

Last checked: 2026-06-26 JST.

This runbook covers every `DbEngine` currently declared by Irodori and explains
how to contract/provision external services when local verification is not
enough. The source of truth for engine support remains
[`docs/data-source-support-status.md`](data-source-support-status.md) and
`apps/desktop/src-tauri/src/db/engine.rs`.

## Policy

- Prefer local verification first when an engine has an embedded mode or a
  `samples/<engine>/compose.yaml`.
- For managed-only engines, create resources with IaC where the vendor has a
  stable provider or API.
- Never keep cloud resources running after verification. Set auto-suspend,
  TTLs, deletion protection off, and budget alerts where available.
- Store cloud credentials outside git. Use short-lived access tokens for manual
  checks when possible; use service account JSON only for repeatable adapter
  tests that explicitly need it.
- A source is "Verified" only after an Irodori connect/query path has been
  exercised, not merely after a vendor CLI query works.

## Local-first matrix

| Engine | `DbEngine` id | Local verification | Contract needed for adapter verification? | IaC path when external |
|---|---|---:|---:|---|
| PostgreSQL | `postgres` | `samples/postgres` | No | Terraform via any Postgres provider only for managed smoke tests |
| MySQL | `mysql` | `samples/mysql` | No | Cloud SQL/RDS/etc. optional |
| MariaDB | `mariadb` | `samples/mariadb` | No | Cloud/RDS optional |
| SQLite | `sqlite` | embedded file | No | Not applicable |
| Oracle | `oracle` | `samples/oracle` | No for local target | OCI or other managed Oracle optional |
| SQL Server | `sqlserver` | `samples/sqlserver` | No | Azure SQL/RDS optional |
| DuckDB | `duckdb` | embedded / `:memory:` | No | Not applicable |
| MongoDB | `mongodb` | `samples/mongodb` | No | Atlas optional |
| CockroachDB | `cockroachdb` | `samples/cockroachdb` | No | Cockroach Cloud optional |
| YugabyteDB | `yugabytedb` | `samples/yugabytedb` | No | YugabyteDB Aeon optional |
| TimescaleDB | `timescaledb` | `samples/timescaledb` | No | Timescale Cloud optional |
| TiDB | `tidb` | `samples/tidb` | No | TiDB Cloud optional |
| H2 | `h2` | add local TCP fixture | No after fixture exists | Not applicable |
| ClickHouse | `clickhouse` | add local compose fixture | No after fixture exists | ClickHouse Cloud optional |
| Neo4j | `neo4j` | add local compose fixture | No after fixture exists | Aura optional |
| Memgraph | `memgraph` | add local compose fixture | Connector not production yet | Defer until connector is wired |
| InfluxDB | `influxdb` | add local compose fixture | No after fixture exists | InfluxDB Cloud optional |
| Redis | `redis` | add local compose fixture | No after fixture exists | Redis Cloud optional |
| Cassandra | `cassandra` | add Cassandra/Scylla compose fixture | No after fixture exists | Astra/Scylla Cloud optional |
| Qdrant | `qdrant` | add local compose fixture | Connector not production yet | Defer until connector is wired |
| Milvus | `milvus` | add local compose fixture | Connector not production yet | Defer until connector is wired |
| Redshift | `redshift` | No practical local Redshift | Yes | Terraform AWS provider |
| Neon | `neon` | Postgres-compatible local proxy is not enough | Yes | Neon API/CLI; Terraform provider must be reviewed before use |
| Snowflake | `snowflake` | No local Snowflake | Yes | Snowflake Terraform provider |
| BigQuery | `bigquery` | No official local BigQuery API target | Yes | Google Terraform provider |
| Bigtable | `bigtable` | Emulator exists, but current adapter targets Cloud REST API | Yes | Google Terraform provider |
| Pinecone | `pinecone` | No local Pinecone; connector not production yet | Yes, after connector exists | Pinecone Terraform provider |

## Not-yet-registered lakehouse and federated SQL targets

These sources are in the coverage strategy but are not `DbEngine` variants yet.
Do not add cloud contracts just to test the current app; provision them when
implementing the adapter, catalog model, or lakehouse execution path.

| Source | Current app status | Local-first check | External / IaC path |
|---|---|---|---|
| Apache Hive / HiveServer2 | Not registered | Local HiveServer2 + Beeline fixture | Self-managed Hadoop/Hive on VMs or managed Hadoop |
| Hive Metastore | Not registered; important for Iceberg catalogs | Local metastore + object store fixture | AWS Glue or managed metastore services |
| Apache Iceberg | Not registered as an engine; priority lakehouse table format | DuckDB/DataFusion/Trino against local object store/catalog | AWS Glue, S3 Tables, REST catalog, warehouse-native Iceberg |
| Trino / Presto | Not registered | Official Trino container with `tpch`, then Hive/Iceberg catalogs | Helm/Kubernetes or Starburst; Terraform/Helm for infra |
| Databricks / Spark SQL | Not registered | No equivalent local Databricks SQL endpoint | Databricks Terraform provider |
| Delta Lake / Apache Hudi | Not registered; after Iceberg | Local files through DuckDB/DataFusion/Spark fixtures | Databricks or managed Spark/lakehouse |

## Existing local verification

Use the sample harness for engines that already have compose fixtures:

```bash
make db-verify DB=postgres
make db-verify DB=mysql
make db-all
make db-up DB=postgres
make db-down DB=postgres
```

For engines with no `samples/<engine>/compose.yaml`, add a fixture before
creating a cloud contract unless the service is managed-only or the local
emulator does not exercise the same adapter path.

## Cloud-only verification levels

Use these levels consistently in PR notes:

| Level | Meaning | Required evidence |
|---|---|---|
| L0 | Vendor resource exists | IaC output or vendor CLI/API `select 1` equivalent |
| L1 | Irodori connects | App profile connects and `SELECT 1` or equivalent succeeds |
| L2 | Repeatable test | Env-gated integration test or scripted smoke test in repo |

Do not mark an engine "Verified" in `data-source-support-status.md` unless it
has at least L2 coverage, or a maintainer explicitly accepts L1 as temporary
evidence.

## Redshift

Use Redshift Serverless for smoke tests; it is closest to the current Postgres
wire adapter and avoids managing a provisioned cluster. AWS documents the
serverless endpoint shape as:

```text
workgroup-name.account-number.aws-region.redshift-serverless.amazonaws.com:5439/dev
```

Contract/provisioning:

1. Create or use an AWS account with billing enabled.
2. Choose a region where Redshift Serverless is available.
3. Create a dedicated VPC security group. Restrict inbound `5439` to the
   verifier's current IP or VPN CIDR.
4. Create a Redshift Serverless namespace and workgroup.
5. Create a database user for Irodori verification. Keep the admin password in a
   secret manager or local password manager, not in Terraform state if avoidable.
6. Copy the workgroup endpoint and build an Irodori URL:

```bash
export IRODORI_REDSHIFT_URL='postgres://USER:PASSWORD@WORKGROUP.ACCOUNT.REGION.redshift-serverless.amazonaws.com:5439/dev?sslmode=require'
```

IaC skeleton:

```hcl
resource "aws_redshiftserverless_namespace" "irodori" {
  namespace_name      = "irodori-smoke"
  db_name             = "dev"
  admin_username      = var.admin_username
  admin_user_password = var.admin_password
}

resource "aws_redshiftserverless_workgroup" "irodori" {
  workgroup_name      = "irodori-smoke"
  namespace_name      = aws_redshiftserverless_namespace.irodori.namespace_name
  base_capacity       = 8
  publicly_accessible = true
  subnet_ids          = var.subnet_ids
  security_group_ids  = [aws_security_group.redshift.id]
}
```

Verification:

1. Confirm with a SQL client first:
   `select 1 as one;`
2. In Irodori, create a `redshift` connection using the Postgres-style URL.
3. Run:

```sql
select current_database() as db, current_user as user_name;
select 1 as one;
```

Cleanup:

```bash
terraform destroy
```

References:

- Amazon Redshift Serverless overview: <https://docs.aws.amazon.com/redshift/latest/mgmt/working-with-serverless.html>
- Redshift Serverless connection strings and default port: <https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-connecting.html>
- Terraform AWS provider resources: `aws_redshiftserverless_namespace`,
  `aws_redshiftserverless_workgroup`

## Neon

Neon is Postgres wire compatible, but local Postgres does not verify Neon's
endpoint behavior, TLS, auth, suspend/resume, or branch semantics.

Contract/provisioning:

1. Sign up or log in to the Neon Console.
2. Create a new project. Neon creates a root branch, primary compute, default
   Postgres database, and default role for the project.
3. Pick Postgres version and region close to the verifier.
4. If the project is protected, configure IP Allow for the verifier IP.
5. Copy the pooled or direct connection string from the dashboard.

IaC:

- Preferred repeatable path today: Neon API or Neon CLI.
- Terraform can be evaluated separately, but do not make a third-party provider
  mandatory until it is reviewed and pinned.

API-driven provisioning sketch:

```bash
export NEON_API_KEY='...'

curl -sS -X POST 'https://console.neon.tech/api/v2/projects' \
  -H 'Accept: application/json' \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"project":{"name":"irodori-smoke","pg_version":17}}'
```

Verification:

```bash
export IRODORI_NEON_URL='postgres://USER:PASSWORD@HOST/neondb?sslmode=require'
```

1. Connect in Irodori as engine `neon`.
2. Run:

```sql
select version();
select current_database(), current_user;
```

Cleanup:

1. Delete the Neon project.
2. If on a paid plan, verify billing/usage limits after deletion.

References:

- Neon project creation and default resources: <https://neon.com/docs/manage/projects>
- Neon API prerequisites and authentication: <https://neon.com/docs/reference/api-reference>
- Neon project creation API: <https://api-docs.neon.tech/reference/createproject>

## Snowflake

Snowflake has no local runtime. Use a trial account for connector verification
when possible.

Contract/provisioning:

1. Sign up for a Snowflake trial account with a valid email.
2. Select cloud platform, region, and edition.
3. Create a small warehouse with auto-suspend enabled.
4. Create a database/schema dedicated to smoke tests.
5. Create a least-privilege user/role for Irodori.
6. Record the account identifier. Snowflake's preferred identifier is
   `organization-account`; the account URL format is
   `account_identifier.snowflakecomputing.com`.

IaC skeleton:

```hcl
terraform {
  required_providers {
    snowflake = {
      source  = "snowflakedb/snowflake"
      version = "~> 2.0"
    }
  }
}

provider "snowflake" {}

resource "snowflake_warehouse" "irodori" {
  name           = "IRODORI_SMOKE_WH"
  warehouse_size = "XSMALL"
  auto_suspend   = 60
  auto_resume    = true
}

resource "snowflake_database" "irodori" {
  name = "IRODORI_SMOKE_DB"
}

resource "snowflake_schema" "public" {
  database = snowflake_database.irodori.name
  name     = "PUBLIC"
}
```

Irodori profile:

- Engine: `snowflake`
- Host: `ACCOUNT_IDENTIFIER.snowflakecomputing.com`
- User/password: smoke-test user
- Database: `IRODORI_SMOKE_DB`
- Options: `warehouse=IRODORI_SMOKE_WH`, `schema=PUBLIC`, optional `role=...`

Verification:

```sql
select current_version();
select current_database(), current_schema(), current_warehouse();
```

Cleanup:

1. `terraform destroy`, or drop the warehouse/database/user manually.
2. For trials, track remaining credits and cancel through Snowflake Support if
   the account should not remain active.

References:

- Snowflake trial account rules: <https://docs.snowflake.com/en/user-guide/admin-trial-account>
- Snowflake account identifiers: <https://docs.snowflake.com/en/user-guide/admin-account-identifier>
- Snowflake Terraform provider: <https://docs.snowflake.com/en/user-guide/terraform>

## BigQuery

BigQuery is cloud-only for Irodori's current REST API adapter.

Contract/provisioning:

1. Create or select a Google Cloud project.
2. Verify billing is enabled.
3. Enable `bigquery.googleapis.com`.
4. Create a dedicated dataset, for example `irodori_smoke`.
5. Create a service account for repeatable checks or use a short-lived OAuth
   access token for manual checks.
6. Grant minimum useful roles:
   - `roles/bigquery.jobUser` on the project.
   - `roles/bigquery.dataViewer` / `roles/bigquery.dataEditor` on the dataset
     depending on whether tests create tables.

IaC skeleton:

```hcl
resource "google_project_service" "bigquery" {
  project = var.project_id
  service = "bigquery.googleapis.com"
}

resource "google_service_account" "irodori" {
  project      = var.project_id
  account_id   = "irodori-bigquery-smoke"
  display_name = "Irodori BigQuery smoke test"
}

resource "google_project_iam_member" "job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.irodori.email}"
}

resource "google_bigquery_dataset" "irodori" {
  project                    = var.project_id
  dataset_id                 = "irodori_smoke"
  location                   = "US"
  default_table_expiration_ms = 86400000
}
```

Irodori profile:

- Engine: `bigquery`
- Database or Host: GCP project ID
- Password: either a short-lived OAuth access token, or service account JSON.
  The adapter parses service account JSON when the password starts with `{`.

Manual short-lived token:

```bash
gcloud auth application-default login
export IRODORI_BIGQUERY_TOKEN="$(gcloud auth print-access-token)"
```

Verification:

```sql
select 1 as one;
select table_schema, table_name
from `PROJECT_ID`.region-us.INFORMATION_SCHEMA.TABLES
limit 10;
```

Cleanup:

```bash
terraform destroy
```

References:

- Google Cloud Terraform prerequisite flow: <https://cloud.google.com/docs/terraform/resource-management/managing-infrastructure-as-code>
- BigQuery dataset Terraform sample: <https://cloud.google.com/bigquery/docs/samples/bigquery-create-dataset>
- Google service account creation: <https://cloud.google.com/iam/docs/service-accounts-create>
- Google service account key management: <https://cloud.google.com/iam/docs/keys-create-delete>

## Bigtable

Bigtable has tooling and emulators, but the current Irodori adapter targets the
Cloud Bigtable REST API, so cloud verification is still required.

Contract/provisioning:

1. Create or select a Google Cloud project.
2. Verify billing is enabled.
3. Enable Bigtable APIs.
4. Create a small Bigtable instance with one development cluster.
5. Create a table, column family, and one row.
6. Create a service account or use a short-lived OAuth access token.
7. Grant minimum useful Bigtable IAM roles for table read/list operations.

IaC skeleton:

```hcl
resource "google_project_service" "bigtable" {
  project = var.project_id
  service = "bigtable.googleapis.com"
}

resource "google_bigtable_instance" "irodori" {
  name                = "irodori-smoke"
  deletion_protection = false

  cluster {
    cluster_id   = "irodori-smoke-c1"
    zone         = var.zone
    num_nodes    = 1
    storage_type = "SSD"
  }
}

resource "google_bigtable_table" "irodori" {
  name          = "irodori-smoke-table"
  instance_name = google_bigtable_instance.irodori.name

  column_family {
    family = "cf1"
  }
}
```

Irodori profile:

- Engine: `bigtable`
- Host: GCP project ID
- Database: Bigtable instance ID
- Password: short-lived OAuth access token or service account JSON.

Verification:

1. Seed one row:

```bash
echo "project = PROJECT_ID" > ~/.cbtrc
echo "instance = irodori-smoke" >> ~/.cbtrc
cbt set irodori-smoke-table r1 cf1:c1=test-value
cbt read irodori-smoke-table
```

2. In Irodori, run either:

```text
irodori-smoke-table
```

or:

```sql
select * from irodori-smoke-table limit 10
```

Cleanup:

```bash
terraform destroy
rm -f ~/.cbtrc
```

References:

- Bigtable quickstart instance/table/read/write flow: <https://cloud.google.com/bigtable/docs/create-instance-write-data-cbt-cli>
- Bigtable IAM access control: <https://cloud.google.com/bigtable/docs/access-control>

## Pinecone

Pinecone is listed in `DbEngine`, but the current support status marks it as
"recognized, no connector". Provision Pinecone only when implementing or
verifying that connector.

Contract/provisioning:

1. Sign up for Pinecone.
2. Create or select a project.
3. Create an API key for index/query access.
4. Create a serverless index that matches the connector test dimension and
   metric.

IaC skeleton:

```hcl
terraform {
  required_providers {
    pinecone = {
      source  = "pinecone-io/pinecone"
      version = "~> 2.0.0"
    }
  }
}

provider "pinecone" {}

resource "pinecone_index" "irodori" {
  name        = "irodori-smoke"
  dimension   = 3
  metric      = "cosine"
  vector_type = "dense"

  spec = {
    serverless = {
      cloud  = "aws"
      region = "us-west-2"
    }
  }

  deletion_protection = "disabled"
}
```

Verification:

- Do not mark Irodori verification complete until `Wire::Pinecone` has a
  production connector.
- After the connector exists, test project listing, index metadata, upsert/query,
  and cleanup.

Cleanup:

```bash
terraform destroy
```

References:

- Pinecone Terraform provider and resource examples: <https://docs.pinecone.io/integrations/terraform>

## Hive, Trino, Databricks, and Iceberg

These are in scope, but they are not current `DbEngine` variants. Treat them as
adapter-design inputs until the registry grows new variants.

### Apache Hive / HiveServer2

Hive can mean two different things in Irodori planning:

- HiveServer2 as a SQL warehouse endpoint.
- Hive Metastore as a catalog for legacy Hive tables and Iceberg catalogs.

Local-first plan:

1. Add a `samples/hive/compose.yaml` fixture only when implementing the adapter.
2. Include HiveServer2, a metastore database, and a small table.
3. Verify with Beeline first:

```bash
beeline -u 'jdbc:hive2://localhost:10000/default'
```

4. After Irodori has a Hive adapter, verify:

```sql
show databases;
show tables;
select 1;
```

External / IaC plan:

- Prefer self-managed infrastructure only for integration testing that cannot be
  reproduced locally.
- On AWS, use EMR or a small Hadoop/Hive stack behind Terraform-managed VPC,
  security groups, IAM roles, and auto-termination.
- On GCP, use Dataproc with Terraform-managed cluster lifecycle and
  auto-delete/idle-delete policies.
- Keep HiveServer2 and metastore ports private; access through VPN, SSH tunnel,
  or a bastion.

Do not make Hive the first lakehouse implementation path unless the task is
specifically legacy Hive compatibility. For Iceberg, a catalog-first path is more
useful.

References:

- Apache Hive project: <https://hive.apache.org/>
- Apache Hive documentation: <https://hive.apache.org/docs/latest/>

### Trino / Presto

Trino is the fastest way to test a federated SQL path locally because the
official container includes a default configuration and `tpch` sample catalog.

Local-first plan:

```bash
docker run --name trino -d -p 8080:8080 trinodb/trino
docker exec -it trino trino
```

Smoke query:

```sql
select count(*) from tpch.sf1.nation;
```

Adapter expectation:

- Irodori should add a `trino` or `presto` `DbEngine` before any contract work.
- The connector should speak Trino's HTTP protocol or use a reviewed client
  crate; do not force it through generic SQL formatting only.
- Metadata should include catalogs, schemas, tables, views, and connector type.

External / IaC plan:

- For self-managed Trino, prefer Kubernetes + Helm; Terraform manages the
  cluster/network/secrets and Helm release.
- For managed Starburst or equivalent, use the vendor API/provider only after
  reviewing licensing and cost controls.

References:

- Trino Docker container: <https://trino.io/docs/current/installation/containers.html>
- Trino Hive connector: <https://trino.io/docs/current/connector/hive.html>
- Trino Iceberg connector: <https://trino.io/docs/current/connector/iceberg.html>

### Databricks / Spark SQL

Databricks/Spark SQL is cloud-first. Do not try to treat local Spark as proof of
Databricks SQL connector behavior; use local Spark only for parser/query-model
experiments.

Contract/provisioning:

1. Use an existing Databricks workspace or create one through the cloud account's
   standard workspace process.
2. Create a SQL warehouse with the smallest acceptable size and auto-stop.
3. Create or select a catalog/schema/table for smoke tests.
4. Create a service principal or PAT with the minimum permissions required for
   SQL warehouse access.

IaC skeleton:

```hcl
terraform {
  required_providers {
    databricks = {
      source = "databricks/databricks"
    }
  }
}

provider "databricks" {}

resource "databricks_sql_endpoint" "irodori" {
  name             = "irodori-smoke"
  cluster_size     = "2X-Small"
  max_num_clusters = 1
  auto_stop_mins   = 10
}
```

Verification after an adapter exists:

```sql
select current_catalog(), current_schema();
select 1 as one;
```

Cleanup:

```bash
terraform destroy
```

References:

- Databricks Terraform provider: <https://docs.databricks.com/aws/en/dev-tools/terraform/>
- Databricks SQL warehouses: <https://docs.databricks.com/aws/en/sql/admin/sql-endpoints>

### Apache Iceberg and catalogs

Iceberg is not a database server. It is a table format plus catalog contracts.
Irodori should model Iceberg as a source family with these pieces:

- Catalog: Hive Metastore, AWS Glue, REST, JDBC, S3 Tables, or warehouse-native.
- Storage: S3, GCS, Azure Blob, local filesystem, or compatible object store.
- Execution: DuckDB/DataFusion locally, Trino/Spark/warehouse remotely.

Local-first plan:

1. Use DuckDB or Trino against a local object store fixture.
2. Seed one small Iceberg table.
3. Verify table discovery, schema, snapshots, and `select * limit 10`.

AWS IaC sketch for Glue-backed Iceberg:

```hcl
resource "aws_s3_bucket" "lake" {
  bucket        = var.bucket_name
  force_destroy = true
}

resource "aws_glue_catalog_database" "irodori" {
  name = "irodori_smoke"
}
```

S3 Tables / managed Iceberg:

- Use when testing AWS-managed Iceberg behavior.
- Keep buckets/tables disposable and force deletion in the test account.

Verification after an adapter exists:

```sql
select * from irodori_smoke.customers limit 10;
```

References:

- Apache Iceberg catalog configuration: <https://iceberg.apache.org/docs/latest/configuration/>
- Apache Iceberg REST catalog spec: <https://iceberg.apache.org/spec/#rest-catalog-api>
- AWS S3 Tables: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables.html>

## Future env-gated integration tests

Cloud engines should eventually get opt-in tests under
`apps/desktop/src-tauri/tests/integration_db.rs`. Use names like:

```bash
IRODORI_REDSHIFT_URL=...
IRODORI_NEON_URL=...
IRODORI_SNOWFLAKE=1
IRODORI_BIGQUERY_PROJECT=...
IRODORI_BIGQUERY_TOKEN=...
IRODORI_BIGTABLE_PROJECT=...
IRODORI_BIGTABLE_INSTANCE=...
```

Test shape:

1. Skip if env vars are absent.
2. Connect through `connect_impl`.
3. Run the smallest self-contained query or API-equivalent read.
4. Call `list_objects_impl` where metadata support exists.
5. Avoid writes unless the IaC fixture created a disposable schema/table.
