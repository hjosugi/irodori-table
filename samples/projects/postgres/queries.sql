-- PostgreSQL feature sample for Irodori Table.
-- Run against `make db-up DB=postgres`.

select version();

create extension if not exists pg_trgm;

drop table if exists irodori_pg_events;

create table irodori_pg_events (
  id bigserial primary key,
  customer_id integer not null references customers(id),
  payload jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index irodori_pg_events_payload_gin
  on irodori_pg_events using gin (payload);

create index irodori_pg_events_tags_gin
  on irodori_pg_events using gin (tags);

insert into irodori_pg_events (customer_id, payload, tags, created_at)
select c.id,
       jsonb_build_object('customer', c.name, 'rank', row_number() over (order by c.id)),
       array['demo', lower(split_part(c.name, ' ', 1))],
       now() - make_interval(days => c.id)
from customers c;

select id,
       payload ->> 'customer' as customer,
       tags,
       created_at
from irodori_pg_events
where payload ? 'rank'
order by id;

select date_trunc('day', created_at) as day,
       count(*) as events
from irodori_pg_events
group by day
order by day desc;

explain (format json)
select *
from irodori_pg_events
where payload @> '{"rank": 1}'::jsonb;
