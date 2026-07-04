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
 * silhouette in the current text color so it blends into the UI. Trademark-strict
 * brands fall through to a neutral category glyph rather than a look-alike.
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
  oracle: Database,
  sqlserver: Database,
  yugabytedb: Database,
  neon: Database,
  firebird: Database,
  redshift: Warehouse,
  athena: Warehouse,
  memgraph: Workflow,
  qdrant: Boxes,
  pinecone: Boxes,
  dynamodb: FileJson,
  questdb: Activity,
  iotdb: Activity,
  bigtable: KeySquare,
  iceberg: Layers,
  s3Tables: Layers,
  deltaLake: Layers,
  hudi: Layers,
};

type EngineIconProps = {
  engine: string;
  size?: number;
  className?: string;
};

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
