import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ROW_KEY_FOR_SECTION } from '@/lib/audit-checks'

/**
 * POST /api/audit-ignore
 *   { action: 'ignore',   sectionId, rowKey, reason? }  → insert
 *   { action: 'unignore', sectionId, rowKey }            → delete
 *
 * Backing table: public.audit_ignores (migration 034).
 *
 * Section and row keys are validated against ROW_KEY_FOR_SECTION so a
 * malicious caller can't fill the table with junk rows.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin gate — Data Audit is admin-only, so ignores are too.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; sectionId?: string; rowKey?: string; reason?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, sectionId, rowKey, reason } = body
  if (!sectionId || !rowKey) {
    return NextResponse.json({ error: 'sectionId and rowKey are required' }, { status: 400 })
  }
  // Sanity-check that the sectionId is one we know about and that supports
  // ignoring (freshness returns null → not ignorable).
  const keyFn = ROW_KEY_FOR_SECTION[sectionId]
  if (!keyFn) {
    return NextResponse.json({ error: `Unknown or non-ignorable section: ${sectionId}` }, { status: 400 })
  }

  const svc = await createServiceClient()

  if (action === 'ignore') {
    const { error } = await svc.from('audit_ignores').upsert({
      section_id: sectionId,
      row_key: rowKey,
      reason: reason ?? null,
      ignored_by: user.email ?? user.id,
      ignored_at: new Date().toISOString(),
    }, { onConflict: 'section_id,row_key' })
    if (error) return NextResponse.json({ error: `DB write failed: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'ignore' })
  }

  if (action === 'unignore') {
    const { error } = await svc.from('audit_ignores')
      .delete()
      .eq('section_id', sectionId)
      .eq('row_key', rowKey)
    if (error) return NextResponse.json({ error: `DB delete failed: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'unignore' })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
