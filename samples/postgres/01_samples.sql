-- Irodori sample schema (PostgreSQL). Loaded on first container init.
-- Idempotent on purpose, so it can also repair an existing local sample DB.

create table if not exists customers (
  id         integer primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id          integer primary key,
  customer_id integer not null references customers(id),
  total       numeric(12,2) not null,
  created_at  timestamptz not null default now()
);

create table if not exists invoice_lines (
  id       integer primary key,
  order_id integer not null references orders(id),
  sku      text not null,
  qty      integer not null,
  amount   numeric(12,2) not null
);

insert into customers (id, name) values
  (1, 'Kawase Foods'),
  (2, 'Northwind Retail'),
  (3, 'Aster Works'),
  (4, 'Minato Labs')
on conflict (id) do nothing;

insert into orders (id, customer_id, total, created_at) values
  (101, 1, 98412.00, now() - interval '1 day'),
  (102, 2, 77201.00, now() - interval '2 days'),
  (103, 1, 65330.00, now() - interval '3 days'),
  (104, 3, 51288.00, now() - interval '4 days')
on conflict (id) do nothing;

insert into invoice_lines (id, order_id, sku, qty, amount) values
  (1, 101, 'SKU-001', 3, 32804.00),
  (2, 101, 'SKU-002', 1, 65608.00),
  (3, 102, 'SKU-003', 2, 77201.00),
  (4, 103, 'SKU-001', 5, 65330.00),
  (5, 104, 'SKU-004', 4, 51288.00)
on conflict (id) do nothing;

create or replace view recent_revenue as
  select c.id as customer_id,
         c.name,
         sum(o.total)      as lifetime_value,
         max(o.created_at) as last_order_at
  from customers c
  join orders o on o.customer_id = c.id
  group by c.id, c.name;

-- Beekeeper/TablePlus-style demo objects. These make the sample database useful
-- for table browsing, FK navigation, structure views, and richer import/export
-- checks without requiring a separate demo fixture.
create table if not exists countries (
  id         integer primary key,
  name       text not null unique,
  iso_code   char(2) not null unique
);

create table if not exists producers (
  id         integer primary key,
  name       text not null,
  country_id integer not null references countries(id),
  founded_at date,
  website    text
);

create table if not exists cheeses (
  id                integer primary key,
  name              text not null,
  cheese_type       text not null,
  description       text not null default '',
  origin_country_id integer not null references countries(id),
  producer_id       integer references producers(id),
  aging_months      integer,
  price_usd         numeric(10,2),
  created_at        timestamptz not null default now()
);

create table if not exists stores (
  id         integer primary key,
  name       text not null,
  city       text not null,
  country_id integer not null references countries(id)
);

create table if not exists reviews (
  id         integer primary key,
  cheese_id  integer not null references cheeses(id),
  rating     integer not null check (rating between 1 and 5),
  reviewer   text not null,
  notes      text,
  created_at timestamptz not null default now()
);

insert into countries (id, name, iso_code) values
  (1, 'France', 'FR'),
  (2, 'Italy', 'IT'),
  (3, 'Switzerland', 'CH'),
  (4, 'Netherlands', 'NL'),
  (5, 'Japan', 'JP')
on conflict (id) do nothing;

insert into producers (id, name, country_id, founded_at, website) values
  (1, 'Maison Beurre', 1, date '1984-04-12', 'https://example.test/maison-beurre'),
  (2, 'Alpi Latte', 2, date '1971-09-03', 'https://example.test/alpi-latte'),
  (3, 'Kaeserei Nord', 3, date '1968-01-20', 'https://example.test/kaserei-nord'),
  (4, 'Minato Dairy', 5, date '2008-06-14', 'https://example.test/minato-dairy')
on conflict (id) do nothing;

insert into cheeses (
  id, name, cheese_type, description, origin_country_id, producer_id,
  aging_months, price_usd, created_at
) values
  (1, 'Brie de Lumiere', 'soft-ripened', 'Creamy bloomy-rind cheese for quick look and FK browsing demos.', 1, 1, 2, 14.50, now() - interval '8 days'),
  (2, 'Gorgonzola Piccante', 'blue', 'Sharp blue cheese with a long description that exercises wide text cells.', 2, 2, 4, 18.75, now() - interval '7 days'),
  (3, 'Alpine Reserve', 'hard', 'Nutty mountain cheese suited for sorting, filtering, and structure checks.', 3, 3, 12, 22.00, now() - interval '6 days'),
  (4, 'Young Gouda', 'semi-hard', 'Mild everyday cheese with numeric and timestamp sample data.', 4, null, 1, 9.25, now() - interval '5 days'),
  (5, 'Sakura Washed Rind', 'washed-rind', 'Small-batch cheese from a local dairy with FK links to producers.', 5, 4, 3, 16.40, now() - interval '4 days')
on conflict (id) do nothing;

insert into stores (id, name, city, country_id) values
  (1, 'Irodori Market', 'Tokyo', 5),
  (2, 'North Pier Foods', 'Rotterdam', 4),
  (3, 'Rue des Tables', 'Paris', 1)
on conflict (id) do nothing;

insert into reviews (id, cheese_id, rating, reviewer, notes, created_at) values
  (1, 1, 5, 'Aki', 'Great with sourdough.', now() - interval '3 days'),
  (2, 2, 4, 'Mina', 'Strong but balanced.', now() - interval '2 days'),
  (3, 3, 5, 'Ren', 'Excellent melt and texture.', now() - interval '1 day'),
  (4, 5, 4, 'Noa', 'A little funky in a good way.', now())
on conflict (id) do nothing;

create or replace view cheese_summary as
  select ch.id,
         ch.name,
         ch.cheese_type,
         co.name as origin_country,
         pr.name as producer,
         count(rv.id) as review_count,
         round(avg(rv.rating)::numeric, 2) as avg_rating
  from cheeses ch
  join countries co on co.id = ch.origin_country_id
  left join producers pr on pr.id = ch.producer_id
  left join reviews rv on rv.cheese_id = ch.id
  group by ch.id, ch.name, ch.cheese_type, co.name, pr.name;
