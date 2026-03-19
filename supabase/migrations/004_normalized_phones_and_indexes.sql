-- Migration 004: pre-normalize phone numbers into indexed columns
-- so the view join uses indexes instead of calling digits_only() on every row.

-- Add normalized phone columns to each table
alter table public.vehicles
  add column if not exists driver_phone_norm text,
  add column if not exists pim_phone_norm    text;

alter table public.devices
  add column if not exists m360_user_norm text;

alter table public.verizon_lines
  add column if not exists phone_norm text;

-- Backfill from existing data
update public.vehicles
  set driver_phone_norm = regexp_replace(coalesce(driver_tablet_phone_number,''),'\D','','g'),
      pim_phone_norm    = regexp_replace(coalesce(pim_phone_number,''),'\D','','g');

update public.devices
  set m360_user_norm = regexp_replace(coalesce(m360_user,''),'\D','','g');

update public.verizon_lines
  set phone_norm = regexp_replace(coalesce(phone_number,''),'\D','','g');

-- Indexes on the normalized columns
create index if not exists idx_vehicles_driver_phone_norm on public.vehicles(driver_phone_norm);
create index if not exists idx_vehicles_pim_phone_norm    on public.vehicles(pim_phone_norm);
create index if not exists idx_devices_m360_user_norm     on public.devices(m360_user_norm);
create index if not exists idx_verizon_phone_norm         on public.verizon_lines(phone_norm);

-- Also add index for device_name prefix extraction (vehicle # lookup)
create index if not exists idx_devices_device_name on public.devices(device_name);

-- Rebuild view using pre-normalized columns — no function calls in JOIN
drop view if exists public.fleet_overview;

create view public.fleet_overview as
select
  v.id                            as vehicle_id,
  v.vehicle_number,
  v.fleet_id,
  v.sheet_tab,
  v.driver_app_version,
  v.pim_app_version,
  v.online_status,
  v.driver_tablet_bluetooth_addr,
  v.meter_status,
  v.driver_tablet_phone_number,
  v.pim_phone_number,
  v.rfid,
  v.meter_bluetooth_name,
  v.notes,
  v.updated_at                    as vehicle_updated_at,
  d.id                            as device_id,
  d.device_name,
  d.m360_user,
  d.tablet_model,
  d.android_os,
  d.imei,
  d.m360_policy,
  d.m360_device_id,
  d.compliance_status,
  d.last_reported,
  vl.id                           as line_id,
  vl.sub_account,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number
from public.vehicles v
left join public.devices d
  on d.m360_user_norm = v.driver_phone_norm
    and v.driver_phone_norm <> ''
left join public.verizon_lines vl
  on (vl.phone_norm = v.driver_phone_norm and v.driver_phone_norm <> '')
  or (vl.phone_norm = v.pim_phone_norm    and v.pim_phone_norm    <> '');

-- Triggers to keep norm columns in sync on insert/update
create or replace function public.sync_vehicle_phone_norms()
returns trigger language plpgsql as $$
begin
  new.driver_phone_norm := regexp_replace(coalesce(new.driver_tablet_phone_number,''),'\D','','g');
  new.pim_phone_norm    := regexp_replace(coalesce(new.pim_phone_number,''),'\D','','g');
  return new;
end;$$;

create or replace function public.sync_device_phone_norm()
returns trigger language plpgsql as $$
begin
  new.m360_user_norm := regexp_replace(coalesce(new.m360_user,''),'\D','','g');
  return new;
end;$$;

create or replace function public.sync_verizon_phone_norm()
returns trigger language plpgsql as $$
begin
  new.phone_norm := regexp_replace(coalesce(new.phone_number,''),'\D','','g');
  return new;
end;$$;

drop trigger if exists trg_vehicle_phone_norms  on public.vehicles;
drop trigger if exists trg_device_phone_norm    on public.devices;
drop trigger if exists trg_verizon_phone_norm   on public.verizon_lines;

create trigger trg_vehicle_phone_norms
  before insert or update on public.vehicles
  for each row execute function public.sync_vehicle_phone_norms();

create trigger trg_device_phone_norm
  before insert or update on public.devices
  for each row execute function public.sync_device_phone_norm();

create trigger trg_verizon_phone_norm
  before insert or update on public.verizon_lines
  for each row execute function public.sync_verizon_phone_norm();
