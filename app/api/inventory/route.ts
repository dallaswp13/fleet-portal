import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Inventory API — backs the /inventory page.
 *
 *   GET     → list all items (any authenticated user)
 *   POST    → create or update an item (admin only)
 *     body:  { id?, name, category?, quantity_on_hand, low_stock_threshold?,
 *              location?, notes?, sort_order? }
 *     behavior: if id is omitted, inserts; otherwise updates that id.
 *   PATCH   → adjust quantity by delta (admin only)
 *     body:  { id, delta }   // positive for restock, negative for usage
 *   DELETE  → remove an item (admin only)
 *     body:  { id }
 *
 * Table: public.inventory_items (migration 035). RLS gates writes to admins
 * but we also check on the server so errors come back as clean JSON rather
 * than an RLS violation.
 */

async function requireAdmin() {
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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, category, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    id?: string
    name?: string
    category?: string | null
    quantity_on_hand?: number
    low_stock_threshold?: number | null
    location?: string | null
    notes?: string | null
    sort_order?: number
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof body.quantity_on_hand !== 'number' || body.quantity_on_hand < 0) {
    return NextResponse.json({ error: 'quantity_on_hand must be a non-negative number' }, { status: 400 })
  }

  const svc = await createServiceClient()
  const row = {
    name: body.name.trim(),
    category: body.category?.trim() || null,
    quantity_on_hand: Math.floor(body.quantity_on_hand),
    low_stock_threshold: typeof body.low_stock_threshold === 'number' && body.low_stock_threshold >= 0
      ? Math.floor(body.low_stock_threshold) : null,
    location: body.location?.trim() || null,
    notes: body.notes?.trim() || null,
    sort_order: typeof body.sort_order === 'number' ? Math.floor(body.sort_order) : 100,
    updated_by: auth.user!.email ?? auth.user!.id,
    updated_at: new Date().toISOString(),
  }

  if (body.id) {
    const { data, error } = await svc.from('inventory_items')
      .update(row).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item: data })
  } else {
    const { data, error } = await svc.from('inventory_items')
      .insert(row).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item: data })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string; delta?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id || typeof body.delta !== 'number' || !Number.isFinite(body.delta)) {
    return NextResponse.json({ error: 'id and numeric delta are required' }, { status: 400 })
  }

  const svc = await createServiceClient()
  // Fetch-modify-write: RLS on the table means we need the service client to
  // read + write reliably, and we need the current quantity to enforce the
  // non-negative constraint cleanly instead of letting the DB reject.
  const { data: current, error: readErr } = await svc.from('inventory_items')
    .select('quantity_on_hand').eq('id', body.id).single()
  if (readErr || !current) {
    return NextResponse.json({ error: readErr?.message ?? 'Item not found' }, { status: 404 })
  }

  const next = Math.max(0, Math.floor(current.quantity_on_hand + body.delta))
  const { data, error } = await svc.from('inventory_items')
    .update({
      quantity_on_hand: next,
      updated_by: auth.user!.email ?? auth.user!.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const svc = await createServiceClient()
  const { error } = await svc.from('inventory_items').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
