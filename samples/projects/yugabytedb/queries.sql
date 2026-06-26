-- YugabyteDB YSQL feature sample for Irodori Table.
-- Run against `make db-up DB=yugabytedb`.

select version();

drop table if exists irodori_yb_orders;

create table irodori_yb_orders (
  id int primary key,
  region text not null,
  customer text not null,
  total numeric(12,2) not null,
  created_at timestamptz not null default now()
) split into 3 tablets;

insert into irodori_yb_orders (id, region, customer, total)
values
  (1, 'ap-northeast-1', 'Kawase Foods', 98412.00),
  (2, 'us-east-1', 'Northwind Retail', 77201.00),
  (3, 'eu-west-1', 'Aster Works', 65330.00);

select region,
       count(*) as orders,
       sum(total) as revenue
from irodori_yb_orders
group by region
order by region;

select *
from yb_table_properties('irodori_yb_orders'::regclass);
