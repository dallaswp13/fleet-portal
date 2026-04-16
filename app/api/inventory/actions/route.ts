import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Inventory Action Cards API
 *
 *   GET    → list all cards with their line items
 *   POST   → create or update a card + line items (admin only)
 *   DELETE → remove a card (admin only)
 *   PATCH  → execute a card (subtract items from inventory) (admin only)
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

  const { data: cards, error: cardsErr } = await supabase
    .from('inventory_action_cards')
    .select('*')
    .order('sort_order')
    .order('name')
  if (cardsErr) return NextResponse.json({ error: cardsErr.message }, { status: 500 })

  // Get all line items for all cards
  const { data: lineItems, error: liErr } = await supabase
    .from('inventory_action_card_items')
    .select('id, card_id, inventory_item_id, quantity')
  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 })

  // Group line items by card_id
  const itemsByCard = new Map<string, typeof lineItems>()
  for (const li of (lineItems ?? [])) {
    const list = itemsByCard.get(li.card_id) ?? []
    list.push(li)
    itemsByCard.set(li.card_id, list)
  }

  const result = (cards ?? []).map(c => ({
    ...c,
    items: itemsByCard.get(c.id) ?? [],
  }))

  return NextResponse.json({ cards: result })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    id?: string
    name: string
    description?: string | null
    icon?: string
    color?: string
    sort_order?: number
    items: { inventory_item_id: string; quantity: number }[]
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const svc = await createServiceClient()
  const cardRow = {
    name: body.name.trim(),
    description: body.description?.trim() || null,
    icon: body.icon?.trim() || '📦',
    color: body.color?.trim() || 'var(--accent)',
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : 100,
    updated_at: new Date().toISOString(),
  }

  let cardId: string
  if (body.id) {
    const { error } = await svc.from('inventory_action_cards')
      .update(cardRow).eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    cardId = body.id
  } else {
    const { data, error } = await svc.from('inventory_action_cards')
      .insert(cardRow).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    cardId = data.id
  }

  // Replace line items: delete all then insert
  await svc.from('inventory_action_card_items').delete().eq('card_id', cardId)
  if (body.items && body.items.length > 0) {
    const rows = body.items
      .filter(li => li.inventory_item_id && li.quantity > 0)
      .map(li => ({ card_id: cardId, inventory_item_id: li.inventory_item_id, quantity: li.quantity }))
    if (rows.length > 0) {
      const { error } = await svc.from('inventory_action_card_items').insert(rows)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, id: cardId })
}

export async function PATCH(req: NextRequest) {
  // Execute an action card: subtract all line items from inventory
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { card_id: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.card_id) return NextResponse.json({ error: 'card_id is required' }, { status: 400 })

  const svc = await createServiceClient()
  // Get line items for this card
  const { data: lineItems } = await svc.from('inventory_action_card_items')
    .select('inventory_item_id, quantity').eq('card_id', body.card_id)
  if (!lineItems || lineItems.length === 0) {
    return NextResponse.json({ error: 'No items linked to this action card' }, { status: 400 })
  }

  // Subtract from inventory (quantity_new first, overflow to quantity_used)
  const results: { item_id: string; subtracted: number; remaining: number }[] = []
  for (const li of lineItems) {
    const { data: item } = await svc.from('inventory_items')
      .select('quantity_new, quantity_used').eq('id', li.inventory_item_id).single()
    if (!item) continue

    let toSubtract = li.quantity
    let newQty = item.quantity_new
    let usedQty = item.quantity_used

    // Take from new first
    const fromNew = Math.min(toSubtract, newQty)
    newQty -= fromNew
    toSubtract -= fromNew

    // Then from used
    const fromUsed = Math.min(toSubtract, usedQty)
    usedQty -= fromUsed

    await svc.from('inventory_items').update({
      quantity_new: newQty,
      quantity_used: usedQty,
      updated_by: auth.user!.email ?? auth.user!.id,
      updated_at: new Date().toISOString(),
    }).eq('id', li.inventory_item_id)

    results.push({ item_id: li.inventory_item_id, subtracted: li.quantity, remaining: newQty + usedQty })
  }

  return NextResponse.json({ ok: true, results })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const svc = await createServiceClient()
  const { error } = await svc.from('inventory_action_cards').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
