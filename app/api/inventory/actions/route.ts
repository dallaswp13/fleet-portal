import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth'

/**
 * Inventory Action Cards API
 *
 *   GET    → list all cards with their line items
 *   POST   → create or update a card + line items (admin only)
 *   DELETE → remove a card (admin only)
 *   PATCH  → execute a card (subtract items from inventory) (admin only)
 */

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

  // Audit log — card created/updated
  const userEmail = auth.user!.email ?? auth.user!.id
  writeAuditLog({
    userEmail,
    action: body.id ? 'inventory_card_update' : 'inventory_card_create',
    targetType: 'inventory',
    targetId: cardId,
    payload: { card_name: body.name.trim(), items_count: (body.items ?? []).filter(li => li.quantity > 0).length },
    result: null,
    success: true,
  })

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

  // Fetch item names + current quantities so we can log before → after
  const itemIds = lineItems.map(li => li.inventory_item_id)
  const { data: itemRows } = await svc.from('inventory_items')
    .select('id, name, quantity_new, quantity_used')
    .in('id', itemIds)
  const itemMap = new Map((itemRows ?? []).map(i => [i.id, i]))

  // Subtract from inventory (quantity_new first, overflow to quantity_used).
  // Track changes + warnings so the caller can show exactly what happened —
  // silent skips were hiding cases like a stale line item pointing at a
  // deleted inventory row, which made the "OBD Meter not deducting" issue
  // look like a logic bug when it was actually a missing/orphaned line item.
  const changes: {
    name: string
    inventory_item_id: string
    requested: number
    from_new: number
    from_used: number
    qty_new_before: number
    qty_used_before: number
    qty_new_after: number
    qty_used_after: number
    short_by: number
  }[] = []
  const warnings: string[] = []
  for (const li of lineItems) {
    const item = itemMap.get(li.inventory_item_id)
    if (!item) {
      warnings.push(
        `Line item links to inventory id ${li.inventory_item_id} which no longer exists — skipped. ` +
        `Open the action card and re-attach the missing item.`,
      )
      continue
    }

    let toSubtract = li.quantity
    const newBefore = item.quantity_new
    const usedBefore = item.quantity_used

    // Take from new first
    const fromNew = Math.min(toSubtract, newBefore)
    toSubtract -= fromNew
    const newAfter = newBefore - fromNew

    // Then from used
    const fromUsed = Math.min(toSubtract, usedBefore)
    toSubtract -= fromUsed
    const usedAfter = usedBefore - fromUsed

    if (toSubtract > 0) {
      warnings.push(
        `${item.name}: requested ${li.quantity} but only ${fromNew + fromUsed} on hand ` +
        `(short by ${toSubtract}). Inventory clamped to 0.`,
      )
    }

    const { error: updErr } = await svc.from('inventory_items').update({
      quantity_new: newAfter,
      quantity_used: usedAfter,
      updated_by: auth.user!.email ?? auth.user!.id,
      updated_at: new Date().toISOString(),
    }).eq('id', li.inventory_item_id)

    if (updErr) {
      warnings.push(`${item.name}: update failed — ${updErr.message}`)
      continue
    }

    changes.push({
      name: item.name,
      inventory_item_id: li.inventory_item_id,
      requested: li.quantity,
      from_new: fromNew,
      from_used: fromUsed,
      qty_new_before: newBefore,
      qty_used_before: usedBefore,
      qty_new_after: newAfter,
      qty_used_after: usedAfter,
      short_by: toSubtract,
    })
  }

  // Audit log — card executed with full before/after detail
  const userEmail = auth.user!.email ?? auth.user!.id
  const { data: cardInfo } = await svc.from('inventory_action_cards')
    .select('name').eq('id', body.card_id).single()
  writeAuditLog({
    userEmail,
    action: 'inventory_card_execute',
    targetType: 'inventory',
    targetId: body.card_id,
    payload: { card_name: cardInfo?.name ?? 'unknown', changes, warnings },
    result: { total_items_affected: changes.length, warnings_count: warnings.length },
    success: true,
  })

  return NextResponse.json({ ok: true, changes, warnings })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const svc = await createServiceClient()

  // Fetch name for audit
  const { data: cardInfo } = await svc.from('inventory_action_cards')
    .select('name').eq('id', body.id).single()

  const { error } = await svc.from('inventory_action_cards').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log — card deleted
  writeAuditLog({
    userEmail: auth.user!.email ?? auth.user!.id,
    action: 'inventory_card_delete',
    targetType: 'inventory',
    targetId: body.id,
    payload: { card_name: cardInfo?.name ?? 'unknown' },
    result: null,
    success: true,
  })

  return NextResponse.json({ ok: true })
}
