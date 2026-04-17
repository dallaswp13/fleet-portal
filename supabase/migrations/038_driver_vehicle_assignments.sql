-- Migration 038: Driver ↔ Vehicle many-to-many assignments
-- Replaces the old 1:1 seated_vehicle_id / seated_vehicle_number on drivers.
-- A driver can be assigned to multiple vehicles (rare) and a vehicle can have
-- up to 2-3 drivers (common for shift work).

create table if not exists public.driver_vehicle_assignments (
  id             uuid primary key default gen_random_uuid(),
  driver_id      integer not null references public.drivers(driver_id) on delete cascade,
  vehicle_number integer not null,
  fleet_id       text    not null,
  -- Shift designation — e.g. 'Day', 'Night', or null if not tracked
  shift          text,
  -- Whether this is the driver's primary vehicle (for display / sorting)
  is_primary     boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A driver can only be assigned to a given vehicle once
  unique (driver_id, vehicle_number, fleet_id)
);

-- Foreign key to vehicles composite key
alter table public.driver_vehicle_assignments
  add constraint fk_dva_vehicle
  foreign key (vehicle_number, fleet_id)
  references public.vehicles(vehicle_number, fleet_id)
  on delete cascade;

alter table public.driver_vehicle_assignments enable row level security;

create policy "Authenticated full access - driver_vehicle_assignments"
  on public.driver_vehicle_assignments for all
  to authenticated using (true) with check (true);

-- Indexes for lookups in both directions
create index if not exists idx_dva_driver_id      on public.driver_vehicle_assignments(driver_id);
create index if not exists idx_dva_vehicle         on public.driver_vehicle_assignments(vehicle_number, fleet_id);

-- Updated-at trigger
create trigger driver_vehicle_assignments_updated_at
  before update on public.driver_vehicle_assignments
  for each row execute function public.handle_updated_at();
