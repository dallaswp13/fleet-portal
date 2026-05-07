import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Per-request cached helpers for auth + profile.
 *
 * React's `cache()` deduplicates calls within a single request, so the layout,
 * the page, and any nested server components can all call these without
 * triggering multiple round trips to Supabase. Before this, every page
 * navigation made 2-3 redundant `auth.getUser()` calls (middleware + layout +
 * page) and ~2 `user_profiles` lookups, adding 200-600ms per page load.
 */
export const getCachedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
})

export interface CachedProfile {
  is_admin: boolean
  offices: Array<string> | null
}

export const getCachedProfile = cache(async (): Promise<CachedProfile | null> => {
  const user = await getCachedUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_profiles')
    .select('is_admin, offices')
    .eq('id', user.id)
    .maybeSingle()
  if (!data) return null
  return {
    is_admin: data.is_admin === true,
    offices: (data.offices as Array<string> | null) ?? null,
  }
})

/**
 * Resolved admin flag combining DB row + ADMIN_EMAIL fallback. Cached for
 * the request so repeated checks are free.
 */
export const getCachedIsAdmin = cache(async (): Promise<boolean> => {
  const user = await getCachedUser()
  if (!user) return false
  const profile = await getCachedProfile()
  if (profile?.is_admin) return true
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  return Boolean(adminEmail && user.email === adminEmail)
})

/**
 * Middleware to verify admin access for API routes.
 */
export async function requireAdmin() {
  const user = await getCachedUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const, user: null }
  const isAdmin = await getCachedIsAdmin()
  if (!isAdmin) return { error: 'Forbidden', status: 403 as const, user: null }
  return { error: null, status: 200 as const, user }
}
