import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import InventoryView, { type InventoryItem, type ActionCard } from '@/components/InventoryView'

export const dynamic = 'force-dynamic'

/**
 * Inventory — tracks office supply counts (OBD meters, PIM cables, spare
 * tablets, fuses, cases, mounts). Supports New/Used split, vendor info,
 * and action-card templates that subtract parts when executed.
 *
 * Any authenticated user can view; admins can edit quantities, add custom
 * items, manage action cards, and delete.
 * Backed by `inventory_items` (035) + `inventory_action_cards` / `_items` (036).
 */
export default async function InventoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.is_admin === true || user.email === (process.env.ADMIN_EMAIL ?? '')

  const svc = await createServiceClient()

  // Fetch inventory items, action cards, and line items all in parallel
  let cards: ActionCard[] = []
  let itemsResult: { data: unknown[] | null; error?: { message: string } | null }
  let cardsResult: { data: unknown[] | null } = { data: null }
  let lineResult: { data: unknown[] | null } = { data: null }
  try {
    const [ir, cr, lr] = await Promise.all([
      svc.from('inventory_items')
        .select('id, name, category, quantity_new, quantity_used, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by, vendor_name, vendor_company, vendor_email, unit_cost')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .limit(500),
      svc.from('inventory_action_cards').select('*').order('sort_order').order('name').limit(200),
      svc.from('inventory_action_card_items').select('id, card_id, inventory_item_id, quantity').limit(2000),
    ])
    itemsResult = ir
    cardsResult = cr
    lineResult = lr
  } catch {
    // Migration 036 may not have been run yet — gracefully degrade
    itemsResult = await svc.from('inventory_items')
      .select('id, name, category, quantity_new, quantity_used, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by, vendor_name, vendor_company, vendor_email, unit_cost')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .limit(500)
  }

  const items: InventoryItem[] = (itemsResult.data ?? []) as InventoryItem[]

  // Build action cards from parallel results
  try {
    const cardsData = cardsResult.data
    const lineData = lineResult.data as { id: string; card_id: string; inventory_item_id: string; quantity: number }[] | null
    const byCard = new Map<string, { id: string; card_id: string; inventory_item_id: string; quantity: number }[]>()
    for (const li of (lineData ?? [])) {
      const arr = byCard.get(li.card_id) ?? []
      arr.push(li)
      byCard.set(li.card_id, arr)
    }
    cards = (cardsData ?? []).map((c: Record<string, unknown>) => ({ ...c, items: byCard.get(c.id as string) ?? [] })) as ActionCard[]
  } catch {
    // Migration 036 may not have been run yet — gracefully degrade
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p>Office supply counts — OBD meters, PIM cables, spare tablets, fuses, cases, mounts.</p>
        </div>
      </div>

      {itemsResult.error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {itemsResult.error.message}
        </div>
      )}

      <InventoryView initialItems={items} initialCards={cards} canEdit={isAdmin} />
    </div>
  )
}
