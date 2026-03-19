-- Migration 008: Add office to verizon_lines + user profiles table

-- ── 1. Add office column to verizon_lines ─────────────────────────────────────
alter table public.verizon_lines
  add column if not exists office text;

-- Map account_number → office (same logic as vehicles)
create or replace function public.verizon_line_office(acct text)
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

-- Backfill existing rows
update public.verizon_lines
  set office = public.verizon_line_office(account_number);

-- Trigger to keep in sync
create or replace function public.sync_verizon_office()
returns trigger language plpgsql as $$
begin
  new.office := public.verizon_line_office(new.account_number);
  return new;
end;$$;

drop trigger if exists trg_verizon_office on public.verizon_lines;
create trigger trg_verizon_office
  before insert or update on public.verizon_lines
  for each row execute function public.sync_verizon_office();

create index if not exists idx_verizon_lines_office on public.verizon_lines(office);

-- Also add office to fleet_overview (PIM line office)
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
  pd.id                           as pim_device_id,
  pd.device_name                  as pim_device_name,
  pd.m360_device_id               as pim_m360_device_id,
  vl.id                           as line_id,
  vl.sub_account,
  public.sub_account_name(vl.account_number) as sub_account_name,
  vl.phone_number,
  vl.phone_status,
  vl.verizon_user,
  vl.mobile_plan,
  vl.monthly_usage_gb,
  vl.account_number,
  pl.id                           as pim_line_id,
  pl.phone_number                 as pim_phone_number_verizon,
  pl.phone_status                 as pim_phone_status,
  pl.monthly_usage_gb             as pim_monthly_usage_gb
from public.vehicles v
left join public.devices dd
  on dd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null and v.vehicle_name_key <> ''
  and (dd.device_name is null or dd.device_name not like '*%')
left join public.devices pd
  on pd.name_key = v.vehicle_name_key
  and v.vehicle_name_key is not null and v.vehicle_name_key <> ''
  and pd.device_name like '*%'
left join public.verizon_lines vl
  on vl.phone_norm = v.driver_phone_norm
  and v.driver_phone_norm is not null and v.driver_phone_norm <> ''
left join public.verizon_lines pl
  on pl.phone_norm = v.pim_phone_norm
  and v.pim_phone_norm is not null and v.pim_phone_norm <> '';

-- ── 2. User profiles table ────────────────────────────────────────────────────
create table if not exists public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  is_admin     boolean not null default false,
  offices      text[] default null,  -- null = all offices; array = restricted to these
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can read their own profile
create policy "Users read own profile"
  on public.user_profiles for select
  to authenticated using (id = auth.uid());

-- Admins can read all profiles (checked via is_admin on own row)
create policy "Admins read all profiles"
  on public.user_profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Admins can update all profiles
create policy "Admins update all profiles"
  on public.user_profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Admins can insert profiles
create policy "Admins insert profiles"
  on public.user_profiles for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();

-- ── 3. IMPORTANT: manually insert your admin profile ─────────────────────────
-- After running this migration, run this in the SQL editor with YOUR user ID:
-- (Find your user ID in Supabase Dashboard → Authentication → Users)
--
-- insert into public.user_profiles (id, email, is_admin)
-- values ('<your-auth-user-id>', '<your-email>', true)
-- on conflict (id) do update set is_admin = true;
