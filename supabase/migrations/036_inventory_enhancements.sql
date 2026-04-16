-- ============================================================================
-- 036 — Inventory Enhancements
--   1) Split quantity_on_hand → quantity_new + quantity_used (on_hand = sum)
--   2) Add vendor info per item (vendor_name, vendor_company, vendor_email)
--   3) Action-card templates stored in DB (e.g. "New Vehicle" subtracts parts)
-- ============================================================================

-- ── 1. New / Used split ────────────────────────────────────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS quantity_new  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_used integer NOT NULL DEFAULT 0;

-- Seed existing totals into quantity_new (treat current stock as "new")
UPDATE public.inventory_items
  SET quantity_new = quantity_on_hand
  WHERE quantity_new = 0 AND quantity_on_hand > 0;

-- quantity_on_hand becomes a generated column = new + used
-- Postgres 12+ supports GENERATED ALWAYS AS (stored).
-- Drop the old check constraint first, then convert.
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_quantity_on_hand_check;
ALTER TABLE public.inventory_items DROP COLUMN quantity_on_hand;
ALTER TABLE public.inventory_items
  ADD COLUMN quantity_on_hand integer GENERATED ALWAYS AS (quantity_new + quantity_used) STORED;

-- Enforce non-negative
ALTER TABLE public.inventory_items ADD CONSTRAINT chk_qty_new_nonneg  CHECK (quantity_new  >= 0);
ALTER TABLE public.inventory_items ADD CONSTRAINT chk_qty_used_nonneg CHECK (quantity_used >= 0);

-- ── 2. Vendor info ─────────────────────────────────────────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS vendor_name    text,
  ADD COLUMN IF NOT EXISTS vendor_company text,
  ADD COLUMN IF NOT EXISTS vendor_email   text;

-- ── 3. Inventory action-card templates ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_action_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                -- e.g. "New Vehicle"
  description text,                         -- what this action does
  icon        text DEFAULT '📦',
  color       text DEFAULT 'var(--accent)',
  sort_order  integer DEFAULT 100,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Each card has line items that decrement inventory
CREATE TABLE IF NOT EXISTS public.inventory_action_card_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id          uuid NOT NULL REFERENCES public.inventory_action_cards(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity         integer NOT NULL DEFAULT 1,  -- how many to subtract
  UNIQUE (card_id, inventory_item_id)
);

-- Trigger for updated_at
CREATE TRIGGER tg_action_cards_updated
  BEFORE UPDATE ON public.inventory_action_cards
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- RLS
ALTER TABLE public.inventory_action_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_action_card_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read action cards"
  ON public.inventory_action_cards FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage action cards"
  ON public.inventory_action_cards FOR ALL
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Authenticated users can read action card items"
  ON public.inventory_action_card_items FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage action card items"
  ON public.inventory_action_card_items FOR ALL
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ── Seed: "New Vehicle" action card ────────────────────────────────────────
-- Links are created by name; the app handles lookup at execution time since
-- the UUIDs for inventory_items are auto-generated and vary per environment.
INSERT INTO public.inventory_action_cards (name, description, icon, color, sort_order)
VALUES ('New Vehicle', 'Subtract parts needed to set up a new cab: 1 OBD Meter, 1 PIM Cable, 1 Fuse, 1 PIM Case, 1 PIM Mount, and 2 Tab A7 Lite.', '🚕', 'var(--green)', 10)
ON CONFLICT DO NOTHING;

-- Wire up the line items by item name (idempotent)
DO $$
DECLARE
  v_card_id uuid;
BEGIN
  SELECT id INTO v_card_id FROM public.inventory_action_cards WHERE name = 'New Vehicle' LIMIT 1;
  IF v_card_id IS NOT NULL THEN
    INSERT INTO public.inventory_action_card_items (card_id, inventory_item_id, quantity)
    SELECT v_card_id, i.id, q.qty
    FROM (VALUES
      ('OBD Meter',     1),
      ('PIM Cable',     1),
      ('Fuse',          1),
      ('PIM Case',      1),
      ('PIM Mount',     1),
      ('Tablet A7 Lite', 2)
    ) AS q(item_name, qty)
    JOIN public.inventory_items i ON i.name = q.item_name
    ON CONFLICT (card_id, inventory_item_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  END IF;
END $$;
