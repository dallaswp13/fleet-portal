-- Migration 006: add office field, fix duplicate rows in fleet_overview

-- Add office column to vehicles
alter table public.vehicles
  add column if not exists office text;

-- Populate office from fleet_id
update public.vehicles set office = case
  when upper(fleet_id) = 'C'                            then 'CYC'
  when upper(fleet_id) = 'G'                            then 'SDY'
  when upper(fleet_id) = 'D'                            then 'DEN'
  when upper(fleet_id) in ('L','S','Y','U','E')         then 'ASC'
  else null
end;

-- Trigger to auto-set office on insert/update
create or replace function public.sync_vehicle_office()
returns trigger language plpgsql as $$
begin
  new.office := case
    when upper(new.fleet_id) = 'C'                        then 'CYC'
    when upper(new.fleet_id) = 'G'                        then 'SDY'
    when upper(new.fleet_id) = 'D'                        then 'DEN'
    when upper(new.fleet_id) in ('L','S','Y','U','E')     then 'ASC'
    else null
  end;
  return new;
end;$$;

drop trigger if exists trg_vehicle_office on public.vehicles;
create trigger trg_vehicle_office
  before insert or update on public.vehicles
  for each row execute function public.sync_vehicle_office();

-- Sub-account name lookup
create or replace function public.sub_account_name(acct text)
returns text language sql immutable as $$
  select case acct
    when '571689935-00002' then 'ASC'
    when '571689935-00003' then 'CYC'
    when '571689935-00004' then 'SDY'
    when '571689935-00010' then 'DEN'
    when '571689935-00007' then 'Staff'
    when '571689935-00009' then 'Staff'
    else null
  end
$$;

-- Fix fleet_overview: one row per vehicle
-- Join driver line and PIM line separately so both appear in same row
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
  -- Driver tablet device (no leading *)
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
  -- PIM device (leading *)
  pd.id                           as pim_device_id,
  pd.device_name                  as pim_device_name,
  pd.m360_device_id               as pim_m360_device_id,
  -- Driver verizon line
  vl.id                           as line_id,
  vl.sub_account,
  public.sub_account_name(vl.account_number) as sub_account_name,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number,
  -- PIM verizon line
  pl.id                           as pim_line_id,
  pl.phone_number                 as pim_phone_number_verizon,
  pl.phone_status                 as pim_phone_status,
  pl.monthly_usage_gb             as pim_monthly_usage_gb
from public.vehicles v
-- Driver tablet: device name does NOT start with *
left join public.devices dd
  on dd.m360_user_norm = v.driver_phone_norm
  and v.driver_phone_norm <> ''
  and (dd.device_name is null or dd.device_name not like '*%')
-- PIM device: device name starts with *
left join public.devices pd
  on pd.m360_user_norm = v.pim_phone_norm
  and v.pim_phone_norm <> ''
  and pd.device_name like '*%'
-- Driver verizon line
left join public.verizon_lines vl
  on vl.phone_norm = v.driver_phone_norm
  and v.driver_phone_norm <> ''
-- PIM verizon line
left join public.verizon_lines pl
  on pl.phone_norm = v.pim_phone_norm
  and v.pim_phone_norm <> '';
