-- ============================================================================
-- 042 — Performance indexes for hot-path dashboard / list queries
--
-- These add composite indexes for common multi-column filters that previously
-- forced full-table scans or single-column index lookups + extra filtering.
-- Every index is IF NOT EXISTS so re-running is safe.
-- ============================================================================

-- Dashboard: vehicles filtered by fleet_id + sheet_tab + online_status counts.
-- Existing indexes were single-column on each. Composite avoids two index lookups.
create index if not exists idx_vehicles_fleet_tab on public.vehicles (fleet_id, sheet_tab);

-- Dashboard "online/offline" counters use ILIKE 'Online%' / 'Offline%'. A
-- functional lower() expression index lets PG use the index for ILIKE prefix
-- searches without scanning every row.
create index if not exists idx_vehicles_online_status_lower on public.vehicles (lower(online_status));

-- audit_log: dashboard + audit page show recent entries, often filtered by
-- user. Existing idx_audit_log_created_at handles "recent". This one helps
-- the user-filtered case (Settings → audit by user).
create index if not exists idx_audit_log_user_created on public.audit_log (user_email, created_at desc);

-- sms_messages: dashboard counts unprocessed; also commonly filters by
-- direction + received_at for the inbox view.
create index if not exists idx_sms_messages_processed on public.sms_messages (processed) where processed = false;
create index if not exists idx_sms_messages_dir_received on public.sms_messages (direction, received_at desc);

-- verizon_lines: account_number + office are filtered together on the lines
-- page. Existing single-column indexes worked but composite is faster for
-- the office-restricted admin view.
create index if not exists idx_verizon_lines_office_phone on public.verizon_lines (office, phone_norm);

-- inventory_items: list view orders by sort_order + name; covering index lets
-- ORDER BY use index without sorting.
-- (already exists as idx_inventory_items_sort — keeping for documentation)

-- inventory_action_card_items: lookup by card_id. The FK auto-creates a
-- unique constraint index but card_id alone (without inventory_item_id) is
-- the hot path during execute.
create index if not exists idx_inventory_action_items_card on public.inventory_action_card_items (card_id);

-- issues: open-issues widget reads WHERE status='open' ORDER BY created_at desc.
create index if not exists idx_issues_status_created on public.issues (status, created_at desc) where status = 'open';

-- drivers: vehicle assignment join uses seated_vehicle_number — frequently
-- accessed on driver/vehicle pages.
create index if not exists idx_drivers_seated_vehicle on public.drivers (seated_vehicle_number) where seated_vehicle_number is not null;

-- daily_snapshots: dashboard trend chart reads recent snapshots
-- (already exists — idx_snapshots_date)

-- Collect statistics on the heaviest tables so the planner picks the new
-- indexes promptly after this migration runs.
analyze public.vehicles;
analyze public.audit_log;
analyze public.sms_messages;
analyze public.verizon_lines;
