export const sqliteSeedSql = `
create table if not exists notes (
  id integer primary key,
  title text not null,
  body text not null,
  updated_at text not null
);

create table if not exists expenses (
  id integer primary key,
  category text not null,
  amount integer not null,
  spent_on text not null
);

insert into notes (title, body, updated_at) values
  ('Mobile SQLite', 'Created in the browser and stored in IndexedDB.', datetime('now')),
  ('Offline first', 'Export the database when you need a .sqlite file.', datetime('now'));

insert into expenses (category, amount, spent_on) values
  ('hardware', 24800, '2026-06-23'),
  ('hosting', 1800, '2026-06-24'),
  ('travel', 6200, '2026-06-25');
`;

export const duckDbSeedSql = `
create table if not exists events as
select * from (
  values
    (1, 'open', 'mobile', 42),
    (2, 'query', 'desktop', 88),
    (3, 'export', 'mobile', 17)
) as t(id, action, surface, duration_ms);
`;

export function starterSql(engine: "sqlite" | "duckdb") {
  if (engine === "duckdb") {
    return "select surface, count(*) as events, avg(duration_ms) as avg_ms from events group by surface order by events desc;";
  }
  return "select id, title, updated_at from notes order by id;";
}
