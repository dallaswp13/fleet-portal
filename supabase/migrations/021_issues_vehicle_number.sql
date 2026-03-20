-- Migration 021: Add vehicle_number to issues table
alter table public.issues
  add column if not exists vehicle_number integer;

create index if not exists idx_issues_vehicle_number on public.issues(vehicle_number);
