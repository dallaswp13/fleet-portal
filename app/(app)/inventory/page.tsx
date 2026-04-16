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

  // Fetch inventory items with new/used split + vendor columns
  const { data, error } = await svc.from('inventory_items')
    .select('id, name, category, quantity_new, quantity_used, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by, vendor_name, vendor_company, vendor_email, unit_cost')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const items: InventoryItem[] = (data ?? []) as InventoryItem[]

  // Fetch action cards + their line items
  let cards: ActionCard[] = []
  try {
    const [{ data: cardsData }, { data: lineData }] = await Promise.all([
      svc.from('inventory_action_cards').select('*').order('sort_order').order('name'),
      svc.from('inventory_action_card_items').select('id, card_id, inventory_item_id, quantity'),
    ])
    const byCard = new Map<string, (typeof lineData extends (infer T)[] | null ? T : never)[]>()
    for (const li of (lineData ?? [])) {
      const arr = byCard.get(li.card_id) ?? []
      arr.push(li)
      byCard.set(li.card_id, arr)
    }
    cards = (cardsData ?? []).map(c => ({ ...c, items: byCard.get(c.id) ?? [] })) as ActionCard[]
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

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      <InventoryView initialItems={items} initialCards={cards} canEdit={isAdmin} />
    </div>
  )
}
