-- Migration 005: remove duplicate vehicles keeping the most recently updated row
-- Duplicates can occur when the same vehicle_number+fleet_id appears across
-- multiple CCSI sheets (e.g. a vehicle in both Active and Surrenders)

with ranked as (
  select id,
    row_number() over (
      partition by vehicle_number, fleet_id
      order by
        case sheet_tab
          when 'Active Vehicles' then 1
          when 'Test Vehicles'   then 2
          when 'Surrenders'      then 3
          else 4
        end,
        updated_at desc
    ) as rn
  from public.vehicles
)
delete from public.vehicles
where id in (select id from ranked where rn > 1);

-- Confirm constraint exists
alter table public.vehicles
  drop constraint if exists vehicles_vehicle_number_fleet_id_key;
alter table public.vehicles
  add constraint vehicles_vehicle_number_fleet_id_key unique (vehicle_number, fleet_id);
