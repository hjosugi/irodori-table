-- MariaDB feature sample for Irodori Table.
-- Run against `make db-up DB=mariadb`.

select version();

drop table if exists irodori_mariadb_metrics;

create table irodori_mariadb_metrics (
  id int primary key auto_increment,
  customer_id int not null,
  attrs longtext check (json_valid(attrs)),
  score decimal(12,2) not null,
  created_at datetime not null default current_timestamp,
  key irodori_mariadb_metrics_customer_idx (customer_id)
);

insert into irodori_mariadb_metrics (customer_id, attrs, score, created_at)
select id,
       json_object('customer', name, 'source', 'mariadb'),
       id * 10.50,
       current_timestamp - interval id day
from customers;

select id,
       json_value(attrs, '$.customer') as customer,
       score,
       avg(score) over () as average_score
from irodori_mariadb_metrics
order by id;

with recursive days(n) as (
  select 1
  union all
  select n + 1 from days where n < 4
)
select n, current_date - interval n day as sample_day
from days;
