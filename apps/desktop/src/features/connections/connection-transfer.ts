import type { DbEngine } from "@/generated/irodori-api";
import {
  defaultConnectionColor,
  defaultPort,
  engineLabel,
  memoryDefaults,
  newDraft,
  normalizeConnectionColor,
  portableProfile,
  redactPasswordFromConnectionUrl,
  withUniqueProfileIds,
  type ConnectionDraft,
  type ConnectionInputMode,
} from "./connection-profiles";

export type ConnectionTransferFormat =
  | "irodori"
  | "dbeaver"
  | "datagrip"
  | "tableplus"
  | "pgadmin"
  | "mysql-workbench"
  | "heidisql"
  | "sqltools";

export const connectionTransferFormatOptions: Array<{
  value: ConnectionTransferFormat;
  label: string;
}> = [
  { value: "irodori", label: "Irodori JSON" },
  { value: "dbeaver", label: "DBeaver CSV" },
  { value: "datagrip", label: "DataGrip XML" },
  { value: "tableplus", label: "TablePlus URL list" },
  { value: "pgadmin", label: "pgAdmin JSON" },
  { value: "mysql-workbench", label: "MySQL Workbench XML" },
  { value: "heidisql", label: "HeidiSQL INI" },
  { value: "sqltools", label: "VS Code SQLTools JSON" },
];

export type ConnectionImportResult = {
  source: string;
  profiles: ConnectionDraft[];
  warnings: string[];
};

export type ConnectionExportResult = {
  format: ConnectionTransferFormat;
  label: string;
  fileName: string;
  mime: string;
  content: string;
  profileCount: number;
  skippedCount: number;
};

type ConnectionCandidate = {
  id?: string;
  name?: string;
  engine?: DbEngine;
  mode?: ConnectionInputMode;
  url?: string;
  host?: string;
  port?: string;
  user?: string;
  database?: string;
  color?: string;
  readOnly?: boolean;
};

type ParsedUrl = {
  url?: string;
  engine?: DbEngine;
  host?: string;
  port?: string;
  user?: string;
  database?: string;
};

const transferVersion = 1;

const engineAliasRules: Array<[DbEngine, RegExp]> = [
  ["cockroachdb", /cockroach/i],
  ["yugabytedb", /yugabyte|\bysql\b/i],
  ["timescaledb", /timescale/i],
  ["redshift", /redshift/i],
  ["mariadb", /mariadb/i],
  ["tidb", /\btidb\b/i],
  ["postgres", /postgres|postgresql|\bpg\b/i],
  ["sqlserver", /sql\s*server|mssql|jtds|\btds\b/i],
  ["mysql", /mysql/i],
  ["sqlite", /sqlite/i],
  ["duckdb", /duckdb/i],
  ["motherduck", /mother\s*duck|motherduck|\bmd:/i],
  ["mongodb", /mongo/i],
  ["oracle", /oracle|thin/i],
  ["clickhouse", /clickhouse/i],
  ["neo4j", /neo4j/i],
  ["memgraph", /memgraph/i],
  ["influxdb", /influx/i],
  ["qdrant", /qdrant/i],
  ["milvus", /milvus/i],
  ["pinecone", /pinecone/i],
  ["snowflake", /snowflake/i],
  ["bigquery", /bigquery|googlebigquery/i],
  ["athena", /athena|awsathena/i],
  ["redis", /redis/i],
  ["scylladb", /scylla/i],
  ["cassandra", /cassandra/i],
  ["bigtable", /bigtable/i],
  ["trinoPresto", /trino|presto/i],
  ["firebird", /firebird/i],
  ["databricks", /databricks|spark\s*sql/i],
  ["openSearch", /opensearch/i],
  ["elasticsearch", /elastic(?:search)?/i],
  ["couchbase", /couchbase/i],
  ["dynamodb", /dynamo\s*db/i],
  ["arangodb", /arangodb|arango/i],
  ["questdb", /questdb/i],
  ["iotdb", /iotdb/i],
  ["hive", /hive|metastore/i],
  ["iceberg", /iceberg|glue\s*catalog|rest\s*catalog|nessie/i],
  ["s3Tables", /s3\s*tables/i],
  ["deltaLake", /delta\s*lake/i],
  ["hudi", /hudi/i],
  ["h2", /\bh2\b/i],
];

const importContainers = [
  "connections",
  "datasources",
  "dataSources",
  "servers",
  "profiles",
  "items",
  "children",
];

export function importConnectionProfiles(
  text: string,
  fileName = "connections",
): ConnectionImportResult {
  if (/\.tableplusconnection$/i.test(fileName)) {
    throw new Error(
      "TablePlus .tableplusconnection files are password-protected; import copied connection URLs instead",
    );
  }
  const sourceText = text.trim();
  if (!sourceText) {
    throw new Error("Connection import file is empty");
  }

  const urlList = importUrlListConnections(sourceText);
  if (urlList.profiles.length > 0) {
    return normalizeImportResult(urlList, fileName);
  }

  const json = parseJson(sourceText);
  if (json !== null) {
    return normalizeImportResult(importJsonConnections(json), fileName);
  }

  const csv = importCsvConnections(sourceText);
  if (csv.profiles.length > 0) {
    return normalizeImportResult(csv, fileName);
  }

  if (looksLikeXml(sourceText)) {
    return normalizeImportResult(
      importXmlConnections(extractXmlPayload(sourceText)),
      fileName,
    );
  }

  return normalizeImportResult(importIniConnections(sourceText), fileName);
}

