-- DuckDB feature sample for Irodori Table.
-- Run against `:memory:` or a DuckDB file connection.

select version();

create or replace table irodori_duck_orders as
select *
from (
  values
    (1, 'Kawase Foods', 98412.00, date '2026-06-01'),
    (2, 'Northwind Retail', 77201.00, date '2026-06-02'),
    (3, 'Aster Works', 65330.00, date '2026-06-03')
) as t(id, customer, total, ordered_on);

select customer,
       total,
       dense_rank() over (order by total desc) as revenue_rank
from irodori_duck_orders;

select struct_pack(customer := customer, total := total) as order_doc
from irodori_duck_orders
order by id;

summarize irodori_duck_orders;

explain
select customer, total
from irodori_duck_orders
where total > 70000;
