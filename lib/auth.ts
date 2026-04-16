import { createClient } from '@/lib/supabase/server'

/**
 * Middleware to verify admin access.
 * Returns { error, status, user } object.
 * - If no user: { error: 'Unauthorized', status: 401, user: null }
 * - If user is not admin: { error: 'Forbidden', status: 403, user: null }
 * - If admin: { error: null, status: 200, user }
 */
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const, user: null }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) return { error: 'Forbidden', status: 403 as const, user: null }
  return { error: null, status: 200 as const, user }
}
