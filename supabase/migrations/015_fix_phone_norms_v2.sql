-- Migration 015: Re-run phone normalization to catch any rows missed or re-corrupted
-- Safe to run multiple times (idempotent)

-- Ensure normalize_phone function exists (in case 014 was skipped)
create or replace function public.normalize_phone(raw text)
returns text language sql immutable as $$
  select case
    when raw is null or raw = '' then null
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(raw, '[^0-9]', '', 'g'), 1) = '1'
    then right(regexp_replace(raw, '[^0-9]', '', 'g'), 10)
    when length(regexp_replace(raw, '[^0-9]', '', 'g')) = 10
    then regexp_replace(raw, '[^0-9]', '', 'g')
    else null
  end
$$;

-- Fix vehicles (driver and PIM phone norms)
update public.vehicles
set
  driver_phone_norm = public.normalize_phone(driver_tablet_phone_number),
  pim_phone_norm    = public.normalize_phone(pim_phone_number)
where
  driver_phone_norm != public.normalize_phone(driver_tablet_phone_number)
  or pim_phone_norm != public.normalize_phone(pim_phone_number)
  or (driver_phone_norm is null and driver_tablet_phone_number is not null)
  or (pim_phone_norm is null and pim_phone_number is not null);

-- Fix verizon_lines
update public.verizon_lines
set phone_norm = public.normalize_phone(phone_number)
where
  phone_norm != public.normalize_phone(phone_number)
  or (phone_norm is null and phone_number is not null);

-- Verify: this query should show 0 after running
-- select count(*) from vehicles where length(driver_phone_norm) = 11;
