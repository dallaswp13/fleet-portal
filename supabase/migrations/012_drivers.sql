-- Migration 012: Drivers table

create table if not exists public.drivers (
  id               uuid primary key default gen_random_uuid(),
  driver_id        integer unique not null,   -- Lease # (from CCSI)
  fleet_id         text not null,             -- C, G, D, E, L, S, Y, U
  office           text,                      -- ASC, CYC, SDY, DEN (computed)
  name             text,
  email            text,
  image_url        text,
  active           boolean not null default true,
  personal_phone   text,                      -- Added manually — for SMS linking
  personal_phone_norm text,                   -- Digits only for matching
  seated_vehicle_id uuid references public.vehicles(id) on delete set null,
  seated_vehicle_number integer,              -- Denormalized for quick display
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.drivers enable row level security;

create policy "Authenticated full access - drivers"
  on public.drivers for all
  to authenticated using (true) with check (true);

create index if not exists idx_drivers_fleet_id  on public.drivers(fleet_id);
create index if not exists idx_drivers_office    on public.drivers(office);
create index if not exists idx_drivers_active    on public.drivers(active);
create index if not exists idx_drivers_personal_phone_norm on public.drivers(personal_phone_norm);

-- Trigger: compute office from fleet_id (same logic as vehicles)
create or replace function public.sync_driver_office()
returns trigger language plpgsql as $$
begin
  new.office := case upper(new.fleet_id)
    when 'C'                    then 'CYC'
    when 'G'                    then 'SDY'
    when 'D'                    then 'DEN'
    when 'E' then 'ASC' when 'L' then 'ASC'
    when 'S' then 'ASC' when 'Y' then 'ASC'
    when 'U' then 'ASC'
    else null
  end;
  new.personal_phone_norm := regexp_replace(coalesce(new.personal_phone, ''), '\D', '', 'g');
  return new;
end;$$;

drop trigger if exists trg_driver_office on public.drivers;
create trigger trg_driver_office
  before insert or update on public.drivers
  for each row execute function public.sync_driver_office();

create trigger drivers_updated_at
  before update on public.drivers
  for each row execute function public.handle_updated_at();

-- Add driver_id FK to sms_messages for driver linking
alter table public.sms_messages
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

create index if not exists idx_sms_messages_driver_id on public.sms_messages(driver_id);

-- App config table for runtime secrets (e.g. gmail token stored after OAuth)
create table if not exists public.app_config (
  key         text primary key,
  value       text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Only admins can read/write app_config
create policy "Admins access app_config"
  on public.app_config for all
  to authenticated
  using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin = true)
    or current_setting('request.jwt.claims', true)::json->>'email' = current_setting('app.admin_email', true)
  );
