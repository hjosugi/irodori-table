-- CockroachDB feature sample for Irodori Table.
-- Run against `make db-up DB=cockroachdb`.

select version();

drop table if exists irodori_crdb_accounts;

create table irodori_crdb_accounts (
  id int primary key default unique_rowid(),
  region string not null,
  owner string not null,
  balance decimal(12,2) not null,
  updated_at timestamptz not null default now()
);

upsert into irodori_crdb_accounts (region, owner, balance)
values
  ('ap-northeast-1', 'Kawase Foods', 98412.00),
  ('us-east-1', 'Northwind Retail', 77201.00),
  ('eu-west-1', 'Aster Works', 65330.00);

select region,
       count(*) as accounts,
       sum(balance) as total_balance
from irodori_crdb_accounts
group by region
order by region;

show ranges from table irodori_crdb_accounts;
