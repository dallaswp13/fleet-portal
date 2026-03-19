-- Migration 016: Add PIM device fields to fleet_overview + use normalize_phone in joins
-- This fixes PIM tablet model/OS/IMEI/policy/compliance in Vehicle Panel
-- AND fixes phone linking for numbers with +1 prefix stored in vehicles table

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

  -- Driver tablet device fields
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

  -- PIM tablet device fields (all of them, matching driver fields)
  pd.id                           as pim_device_id,
  pd.device_name                  as pim_device_name,
  pd.m360_device_id               as pim_m360_device_id,
  pd.tablet_model                 as pim_tablet_model,
  pd.android_os                   as pim_android_os,
  pd.imei                         as pim_imei,
  pd.m360_policy                  as pim_m360_policy,
  pd.compliance_status            as pim_compliance_status,
  pd.last_reported                as pim_last_reported,

  -- Driver Verizon line
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

-- Driver device: name_key match, NOT a PIM (*) device
left join public.devices dd
  on dd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null and v.vehicle_name_key <> ''
  and (dd.device_name is null or dd.device_name not like '*%')

-- PIM device: name_key match, IS a PIM (*) device
left join public.devices pd
  on pd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null and v.vehicle_name_key <> ''
  and pd.device_name like '*%'

-- Driver Verizon line: join on normalized phone
left join public.verizon_lines vl
  on vl.phone_norm = public.normalize_phone(v.driver_tablet_phone_number)
  and v.driver_tablet_phone_number is not null and v.driver_tablet_phone_number <> ''

-- PIM Verizon line: join on normalized phone
left join public.verizon_lines pl
  on pl.phone_norm = public.normalize_phone(v.pim_phone_number)
  and v.pim_phone_number is not null and v.pim_phone_number <> '';
