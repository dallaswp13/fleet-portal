-- Migration 019: Backfill vehicle_id on transactions using device_name and location

-- Update by device_name: "6020E-SM-T387V" → name_key "6020e" → vehicle
update public.transactions t
set vehicle_id = v.id
from public.vehicles v
where t.vehicle_id is null
  and v.vehicle_name_key is not null
  and lower(
    split_part(
      regexp_replace(t.device_name, '^\*+', ''),
      '-', 1
    )
  ) = v.vehicle_name_key;

-- Update by location: "Cab #6020" → vehicle_number 6020
update public.transactions t
set vehicle_id = v.id
from public.vehicles v
where t.vehicle_id is null
  and t.location ~ '(?i)(cab|vehicle|#)\s*#?\s*\d{1,4}'
  and v.vehicle_number = cast(
    (regexp_match(t.location, '(?i)(?:cab|vehicle|#)\s*#?\s*(\d{1,4})'))[1]
    as integer
  );
