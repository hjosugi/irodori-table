-- Irodori sample schema (MySQL/MariaDB). Loaded on first container init.

create table customers (
  id         int primary key,
  name       varchar(200) not null,
  created_at datetime not null default current_timestamp
);

create table orders (
  id          int primary key,
  customer_id int not null,
  total       decimal(12,2) not null,
  created_at  datetime not null default current_timestamp,
  constraint fk_orders_customer foreign key (customer_id) references customers(id)
);

create table invoice_lines (
  id       int primary key,
  order_id int not null,
  sku      varchar(64) not null,
  qty      int not null,
  amount   decimal(12,2) not null,
  constraint fk_lines_order foreign key (order_id) references orders(id)
);

insert into customers (id, name) values
  (1, 'Kawase Foods'), (2, 'Northwind Retail'), (3, 'Aster Works'), (4, 'Minato Labs');

insert into orders (id, customer_id, total, created_at) values
  (101, 1, 98412.00, now() - interval 1 day),
  (102, 2, 77201.00, now() - interval 2 day),
  (103, 1, 65330.00, now() - interval 3 day),
  (104, 3, 51288.00, now() - interval 4 day);

insert into invoice_lines (id, order_id, sku, qty, amount) values
  (1, 101, 'SKU-001', 3, 32804.00),
  (2, 101, 'SKU-002', 1, 65608.00),
  (3, 102, 'SKU-003', 2, 77201.00),
  (4, 103, 'SKU-001', 5, 65330.00),
  (5, 104, 'SKU-004', 4, 51288.00);

create view recent_revenue as
  select c.id as customer_id, c.name,
         sum(o.total) as lifetime_value, max(o.created_at) as last_order_at
  from customers c join orders o on o.customer_id = c.id
  group by c.id, c.name;
