-- 035_inventory_items.sql
-- Fleet supply inventory — tracks counts of physical parts/accessories the
-- office keeps on hand (OBD meters, PIM cables, spare tablets, fuses, cases,
-- mounts, etc).
--
-- Seeded with the six categories Dallas asked to track; additional rows can
-- be added from the UI (/inventory).

create table if not exists public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category            text,
  quantity_on_hand    integer not null default 0 check (quantity_on_hand >= 0),
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  location            text,
  notes               text,
  sort_order          integer not null default 100,
  updated_at          timestamptz not null default now(),
  updated_by          text
);

create index if not exists idx_inventory_items_name on public.inventory_items (name);
create index if not exists idx_inventory_items_sort on public.inventory_items (sort_order, name);

-- updated_at auto-touch trigger (function may or may not already exist from
-- other migrations — use CREATE OR REPLACE so we don't depend on ordering).
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.tg_set_updated_at();

-- RLS: everyone authenticated can read; only admins can write. Mirrors the
-- admin-gating used by Data Audit and app_settings.
alter table public.inventory_items enable row level security;

drop policy if exists inventory_items_select_authenticated on public.inventory_items;
create policy inventory_items_select_authenticated
  on public.inventory_items for select
  using (auth.role() = 'authenticated');

drop policy if exists inventory_items_write_admin on public.inventory_items;
create policy inventory_items_write_admin
  on public.inventory_items for all
  using (exists (select 1 from public.user_profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.user_profiles where id = auth.uid() and is_admin = true));

-- Seed the six categories Dallas called out.
insert into public.inventory_items (name, category, quantity_on_hand, low_stock_threshold, sort_order) values
  ('OBD Meter',        'meters',  0,  5, 10),
  ('PIM Cable',        'cables',  0, 10, 20),
  ('Tablet (A7 Lite)', 'tablets', 0,  3, 30),
  ('Fuse',             'parts',   0, 20, 40),
  ('PIM Case',         'cases',   0, 10, 50),
  ('PIM Mount',        'mounts',  0, 10, 60)
on conflict do nothing;
