import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Inventory API — backs the /inventory page.
 *
 *   GET     → list all items (any authenticated user)
 *   POST    → create or update an item (admin only)
 *     body:  { id?, name, category?, quantity_new, quantity_used,
 *              low_stock_threshold?, location?, notes?, sort_order?,
 *              vendor_name?, vendor_company?, vendor_email? }
 *   PATCH   → adjust quantity by delta (admin only)
 *     body:  { id, delta, field?: 'new' | 'used' }
 *       field defaults to 'new'. Adjusts quantity_new or quantity_used.
 *   DELETE  → remove an item (admin only)
 *     body:  { id }
 *
 * Table: public.inventory_items (migration 035 + 036).
 * quantity_on_hand is a generated column = quantity_new + quantity_used.
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

const ITEM_COLS = 'id, name, category, quantity_new, quantity_used, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by, vendor_name, vendor_company, vendor_email'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_COLS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    id?: string; name?: string; category?: string | null
    quantity_new?: number; quantity_used?: number
    // Legacy compat: if quantity_on_hand is sent (before migration), map to quantity_new
    quantity_on_hand?: number
    low_stock_threshold?: number | null
    location?: string | null; notes?: string | null; sort_order?: number
    vendor_name?: string | null; vendor_company?: string | null; vendor_email?: string | null
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const qtyNew = Math.floor(body.quantity_new ?? body.quantity_on_hand ?? 0)
  const qtyUsed = Math.floor(body.quantity_used ?? 0)
  if (qtyNew < 0 || qtyUsed < 0) {
    return NextResponse.json({ error: 'quantities must be non-negative' }, { status: 400 })
  }

  const svc = await createServiceClient()
  const row: Record<string, unknown> = {
    name: body.name.trim(),
    category: body.category?.trim() || null,
    quantity_new: qtyNew,
    quantity_used: qtyUsed,
    low_stock_threshold: typeof body.low_stock_threshold === 'number' && body.low_stock_threshold >= 0
      ? Math.floor(body.low_stock_threshold) : null,
    location: body.location?.trim() || null,
    notes: body.notes?.trim() || null,
    sort_order: typeof body.sort_order === 'number' ? Math.floor(body.sort_order) : 100,
    vendor_name: body.vendor_name?.trim() || null,
    vendor_company: body.vendor_company?.trim() || null,
    vendor_email: body.vendor_email?.trim() || null,
    updated_by: auth.user!.email ?? auth.user!.id,
    updated_at: new Date().toISOString(),
  }

  if (body.id) {
    const { data, error } = await svc.from('inventory_items')
      .update(row).eq('id', body.id).select(ITEM_COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item: data })
  } else {
    const { data, error } = await svc.from('inventory_items')
      .insert(row).select(ITEM_COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item: data })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string; delta?: number; field?: 'new' | 'used' }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id || typeof body.delta !== 'number' || !Number.isFinite(body.delta)) {
    return NextResponse.json({ error: 'id and numeric delta are required' }, { status: 400 })
  }

  const field = body.field === 'used' ? 'quantity_used' : 'quantity_new'
  const svc = await createServiceClient()

  const { data: current, error: readErr } = await svc.from('inventory_items')
    .select('quantity_new, quantity_used').eq('id', body.id).single()
  if (readErr || !current) {
    return NextResponse.json({ error: readErr?.message ?? 'Item not found' }, { status: 404 })
  }

  const currentVal = field === 'quantity_new' ? current.quantity_new : current.quantity_used
  const next = Math.max(0, Math.floor(currentVal + body.delta))

  const { data, error } = await svc.from('inventory_items')
    .update({
      [field]: next,
      updated_by: auth.user!.email ?? auth.user!.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select(ITEM_COLS)
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
