import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAllAppSettings, type AppSettingKey } from '@/lib/appSettings'

/**
 * GET  /api/app-settings              — returns all known settings + defaults
 * POST /api/app-settings { key, value } — admin-only update
 *
 * Backing table: public.app_settings (migration 034).
 */

// Keys the client UI is allowed to write. Anything else is rejected.
// Keeping this list in code (not derived from DB) means a malicious caller
// can't invent new keys to inject state into parts of the app that don't
// expect it.
const WRITABLE_KEYS: ReadonlyArray<AppSettingKey> = [
  'claude_responding_enabled',
  'claude_execute_actions_enabled',
]

export async function GET() {
  // Any signed-in user can read settings; the popover needs them.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await getAllAppSettings()
  return NextResponse.json({ settings })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin gate — RLS also enforces this, but we want a clean 403 rather than
  // a PostgREST error.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { key?: string; value?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { key, value } = body
  if (!key || !WRITABLE_KEYS.includes(key as AppSettingKey)) {
    return NextResponse.json({ error: `Unknown or non-writable setting key: ${key}` }, { status: 400 })
  }
  if (value === undefined) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 })
  }

  // Use service client so we bypass RLS for the upsert — we've already
  // authorized the caller above. The updated_by column gets the email so
  // audit_log-style queries can tell who flipped a toggle.
  const svc = await createServiceClient()
  const { error } = await svc.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by: user.email ?? user.id,
  }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: `DB write failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, key, value })
}
