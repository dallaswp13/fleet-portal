-- Migration 020: Definitive phone normalization fix
-- Strips leading country code (1) from all 11-digit phone numbers
-- Run this once after deploying v1.27.1+ to fix all existing rows

-- Ensure normalize_phone function exists
create or replace function public.normalize_phone(raw text)
returns text language sql immutable as $$
  select case
    when raw is null then null
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(raw, '[^0-9]', '', 'g'), 1) = '1'
    then right(regexp_replace(raw, '[^0-9]', '', 'g'), 10)
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) = 10
    then regexp_replace(raw, '[^0-9]', '', 'g')
    else regexp_replace(raw, '[^0-9]', '', 'g')
  end
$$;

-- Fix vehicles: recompute norms from source phone fields
update public.vehicles
set
  driver_phone_norm = public.normalize_phone(driver_tablet_phone_number),
  pim_phone_norm    = public.normalize_phone(pim_phone_number),
  updated_at        = now();

-- Fix verizon_lines: recompute norms
update public.verizon_lines
set phone_norm = public.normalize_phone(phone_number),
    updated_at = now();

-- Verify: should return 0 rows after running
-- select vehicle_number, fleet_id, pim_phone_number, pim_phone_norm 
-- from vehicles where vehicle_number = 6442;
