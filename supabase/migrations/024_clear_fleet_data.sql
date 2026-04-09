-- Migration 024: Clear all fleet data for fresh re-import
-- Run this before uploading new CCSI, devices, and Verizon documents.
-- Preserves: user accounts, user_profiles, app_config, audit_log, sms data, maas360_token

-- Clear verizon_lines first (may have FK references)
truncate public.verizon_lines restart identity cascade;

-- Clear devices
truncate public.devices restart identity cascade;

-- Clear vehicles (cascade will handle any FK refs from drivers, etc.)
truncate public.vehicles restart identity cascade;

-- Clear drivers (linked to vehicles)
truncate public.drivers restart identity cascade;
