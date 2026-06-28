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
 * Master switch for trademarked brand logos.
 *
 * The artwork below comes from simple-icons (CC0 / public-domain paths), and
 * showing a product's mark purely to identify a connection is the same
 * nominative use DBeaver / TablePlus / VS Code's database extensions rely on.
 * Some brands are still trademark-sensitive, though — flip this to `false` to
 * render the neutral, look-alike category glyphs ({@link FALLBACK}) for *every*
 * engine instead, with zero logos shipped.
 */
const USE_BRAND_LOGOS = true;

/**
 * Real per-engine brand logos (CC0 simple-icons) keyed by `DbEngine` id. Engines
 * without an official brand mark fall back to a category glyph in {@link FALLBACK}.
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
  /** Render in the engine's official brand color (default) vs. `currentColor`. */
  brandColor?: boolean;
  className?: string;
};

/**
 * Brand-accurate icon for a database engine. Mirrors what VS Code's database
 * extensions show: the real product logo where one exists, a category glyph
 * otherwise — so every connection is visually identifiable at a glance.
 */
export function EngineIcon({
  engine,
  size = 16,
  brandColor = true,
  className,
}: EngineIconProps) {
  const Brand = USE_BRAND_LOGOS ? BRAND[engine] : undefined;
  if (Brand) {
    return (
      <Brand
        size={size}
        color={brandColor ? "default" : "currentColor"}
        className={className}
        aria-hidden="true"
      />
    );
  }
  const Fallback = FALLBACK[engine] ?? Database;
  return <Fallback size={size} className={className} aria-hidden="true" />;
}