export function exportConnectionProfiles(
  profiles: readonly ConnectionDraft[],
  format: ConnectionTransferFormat,
): ConnectionExportResult {
  switch (format) {
    case "dbeaver":
      return buildDbeaverExport(profiles);
    case "datagrip":
      return buildDataGripExport(profiles);
    case "tableplus":
      return buildTablePlusExport(profiles);
    case "pgadmin":
      return buildPgAdminExport(profiles);
    case "mysql-workbench":
      return buildMySqlWorkbenchExport(profiles);
    case "heidisql":
      return buildHeidiSqlExport(profiles);
    case "sqltools":
      return buildSqlToolsExport(profiles);
    default:
      return buildIrodoriExport(profiles);
  }
}

function normalizeImportResult(
  result: ConnectionImportResult,
  fileName: string,
): ConnectionImportResult {
  const profiles = withUniqueProfileIds(
    result.profiles.map((profile) => portableProfile(profile)),
  );
  if (profiles.length === 0) {
    throw new Error(`No connection profiles found in ${fileName}`);
  }
  return {
    ...result,
    profiles,
  };
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      if (row.some((value) => value)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value)) {
    rows.push(row);
  }
  return rows;
}

function importUrlListConnections(text: string): ConnectionImportResult {
  const urls = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => {
      const parsed = parseConnectionUrl(line);
      return (
        parsed.engine ||
        parsed.host ||
        parsed.database ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(line)
      );
    });
  if (urls.length === 0) {
    return { source: "URL list", profiles: [], warnings: [] };
  }
  return {
    source: "Connection URL list",
    profiles: urls.map((url, index) =>
      candidateToDraft({ id: `url-${index + 1}`, url }, index),
    ),
    warnings: [],
  };
}

function importCsvConnections(text: string): ConnectionImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { source: "CSV", profiles: [], warnings: [] };
  }
  const headers = rows[0].map((header) => normalizeKey(header));
  const hasConnectionColumns = headers.some((header) =>
    [
      "name",
      "host",
      "hostname",
      "server",
      "port",
      "database",
      "url",
      "jdbcurl",
      "driver",
      "type",
    ].includes(header),
  );
  if (!hasConnectionColumns) {
    return { source: "CSV", profiles: [], warnings: [] };
  }
  const profiles = rows.slice(1).flatMap((row, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      record[header] = row[columnIndex] ?? "";
    });
    const candidate = candidateFromRecord(record, `csv-${index + 1}`);
    return candidate ? [candidateToDraft(candidate, index)] : [];
  });
  return {
    source: "DBeaver CSV",
    profiles,
    warnings: [],
  };
}

function importJsonConnections(value: unknown): ConnectionImportResult {
  const candidates: ConnectionCandidate[] = [];
  let source = "JSON";

  if (!isRecord(value)) {
    return { source, profiles: [], warnings: [] };
  }

  const irodoriConnections = getAny(value, ["connections"]);
  if (Array.isArray(irodoriConnections)) {
    source = stringFrom(getAny(value, ["kind"]))?.includes("irodori")
      ? "Irodori JSON"
      : "JSON connections";
    candidates.push(
      ...irodoriConnections
        .map((item, index) =>
          candidateFromRecord(item, `connection-${index + 1}`),
        )
        .filter(isCandidate),
    );
  } else if (isRecord(irodoriConnections)) {
    source = "DBeaver data-sources.json";
    candidates.push(
      ...Object.entries(irodoriConnections)
        .map(([id, item]) => candidateFromRecord(item, id))
        .filter(isCandidate),
    );
  }

  const pgAdminServers = getAny(value, ["Servers", "servers"]);
  if (isRecord(pgAdminServers)) {
    source = "pgAdmin servers.json";
    candidates.push(
      ...Object.entries(pgAdminServers)
        .map(([id, item]) => pgAdminCandidate(item, id))
        .filter(isCandidate),
    );
  }

  const sqlToolsConnections = getAny(value, ["sqltools.connections"]);
  if (Array.isArray(sqlToolsConnections)) {
    source = "VS Code SQLTools settings";
    candidates.push(
      ...sqlToolsConnections
        .map((item, index) =>
          candidateFromRecord(item, `sqltools-${index + 1}`),
        )
        .filter(isCandidate),
    );
  }

  if (candidates.length === 0) {
    collectGenericJsonCandidates(value, candidates, 0);
  }

  return {
    source,
    profiles: candidates.map(candidateToDraft),
    warnings: [],
  };
}

