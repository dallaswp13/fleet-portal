-- Fleet Portal Schema
-- Run in Supabase SQL editor or via supabase db push

-- ─── VEHICLES ────────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id                            uuid primary key default gen_random_uuid(),
  vehicle_number                integer not null,
  fleet_id                      text not null default '',
  unique (vehicle_number, fleet_id),
  sheet_tab                     text not null default 'Active Vehicles', -- 'Active Vehicles' | 'Test Vehicles' | 'Surrenders'
  driver_app_version            text,
  pim_app_version               text,
  online_status                 text,
  driver_tablet_bluetooth_addr  text,
  meter_status                  text,
  driver_tablet_phone_number    text,
  pim_phone_number              text,
  rfid                          text,
  meter_bluetooth_name          text,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- ─── DEVICES (MaaS360 / View_All_Devices) ────────────────────────────────────
create table if not exists public.devices (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  device_name      text,
  m360_user        text,
  tablet_model     text,
  android_os       text,
  imei             text,
  m360_policy      text,
  m360_device_id   text unique,  -- Device ID from MaaS360 for API calls
  compliance_status text,
  last_reported    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─── VERIZON LINES ───────────────────────────────────────────────────────────
create table if not exists public.verizon_lines (
  id                   uuid primary key default gen_random_uuid(),
  vehicle_id           uuid references public.vehicles(id) on delete set null,
  sub_account          text,
  phone_number         text unique,
  phone_status         text,
  verizon_user         text,
  mobile_plan          text,
  monthly_usage_gb     numeric(10,4),
  account_number       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  action       text not null,  -- 'reboot' | 'wipe' | 'kiosk_enter' | 'kiosk_exit' | 'clear_app_data' | 'activate_sim'
  target_type  text not null,  -- 'device' | 'sim'
  target_id    text not null,  -- m360_device_id or phone_number
  vehicle_number integer,
  payload      jsonb,
  result       jsonb,
  success      boolean,
  created_at   timestamptz not null default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
create index if not exists idx_devices_vehicle_id on public.devices(vehicle_id);
create index if not exists idx_devices_m360_device_id on public.devices(m360_device_id);
create index if not exists idx_verizon_lines_vehicle_id on public.verizon_lines(vehicle_id);
create index if not exists idx_verizon_lines_phone on public.verizon_lines(phone_number);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_log_vehicle on public.audit_log(vehicle_number);

-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger vehicles_updated_at
  before update on public.vehicles
  for each row execute function public.handle_updated_at();

create trigger devices_updated_at
  before update on public.devices
  for each row execute function public.handle_updated_at();

create trigger verizon_lines_updated_at
  before update on public.verizon_lines
  for each row execute function public.handle_updated_at();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table public.vehicles      enable row level security;
alter table public.devices       enable row level security;
alter table public.verizon_lines enable row level security;
alter table public.audit_log     enable row level security;

-- Admin: authenticated users get full access (single-role for now)
create policy "Authenticated full access - vehicles"
  on public.vehicles for all
  to authenticated using (true) with check (true);

create policy "Authenticated full access - devices"
  on public.devices for all
  to authenticated using (true) with check (true);

create policy "Authenticated full access - verizon_lines"
  on public.verizon_lines for all
  to authenticated using (true) with check (true);

create policy "Authenticated full access - audit_log"
  on public.audit_log for all
  to authenticated using (true) with check (true);

-- ─── UNIFIED VIEW ─────────────────────────────────────────────────────────────
-- Joins all three tables for the main fleet view
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
  -- Device fields
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
  -- Verizon fields
  vl.id                          as line_id,
  vl.sub_account,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number
from public.vehicles v
left join public.devices d       on d.vehicle_id = v.id
left join public.verizon_lines vl on vl.vehicle_id = v.id;
