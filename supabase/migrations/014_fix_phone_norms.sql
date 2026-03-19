-- Migration 014: Fix phone normalization — strip leading country code (1) from 11-digit numbers
-- This fixes the matching failure when CCSI phones are stored as +1XXXXXXXXXX

-- Helper: normalize phone to exactly 10 digits, stripping leading country code
create or replace function public.normalize_phone(raw text)
returns text language sql immutable as $$
  select case
    when raw is null or raw = '' then null
    when length(regexp_replace(raw, '\D', '', 'g')) = 11
         and left(regexp_replace(raw, '\D', '', 'g'), 1) = '1'
    then right(regexp_replace(raw, '\D', '', 'g'), 10)
    when length(regexp_replace(raw, '\D', '', 'g')) = 10
    then regexp_replace(raw, '\D', '', 'g')
    else null
  end
$$;

-- Recompute vehicle phone norms
update public.vehicles
set
  driver_phone_norm = public.normalize_phone(driver_tablet_phone_number),
  pim_phone_norm    = public.normalize_phone(pim_phone_number);

-- Recompute verizon_lines phone norm
update public.verizon_lines
set phone_norm = public.normalize_phone(phone_number);

-- Update the fleet_overview view to use the new function going forward
-- (triggers already call digitsOnly — replace it with normalize_phone in future imports)
