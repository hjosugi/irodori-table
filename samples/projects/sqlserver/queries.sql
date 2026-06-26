-- SQL Server feature sample for Irodori Table.
-- Run against `make db-up DB=sqlserver`.

select @@version as version;

if object_id('dbo.irodori_sqlserver_orders', 'U') is not null
  drop table dbo.irodori_sqlserver_orders;

create table dbo.irodori_sqlserver_orders (
  id int identity(1,1) primary key,
  customer_name nvarchar(200) not null,
  total decimal(12,2) not null,
  created_at datetime2 not null default sysdatetime(),
  attrs nvarchar(max) not null,
  constraint irodori_sqlserver_orders_attrs_json check (isjson(attrs) = 1)
);

insert into dbo.irodori_sqlserver_orders (customer_name, total, attrs)
values
  (N'Kawase Foods', 98412.00, json_object('tier': 'gold')),
  (N'Northwind Retail', 77201.00, json_object('tier': 'silver')),
  (N'Aster Works', 65330.00, json_object('tier': 'standard'));

select top (10)
       id,
       customer_name,
       json_value(attrs, '$.tier') as tier,
       total,
       dense_rank() over (order by total desc) as revenue_rank
from dbo.irodori_sqlserver_orders
order by id;

select customer_name, total
from dbo.irodori_sqlserver_orders
order by total desc
offset 0 rows fetch next 2 rows only;
