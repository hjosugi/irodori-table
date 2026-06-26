-- TiDB feature sample for Irodori Table.
-- Run against `make db-up DB=tidb`.

select tidb_version();

drop table if exists irodori_tidb_orders;

create table irodori_tidb_orders (
  id bigint primary key auto_increment,
  region varchar(64) not null,
  customer varchar(200) not null,
  total decimal(12,2) not null,
  created_at datetime not null default current_timestamp,
  key irodori_tidb_orders_region_idx (region)
) shard_row_id_bits = 4;

insert into irodori_tidb_orders (region, customer, total)
values
  ('ap-northeast-1', 'Kawase Foods', 98412.00),
  ('us-east-1', 'Northwind Retail', 77201.00),
  ('eu-west-1', 'Aster Works', 65330.00);

select region,
       count(*) as orders,
       sum(total) as revenue
from irodori_tidb_orders
group by region
order by region;

explain analyze
select *
from irodori_tidb_orders
where region = 'ap-northeast-1';
