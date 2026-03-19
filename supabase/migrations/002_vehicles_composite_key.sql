-- Migration: change vehicles unique constraint from vehicle_number alone
-- to composite (vehicle_number, fleet_id) to support multiple fleets

-- Drop old single-column constraint
alter table public.vehicles
  drop constraint if exists vehicles_vehicle_number_key;

-- Ensure fleet_id is never null (use empty string for unknown fleet)
update public.vehicles set fleet_id = '' where fleet_id is null;
alter table public.vehicles
  alter column fleet_id set not null,
  alter column fleet_id set default '';

-- Add composite unique constraint
alter table public.vehicles
  add constraint vehicles_vehicle_number_fleet_id_key unique (vehicle_number, fleet_id);
