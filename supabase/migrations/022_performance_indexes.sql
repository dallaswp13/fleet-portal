-- Migration 022: Performance indexes for common query patterns

-- fleet_overview queries always filter/sort by vehicle_number
create index if not exists idx_vehicles_vehicle_number on public.vehicles(vehicle_number);

-- Verizon lines page filters by office and phone_norm frequently  
create index if not exists idx_verizon_lines_phone_norm on public.verizon_lines(phone_norm);
create index if not exists idx_verizon_lines_office on public.verizon_lines(office);
create index if not exists idx_verizon_lines_account_number on public.verizon_lines(account_number);

-- Devices page filters by name_key and compliance
create index if not exists idx_devices_compliance on public.devices(compliance_status);
create index if not exists idx_devices_android_os on public.devices(android_os);
create index if not exists idx_devices_m360_policy on public.devices(m360_policy);

-- Vehicles page common filters
create index if not exists idx_vehicles_sheet_tab on public.vehicles(sheet_tab);
create index if not exists idx_vehicles_fleet_online on public.vehicles(fleet_id, online_status);

-- Transactions lookup by vehicle
create index if not exists idx_transactions_vehicle_id on public.transactions(vehicle_id);
create index if not exists idx_transactions_date on public.transactions(transaction_date desc);

-- SMS messages lookup by vehicle
create index if not exists idx_sms_vehicle_id on public.sms_messages(vehicle_id);

-- Audit log most recent first
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
