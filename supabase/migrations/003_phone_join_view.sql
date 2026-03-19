-- Migration: replace FK-based joins with phone-number-based joins in fleet_overview.
-- This means the import script never needs to run a linking step —
-- just truncate and reload the three tables and the view self-joins automatically.

-- Helper: strip all non-digit characters for reliable phone matching
create or replace function public.digits_only(p text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g')
$$;

-- Drop the old view and recreate with phone-based joins
drop view if exists public.fleet_overview;

create or replace view public.fleet_overview as
select
  v.id                           as vehicle_id,
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
  v.updated_at                   as vehicle_updated_at,
  d.id                           as device_id,
  d.device_name,
  d.m360_user,
  d.tablet_model,
  d.android_os,
  d.imei,
  d.m360_policy,
  d.m360_device_id,
  d.compliance_status,
  d.last_reported,
  vl.id                          as line_id,
  vl.sub_account,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number
from public.vehicles v
left join public.devices d
  on public.digits_only(d.m360_user) = public.digits_only(v.driver_tablet_phone_number)
left join public.verizon_lines vl
  on  public.digits_only(vl.phone_number) = public.digits_only(v.driver_tablet_phone_number)
  or  public.digits_only(vl.phone_number) = public.digits_only(v.pim_phone_number);
