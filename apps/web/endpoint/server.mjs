import http from "node:http";
import { Pool } from "pg";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://irodori:irodori@127.0.0.1:55432/samples";
const apiToken = process.env.API_TOKEN ?? "";
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 1_048_576);
const maxRowsLimit = Number(process.env.MAX_ROWS_LIMIT ?? 1_000);

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
  max: Number(process.env.PG_POOL_SIZE ?? 4),
  query_timeout: Number(process.env.QUERY_TIMEOUT_MS ?? 15_000),
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeMaxRows(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 500;
  }
  return Math.min(maxRowsLimit, Math.max(1, Math.trunc(parsed)));
}

function assertAuthorized(request) {
  if (!apiToken) {
    return;
  }
  const authorization = request.headers.authorization ?? "";
  if (authorization !== `Bearer ${apiToken}`) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
}

function resultPayload(result, maxRows, elapsedMs) {
  const rows = result.rows.slice(0, maxRows);
  return {
    columns: result.fields.map((field) => field.name),
    rows,
    rowCount: result.rowCount ?? result.rows.length,
    elapsedMs,
    truncated: result.rows.length > rows.length,
  };
}

async function handleQuery(request, response) {
  assertAuthorized(request);
  const payload = await readJson(request);
  const sql = typeof payload.sql === "string" ? payload.sql.trim() : "";
  if (!sql) {
    sendJson(response, 400, { error: "sql is required" });
    return;
  }
  const maxRows = normalizeMaxRows(payload.maxRows);
  const startedAt = performance.now();
  const result = await pool.query({
    text: sql,
    rowMode: "array",
  });
  const selectedResult = Array.isArray(result) ? result[result.length - 1] : result;
  sendJson(response, 200, resultPayload(selectedResult, maxRows, performance.now() - startedAt));
}

async function handleHealth(response) {
  const startedAt = performance.now();
  await pool.query("select 1");
  sendJson(response, 200, {
    ok: true,
    database: "postgres",
    elapsedMs: performance.now() - startedAt,
  });
}

const server = http.createServer((request, response) => {
  void (async () => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      await handleHealth(response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/query") {
      await handleQuery(request, response);
      return;
    }
    sendJson(response, 404, { error: "not found" });
  })().catch((error) => {
    const status = Number(error.status) || 500;
    sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Irodori web endpoint listening on 0.0.0.0:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
