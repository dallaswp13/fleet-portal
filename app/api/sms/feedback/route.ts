import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/sms/feedback
 *
 * Records thumbs-up / thumbs-down feedback on a Claude-generated reply.
 * Thumbs-down notes are surfaced to future Claude calls as "past mistakes
 * to avoid" so the system learns from Dallas's corrections.
 *
 * Body: { messageId: string; rating: 'up' | 'down' | null; note?: string }
 *
 * Passing rating=null clears prior feedback on the row.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin === true || user.email === (process.env.ADMIN_EMAIL ?? '')
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  let body: { messageId?: string; rating?: 'up' | 'down' | null; note?: string; category?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { messageId, rating, note, category } = body
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
  if (rating !== null && rating !== 'up' && rating !== 'down') {
    return NextResponse.json({ error: 'rating must be up, down, or null' }, { status: 400 })
  }

  const svc = createServiceClient()
  const update: Record<string, unknown> = {
    claude_feedback: rating,
    claude_feedback_note: rating === 'down' ? (note?.trim() || null) : (note?.trim() || null),
    claude_feedback_at: rating === null ? null : new Date().toISOString(),
    claude_feedback_by: rating === null ? null : (user.email ?? null),
    // Tag with the issue category at time of downvote for category-aware feedback loop
    feedback_category: rating === 'down' ? (category?.trim() || null) : null,
  }

  let { error } = await svc.from('sms_messages').update(update).eq('id', messageId)
  // Graceful fallback if migration 040 hasn't been applied yet
  if (error && /feedback_category/i.test(error.message)) {
    const { feedback_category, ...legacy } = update
    const retry = await svc.from('sms_messages').update(legacy).eq('id', messageId)
    error = retry.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
