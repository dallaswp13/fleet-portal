-- Migration 017: Fix user_profiles RLS so any authenticated user can read all profiles
-- The old policy had a recursive self-referencing check that blocked non-admins
-- from seeing the table at all, making the UserManager show "not in table" even when they are.

-- Drop old restrictive policies
drop policy if exists "Users read own profile"      on public.user_profiles;
drop policy if exists "Admins read all profiles"    on public.user_profiles;
drop policy if exists "Admins update all profiles"  on public.user_profiles;
drop policy if exists "Admins insert profiles"      on public.user_profiles;

-- Any authenticated user can read all profiles (profiles contain no sensitive data)
create policy "Authenticated users read all profiles"
  on public.user_profiles for select
  to authenticated using (true);

-- Users can update their own profile (display name only effectively)
create policy "Users update own profile"
  on public.user_profiles for update
  to authenticated using (id = auth.uid());

-- Service role (used by invite API) can do everything
-- Regular authenticated users cannot insert (only invite API inserts)
create policy "Service role full access"
  on public.user_profiles for all
  to service_role using (true) with check (true);
