-- Migration 032: Driver License + extended contact fields
-- Adds columns populated by the Tableau "Driver Report" import (driver-report.csv).
-- personal_phone / email already exist; this adds:
--   * drivers_license          — text, e.g. "A4645905"
--   * drivers_license_expire   — date
--   * drivers_license_state    — text, e.g. "CA"
--   * city / state / street1 / street2 / zip — mailing/contact address
--   * insert_date              — date the lease record was created upstream
--   * allowed_to_work          — boolean (Y/N flag from the report)
--   * complaints_count         — integer

alter table public.drivers
  add column if not exists drivers_license          text,
  add column if not exists drivers_license_expire   date,
  add column if not exists drivers_license_state    text,
  add column if not exists city                     text,
  add column if not exists state                    text,
  add column if not exists street1                  text,
  add column if not exists street2                  text,
  add column if not exists zip_code                 text,
  add column if not exists insert_date              date,
  add column if not exists allowed_to_work          boolean,
  add column if not exists complaints_count         integer;

create index if not exists idx_drivers_license_expire on public.drivers(drivers_license_expire);
