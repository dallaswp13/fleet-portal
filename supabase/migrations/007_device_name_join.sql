-- Migration 007: Fix device-to-vehicle pairing using device_name prefix
-- Problem: devices are NOT reliably joined by phone number (m360_user).
-- The true join key is the device_name prefix:
--   "2g-SM-T387V"  → vehicle 2, fleet G  (driver tablet, no leading *)
--   "*2g-SM-T387V" → vehicle 2, fleet G  (PIM tablet, leading *)
-- We extract a "name_key" = lower(vehicle_number || fleet_id) from device_name.

-- Step 1: add a computed name_key column to devices
alter table public.devices
  add column if not exists name_key text;

-- Step 2: function to extract name_key from device_name
-- Strip leading *, take everything before the first '-', lowercase.
-- e.g. "2g-SM-T387V" → "2g", "*2g-SM-T387V" → "2g"
create or replace function public.device_name_key(dname text)
returns text language sql immutable as $$
  select lower(
    split_part(
      regexp_replace(coalesce(dname, ''), '^\*+', ''),
      '-', 1
    )
  )
$$;

-- Step 3: backfill existing devices
update public.devices
  set name_key = public.device_name_key(device_name);

-- Step 4: index for fast join
create index if not exists idx_devices_name_key on public.devices(name_key);

-- Step 5: trigger to keep name_key in sync
create or replace function public.sync_device_name_key()
returns trigger language plpgsql as $$
begin
  new.name_key := public.device_name_key(new.device_name);
  return new;
end;$$;

drop trigger if exists trg_device_name_key on public.devices;
create trigger trg_device_name_key
  before insert or update on public.devices
  for each row execute function public.sync_device_name_key();

-- Step 6: add vehicle_name_key to vehicles for the other side of the join
alter table public.vehicles
  add column if not exists vehicle_name_key text;

-- e.g. vehicle 2, fleet G → "2g"
create or replace function public.vehicle_name_key_fn(vnum integer, fleet text)
returns text language sql immutable as $$
  select lower(coalesce(vnum::text,'') || coalesce(fleet,''))
$$;

update public.vehicles
  set vehicle_name_key = public.vehicle_name_key_fn(vehicle_number, fleet_id);

create index if not exists idx_vehicles_name_key on public.vehicles(vehicle_name_key);

create or replace function public.sync_vehicle_name_key()
returns trigger language plpgsql as $$
begin
  new.vehicle_name_key := public.vehicle_name_key_fn(new.vehicle_number, new.fleet_id);
  return new;
end;$$;

drop trigger if exists trg_vehicle_name_key on public.vehicles;
create trigger trg_vehicle_name_key
  before insert or update on public.vehicles
  for each row execute function public.sync_vehicle_name_key();

-- Step 7: rebuild fleet_overview using device_name_key join (primary)
-- Falls back to m360_user_norm/phone join for devices that have phone usernames.
-- PIM device: name_key matches AND device_name starts with *
-- Driver device: name_key matches AND device_name does NOT start with *
drop view if exists public.fleet_overview;

create view public.fleet_overview as
select
  v.id                            as vehicle_id,
  v.vehicle_number,
  upper(v.fleet_id)               as fleet_id,
  v.office,
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

  -- Driver tablet: name_key match + no leading * on device_name
  dd.id                           as device_id,
  dd.device_name,
  dd.m360_user,
  dd.tablet_model,
  dd.android_os,
  dd.imei,
  dd.m360_policy,
  dd.m360_device_id,
  dd.compliance_status,
  dd.last_reported,

  -- PIM tablet: name_key match + leading * on device_name
  pd.id                           as pim_device_id,
  pd.device_name                  as pim_device_name,
  pd.m360_device_id               as pim_m360_device_id,

  -- Driver Verizon line (by phone number)
  vl.id                           as line_id,
  vl.sub_account,
  public.sub_account_name(vl.account_number) as sub_account_name,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number,

  -- PIM Verizon line
  pl.id                           as pim_line_id,
  pl.phone_number                 as pim_phone_number_verizon,
  pl.phone_status                 as pim_phone_status,
  pl.monthly_usage_gb             as pim_monthly_usage_gb

from public.vehicles v

-- Driver tablet: device_name_key matches vehicle_name_key, no leading *
left join public.devices dd
  on dd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null
  and v.vehicle_name_key <> ''
  and (dd.device_name is null or dd.device_name not like '*%')

-- PIM tablet: device_name_key matches, leading * present
left join public.devices pd
  on pd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null
  and v.vehicle_name_key <> ''
  and pd.device_name like '*%'

-- Driver Verizon line
left join public.verizon_lines vl
  on vl.phone_norm = v.driver_phone_norm
  and v.driver_phone_norm is not null
  and v.driver_phone_norm <> ''

-- PIM Verizon line
left join public.verizon_lines pl
  on pl.phone_norm = v.pim_phone_norm
  and v.pim_phone_norm is not null
  and v.pim_phone_norm <> '';
