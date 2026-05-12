-- Migration 045: RLS hardening + foreign-key indexes
--
-- ────────────────────────────────────────────────────────────────────────
-- Context (from Supabase Security & Performance Advisors, 2026-05-11):
-- ────────────────────────────────────────────────────────────────────────
--
-- 1. Ten tables had `Authenticated full access` policies (FOR ALL, USING/CHECK
--    true), letting any authenticated user mutate any row. Dallas confirmed
--    he's the only admin user. We move to:
--      • SELECT — any authenticated user can read
--      • INSERT / UPDATE / DELETE — only users where user_profiles.is_admin
--    Service-role-driven writes (cron snapshot, webhook inserts, /api/*
--    endpoints) continue to work because service_role bypasses RLS.
--
--    If any non-admin user is added later, they'll be able to *view* the
--    Fleet Portal but cannot edit any of these tables until either (a) we
--    promote them to admin, or (b) we add a more targeted role and policy.
--    Client-side writes from non-admin users (e.g. directly inserting an
--    sms_rule from the UI) will fail with a PostgREST permission error —
--    refactor those paths to /api/* with service role if non-admin write
--    access is needed later.
--
-- 2. Two foreign keys were missing covering indexes:
--      • drivers.seated_vehicle_id  → vehicles.id
--      • inventory_action_card_items.inventory_item_id → inventory_items.id
--    Adding indexes speeds up joins and FK-cascade checks on DELETE.
--
-- All admin checks use (select auth.uid()) so we don't reintroduce the
-- init-plan warnings cleared by migration 044.


-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Foreign-key covering indexes
-- ════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_drivers_seated_vehicle_id
  ON public.drivers(seated_vehicle_id)
  WHERE seated_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_action_card_items_inventory_item_id
  ON public.inventory_action_card_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Split "Authenticated full access" policies on 10 tables
-- ════════════════════════════════════════════════════════════════════════
-- Helper pattern for each table:
--   DROP "Authenticated full access - <table>"
--   CREATE select policy   FOR SELECT  TO authenticated  USING (true)
--   CREATE insert policy   FOR INSERT  TO authenticated  WITH CHECK (admin)
--   CREATE update policy   FOR UPDATE  TO authenticated  USING (admin) WITH CHECK (admin)
--   CREATE delete policy   FOR DELETE  TO authenticated  USING (admin)
--
-- where `admin` is:
--   EXISTS (SELECT 1 FROM public.user_profiles p
--           WHERE p.id = (select auth.uid()) AND p.is_admin = true)


-- ─── vehicles ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - vehicles" ON public.vehicles;

CREATE POLICY vehicles_select_authenticated ON public.vehicles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY vehicles_insert_admin ON public.vehicles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY vehicles_update_admin ON public.vehicles
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY vehicles_delete_admin ON public.vehicles
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── drivers ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - drivers" ON public.drivers;

CREATE POLICY drivers_select_authenticated ON public.drivers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY drivers_insert_admin ON public.drivers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY drivers_update_admin ON public.drivers
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY drivers_delete_admin ON public.drivers
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── devices ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - devices" ON public.devices;

CREATE POLICY devices_select_authenticated ON public.devices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY devices_insert_admin ON public.devices
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY devices_update_admin ON public.devices
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY devices_delete_admin ON public.devices
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── verizon_lines ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - verizon_lines" ON public.verizon_lines;

CREATE POLICY verizon_lines_select_authenticated ON public.verizon_lines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY verizon_lines_insert_admin ON public.verizon_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY verizon_lines_update_admin ON public.verizon_lines
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY verizon_lines_delete_admin ON public.verizon_lines
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── transactions ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - transactions" ON public.transactions;

CREATE POLICY transactions_select_authenticated ON public.transactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY transactions_insert_admin ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY transactions_update_admin ON public.transactions
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY transactions_delete_admin ON public.transactions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── sms_messages ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - sms_messages" ON public.sms_messages;

CREATE POLICY sms_messages_select_authenticated ON public.sms_messages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sms_messages_insert_admin ON public.sms_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY sms_messages_update_admin ON public.sms_messages
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY sms_messages_delete_admin ON public.sms_messages
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── sms_rules ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - sms_rules" ON public.sms_rules;

CREATE POLICY sms_rules_select_authenticated ON public.sms_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sms_rules_insert_admin ON public.sms_rules
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY sms_rules_update_admin ON public.sms_rules
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY sms_rules_delete_admin ON public.sms_rules
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── issues ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - issues" ON public.issues;

CREATE POLICY issues_select_authenticated ON public.issues
  FOR SELECT TO authenticated USING (true);
CREATE POLICY issues_insert_admin ON public.issues
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY issues_update_admin ON public.issues
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY issues_delete_admin ON public.issues
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── driver_vehicle_assignments ────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated full access - driver_vehicle_assignments"
  ON public.driver_vehicle_assignments;

CREATE POLICY driver_vehicle_assignments_select_authenticated ON public.driver_vehicle_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY driver_vehicle_assignments_insert_admin ON public.driver_vehicle_assignments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY driver_vehicle_assignments_update_admin ON public.driver_vehicle_assignments
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY driver_vehicle_assignments_delete_admin ON public.driver_vehicle_assignments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));


-- ─── daily_snapshots ───────────────────────────────────────────────────────
-- Note: only written by /api/snapshot (service role). Authenticated SELECT
-- is preserved so the dashboard charts can read snapshots; admin writes are
-- here for completeness but in practice the path is always service-role.
DROP POLICY IF EXISTS "Authenticated full access - daily_snapshots" ON public.daily_snapshots;

CREATE POLICY daily_snapshots_select_authenticated ON public.daily_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY daily_snapshots_insert_admin ON public.daily_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY daily_snapshots_update_admin ON public.daily_snapshots
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
CREATE POLICY daily_snapshots_delete_admin ON public.daily_snapshots
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true));
