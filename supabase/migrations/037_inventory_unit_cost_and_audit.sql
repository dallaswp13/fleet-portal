-- Migration 037: Inventory unit cost column
-- Adds unit_cost (decimal) to inventory_items for per-item pricing.
-- Audit logging of inventory changes uses the existing audit_log table
-- with target_type = 'inventory'.

-- ── Unit cost column ───────────────────────────────────────────────
alter table public.inventory_items
  add column if not exists unit_cost numeric(10,2) default null;

comment on column public.inventory_items.unit_cost is 'Cost per unit in USD';