function importXmlConnections(text: string): ConnectionImportResult {
  if (typeof DOMParser === "undefined") {
    throw new Error("XML import is not available in this runtime");
  }
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Connection XML could not be parsed");
  }

  const candidates: ConnectionCandidate[] = [];
  const dataSources = Array.from(document.querySelectorAll("data-source"));
  if (dataSources.length > 0) {
    candidates.push(...dataSources.map(dataGripCandidate).filter(isCandidate));
    return {
      source: "DataGrip dataSources.xml",
      profiles: candidates.map(candidateToDraft),
      warnings: [],
    };
  }

  const workbenchConnections = Array.from(
    document.querySelectorAll('[struct-name="db.mgmt.Connection"]'),
  );
  if (workbenchConnections.length > 0) {
    candidates.push(
      ...workbenchConnections.map(workbenchCandidate).filter(isCandidate),
    );
    return {
      source: "MySQL Workbench connections.xml",
      profiles: candidates.map(candidateToDraft),
      warnings: [],
    };
  }

  const sqlDeveloperReferences = Array.from(
    document.querySelectorAll("Reference"),
  );
  if (sqlDeveloperReferences.length > 0) {
    candidates.push(
      ...sqlDeveloperReferences.map(sqlDeveloperCandidate).filter(isCandidate),
    );
  }

  if (candidates.length === 0) {
    const genericNodes = Array.from(
      document.querySelectorAll(
        "connection, server, datasource, dataSource, profile",
      ),
    );
    candidates.push(...genericNodes.map(xmlNodeCandidate).filter(isCandidate));
  }

  return {
    source:
      sqlDeveloperReferences.length > 0
        ? "Oracle SQL Developer XML"
        : "XML connections",
    profiles: candidates.map(candidateToDraft),
    warnings: [],
  };
}

function looksLikeXml(text: string) {
  return /<\s*(\?xml|data-source|data-sources|connection|connections|server|Reference|data|project)\b/i.test(
    text,
  );
}

function extractXmlPayload(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    return trimmed;
  }
  const fragments = [
    ...trimmed.matchAll(/<data-source\b[\s\S]*?<\/data-source>/gi),
    ...trimmed.matchAll(/<Reference\b[\s\S]*?<\/Reference>/gi),
    ...trimmed.matchAll(/<connection\b[\s\S]*?(?:<\/connection>|\/>)/gi),
    ...trimmed.matchAll(/<server\b[\s\S]*?(?:<\/server>|\/>)/gi),
  ].map((match) => match[0]);
  if (fragments.length > 0) {
    return `<connections>${fragments.join("\n")}</connections>`;
  }
  const xmlStart = trimmed.search(
    /<\s*(\?xml|data-source|data-sources|connection|connections|server|Reference|data|project)\b/i,
  );
  if (xmlStart === -1) {
    return trimmed;
  }
  return `<connections>${trimmed.slice(xmlStart)}</connections>`;
}

function importIniConnections(text: string): ConnectionImportResult {
  const sections = parseIniSections(text);
  const candidates = sections
    .map((section, index) => iniSectionCandidate(section, index))
    .filter(isCandidate);
  return {
    source: "INI connections",
    profiles: candidates.map(candidateToDraft),
    warnings: [],
  };
}

