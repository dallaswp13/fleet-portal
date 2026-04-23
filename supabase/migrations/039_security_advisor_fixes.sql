-- Migration 039: Fix Supabase Security Advisor errors
-- 1. fleet_overview — Security Definer View → recreate with security_invoker = true
-- 2. unassociated_devices — Security Definer View → recreate with security_invoker = true
-- 3. daily_snapshots — RLS Disabled → enable RLS + add authenticated policy

-- ─── 1. fleet_overview: switch to security invoker ──────────────────────────
DROP VIEW IF EXISTS public.fleet_overview;

CREATE VIEW public.fleet_overview
WITH (security_invoker = true) AS
SELECT
  v.id                            AS vehicle_id,
  v.vehicle_number,
  upper(v.fleet_id)               AS fleet_id,
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
  v.updated_at                    AS vehicle_updated_at,

  -- Driver tablet device fields
  dd.id                           AS device_id,
  dd.device_name,
  dd.m360_user,
  dd.tablet_model,
  dd.android_os,
  dd.imei,
  dd.m360_policy,
  dd.m360_device_id,
  dd.compliance_status,
  dd.last_reported,

  -- PIM tablet device fields
  pd.id                           AS pim_device_id,
  pd.device_name                  AS pim_device_name,
  pd.m360_device_id               AS pim_m360_device_id,
  pd.tablet_model                 AS pim_tablet_model,
  pd.android_os                   AS pim_android_os,
  pd.imei                         AS pim_imei,
  pd.m360_policy                  AS pim_m360_policy,
  pd.compliance_status            AS pim_compliance_status,
  pd.last_reported                AS pim_last_reported,

  -- Driver Verizon line
  vl.id                           AS line_id,
  vl.sub_account,
  public.sub_account_name(vl.account_number) AS sub_account_name,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number,

  -- PIM Verizon line
  pl.id                           AS pim_line_id,
  pl.phone_number                 AS pim_phone_number_verizon,
  pl.phone_status                 AS pim_phone_status,
  pl.monthly_usage_gb             AS pim_monthly_usage_gb

FROM public.vehicles v

LEFT JOIN public.devices dd
  ON dd.name_key = v.vehicle_name_key
  AND v.vehicle_name_key IS NOT NULL AND v.vehicle_name_key <> ''
  AND (dd.device_name IS NULL OR dd.device_name NOT LIKE '*%')

LEFT JOIN public.devices pd
  ON pd.name_key = v.vehicle_name_key
  AND v.vehicle_name_key IS NOT NULL AND v.vehicle_name_key <> ''
  AND pd.device_name LIKE '*%'

LEFT JOIN public.verizon_lines vl
  ON vl.phone_norm = public.normalize_phone(v.driver_tablet_phone_number)
  AND v.driver_tablet_phone_number IS NOT NULL AND v.driver_tablet_phone_number <> ''

LEFT JOIN public.verizon_lines pl
  ON pl.phone_norm = public.normalize_phone(v.pim_phone_number)
  AND v.pim_phone_number IS NOT NULL AND v.pim_phone_number <> '';


-- ─── 2. unassociated_devices: switch to security invoker ────────────────────
DROP VIEW IF EXISTS public.unassociated_devices;

CREATE VIEW public.unassociated_devices
WITH (security_invoker = true) AS
SELECT d.*
FROM devices d
WHERE NOT EXISTS (
  SELECT 1 FROM vehicles v
  WHERE v.vehicle_name_key IS NOT NULL
    AND v.vehicle_name_key = d.name_key
);


-- ─── 3. daily_snapshots: enable RLS + add policy ───────────────────────────
ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access - daily_snapshots"
  ON public.daily_snapshots FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
