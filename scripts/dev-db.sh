#!/usr/bin/env bash
#
# Stand up / tear down the Irodori "samples" databases for real-DB testing, and
# generate large-scale seed data. Uses plain `podman`/`docker run`, so it works
# even where compose is unavailable.
#
#   scripts/dev-db.sh up                 # start postgres + mysql, wait, print env
#   scripts/dev-db.sh seed postgres      # bulk-generate (ROWS rows, TABLES tables)
#   scripts/dev-db.sh test               # run the Rust integration tests
#   scripts/dev-db.sh down               # remove containers
#
# Tunables:  ROWS=10000000  TABLES=100  ENGINE_BIN=podman|docker
set -euo pipefail

ENGINE_BIN="${ENGINE_BIN:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES="$ROOT/samples"
MANIFEST="$ROOT/apps/desktop/src-tauri/Cargo.toml"

PG_NAME=irodori-pg
MY_NAME=irodori-mysql
PG_URL="postgres://irodori:irodori@localhost:55432/samples"
MY_URL="mysql://irodori:irodori@localhost:55306/samples"

ROWS="${ROWS:-10000000}"
TABLES="${TABLES:-100}"

pg()  { "$ENGINE_BIN" exec -i "$PG_NAME" psql -v ON_ERROR_STOP=1 -U irodori -d samples "$@"; }
my()  { "$ENGINE_BIN" exec -i "$MY_NAME" mysql --local-infile=1 -uirodori -pirodori samples "$@"; }

up() {
  "$ENGINE_BIN" run -d --replace --name "$PG_NAME" \
    -e POSTGRES_USER=irodori -e POSTGRES_PASSWORD=irodori -e POSTGRES_DB=samples \
    -p 55432:5432 -v "$SAMPLES/postgres:/docker-entrypoint-initdb.d:ro,Z" \
    docker.io/library/postgres:16-alpine >/dev/null
  "$ENGINE_BIN" run -d --replace --name "$MY_NAME" \
    -e MYSQL_ROOT_PASSWORD=root -e MYSQL_USER=irodori -e MYSQL_PASSWORD=irodori -e MYSQL_DATABASE=samples \
    -p 55306:3306 -v "$SAMPLES/mysql:/docker-entrypoint-initdb.d:ro,Z" \
    docker.io/library/mysql:8.4 --local-infile=1 >/dev/null
  echo "started $PG_NAME (55432) and $MY_NAME (55306)"
  wait_ready
  env_
}

wait_ready() {
  printf 'waiting for postgres'
  for _ in $(seq 1 60); do
    if pg -c 'select 1' >/dev/null 2>&1; then printf ' ready\n'; break; fi
    printf '.'; sleep 1
  done
  printf 'waiting for mysql'
  for _ in $(seq 1 90); do
    if my -e 'select 1' >/dev/null 2>&1; then printf ' ready\n'; break; fi
    printf '.'; sleep 1
  done
}

# Bulk seed: one large `events` table (ROWS) + many small tables (TABLES).
seed() {
  local target="${1:-postgres}"
  case "$target" in
    postgres|pg) seed_pg ;;
    mysql|my)    seed_my ;;
    *) echo "usage: $0 seed {postgres|mysql}"; exit 1 ;;
  esac
}

seed_pg() {
  echo "[pg] events: $ROWS rows (generate_series)"
  pg <<SQL
drop table if exists events;
create table events (
  id bigint primary key, ts timestamptz not null, user_id int not null,
  kind text not null, amount numeric(12,2) not null, payload jsonb not null
);
insert into events (id, ts, user_id, kind, amount, payload)
select g, now() - ((g % 1000000) * interval '1 second'), (g % 50000) + 1,
       (array['click','view','purchase','refund','login'])[1 + (g % 5)],
       round((random()*1000)::numeric, 2),
       jsonb_build_object('seq', g, 'bucket', g % 100)
from generate_series(1, $ROWS) g;
create index events_user_idx on events(user_id);
create index events_ts_idx on events(ts);
SQL
  echo "[pg] $TABLES catalog tables"
  pg <<SQL
do \$\$
declare i int;
begin
  for i in 1..$TABLES loop
    execute format('drop table if exists t_%s', lpad(i::text,4,'0'));
    execute format('create table t_%s (id int primary key, label text, val numeric(10,2), created_at timestamptz default now())', lpad(i::text,4,'0'));
    execute format('insert into t_%s(id,label,val) select g, ''row_''||g, g*1.5 from generate_series(1,200) g', lpad(i::text,4,'0'));
  end loop;
end \$\$;
SQL
  pg -c 'analyze;' >/dev/null
  echo "[pg] seeded"
}

seed_my() {
  echo "[mysql] events: up to $ROWS rows (digit cross-join)"
  my <<SQL
drop table if exists events;
create table events (
  id bigint primary key, ts datetime not null, user_id int not null,
  kind varchar(16) not null, amount decimal(12,2) not null
);
drop table if exists _d;
create table _d(n int);
insert into _d values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);
insert into events (id, ts, user_id, kind, amount)
select id, now() - interval (id % 1000000) second, (id % 50000)+1,
       elt(1+(id%5),'click','view','purchase','refund','login'), round(rand()*1000,2)
from (
  select 1 + a.n + b.n*10 + c.n*100 + d.n*1000 + e.n*10000 + f.n*100000 + g.n*1000000 as id
  from _d a join _d b join _d c join _d d join _d e join _d f join _d g
) s
where id <= $ROWS;
drop table _d;
create index events_user_idx on events(user_id);
SQL
  echo "[mysql] $TABLES catalog tables"
  for i in $(seq 1 "$TABLES"); do
    printf 'drop table if exists t_%04d; create table t_%04d (id int primary key, label varchar(64), val decimal(10,2));\n' "$i" "$i"
  done | my
  echo "[mysql] seeded"
}

down() { "$ENGINE_BIN" rm -f "$PG_NAME" "$MY_NAME" >/dev/null 2>&1 || true; echo "removed sample containers"; }

env_() {
  echo "export IRODORI_PG_URL=\"$PG_URL\""
  echo "export IRODORI_MYSQL_URL=\"$MY_URL\""
}

run_tests() {
  IRODORI_PG_URL="$PG_URL" IRODORI_MYSQL_URL="$MY_URL" \
    cargo test --manifest-path "$MANIFEST" --test integration_db -- --nocapture
}

case "${1:-}" in
  up)   up ;;
  down) down ;;
  env)  env_ ;;
  seed) shift; seed "${1:-postgres}" ;;
  test) run_tests ;;
  *) echo "usage: $0 {up|down|env|seed [postgres|mysql]|test}"; exit 1 ;;
esac
