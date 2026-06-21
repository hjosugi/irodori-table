-- Irodori sample schema (Oracle). Runs as APP_USER on FREEPDB1 (gvenzl image).
-- This is the connection target for the Oracle thin-driver spike (SRC-004a);
-- the Irodori Oracle adapter is not wired yet.

create table customers (
  id         number primary key,
  name       varchar2(200) not null,
  created_at timestamp default systimestamp not null
);

create table orders (
  id          number primary key,
  customer_id number not null references customers(id),
  total       number(12,2) not null,
  created_at  timestamp default systimestamp not null
);

insert into customers (id, name) values (1, 'Kawase Foods');
insert into customers (id, name) values (2, 'Northwind Retail');
insert into customers (id, name) values (3, 'Aster Works');
insert into customers (id, name) values (4, 'Minato Labs');

insert into orders (id, customer_id, total, created_at) values (101, 1, 98412.00, systimestamp - 1);
insert into orders (id, customer_id, total, created_at) values (102, 2, 77201.00, systimestamp - 2);
insert into orders (id, customer_id, total, created_at) values (103, 1, 65330.00, systimestamp - 3);
insert into orders (id, customer_id, total, created_at) values (104, 3, 51288.00, systimestamp - 4);

create or replace view recent_revenue as
  select c.id as customer_id, c.name,
         sum(o.total) as lifetime_value, max(o.created_at) as last_order_at
  from customers c join orders o on o.customer_id = c.id
  group by c.id, c.name;

commit;
