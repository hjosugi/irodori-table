-- SQLite feature sample for Irodori Table.
-- Run against an in-memory or file SQLite connection.

pragma foreign_keys = on;

drop table if exists notes;
drop table if exists customers;

create table customers (
  id integer primary key,
  name text not null,
  profile text not null check (json_valid(profile))
);

create table notes (
  id integer primary key,
  customer_id integer not null references customers(id),
  title text not null,
  body text not null,
  created_at text not null default current_timestamp
);

create virtual table notes_fts using fts5(title, body);

insert into customers (id, name, profile) values
  (1, 'Kawase Foods', json_object('tier', 'gold')),
  (2, 'Northwind Retail', json_object('tier', 'silver'));

insert into notes (id, customer_id, title, body) values
  (1, 1, 'cheese order', 'Brie and Alpine Reserve reorder'),
  (2, 2, 'invoice check', 'Confirm discount and delivery window');

insert into notes_fts (rowid, title, body)
select id, title, body from notes;

select c.name,
       json_extract(c.profile, '$.tier') as tier,
       n.title
from customers c
join notes n on n.customer_id = c.id
order by c.id;

select rowid, title
from notes_fts
where notes_fts match 'cheese';
