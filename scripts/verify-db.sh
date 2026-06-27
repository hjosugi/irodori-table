#!/usr/bin/env bash
#
# Bring up one engine's per-DB compose, verify Irodori connects/queries it via the
# Rust integration tests, then stop it. Each supported engine has its own compose
# under samples/<engine>/compose.yaml.
#
#   scripts/verify-db.sh postgres      # up -> test -> down for one engine
#   scripts/verify-db.sh all           # the normal bootable engines, in turn
#   scripts/verify-db.sh up postgres   # just bring it up and print the env line
#   scripts/verify-db.sh down postgres # stop + remove it
set -uo pipefail

ENGINE_BIN="${ENGINE_BIN:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# DB sample fixtures live in the sibling irodori-samples repo; override with IRODORI_SAMPLES.
SAMPLES="${IRODORI_SAMPLES:-$ROOT/../irodori-samples}"
MANIFEST="$ROOT/apps/desktop/src-tauri/Cargo.toml"

# engine -> (EVAR, URL, TEST). Oracle uses a flag env because its integration
# test reads structured host/port/user/password defaults from the sample compose.
meta() {
  case "$1" in
    postgres)    EVAR=IRODORI_PG_URL;        URL="postgres://irodori:irodori@127.0.0.1:55432/samples"; T=postgres_samples;;
    mysql)       EVAR=IRODORI_MYSQL_URL;     URL="mysql://irodori:irodori@localhost:55306/samples";     T=mysql_samples;;
    mariadb)     EVAR=IRODORI_MARIADB_URL;   URL="mysql://irodori:irodori@localhost:55307/samples";     T=mariadb_connect;;
    timescaledb) EVAR=IRODORI_TIMESCALE_URL; URL="postgres://irodori:irodori@localhost:55433/samples";  T=timescaledb_samples;;
    cockroachdb) EVAR=IRODORI_CRDB_URL;      URL="postgres://root@localhost:55257/defaultdb?sslmode=disable"; T=cockroachdb_connect;;
    yugabytedb)  EVAR=IRODORI_YUGABYTE_URL;  URL="postgres://yugabyte@localhost:55434/yugabyte?sslmode=disable"; T=yugabytedb_connect;;
    tidb)        EVAR=IRODORI_TIDB_URL;      URL="mysql://root@localhost:54000/test";                   T=tidb_connect;;
    sqlserver)   EVAR=IRODORI_MSSQL_URL;     URL="server=tcp:localhost,51433;User Id=sa;Password=Irodori_Strong!23;TrustServerCertificate=true"; T=sqlserver_samples;;
    mongodb)     EVAR=IRODORI_MONGO_URL;     URL="mongodb://irodori:irodori@localhost:57017/samples?authSource=admin"; T=mongo_samples;;
    oracle)      EVAR=IRODORI_ORACLE;        URL="1"; T=oracle_samples;;
    *) echo "no sample DB compose target for '$1' (sqlite/duckdb are embedded; redshift is cloud-only)"; return 1;;
  esac
}

compose_file() {
  if [ "${SAMPLE_NETWORK:-bridge}" = "host" ] && [ -f "$SAMPLES/$1/compose.host.yaml" ]; then
    echo "$SAMPLES/$1/compose.host.yaml"
  else
    echo "$SAMPLES/$1/compose.yaml"
  fi
}

compose() { "$ENGINE_BIN" compose -f "$(compose_file "$1")" "${@:2}"; }

down_engine() {
  compose "$1" down -v >/dev/null 2>&1 || true
  if [ "$1" = "postgres" ] && [ -f "$SAMPLES/$1/compose.host.yaml" ]; then
    SAMPLE_NETWORK=host compose "$1" down -v >/dev/null 2>&1 || true
  fi
}

up_engine() {
  local e="$1"
  if compose "$e" up -d; then
    return 0
  fi
  if [ "$e" = "postgres" ] && [ "${SAMPLE_NETWORK:-bridge}" != "host" ] && [ -f "$SAMPLES/$e/compose.host.yaml" ]; then
    echo "bridge network startup failed; retrying postgres with SAMPLE_NETWORK=host"
    compose "$e" down -v >/dev/null 2>&1 || true
    SAMPLE_NETWORK=host compose "$e" up -d
    return $?
  fi
  return 1
}

verify() {
  local e="$1"; meta "$e" || return 2
  echo "== $e: up =="
  up_engine "$e" || { echo "FAIL($e): compose up"; return 1; }
  echo "== $e: verify (test retries until the DB is ready) =="
  local ok=1
  for _ in $(seq 1 40); do
    if env "$EVAR=$URL" cargo test --manifest-path "$MANIFEST" --test integration_db "$T" -- --nocapture 2>&1 | grep -q "test result: ok\. 1 passed"; then ok=0; break; fi
    sleep 3
  done
  [ $ok -eq 0 ] && echo "PASS: $e" || echo "FAIL/timeout: $e"
  echo "== $e: down =="
  down_engine "$e"
  return $ok
}

case "${1:-}" in
  all)
    rc=0
    for e in postgres mysql mariadb timescaledb cockroachdb tidb sqlserver mongodb; do verify "$e" || rc=1; done
    echo "=== done (heavy/slow engines yugabytedb, oracle: run individually) ==="
    exit $rc ;;
  up)   meta "$2" && up_engine "$2" && echo "export $EVAR=\"$URL\"" ;;
  down) down_engine "$2" ;;
  ""|-h|--help) echo "usage: $0 {all | <engine> | up <engine> | down <engine>}"; echo "engines: postgres mysql mariadb timescaledb cockroachdb yugabytedb tidb sqlserver mongodb oracle"; ;;
  *) verify "$1" ;;
esac
