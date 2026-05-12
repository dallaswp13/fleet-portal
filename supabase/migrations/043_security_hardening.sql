-- Migration 043: Security hardening based on Supabase Database Linter warnings
--
-- Three changes:
--
-- 1. function_search_path_mutable (20 functions) — lock search_path so a
--    malicious user with CREATE on another schema in the search_path cannot
--    shadow trusted function names. The actual exploit requires CREATE
--    privileges that anon/authenticated do not have on public by default,
--    so this is largely defense-in-depth; the fix is one ALTER per function.
--
-- 2. anon_security_definer_function_executable — record_daily_snapshot() is
--    SECURITY DEFINER and currently callable by anon and authenticated via
--    /rest/v1/rpc/record_daily_snapshot. Only the snapshot endpoint at
--    /api/snapshot (running with service role) needs to call it. Revoke
--    EXECUTE from anon, authenticated, and PUBLIC. service_role retains
--    EXECUTE so the app keeps working.
--
-- 3. rls_policy_always_true on audit_log — current policy is FOR ALL with
--    USING (true) WITH CHECK (true), meaning any authenticated user could
--    INSERT, UPDATE, or DELETE audit rows. Audit logs must be append-only
--    from the app. Replace with a SELECT-only policy. Writes come from the
--    service role, which bypasses RLS, so existing write paths are unaffected.
--
-- The other tables flagged by rls_policy_always_true (vehicles, drivers,
-- sms_messages, sms_rules, transactions, devices, driver_vehicle_assignments,
-- issues, verizon_lines, daily_snapshots) are intentionally left as-is.
-- All authenticated users of Fleet Portal are trusted office staff today.
-- When Driver Portal launches and drivers share the same Supabase Auth
-- project, those policies will need to be narrowed by role — that's a
-- separate design pass, not this migration.


-- ─── 1. Lock search_path on flagged functions ──────────────────────────────
-- Use a DO block + regprocedure cast so we don't need to enumerate argument
-- signatures for each function (handles overloads correctly).
DO $$
DECLARE
  fn_sig text;
BEGIN
  FOR fn_sig IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'sync_driver_office',
        'tg_set_updated_at',
        'normalize_phone',
        'sync_vehicle_phone_norms',
        'sync_verizon_phone_norm',
        'count_available_lines',
        'get_available_line_norms',
        'record_daily_snapshot',
        'sms_rules_sync_actions',
        'device_name_key',
        'sync_device_name_key',
        'vehicle_name_key_fn',
        'sync_vehicle_name_key',
        'verizon_line_office',
        'sync_verizon_office',
        'handle_updated_at',
        'digits_only',
        'sync_device_phone_norm',
        'sync_vehicle_office',
        'sub_account_name'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', fn_sig);
    RAISE NOTICE 'Locked search_path on %', fn_sig;
  END LOOP;
END $$;


-- ─── 2. Revoke EXECUTE on record_daily_snapshot from non-service roles ─────
-- Kept as SECURITY DEFINER so it still runs as the owner (writes to
-- daily_snapshots regardless of caller RLS). service_role is the only caller
-- and retains EXECUTE implicitly via ownership / default grants.
REVOKE EXECUTE ON FUNCTION public.record_daily_snapshot() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_daily_snapshot() FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_daily_snapshot() FROM authenticated;


-- ─── 3. Tighten audit_log RLS — read-only for authenticated ────────────────
-- Drop the existing FOR ALL policy and replace with FOR SELECT only.
-- The app inserts audit rows via the service role, which bypasses RLS, so
-- inbound audit writes from /api/* routes continue to work unchanged.
DROP POLICY IF EXISTS "Authenticated full access - audit_log" ON public.audit_log;

CREATE POLICY "Authenticated read - audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated USING (true);

-- Note: no INSERT/UPDATE/DELETE policy is created on audit_log. Without one,
-- the authenticated role cannot mutate the table via PostgREST. service_role
-- bypasses RLS entirely and continues to write normally.