function candidateFromRecord(
  value: unknown,
  fallbackId: string,
): ConnectionCandidate | null {
  if (!isRecord(value)) {
    return null;
  }
  const configuration = firstRecord(
    getAny(value, ["configuration", "config", "settings", "connection"]),
  );
  const properties = firstRecord(
    getAny(configuration, ["properties", "propertyMap"]),
    getAny(value, ["properties"]),
  );
  const auth = firstRecord(getAny(value, ["auth", "authentication"]));
  const url = pickString(
    getAny(value, ["url", "uri", "jdbcUrl", "connectionUrl", "dsn"]),
    getAny(configuration, ["url", "uri", "jdbcUrl", "connectionUrl", "dsn"]),
  );
  const host = pickString(
    getAny(value, ["host", "hostname", "server", "address", "hostName"]),
    getAny(configuration, [
      "host",
      "hostname",
      "server",
      "address",
      "hostName",
    ]),
  );
  const port = pickString(
    getAny(value, ["port"]),
    getAny(configuration, ["port"]),
  );
  const database = pickString(
    getAny(value, [
      "database",
      "db",
      "databaseName",
      "schema",
      "service",
      "serviceName",
      "sid",
      "maintenanceDb",
      "defaultDatabase",
      "path",
    ]),
    getAny(configuration, [
      "database",
      "db",
      "databaseName",
      "schema",
      "service",
      "serviceName",
      "sid",
      "maintenanceDb",
      "defaultDatabase",
      "path",
    ]),
  );
  const user = pickString(
    getAny(value, ["user", "username", "userName", "login", "uid"]),
    getAny(configuration, ["user", "username", "userName", "login", "uid"]),
    getAny(properties, ["user", "username", "userName", "uid"]),
    getAny(auth, ["user", "username", "userName", "login", "uid"]),
  );
  const name = pickString(
    getAny(value, ["name", "label", "title", "displayName"]),
    getAny(configuration, ["name", "label", "title", "displayName"]),
  );
  const driver = pickString(
    getAny(value, [
      "engine",
      "driver",
      "driverName",
      "driverId",
      "provider",
      "type",
      "dialect",
    ]),
    getAny(configuration, [
      "engine",
      "driver",
      "driverName",
      "driverId",
      "provider",
      "type",
      "dialect",
    ]),
  );
  const engine = detectEngine(driver, url, name, host);
  const candidate: ConnectionCandidate = {
    id: pickString(getAny(value, ["id", "uuid", "key"]), fallbackId),
    name,
    engine,
    url,
    host,
    port,
    user,
    database,
    color: pickString(getAny(value, ["color", "colour"])),
    readOnly: booleanFrom(getAny(value, ["readOnly", "readonly", "read_only"])),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function pgAdminCandidate(value: unknown, fallbackId: string) {
  if (!isRecord(value)) {
    return null;
  }
  const candidate: ConnectionCandidate = {
    id: fallbackId,
    name: pickString(getAny(value, ["Name", "name"]), fallbackId),
    engine: "postgres",
    host: pickString(getAny(value, ["Host", "host"])),
    port: pickString(getAny(value, ["Port", "port"])),
    database: pickString(
      getAny(value, ["MaintenanceDB", "maintenanceDb", "database"]),
    ),
    user: pickString(getAny(value, ["Username", "username", "user"])),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function dataGripCandidate(node: Element): ConnectionCandidate | null {
  const jdbcUrl = childText(node, "jdbc-url");
  const driver = pickString(
    childText(node, "driver-ref"),
    childText(node, "jdbc-driver"),
  );
  const candidate: ConnectionCandidate = {
    id: node.getAttribute("uuid") ?? undefined,
    name: node.getAttribute("name") ?? undefined,
    engine: detectEngine(driver, jdbcUrl),
    url: jdbcUrl,
    user: pickString(
      childText(node, "user-name"),
      optionValue(node, "USER"),
      optionValue(node, "user"),
      propertyValue(node, "user"),
    ),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function workbenchCandidate(node: Element): ConnectionCandidate | null {
  const driver = keyedXmlValue(node, ["driver", "driverName", "driver_id"]);
  const hostIdentifier = parseHostIdentifier(
    keyedXmlValue(node, ["hostIdentifier"]),
  );
  const candidate: ConnectionCandidate = {
    id: node.getAttribute("id") ?? undefined,
    name: keyedXmlValue(node, ["name"]),
    engine: detectEngine(driver, "mysql"),
    host: pickString(
      keyedXmlValue(node, ["hostName", "host"]),
      hostIdentifier.host,
    ),
    port: pickString(keyedXmlValue(node, ["port"]), hostIdentifier.port),
    user: pickString(
      keyedXmlValue(node, ["userName", "user", "username"]),
      hostIdentifier.user,
    ),
    database: keyedXmlValue(node, ["schema", "database", "defaultSchema"]),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function sqlDeveloperCandidate(node: Element): ConnectionCandidate | null {
  const candidate: ConnectionCandidate = {
    id: node.getAttribute("name") ?? undefined,
    name: node.getAttribute("name") ?? undefined,
    engine: "oracle",
    host: refAddrValue(node, ["hostname", "host"]),
    port: refAddrValue(node, ["port"]),
    user: refAddrValue(node, ["user", "username"]),
    database: pickString(
      refAddrValue(node, ["serviceName", "service"]),
      refAddrValue(node, ["sid"]),
    ),
    url: refAddrValue(node, ["customUrl", "url"]),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function xmlNodeCandidate(node: Element): ConnectionCandidate | null {
  const candidate: ConnectionCandidate = {
    id: pickString(node.getAttribute("id"), node.getAttribute("uuid")),
    name: pickString(
      node.getAttribute("name"),
      childText(node, "name"),
      childText(node, "label"),
    ),
    engine: detectEngine(
      node.getAttribute("engine"),
      node.getAttribute("driver"),
      childText(node, "engine"),
      childText(node, "driver"),
      childText(node, "url"),
    ),
    url: pickString(
      node.getAttribute("url"),
      childText(node, "url"),
      childText(node, "jdbc-url"),
    ),
    host: pickString(
      node.getAttribute("host"),
      childText(node, "host"),
      childText(node, "server"),
    ),
    port: pickString(node.getAttribute("port"), childText(node, "port")),
    user: pickString(
      node.getAttribute("user"),
      childText(node, "user"),
      childText(node, "username"),
    ),
    database: pickString(
      node.getAttribute("database"),
      childText(node, "database"),
      childText(node, "schema"),
      childText(node, "service"),
    ),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function iniSectionCandidate(
  section: { name: string; values: Record<string, string> },
  index: number,
): ConnectionCandidate | null {
  const values = section.values;
  const sectionName = section.name.split(/[\\/]/).pop() || section.name;
  const driver = pickString(
    getAny(values, ["driver", "driverId", "netType", "library"]),
  );
  const candidate: ConnectionCandidate = {
    id: slugify(sectionName, `connection-${index + 1}`),
    name: pickString(getAny(values, ["name"]), sectionName),
    engine: detectEngine(driver, getAny(values, ["host"]), "mysql"),
    host: pickString(getAny(values, ["host", "hostname", "server"])),
    port: pickString(getAny(values, ["port"])),
    user: pickString(getAny(values, ["user", "username"])),
    database: pickString(getAny(values, ["database", "databases", "schema"])),
  };
  return candidateHasTarget(candidate) ? candidate : null;
}

function collectGenericJsonCandidates(
  value: unknown,
  candidates: ConnectionCandidate[],
  depth: number,
) {
  if (depth > 5) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectGenericJsonCandidates(item, candidates, depth + 1),
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const candidate = candidateFromRecord(
    value,
    `connection-${candidates.length + 1}`,
  );
  if (candidate) {
    candidates.push(candidate);
    return;
  }
  for (const key of importContainers) {
    const child = getAny(value, [key]);
    if (Array.isArray(child)) {
      child.forEach((item) =>
        collectGenericJsonCandidates(item, candidates, depth + 1),
      );
    } else if (isRecord(child)) {
      Object.values(child).forEach((item) =>
        collectGenericJsonCandidates(item, candidates, depth + 1),
      );
    }
  }
}

function candidateToDraft(candidate: ConnectionCandidate, index: number) {
  const parsed = parseConnectionUrl(candidate.url ?? "");
  const engine =
    candidate.engine ??
    parsed.engine ??
    detectEngine(candidate.url, candidate.name) ??
    "postgres";
  const defaults = {
    ...newDraft(index + 1),
    ...memoryDefaults(engine),
  };
  const host = pickString(candidate.host, parsed.host, defaults.host);
  const database = pickString(
    candidate.database,
    parsed.database,
    defaults.database,
  );
  const mode: ConnectionInputMode =
    candidate.mode ??
    (engine === "sqlite" || engine === "duckdb" || host ? "fields" : "url");
  const name = pickString(
    candidate.name,
    database ? `${engineLabel(engine)} ${database}` : undefined,
    host ? `${engineLabel(engine)} ${host}` : undefined,
    defaults.name,
  );
  return portableProfile({
    ...defaults,
    id: slugify(pickString(candidate.id, name), defaults.id),
    name,
    color: normalizeConnectionColor(candidate.color, defaultConnectionColor),
    engine,
    mode,
    url: redactPasswordFromConnectionUrl(
      pickString(candidate.url, parsed.url, defaults.url),
    ),
    host,
    port: pickString(
      candidate.port,
      parsed.port,
      defaults.port || defaultPort(engine),
    ),
    user: pickString(candidate.user, parsed.user, defaults.user),
    password: "",
    database,
    readOnly: candidate.readOnly === true,
  });
}

function parseConnectionUrl(raw: string): ParsedUrl {
  const url = redactPasswordFromConnectionUrl(raw);
  if (!url) {
    return {};
  }

  const sqlServer = /^(?:jdbc:)?sqlserver:\/\/([^;/?#]+)(.*)$/i.exec(url);
  if (sqlServer) {
    const [host, port] = splitHostPort(sqlServer[1]);
    const values = parseDelimitedProperties(sqlServer[2]);
    return {
      url,
      engine: "sqlserver",
      host,
      port,
      user: pickString(values.user, values.username, values.uid),
      database: pickString(values.databasename, values.database, values.db),
    };
  }

  const oracleService =
    /^jdbc:oracle:[^@]*:@\/\/([^/:]+)(?::(\d+))?\/(.+)$/i.exec(url);
  if (oracleService) {
    return {
      url,
      engine: "oracle",
      host: oracleService[1],
      port: oracleService[2],
      database: decodeValue(oracleService[3]),
    };
  }

  const oracleSid = /^jdbc:oracle:[^@]*:@([^/:]+)(?::(\d+))?:(.+)$/i.exec(url);
  if (oracleSid) {
    return {
      url,
      engine: "oracle",
      host: oracleSid[1],
      port: oracleSid[2],
      database: decodeValue(oracleSid[3]),
    };
  }

  const sqlite = /^(?:jdbc:)?sqlite:(.+)$/i.exec(url);
  if (sqlite) {
    return {
      url,
      engine: "sqlite",
      database: sqlite[1].replace(/^\/\//, ""),
    };
  }

  const jdbcPrefix = /^jdbc:([A-Za-z][A-Za-z0-9+.-]*):(.*)$/i.exec(url);
  if (jdbcPrefix) {
    return {
      ...parseConnectionUrl(`${jdbcPrefix[1]}:${jdbcPrefix[2]}`),
      url,
      engine: detectEngine(jdbcPrefix[1], url),
    };
  }

  const keyValues = parseDelimitedProperties(url);
  if (Object.keys(keyValues).length > 1) {
    const looksLikeSqlServer =
      keyValues.server ||
      keyValues.initialcatalog ||
      keyValues.trustedconnection ||
      keyValues.trustservercertificate;
    return {
      url,
      engine:
        detectEngine(keyValues.driver, keyValues.engine) ??
        (looksLikeSqlServer ? "sqlserver" : undefined),
      host: pickString(
        keyValues.host,
        keyValues.hostname,
        keyValues.server,
        keyValues.address,
      ),
      port: keyValues.port,
      user: pickString(
        keyValues.user,
        keyValues.username,
        keyValues.uid,
        keyValues["user id"],
      ),
      database: pickString(
        keyValues.database,
        keyValues.db,
        keyValues.initialcatalog,
        keyValues.schema,
      ),
    };
  }

  const parsed = parseStandardUrl(url);
  if (parsed) {
    return parsed;
  }

  return { url };
}

function parseStandardUrl(value: string): ParsedUrl | null {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const scheme = parsed.protocol.replace(/:$/, "");
    return {
      url: value,
      engine: detectEngine(scheme, value),
      host: parsed.hostname,
      port: parsed.port,
      user: decodeValue(parsed.username),
      database: decodeValue(parsed.pathname.replace(/^\/+/, "")),
    };
  } catch {
    return null;
  }
}

function buildIrodoriExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const exportedProfiles = profiles.map(exportProfile);
  return {
    format: "irodori",
    label: "Irodori JSON",
    fileName: exportFileName("irodori-connections", "json"),
    mime: "application/json",
    profileCount: exportedProfiles.length,
    skippedCount: 0,
    content: JSON.stringify(
      {
        kind: "irodori.connections",
        version: transferVersion,
        exportedAt: new Date().toISOString(),
        connections: exportedProfiles,
      },
      null,
      2,
    ),
  };
}

function buildDbeaverExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const rows = [
    ["name", "type", "host", "port", "database", "url", "user"],
    ...profiles.map((profile) => {
      const view = exportView(profile);
      return [
        view.name,
        dbeaverProvider(view.engine),
        view.host,
        view.port,
        view.database,
        jdbcUrlFor(view),
        view.user,
      ];
    }),
  ];
  return {
    format: "dbeaver",
    label: "DBeaver CSV",
    fileName: exportFileName("dbeaver-connections", "csv"),
    mime: "text/csv",
    content: rows.map(csvLine).join("\n"),
    profileCount: profiles.length,
    skippedCount: 0,
  };
}

function buildDataGripExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const dataSources = profiles
    .map((profile) => {
      const view = exportView(profile);
      return [
        `    <data-source source="LOCAL" name="${xmlAttribute(view.name)}" uuid="${xmlAttribute(view.id)}">`,
        `      <driver-ref>${xmlText(dataGripDriver(view.engine))}</driver-ref>`,
        `      <jdbc-url>${xmlText(jdbcUrlFor(view))}</jdbc-url>`,
        view.user ? `      <user-name>${xmlText(view.user)}</user-name>` : "",
        "    </data-source>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return xmlExport(
    "datagrip",
    "DataGrip XML",
    "datagrip-dataSources",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project version="4">',
      '  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">',
      dataSources,
      "  </component>",
      "</project>",
    ].join("\n"),
    profiles.length,
  );
}

function buildTablePlusExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  return {
    format: "tableplus",
    label: "TablePlus URL list",
    fileName: exportFileName("tableplus-connection-urls", "txt"),
    mime: "text/plain",
    content: profiles
      .map((profile) => exportView(profile).url)
      .filter(Boolean)
      .join("\n"),
    profileCount: profiles.length,
    skippedCount: 0,
  };
}

function buildPgAdminExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const supported = profiles.filter((profile) =>
    [
      "postgres",
      "timescaledb",
      "neon",
      "cockroachdb",
      "yugabytedb",
      "redshift",
    ].includes(profile.engine),
  );
  const servers = Object.fromEntries(
    supported.map((profile, index) => {
      const view = exportView(profile);
      return [
        String(index + 1),
        compactRecord({
          Name: view.name,
          Group: "Servers",
          Host: view.host,
          Port: view.port ? Number(view.port) : undefined,
          MaintenanceDB: view.database || "postgres",
          Username: view.user,
          SSLMode: "prefer",
        }),
      ];
    }),
  );
  return jsonExport(
    "pgadmin",
    "pgAdmin JSON",
    "pgadmin-servers",
    { Servers: servers },
    supported.length,
    profiles.length - supported.length,
  );
}

function buildMySqlWorkbenchExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const supported = profiles.filter((profile) =>
    ["mysql", "mariadb", "tidb"].includes(profile.engine),
  );
  const connectionXml = supported
    .map((profile) => {
      const view = exportView(profile);
      return [
        `  <value type="object" struct-name="db.mgmt.Connection" id="${xmlAttribute(view.id)}">`,
        `    <value type="string" key="name">${xmlText(view.name)}</value>`,
        '    <value type="string" key="driver">MysqlNative</value>',
        `    <value type="string" key="hostIdentifier">${xmlText(
          `${view.user ? `${view.user}@` : ""}${view.host}${view.port ? `:${view.port}` : ""}`,
        )}</value>`,
        '    <value type="dict" key="parameterValues">',
        `      <value type="string" key="hostName">${xmlText(view.host)}</value>`,
        view.port
          ? `      <value type="int" key="port">${xmlText(view.port)}</value>`
          : "",
        view.user
          ? `      <value type="string" key="userName">${xmlText(view.user)}</value>`
          : "",
        view.database
          ? `      <value type="string" key="schema">${xmlText(view.database)}</value>`
          : "",
        "    </value>",
        "  </value>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return xmlExport(
    "mysql-workbench",
    "MySQL Workbench XML",
    "mysql-workbench-connections",
    ['<?xml version="1.0"?>', "<data>", connectionXml, "</data>"].join("\n"),
    supported.length,
    profiles.length - supported.length,
  );
}

function buildHeidiSqlExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  const sections = profiles
    .map((profile) => {
      const view = exportView(profile);
      return [
        `[Servers\\${iniEscape(view.name)}]`,
        `Host=${iniEscape(view.host)}`,
        view.port ? `Port=${iniEscape(view.port)}` : "",
        view.user ? `User=${iniEscape(view.user)}` : "",
        view.database ? `Databases=${iniEscape(view.database)}` : "",
        `Comment=${iniEscape(`Imported from Irodori Table (${engineLabel(view.engine)})`)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return {
    format: "heidisql",
    label: "HeidiSQL INI",
    fileName: exportFileName("heidisql-sessions", "ini"),
    mime: "text/plain",
    content: sections,
    profileCount: profiles.length,
    skippedCount: 0,
  };
}

function buildSqlToolsExport(
  profiles: readonly ConnectionDraft[],
): ConnectionExportResult {
  return jsonExport(
    "sqltools",
    "VS Code SQLTools JSON",
    "sqltools-connections",
    {
      "sqltools.connections": profiles.map((profile) => {
        const view = exportView(profile);
        return compactRecord({
          name: view.name,
          driver: sqlToolsDriver(view.engine),
          server: view.host,
          port: view.port ? Number(view.port) : undefined,
          database: view.database,
          username: view.user,
          connectionTimeout: 30,
        });
      }),
    },
    profiles.length,
  );
}

function jsonExport(
  format: ConnectionTransferFormat,
  label: string,
  baseName: string,
  payload: unknown,
  profileCount: number,
  skippedCount = 0,
): ConnectionExportResult {
  return {
    format,
    label,
    fileName: exportFileName(baseName, "json"),
    mime: "application/json",
    content: JSON.stringify(payload, null, 2),
    profileCount,
    skippedCount,
  };
}

function xmlExport(
  format: ConnectionTransferFormat,
  label: string,
  baseName: string,
  content: string,
  profileCount: number,
  skippedCount = 0,
): ConnectionExportResult {
  return {
    format,
    label,
    fileName: exportFileName(baseName, "xml"),
    mime: "application/xml",
    content,
    profileCount,
    skippedCount,
  };
}

function exportProfile(profile: ConnectionDraft) {
  const view = exportView(profile);
  return compactRecord({
    id: view.id,
    name: view.name,
    color: view.color,
    engine: view.engine,
    mode: view.mode,
    url: view.url,
    host: view.host,
    port: view.port,
    user: view.user,
    database: view.database,
    readOnly: view.readOnly ? true : undefined,
  });
}

function exportView(profile: ConnectionDraft) {
  const clean = portableProfile(profile);
  const parsed = parseConnectionUrl(clean.url);
  const host = pickString(clean.host, parsed.host);
  const port = pickString(clean.port, parsed.port, defaultPort(clean.engine));
  const database = pickString(clean.database, parsed.database);
  const user = pickString(clean.user, parsed.user);
  const url = pickString(
    clean.url,
    standardUrlFor(clean.engine, host, port, database, user),
  );
  return {
    ...clean,
    host,
    port,
    database,
    user,
    url: redactPasswordFromConnectionUrl(url),
  };
}

function standardUrlFor(
  engine: DbEngine,
  host: string,
  port: string,
  database: string,
  user: string,
) {
  if (engine === "sqlite" || engine === "duckdb") {
    return database;
  }
  if (engine === "motherduck") {
    return database ? `md:${database}` : "md:";
  }
  if (!host) {
    return "";
  }
  const scheme = urlScheme(engine);
  const auth = user ? `${encodeURIComponent(user)}@` : "";
  const portPart = port ? `:${port}` : "";
  const databasePart = database ? `/${encodeURIComponent(database)}` : "";
  return `${scheme}://${auth}${host}${portPart}${databasePart}`;
}

function jdbcUrlFor(view: ReturnType<typeof exportView>) {
  const host = view.host || "localhost";
  const port = view.port || defaultPort(view.engine);
  const database = view.database;
  switch (view.engine) {
    case "mysql":
    case "mariadb":
    case "tidb":
      return `jdbc:${view.engine === "mariadb" ? "mariadb" : "mysql"}://${host}${port ? `:${port}` : ""}${database ? `/${database}` : ""}`;
    case "sqlserver":
      return `jdbc:sqlserver://${host}${port ? `:${port}` : ""}${database ? `;databaseName=${database}` : ""}`;
    case "oracle":
      return `jdbc:oracle:thin:@//${host}${port ? `:${port}` : ""}${database ? `/${database}` : ""}`;
    case "sqlite":
      return `jdbc:sqlite:${database || view.url || ":memory:"}`;
    case "clickhouse":
      return `jdbc:clickhouse://${host}${port ? `:${port}` : ""}${database ? `/${database}` : ""}`;
    default:
      return `jdbc:postgresql://${host}${port ? `:${port}` : ""}${database ? `/${database}` : ""}`;
  }
}

function urlScheme(engine: DbEngine) {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
    case "redshift":
    case "cockroachdb":
    case "yugabytedb":
      return "postgres";
    case "mariadb":
    case "tidb":
      return "mysql";
    case "sqlserver":
      return "sqlserver";
    case "mongodb":
      return "mongodb";
    case "trinoPresto":
      return "trino";
    case "elasticsearch":
    case "openSearch":
      return "http";
    case "dynamodb":
      return "https";
    case "athena":
      return "athena";
    case "motherduck":
      return "motherduck";
    case "scylladb":
      return "cassandra";
    case "questdb":
      return "postgres";
    case "redis":
      return "redis";
    case "neo4j":
    case "memgraph":
      return "neo4j";
    default:
      return engine;
  }
}

function dbeaverProvider(engine: DbEngine) {
  if (engine === "postgres") return "postgresql";
  if (engine === "sqlserver") return "sqlserver";
  return urlScheme(engine);
}

function dataGripDriver(engine: DbEngine) {
  if (engine === "postgres") return "postgresql";
  if (engine === "sqlserver") return "sqlserver.ms";
  return urlScheme(engine);
}

function sqlToolsDriver(engine: DbEngine) {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
    case "redshift":
    case "cockroachdb":
    case "yugabytedb":
      return "PostgreSQL";
    case "mysql":
    case "mariadb":
    case "tidb":
      return "MySQL";
    case "sqlserver":
      return "MSSQL";
    case "sqlite":
      return "SQLite";
    default:
      return engineLabel(engine);
  }
}

function detectEngine(...values: unknown[]): DbEngine | undefined {
  const text = values
    .map((value) => stringFrom(value))
    .filter(Boolean)
    .join(" ");
  if (!text) {
    return undefined;
  }
  for (const [engine, pattern] of engineAliasRules) {
    if (pattern.test(text)) {
      return engine;
    }
  }
  return undefined;
}

function candidateHasTarget(candidate: ConnectionCandidate) {
  return Boolean(candidate.url || candidate.host || candidate.database);
}

function isCandidate(
  value: ConnectionCandidate | null,
): value is ConnectionCandidate {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(
  ...values: unknown[]
): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.]/g, "");
}

function getAny(record: unknown, keys: readonly string[]) {
  if (!isRecord(record)) {
    return undefined;
  }
  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizeKey(key))) {
      return value;
    }
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringFrom(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function booleanFrom(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "readonly", "read-only"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function slugify(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

function decodeValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitHostPort(value: string): [string, string] {
  const ipv6 = /^\[([^\]]+)](?::(\d+))?$/.exec(value);
  if (ipv6) {
    return [ipv6[1], ipv6[2] ?? ""];
  }
  const [host, port = ""] = value.split(":", 2);
  return [host, port];
}

function parseHostIdentifier(value: string | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return { user: "", host: "", port: "" };
  }
  const [userPart, hostPart = userPart] = raw.includes("@")
    ? raw.split("@", 2)
    : ["", raw];
  const [host, port] = splitHostPort(hostPart);
  return {
    user: raw.includes("@") ? userPart : "",
    host,
    port,
  };
}

function parseDelimitedProperties(value: string) {
  const entries: Record<string, string> = {};
  value
    .replace(/^[;?&]+/, "")
    .split(/[;&\n]/)
    .forEach((part) => {
      const separator = part.includes("=")
        ? "="
        : part.includes(":")
          ? ":"
          : "";
      if (!separator) {
        return;
      }
      const [key, ...rest] = part.split(separator);
      const normalized = normalizeKey(key);
      if (normalized) {
        entries[normalized] = rest.join(separator).trim();
      }
    });
  return entries;
}

function parseIniSections(text: string) {
  const sections: Array<{ name: string; values: Record<string, string> }> = [];
  let current: { name: string; values: Record<string, string> } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    const section = /^\[([^\]]+)]$/.exec(line);
    if (section) {
      current = { name: section[1], values: {} };
      sections.push(current);
      continue;
    }
    const separator = line.indexOf("=");
    if (separator !== -1 && current) {
      current.values[line.slice(0, separator).trim()] = line
        .slice(separator + 1)
        .trim();
    }
  }
  return sections;
}

function childText(node: Element, localName: string) {
  return Array.from(node.children)
    .find((child) => child.localName === localName)
    ?.textContent?.trim();
}

function optionValue(node: Element, name: string) {
  return (
    Array.from(node.querySelectorAll("option"))
      .find(
        (child) =>
          child.getAttribute("name")?.toLowerCase() === name.toLowerCase(),
      )
      ?.getAttribute("value") ?? undefined
  );
}

function propertyValue(node: Element, name: string) {
  return (
    Array.from(node.querySelectorAll("property"))
      .find(
        (child) =>
          child.getAttribute("name")?.toLowerCase() === name.toLowerCase(),
      )
      ?.getAttribute("value") ?? undefined
  );
}

function keyedXmlValue(node: Element, keys: readonly string[]) {
  const wanted = new Set(keys.map(normalizeKey));
  return Array.from(node.querySelectorAll("[key]"))
    .find((child) => wanted.has(normalizeKey(child.getAttribute("key") ?? "")))
    ?.textContent?.trim();
}

function refAddrValue(node: Element, keys: readonly string[]) {
  const wanted = new Set(keys.map(normalizeKey));
  for (const child of Array.from(node.querySelectorAll("StringRefAddr"))) {
    const addrType = child.getAttribute("addrType") ?? "";
    if (wanted.has(normalizeKey(addrType))) {
      return child.querySelector("Contents")?.textContent?.trim();
    }
  }
  return undefined;
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }
      if (isRecord(value) && Object.keys(value).length === 0) {
        return false;
      }
      return true;
    }),
  );
}

function csvLine(values: readonly string[]) {
  return values
    .map((value) =>
      /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
    )
    .join(",");
}

function xmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlAttribute(value: string) {
  return xmlText(value).replace(/"/g, "&quot;");
}

function iniEscape(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
}

function exportFileName(baseName: string, extension: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${baseName}-${timestamp}.${extension}`;
}
