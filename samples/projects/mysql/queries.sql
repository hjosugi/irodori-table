-- MySQL feature sample for Irodori Table.
-- Run against `make db-up DB=mysql`.

select version();

drop table if exists irodori_mysql_orders;

create table irodori_mysql_orders (
  id int primary key auto_increment,
  customer_id int not null,
  attrs json not null,
  total decimal(12,2) not null,
  created_at datetime not null default current_timestamp,
  key irodori_mysql_orders_customer_idx (customer_id),
  constraint irodori_mysql_orders_customer_fk foreign key (customer_id) references customers(id)
);

insert into irodori_mysql_orders (customer_id, attrs, total, created_at)
select id,
       json_object('customer', name, 'tier', case when id in (1, 4) then 'gold' else 'standard' end),
       id * 100.25,
       current_timestamp - interval id day
from customers;

select id,
       json_unquote(json_extract(attrs, '$.customer')) as customer,
       json_unquote(json_extract(attrs, '$.tier')) as tier,
       total
from irodori_mysql_orders
order by id;

select customer_id,
       total,
       dense_rank() over (order by total desc) as revenue_rank
from irodori_mysql_orders
order by revenue_rank;

explain format=json
select *
from irodori_mysql_orders
where customer_id = 1;
