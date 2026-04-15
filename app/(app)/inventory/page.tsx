import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import InventoryView, { type InventoryItem } from '@/components/InventoryView'

export const dynamic = 'force-dynamic'

/**
 * Inventory — tracks office supply counts (OBD meters, PIM cables, spare
 * tablets, fuses, cases, mounts).
 *
 * Any authenticated user can view; admins can edit quantities, add custom
 * items, and delete. Backed by `public.inventory_items` (migration 035).
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

  // Use the service client for the initial load so RLS doesn't interfere if
  // profiles haven't propagated yet. Reads are authenticated-only at the RLS
  // layer anyway, and we already verified `user` above.
  const svc = await createServiceClient()
  const { data, error } = await svc.from('inventory_items')
    .select('id, name, category, quantity_on_hand, low_stock_threshold, location, notes, sort_order, updated_at, updated_by')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const items: InventoryItem[] = (data ?? []) as InventoryItem[]

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

      <InventoryView initialItems={items} canEdit={isAdmin} />
    </div>
  )
}
