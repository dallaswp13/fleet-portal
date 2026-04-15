-- Migration 034 — App-level settings and Data Audit ignores
--
-- Two unrelated tables bundled together because both landed in the same sprint:
--
--   1. public.app_settings — global key/value toggles the portal reads at
--      runtime.  Used for things that must flip immediately without a deploy
--      (e.g. "Claude Responding ON/OFF").  jsonb value is flexible for future
--      settings that aren't just booleans.
--
--   2. public.audit_ignores — rows that Dallas has explicitly marked as
--      "known, don't show me again" on the Data Audit page.  Keyed by
--      (section_id, row_key); the audit view filters them out of the returned
--      row set before rendering.
--
-- Both tables are admin-gated via the existing is_admin profile column.

-- ── app_settings ─────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Seed the two toggles that back the Claude button. Default both to TRUE so
-- behavior after this migration matches pre-migration behavior.
insert into public.app_settings (key, value, updated_by)
values
  ('claude_responding_enabled',       'true'::jsonb, 'migration_034'),
  ('claude_execute_actions_enabled',  'true'::jsonb, 'migration_034')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- Any authenticated user can read settings (the ClaudeSupportToggle popover
-- is visible to every logged-in user so their UI stays in sync).
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read
  on public.app_settings for select
  to authenticated
  using (true);

-- Only admins can write. The API route double-checks this; the RLS policy
-- exists as a defense-in-depth guard.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write
  on public.app_settings for all
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin));


-- ── audit_ignores ────────────────────────────────────────────────────────────
create table if not exists public.audit_ignores (
  section_id  text not null,
  row_key     text not null,
  reason      text,
  ignored_by  text not null,
  ignored_at  timestamptz not null default now(),
  primary key (section_id, row_key)
);

create index if not exists idx_audit_ignores_section
  on public.audit_ignores(section_id);

alter table public.audit_ignores enable row level security;

-- Admins only.  (The Data Audit page is admin-gated at the app level, but
-- RLS is enforced here too.)
drop policy if exists audit_ignores_read on public.audit_ignores;
create policy audit_ignores_read
  on public.audit_ignores for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists audit_ignores_write on public.audit_ignores;
create policy audit_ignores_write
  on public.audit_ignores for all
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.is_admin));
