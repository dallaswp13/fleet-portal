-- Migration 044: Performance Advisor fixes
--
-- Three categories of fixes from the Supabase Performance Advisor:
--
-- 1. auth_rls_initplan (9 policies) — auth.uid() and auth.role() were being
--    re-evaluated per row inside RLS policies. Wrapping them in
--    (select auth.uid()) makes Postgres treat the call as a stable subquery
--    that runs once per statement instead of once per row. Big win on
--    large-result queries (inventory pages, audit log, etc.).
--
-- 2. multiple_permissive_policies (5 tables) — each table had a
--    read-everyone policy AND an admin write FOR ALL policy. FOR ALL fires
--    on SELECT too, so every SELECT was evaluating both policies and
--    OR-ing them. Splitting the admin policy into FOR INSERT / UPDATE /
--    DELETE means SELECTs only evaluate the read policy.
--
-- 3. duplicate_index (3 pairs) — historical migrations created two indexes
--    on the same column. We keep the one with the canonical
--    idx_<table>_<column> naming and drop the shorter alias.
--
-- All changes are pure performance — no behavior or permission changes.


-- ════════════════════════════════════════════════════════════════════════
-- PART 1: auth_rls_initplan — wrap auth.<fn>() in (select auth.<fn>())
-- ════════════════════════════════════════════════════════════════════════
-- DROP + CREATE rather than ALTER POLICY because some of the FOR ALL
-- policies will be replaced entirely by Part 2's split anyway, and uniform
-- DROP+CREATE is easier to audit.


-- ─── user_profiles "Users update own profile" ──────────────────────────────
DROP POLICY IF EXISTS "Users update own profile" ON public.user_profiles;
CREATE POLICY "Users update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()));


-- ─── app_config "Admins access app_config" ────────────────────────────────
-- Single FOR ALL policy on this table — Part 2 doesn't apply; only the
-- initplan fix is needed.
DROP POLICY IF EXISTS "Admins access app_config" ON public.app_config;
CREATE POLICY "Admins access app_config"
  ON public.app_config FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true)
    OR (select current_setting('request.jwt.claims', true))::json->>'email' = (select current_setting('app.admin_email', true))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin = true)
    OR (select current_setting('request.jwt.claims', true))::json->>'email' = (select current_setting('app.admin_email', true))
  );


-- ─── inventory_items.inventory_items_select_authenticated ──────────────────
-- This one uses auth.role() instead of auth.uid().
DROP POLICY IF EXISTS inventory_items_select_authenticated ON public.inventory_items;
CREATE POLICY inventory_items_select_authenticated
  ON public.inventory_items FOR SELECT
  USING ((select auth.role()) = 'authenticated');


-- ─── audit_ignores.audit_ignores_read ──────────────────────────────────────
DROP POLICY IF EXISTS audit_ignores_read ON public.audit_ignores;
CREATE POLICY audit_ignores_read
  ON public.audit_ignores FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: multiple_permissive_policies — split FOR ALL into INSERT/UPDATE/DELETE
-- ════════════════════════════════════════════════════════════════════════
-- For each table with a read-everyone policy + an admin FOR ALL policy,
-- replace the FOR ALL with three separate policies. SELECTs now only
-- evaluate the read policy; admin checks only run on writes.
-- The auth.uid() calls are also wrapped in (select ...) at the same time.


-- ─── app_settings.app_settings_write ───────────────────────────────────────
DROP POLICY IF EXISTS app_settings_write ON public.app_settings;

CREATE POLICY app_settings_write_insert
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));

CREATE POLICY app_settings_write_update
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));

CREATE POLICY app_settings_write_delete
  ON public.app_settings FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));


-- ─── audit_ignores.audit_ignores_write ─────────────────────────────────────
DROP POLICY IF EXISTS audit_ignores_write ON public.audit_ignores;

CREATE POLICY audit_ignores_write_insert
  ON public.audit_ignores FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));

CREATE POLICY audit_ignores_write_update
  ON public.audit_ignores FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));

CREATE POLICY audit_ignores_write_delete
  ON public.audit_ignores FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (select auth.uid()) AND p.is_admin));


-- ─── inventory_items.inventory_items_write_admin ───────────────────────────
DROP POLICY IF EXISTS inventory_items_write_admin ON public.inventory_items;

CREATE POLICY inventory_items_write_admin_insert
  ON public.inventory_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY inventory_items_write_admin_update
  ON public.inventory_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY inventory_items_write_admin_delete
  ON public.inventory_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- ─── inventory_action_cards "Admins can manage action cards" ───────────────
DROP POLICY IF EXISTS "Admins can manage action cards" ON public.inventory_action_cards;

CREATE POLICY "Admins manage action cards - insert"
  ON public.inventory_action_cards FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY "Admins manage action cards - update"
  ON public.inventory_action_cards FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY "Admins manage action cards - delete"
  ON public.inventory_action_cards FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- ─── inventory_action_card_items "Admins can manage action card items" ─────
DROP POLICY IF EXISTS "Admins can manage action card items" ON public.inventory_action_card_items;

CREATE POLICY "Admins manage action card items - insert"
  ON public.inventory_action_card_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY "Admins manage action card items - update"
  ON public.inventory_action_card_items FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));

CREATE POLICY "Admins manage action card items - delete"
  ON public.inventory_action_card_items FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = (select auth.uid()) AND is_admin = true));


-- ════════════════════════════════════════════════════════════════════════
-- PART 3: duplicate_index — drop redundant indexes
-- ════════════════════════════════════════════════════════════════════════
-- Each pair indexes the exact same column. We keep the one with the
-- canonical idx_<table>_<column> naming convention used in newer migrations.

-- sms_messages(sender_phone): keep idx_sms_messages_sender_phone (from 011),
-- drop idx_sms_sender_phone (added in 027).
DROP INDEX IF EXISTS public.idx_sms_sender_phone;

-- sms_messages(vehicle_id): keep idx_sms_messages_vehicle_id (from 011),
-- drop idx_sms_vehicle_id (added in 022).
DROP INDEX IF EXISTS public.idx_sms_vehicle_id;

-- verizon_lines(phone_norm): keep idx_verizon_lines_phone_norm (from 022/025
-- with the canonical naming), drop idx_verizon_phone_norm (from 004).
DROP INDEX IF EXISTS public.idx_verizon_phone_norm;
