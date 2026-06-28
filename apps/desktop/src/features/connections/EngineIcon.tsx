import {
  SiApachecassandra,
  SiApachehive,
  SiArangodb,
  SiClickhouse,
  SiCockroachlabs,
  SiCouchbase,
  SiDatabricks,
  SiDuckdb,
  SiElasticsearch,
  SiGooglebigquery,
  SiGooglecloudspanner,
  SiH2database,
  SiInfluxdb,
  SiMariadb,
  SiMilvus,
  SiMongodb,
  SiMysql,
  SiNeo4j,
  SiOpensearch,
  SiPostgresql,
  SiRedis,
  SiScylladb,
  SiSnowflake,
  SiSqlite,
  SiTidb,
  SiTimescale,
  SiTrino,
  type IconType,
} from "@icons-pack/react-simple-icons";
import {
  Activity,
  Boxes,
  Database,
  FileJson,
  HardDrive,
  KeySquare,
  Layers,
  Warehouse,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Per-engine brand marks keyed by `DbEngine` id.
 *
 * Artwork is from simple-icons (CC0 / public domain), rendered as a monochrome
 * silhouette in the current text color so it blends into the UI — the same
 * nominative, identification-only use DBeaver / DataGrip / TablePlus / VS Code's
 * database extensions rely on. Trademark-strict brands (Oracle, SQL Server, …)
 * are deliberately absent from simple-icons, so they fall through to a neutral
 * category glyph in {@link FALLBACK} rather than a hand-drawn look-alike, which
 * would be the legally worse choice.
 */
const BRAND: Record<string, IconType> = {
  postgres: SiPostgresql,
  mysql: SiMysql,
  mariadb: SiMariadb,
  sqlite: SiSqlite,
  mongodb: SiMongodb,
  redis: SiRedis,
  snowflake: SiSnowflake,
  clickhouse: SiClickhouse,
  cassandra: SiApachecassandra,
  scylladb: SiScylladb,
  neo4j: SiNeo4j,
  elasticsearch: SiElasticsearch,
  openSearch: SiOpensearch,
  duckdb: SiDuckdb,
  motherduck: SiDuckdb,
  cockroachdb: SiCockroachlabs,
  influxdb: SiInfluxdb,
  couchbase: SiCouchbase,
  arangodb: SiArangodb,
  bigquery: SiGooglebigquery,
  databricks: SiDatabricks,
  trinoPresto: SiTrino,
  milvus: SiMilvus,
  hive: SiApachehive,
  tidb: SiTidb,
  timescaledb: SiTimescale,
  cloudSpanner: SiGooglecloudspanner,
  h2: SiH2database,
};

/** Category glyphs for engines without a brand logo, grouped by data model. */
const FALLBACK: Record<string, LucideIcon> = {
  // relational
  oracle: Database,
  sqlserver: Database,
  yugabytedb: Database,
  neon: Database,
  firebird: Database,
  // warehouse
  redshift: Warehouse,
  athena: Warehouse,
  // graph
  memgraph: Workflow,
  // vector
  qdrant: Boxes,
  pinecone: Boxes,
  // document
  dynamodb: FileJson,
  // time-series
  questdb: Activity,
  iotdb: Activity,
  // key-value / wide-column
  bigtable: KeySquare,
  kvStore: KeySquare,
  // lakehouse / object store
  iceberg: Layers,
  s3Tables: Layers,
  deltaLake: Layers,
  hudi: Layers,
  objectStore: HardDrive,
};

type EngineIconProps = {
  engine: string;
  size?: number;
  className?: string;
};

/**
 * Monochrome silhouette icon for a database engine: the real product mark where
 * a public-domain one exists, a neutral category glyph otherwise — drawn in the
 * current text color so every connection is identifiable yet blends into the UI.
 */
export function EngineIcon({ engine, size = 16, className }: EngineIconProps) {
  const Brand = BRAND[engine];
  if (Brand) {
    return (
      <Brand
        size={size}
        color="currentColor"
        className={className}
        aria-hidden="true"
      />
    );
  }
  const Fallback = FALLBACK[engine] ?? Database;
  return <Fallback size={size} className={className} aria-hidden="true" />;
}
