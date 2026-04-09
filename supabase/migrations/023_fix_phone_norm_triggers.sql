-- Migration 023: Fix phone normalization triggers
--
-- The triggers from migration 004 use raw regexp_replace which does NOT strip
-- leading country code "1" from 11-digit numbers. The normalize_phone() function
-- from migration 014 handles this correctly, but the triggers were never updated.
-- This mismatch causes the "Available" tab on the Lines page to miscount because
-- the JS normalizePhone() strips leading "1" but the DB values may still have it.
--
-- Fix: update all three phone-norm trigger functions to use normalize_phone().
-- Then re-normalize all existing rows.

-- Ensure normalize_phone function exists (idempotent)
create or replace function public.normalize_phone(raw text)
returns text language sql immutable as $$
  select case
    when raw is null or raw = '' then null
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(raw, '[^0-9]', '', 'g'), 1) = '1'
    then right(regexp_replace(raw, '[^0-9]', '', 'g'), 10)
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) >= 10
    then regexp_replace(raw, '[^0-9]', '', 'g')
    else null
  end
$$;

-- Fix vehicle phone norm trigger
create or replace function public.sync_vehicle_phone_norms()
returns trigger language plpgsql as $$
begin
  new.driver_phone_norm := public.normalize_phone(new.driver_tablet_phone_number);
  new.pim_phone_norm    := public.normalize_phone(new.pim_phone_number);
  return new;
end;$$;

-- Fix verizon line phone norm trigger
create or replace function public.sync_verizon_phone_norm()
returns trigger language plpgsql as $$
begin
  new.phone_norm := public.normalize_phone(new.phone_number);
  return new;
end;$$;

-- Re-normalize all existing data to be consistent
update public.vehicles
set
  driver_phone_norm = public.normalize_phone(driver_tablet_phone_number),
  pim_phone_norm    = public.normalize_phone(pim_phone_number),
  updated_at        = now();

update public.verizon_lines
set
  phone_norm = public.normalize_phone(phone_number),
  updated_at = now();
