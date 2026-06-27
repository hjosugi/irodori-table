pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists sources (
  id text primary key,
  name text not null,
  product text not null,
  category text not null,
  source_type text not null,
  url text not null unique,
  official integer not null default 1,
  cadence text not null default 'weekly',
  enabled integer not null default 1,
  notes text not null default '',
  last_checked_at text,
  last_changed_at text,
  last_hash text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists source_snapshots (
  id integer primary key autoincrement,
  source_id text not null references sources(id) on delete cascade,
  fetched_at text not null default current_timestamp,
  http_status integer,
  content_hash text not null,
  title text,
  url text not null,
  raw_text text not null,
  metadata_json text not null default '{}'
);

create index if not exists idx_source_snapshots_source_fetched
  on source_snapshots(source_id, fetched_at desc);

create unique index if not exists idx_source_snapshots_source_hash
  on source_snapshots(source_id, content_hash);

create table if not exists facts (
  id integer primary key autoincrement,
  source_id text references sources(id) on delete set null,
  snapshot_id integer references source_snapshots(id) on delete set null,
  product text not null,
  db_family text not null default '',
  version text not null default '',
  area text not null default '',
  title text not null,
  summary text not null,
  impact text not null default '',
  priority text not null default 'normal',
  confidence text not null default 'medium',
  url text not null default '',
  observed_at text not null default current_timestamp,
  metadata_json text not null default '{}'
);

create index if not exists idx_facts_product_version
  on facts(product, version);

create index if not exists idx_facts_area_priority
  on facts(area, priority);

create table if not exists implementation_notes (
  id integer primary key autoincrement,
  fact_id integer references facts(id) on delete set null,
  product text not null default '',
  component text not null,
  title text not null,
  note text not null,
  status text not null default 'open',
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create virtual table if not exists source_snapshots_fts using fts5(
  title,
  raw_text,
  source_id unindexed,
  content='source_snapshots',
  content_rowid='id'
);

create virtual table if not exists facts_fts using fts5(
  title,
  summary,
  impact,
  product unindexed,
  content='facts',
  content_rowid='id'
);

create trigger if not exists source_snapshots_ai after insert on source_snapshots begin
  insert into source_snapshots_fts(rowid, title, raw_text, source_id)
  values (new.id, coalesce(new.title, ''), new.raw_text, new.source_id);
end;

create trigger if not exists source_snapshots_ad after delete on source_snapshots begin
  insert into source_snapshots_fts(source_snapshots_fts, rowid, title, raw_text, source_id)
  values ('delete', old.id, coalesce(old.title, ''), old.raw_text, old.source_id);
end;

create trigger if not exists source_snapshots_au after update on source_snapshots begin
  insert into source_snapshots_fts(source_snapshots_fts, rowid, title, raw_text, source_id)
  values ('delete', old.id, coalesce(old.title, ''), old.raw_text, old.source_id);
  insert into source_snapshots_fts(rowid, title, raw_text, source_id)
  values (new.id, coalesce(new.title, ''), new.raw_text, new.source_id);
end;

create trigger if not exists facts_ai after insert on facts begin
  insert into facts_fts(rowid, title, summary, impact, product)
  values (new.id, new.title, new.summary, new.impact, new.product);
end;

create trigger if not exists facts_ad after delete on facts begin
  insert into facts_fts(facts_fts, rowid, title, summary, impact, product)
  values ('delete', old.id, old.title, old.summary, old.impact, old.product);
end;

create trigger if not exists facts_au after update on facts begin
  insert into facts_fts(facts_fts, rowid, title, summary, impact, product)
  values ('delete', old.id, old.title, old.summary, old.impact, old.product);
  insert into facts_fts(rowid, title, summary, impact, product)
  values (new.id, new.title, new.summary, new.impact, new.product);
end;
