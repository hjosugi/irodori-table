-- TimescaleDB feature sample for Irodori Table.
-- Run against `make db-up DB=timescaledb`.

select version();

create extension if not exists timescaledb;

drop table if exists irodori_sensor_readings;

create table irodori_sensor_readings (
  time timestamptz not null,
  device_id text not null,
  temperature double precision not null,
  humidity double precision not null
);

select create_hypertable('irodori_sensor_readings', 'time', if_not_exists => true);

insert into irodori_sensor_readings (time, device_id, temperature, humidity)
select now() - (n || ' minutes')::interval,
       'device-' || (1 + n % 3),
       20 + (n % 8),
       45 + (n % 12)
from generate_series(1, 60) as n;

select time_bucket('15 minutes', time) as bucket,
       device_id,
       round(avg(temperature)::numeric, 2) as avg_temperature
from irodori_sensor_readings
group by bucket, device_id
order by bucket desc, device_id
limit 20;

select hypertable_name, num_chunks
from timescaledb_information.hypertables
where hypertable_name = 'irodori_sensor_readings';
