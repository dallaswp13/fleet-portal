import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import InventoryView, { type InventoryItem, type ActionCard } from '@/components/InventoryView'
import { getCachedUser, getCachedIsAdmin } from '@/lib/auth'

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
  // Service client doesn't need awaiting (it's synchronous), and we run the
  // auth check + admin lookup + the three data queries together so the page
  // is bottlenecked on the slowest single round trip rather than the sum.
  const svc = createServiceClient()
  const itemsQuery = svc.from('inventory_items')
    .select('id, name, category, quantity_new, quantity_used, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by, vendor_name, vendor_company, vendor_email, unit_cost')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500)
  const cardsQuery = svc.from('inventory_action_cards').select('*').order('sort_order').order('name').limit(200)
  const lineQuery  = svc.from('inventory_action_card_items').select('id, card_id, inventory_item_id, quantity').limit(2000)

  let cards: ActionCard[] = []
  let itemsResult: { data: unknown[] | null; error?: { message: string } | null }
  let cardsResult: { data: unknown[] | null } = { data: null }
  let lineResult: { data: unknown[] | null } = { data: null }

  const [user, isAdmin, ir, cr, lr] = await Promise.all([
    getCachedUser(),
    getCachedIsAdmin(),
    itemsQuery,
    cardsQuery.then(r => r, () => ({ data: null })),
    lineQuery.then(r => r, () => ({ data: null })),
  ])
  if (!user) redirect('/login')
  itemsResult = ir
  cardsResult = cr as { data: unknown[] | null }
  lineResult  = lr as { data: unknown[] | null }

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
