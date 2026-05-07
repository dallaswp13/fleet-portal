'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toaster'

export interface InventoryItem {
  id: string
  name: string
  category: string | null
  quantity_new: number
  quantity_used: number
  quantity_on_hand: number          // generated: new + used
  low_stock_threshold: number | null
  location: string | null
  notes: string | null
  sort_order: number
  updated_at: string
  updated_by: string | null
  vendor_name: string | null
  vendor_company: string | null
  vendor_email: string | null
  unit_cost: number | null
}

export interface ActionCard {
  id: string; name: string; description: string | null
  icon: string; color: string; sort_order: number
  items: { id: string; card_id: string; inventory_item_id: string; quantity: number }[]
}

export default function InventoryView({
  initialItems, initialCards, canEdit,
}: { initialItems: InventoryItem[]; initialCards: ActionCard[]; canEdit: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingCard, setEditingCard] = useState<ActionCard | null>(null)
  const [addingCard, setAddingCard] = useState(false)
  const [executingCard, setExecutingCard] = useState<string | null>(null)

  // Local state for items — enables optimistic updates without full page re-render
  const [items, setItems] = useState(initialItems)
  // Sync when server data changes (e.g. after modal save triggers router.refresh)
  const [prevInitial, setPrevInitial] = useState(initialItems)
  if (initialItems !== prevInitial) {
    setItems(initialItems)
    setPrevInitial(initialItems)
  }

  const cards = initialCards

  const lowStock = useMemo(
    () => items.filter(i => i.low_stock_threshold != null && i.quantity_on_hand <= i.low_stock_threshold),
    [items],
  )
  const totalOnHand = useMemo(
    () => items.reduce((sum, i) => sum + (i.quantity_on_hand || 0), 0),
    [items],
  )
  const totalValue = useMemo(
    () => items.reduce((sum, i) => sum + (i.unit_cost != null ? i.unit_cost * i.quantity_on_hand : 0), 0),
    [items],
  )

  async function adjust(id: string, delta: number, field: 'new' | 'used' = 'new') {
    if (!canEdit) return

    // Optimistic update — instant UI feedback
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const qtyField = field === 'used' ? 'quantity_used' : 'quantity_new'
      const newVal = Math.max(0, item[qtyField] + delta)
      return {
        ...item,
        [qtyField]: newVal,
        quantity_on_hand: (field === 'new' ? newVal : item.quantity_new) + (field === 'used' ? newVal : item.quantity_used),
      }
    }))

    // Fire API call in background — no need to block the UI
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, delta, field }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        toast.error('Adjust failed', { detail: txt.slice(0, 120) || `HTTP ${res.status}` })
        // Revert optimistic update on failure
        setItems(prev => prev.map(item => {
          if (item.id !== id) return item
          const qtyField = field === 'used' ? 'quantity_used' : 'quantity_new'
          const revertVal = Math.max(0, item[qtyField] - delta)
          return {
            ...item,
            [qtyField]: revertVal,
            quantity_on_hand: (field === 'new' ? revertVal : item.quantity_new) + (field === 'used' ? revertVal : item.quantity_used),
          }
        }))
      } else {
        // Apply server's authoritative values
        const data = await res.json()
        if (data.item) {
          setItems(prev => prev.map(item => item.id === id ? { ...item, ...data.item } : item))
        }
      }
    } catch {
      toast.error('Network error')
    }
  }

  async function remove(id: string, name: string) {
    if (!canEdit) return
    if (!window.confirm(`Delete "${name}" from inventory? This can't be undone.`)) return
    setBusyId(id)
    try {
      const res = await fetch('/api/inventory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        toast.error('Delete failed', { detail: txt.slice(0, 120) || `HTTP ${res.status}` })
      } else {
        toast.success('Item deleted')
        startTransition(() => router.refresh())
      }
    } finally {
      setBusyId(null)
    }
  }

  async function executeCard(cardId: string, cardName: string) {
    if (!canEdit) return
    if (!window.confirm(`Execute "${cardName}"? This will subtract items from inventory.`)) return
    setExecutingCard(cardId)

    // Optimistic update: subtract card line items from local state
    const card = cards.find(c => c.id === cardId)
    if (card) {
      setItems(prev => prev.map(item => {
        const lineItem = card.items.find(li => li.inventory_item_id === item.id)
        if (!lineItem) return item
        const sub = lineItem.quantity
        const fromNew = Math.min(sub, item.quantity_new)
        const fromUsed = Math.min(sub - fromNew, item.quantity_used)
        return {
          ...item,
          quantity_new: item.quantity_new - fromNew,
          quantity_used: item.quantity_used - fromUsed,
          quantity_on_hand: item.quantity_on_hand - fromNew - fromUsed,
        }
      }))
    }

    try {
      const res = await fetch('/api/inventory/actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        toast.error('Execute failed', { detail: txt.slice(0, 120) || `HTTP ${res.status}` })
        // Revert by re-fetching
        startTransition(() => router.refresh())
      } else {
        // Parse the response so we can show what was actually deducted, and
        // surface warnings (missing line items, insufficient stock). This is
        // the diagnostic that exposes "OBD Meter not deducting" symptoms.
        type ChangeRow = {
          name: string; from_new: number; from_used: number;
          qty_new_after: number; qty_used_after: number; short_by: number
        }
        const data = await res.json().catch(() => ({} as { changes?: ChangeRow[]; warnings?: string[] }))
        const changes: ChangeRow[] = Array.isArray(data.changes) ? data.changes : []
        const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : []

        const lines = changes.map(c => {
          const parts: string[] = []
          if (c.from_new > 0)  parts.push(`${c.from_new} new`)
          if (c.from_used > 0) parts.push(`${c.from_used} used`)
          const took = parts.length > 0 ? parts.join(' + ') : '0'
          return `${c.name}: −${took} → ${c.qty_new_after + c.qty_used_after} on hand` +
            (c.short_by > 0 ? ` (short ${c.short_by})` : '')
        })

        if (warnings.length > 0) {
          toast.error(`"${cardName}" executed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`, {
            detail: [...lines, '—', ...warnings].join('\n'),
          })
          // Re-fetch to get authoritative state when something looked off
          startTransition(() => router.refresh())
        } else {
          toast.success(`"${cardName}" executed — ${changes.length} item${changes.length === 1 ? '' : 's'} updated`, {
            detail: lines.join('\n') || 'No changes',
          })
        }
      }
    } finally {
      setExecutingCard(null)
    }
  }

  async function deleteCard(id: string, name: string) {
    if (!window.confirm(`Delete action card "${name}"?`)) return
    const res = await fetch('/api/inventory/actions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) toast.error('Delete failed')
    else { toast.success('Card deleted'); startTransition(() => router.refresh()) }
  }

  function exportPdf() {
    const html = buildInventoryPrintHtml(items, lowStock, totalOnHand, totalValue)
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) {
      toast.error('Popup blocked', { detail: 'Allow popups for this site to export.' })
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    // Trigger print after the page has rendered. We rely on the inline script
    // in buildInventoryPrintHtml() to call print() on load — this is more
    // reliable across browsers than calling w.print() from this window.
  }

  return (
    <>
      {/* ── ACTION CARDS ──────────────────────────────────────── */}
      {cards.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Actions</div>
            {canEdit && (
              <button className="btn-secondary btn-sm" onClick={() => setAddingCard(true)} disabled={pending}>
                + Add action
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {cards.map(card => {
              const itemNames = card.items.map(li => {
                const inv = items.find(i => i.id === li.inventory_item_id)
                return inv ? `${li.quantity}x ${inv.name}` : `${li.quantity}x unknown`
              })
              return (
                <div key={card.id} className="card" style={{ padding: 14, borderLeft: `3px solid ${card.color}`, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 20 }}>{card.icon}</span>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{card.name}</div>
                  </div>
                  {card.description && <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.4 }}>{card.description}</div>}
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>{itemNames.join(', ')}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {canEdit && (
                      <>
                        <button className="btn-primary btn-sm" style={{ fontSize: 11 }}
                          disabled={executingCard === card.id || pending}
                          onClick={() => executeCard(card.id, card.name)}>
                          {executingCard === card.id ? 'Running…' : 'Execute'}
                        </button>
                        <button className="btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setEditingCard(card)}>Edit</button>
                        <button className="btn-danger btn-sm" style={{ fontSize: 11 }}
                          onClick={() => deleteCard(card.id, card.name)}>×</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {cards.length === 0 && canEdit && (
        <div style={{ marginBottom: 20 }}>
          <button className="btn-secondary btn-sm" onClick={() => setAddingCard(true)}>+ Add action card</button>
          <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>Action cards subtract inventory when executed (e.g. "New Vehicle")</span>
        </div>
      )}

      {/* ── SUMMARY STRIP ─────────────────────────────────────── */}
      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <StatCard label="Item types"      value={items.length}          color="var(--blue)" sub="distinct SKUs" />
        <StatCard label="Total on hand"   value={totalOnHand}           color="var(--green)" sub="new + used" />
        <StatCard label="Total value"     value={`$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color="var(--text1)" sub="on-hand × unit cost" />
        <StatCard label="Low stock"       value={lowStock.length}       color={lowStock.length > 0 ? 'var(--amber)' : 'var(--text3)'} sub="at/below threshold" />
      </div>

      {lowStock.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 16, borderLeft: '3px solid var(--amber)', background: 'rgba(245, 158, 11, 0.06)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--amber)' }}>⚠ Low stock</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {lowStock.map(i => `${i.name} (${i.quantity_on_hand})`).join(' · ')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {canEdit ? 'Admin view — click +/− to adjust New or Used counts, or Edit to change fields.' : 'Read-only view.'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-secondary btn-sm"
            onClick={exportPdf}
            disabled={pending || items.length === 0}
            title="Open a printable, single-page overview — use the print dialog's 'Save as PDF' option"
          >
            Export PDF
          </button>
          {canEdit && (
            <button className="btn-primary btn-sm" onClick={() => setAdding(true)} disabled={pending}>
              + Add item
            </button>
          )}
        </div>
      </div>

      {/* ── INVENTORY TABLE ───────────────────────────────────── */}
      <div className="table-wrap card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Item</th>
              <th style={{ width: 100 }}>New</th>
              <th style={{ width: 100 }}>Used</th>
              <th style={{ width: 80 }}>On Hand</th>
              <th style={{ width: 90 }}>Unit Cost</th>
              <th style={{ width: 90 }}>Low-stock</th>
              <th>Vendor</th>
              <th>Location</th>
              <th style={{ width: 140 }}>Updated</th>
              {canEdit && <th style={{ width: 130 }} />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 11 : 10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>
                  No items yet. {canEdit ? 'Click "Add item" to create one.' : ''}
                </td>
              </tr>
            )}
            {items.map(i => {
              const isLow = i.low_stock_threshold != null && i.quantity_on_hand <= i.low_stock_threshold
              return (
                <tr key={i.id}>
                  <td>
                    {isLow ? (
                      <span title="At or below low-stock threshold" style={{ color: 'var(--amber)' }}>⚠</span>
                    ) : (
                      <span style={{ color: 'var(--text3)' }}>·</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    {i.category && <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{i.category}</div>}
                  </td>
                  <td><QtyCell value={i.quantity_new} canEdit={canEdit} busy={false} onAdjust={delta => adjust(i.id, delta, 'new')} zeroDisable={i.quantity_new <= 0} /></td>
                  <td><QtyCell value={i.quantity_used} canEdit={canEdit} busy={false} onAdjust={delta => adjust(i.id, delta, 'used')} zeroDisable={i.quantity_used <= 0} /></td>
                  <td><span style={{ fontSize: 16, fontWeight: 700, color: isLow ? 'var(--amber)' : 'inherit' }}>{i.quantity_on_hand}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{i.unit_cost != null ? `$${i.unit_cost.toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text3)' }}>{i.low_stock_threshold == null ? <span>—</span> : `≤ ${i.low_stock_threshold}`}</td>
                  <td style={{ fontSize: 11 }}>
                    {i.vendor_name || i.vendor_company ? (
                      <div>
                        {i.vendor_name && <div style={{ fontWeight: 500 }}>{i.vendor_name}</div>}
                        {i.vendor_company && <div style={{ color: 'var(--text3)' }}>{i.vendor_company}</div>}
                      </div>
                    ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{i.location || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {new Date(i.updated_at).toLocaleString()}
                    {i.updated_by && <div style={{ fontSize: 10 }}>{i.updated_by}</div>}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-secondary btn-sm" style={{ marginRight: 4 }} disabled={pending || busyId === i.id} onClick={() => setEditing(i)}>Edit</button>
                      <button className="btn-danger btn-sm" disabled={pending || busyId === i.id} onClick={() => remove(i.id, i.name)}>Delete</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(editing || adding) && (
        <ItemModal initial={editing} onClose={() => { setEditing(null); setAdding(false) }}
          onSaved={() => { setEditing(null); setAdding(false); startTransition(() => router.refresh()) }} />
      )}
      {(editingCard || addingCard) && (
        <CardModal initial={editingCard} inventoryItems={items}
          onClose={() => { setEditingCard(null); setAddingCard(false) }}
          onSaved={() => { setEditingCard(null); setAddingCard(false); startTransition(() => router.refresh()) }} />
      )}
    </>
  )
}

function QtyCell({ value, canEdit, busy, onAdjust, zeroDisable }: {
  value: number; canEdit: boolean; busy: boolean; onAdjust: (d: number) => void; zeroDisable: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {canEdit && <button className="btn-secondary btn-sm" style={{ padding: '2px 6px', minWidth: 24, fontSize: 13 }} disabled={busy || zeroDisable} onClick={() => onAdjust(-1)}>−</button>}
      <span style={{ fontSize: 14, fontWeight: 600, minWidth: 28, textAlign: 'center' }}>{value}</span>
      {canEdit && <button className="btn-secondary btn-sm" style={{ padding: '2px 6px', minWidth: 24, fontSize: 13 }} disabled={busy} onClick={() => onAdjust(1)}>+</button>}
    </div>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>
    </div>
  )
}

function ItemModal({ initial, onClose, onSaved }: { initial: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName]       = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [qtyNew, setQtyNew]   = useState(String(initial?.quantity_new ?? 0))
  const [qtyUsed, setQtyUsed] = useState(String(initial?.quantity_used ?? 0))
  const [low, setLow]         = useState(initial?.low_stock_threshold == null ? '' : String(initial.low_stock_threshold))
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes]     = useState(initial?.notes ?? '')
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 100))
  const [unitCost, setUnitCost]           = useState(initial?.unit_cost != null ? String(initial.unit_cost) : '')
  const [vendorName, setVendorName]       = useState(initial?.vendor_name ?? '')
  const [vendorCompany, setVendorCompany] = useState(initial?.vendor_company ?? '')
  const [vendorEmail, setVendorEmail]     = useState(initial?.vendor_email ?? '')
  const [saving, setSaving]   = useState(false)

  async function save() {
    const qn = parseInt(qtyNew, 10); const qu = parseInt(qtyUsed, 10)
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!Number.isFinite(qn) || qn < 0) { toast.error('New qty must be ≥ 0'); return }
    if (!Number.isFinite(qu) || qu < 0) { toast.error('Used qty must be ≥ 0'); return }
    const lowNum = low.trim() === '' ? null : parseInt(low, 10)
    if (lowNum != null && (!Number.isFinite(lowNum) || lowNum < 0)) { toast.error('Low-stock must be ≥ 0 or blank'); return }
    const costNum = unitCost.trim() === '' ? null : parseFloat(unitCost)
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) { toast.error('Unit cost must be ≥ 0 or blank'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: initial?.id, name: name.trim(), category: category.trim() || null,
          quantity_new: qn, quantity_used: qu, low_stock_threshold: lowNum,
          location: location.trim() || null, notes: notes.trim() || null,
          sort_order: parseInt(sortOrder) || 100, unit_cost: costNum,
          vendor_name: vendorName.trim() || null, vendor_company: vendorCompany.trim() || null,
          vendor_email: vendorEmail.trim() || null,
        }),
      })
      if (!res.ok) { const t = await res.text().catch(() => ''); toast.error('Save failed', { detail: t.slice(0, 120) || `HTTP ${res.status}` }) }
      else { toast.success(initial ? 'Item updated' : 'Item added'); onSaved() }
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ padding: 20, minWidth: 340, maxWidth: 600, width: '92%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{initial ? 'Edit item' : 'Add item'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name *"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. OBD Meter" autoFocus /></Field>
          <Field label="Category"><input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. meters" /></Field>
          <Field label="Qty New *"><input type="number" min={0} value={qtyNew} onChange={e => setQtyNew(e.target.value)} /></Field>
          <Field label="Qty Used"><input type="number" min={0} value={qtyUsed} onChange={e => setQtyUsed(e.target.value)} /></Field>
          <Field label="Low-stock threshold"><input type="number" min={0} value={low} onChange={e => setLow(e.target.value)} placeholder="optional" /></Field>
          <Field label="Location"><input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Storeroom A" /></Field>
          <Field label="Unit Cost ($)"><input type="number" min={0} step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Sort order"><input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} /></Field>
          <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor</div>
          </div>
          <Field label="Contact Name"><input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="John Smith" /></Field>
          <Field label="Company"><input value={vendorCompany} onChange={e => setVendorCompany(e.target.value)} placeholder="ACME Parts" /></Field>
          <Field label="Email" span={2}><input type="email" value={vendorEmail} onChange={e => setVendorEmail(e.target.value)} placeholder="vendor@example.com" /></Field>
          <Field label="Notes" span={2}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : (initial ? 'Save' : 'Add')}</button>
        </div>
      </div>
    </div>
  )
}

function CardModal({ initial, inventoryItems, onClose, onSaved }: {
  initial: ActionCard | null; inventoryItems: InventoryItem[]; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '📦')
  const [color, setColor] = useState(initial?.color ?? 'var(--accent)')
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 100))
  const [lineItems, setLineItems] = useState<{ inventory_item_id: string; quantity: number }[]>(
    initial?.items.map(li => ({ inventory_item_id: li.inventory_item_id, quantity: li.quantity })) ?? []
  )
  const [saving, setSaving] = useState(false)

  function addLine() {
    const usedIds = new Set(lineItems.map(li => li.inventory_item_id))
    const next = inventoryItems.find(i => !usedIds.has(i.id))
    if (next) setLineItems([...lineItems, { inventory_item_id: next.id, quantity: 1 }])
  }
  function updateLine(idx: number, field: 'inventory_item_id' | 'quantity', val: string | number) {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: val } : li))
  }

  async function save() {
    if (!name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/inventory/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: initial?.id, name: name.trim(), description: desc.trim() || null,
          icon: icon.trim() || '📦', color: color.trim() || 'var(--accent)',
          sort_order: parseInt(sortOrder) || 100,
          items: lineItems.filter(li => li.inventory_item_id && li.quantity > 0),
        }),
      })
      if (!res.ok) { const t = await res.text().catch(() => ''); toast.error('Save failed', { detail: t.slice(0, 120) }) }
      else { toast.success(initial ? 'Card updated' : 'Card created'); onSaved() }
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ padding: 20, minWidth: 340, maxWidth: 560, width: '92%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{initial ? 'Edit Action Card' : 'New Action Card'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name *"><input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. New Vehicle" /></Field>
          <Field label="Icon"><input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🚕" /></Field>
          <Field label="Color"><input value={color} onChange={e => setColor(e.target.value)} placeholder="var(--green)" /></Field>
          <Field label="Sort order"><input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} /></Field>
          <Field label="Description" span={2}><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="What does this action do?" /></Field>
        </div>
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Items to subtract</span>
            <button className="btn-secondary btn-sm" onClick={addLine} disabled={lineItems.length >= inventoryItems.length}>+ Add line</button>
          </div>
          {lineItems.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>No items linked yet.</div>}
          {lineItems.map((li, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <select value={li.inventory_item_id} onChange={e => updateLine(idx, 'inventory_item_id', e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                {inventoryItems.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>×</span>
              <input type="number" min={1} value={li.quantity} onChange={e => updateLine(idx, 'quantity', parseInt(e.target.value) || 1)} style={{ width: 60, fontSize: 12, textAlign: 'center' }} />
              <button className="btn-danger btn-sm" style={{ padding: '2px 8px' }} onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : (initial ? 'Save' : 'Create')}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, span = 1, children }: { label: string; span?: number; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: `span ${span}` }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  )
}

/**
 * Build a self-contained printable HTML document for an inventory overview.
 * Designed to fit a single Letter-size page with low-stock items emphasized.
 * Auto-triggers print() so the user lands on the browser's print dialog
 * where they can pick "Save as PDF".
 */
function buildInventoryPrintHtml(
  items: InventoryItem[],
  lowStock: InventoryItem[],
  totalOnHand: number,
  totalValue: number,
): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
    )
  const fmtMoney = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const filename = 'inventory-overview-' + new Date().toISOString().slice(0, 10)

  // Sort: low-stock items first (most-critical lowest on-hand first), then by name.
  const sorted = [...items].sort((a, b) => {
    const aLow = a.low_stock_threshold != null && a.quantity_on_hand <= a.low_stock_threshold
    const bLow = b.low_stock_threshold != null && b.quantity_on_hand <= b.low_stock_threshold
    if (aLow && !bLow) return -1
    if (!aLow && bLow) return 1
    if (aLow && bLow) return a.quantity_on_hand - b.quantity_on_hand
    return a.name.localeCompare(b.name)
  })

  const rowsHtml = sorted.map(i => {
    const isLow = i.low_stock_threshold != null && i.quantity_on_hand <= i.low_stock_threshold
    const vendor = i.vendor_company || i.vendor_name || ''
    const cat = i.category ? '<div class="cat">' + esc(i.category) + '</div>' : ''
    const threshold = i.low_stock_threshold == null ? '—' : '≤ ' + i.low_stock_threshold
    const cost = i.unit_cost != null ? '$' + i.unit_cost.toFixed(2) : '—'
    return (
      '<tr class="' + (isLow ? 'low' : '') + '">' +
      '<td class="warn">' + (isLow ? '⚠' : '') + '</td>' +
      '<td><div class="name">' + esc(i.name) + '</div>' + cat + '</td>' +
      '<td class="num">' + i.quantity_new + '</td>' +
      '<td class="num">' + i.quantity_used + '</td>' +
      '<td class="num bold ' + (isLow ? 'lowtxt' : '') + '">' + i.quantity_on_hand + '</td>' +
      '<td class="num">' + threshold + '</td>' +
      '<td class="num">' + cost + '</td>' +
      '<td>' + esc(i.location || '') + '</td>' +
      '<td>' + esc(vendor) + '</td>' +
      '</tr>'
    )
  }).join('')

  const lowSorted = lowStock.slice().sort((a, b) => a.quantity_on_hand - b.quantity_on_hand)
  const lowChips = lowSorted.map(i => {
    const t = i.low_stock_threshold != null ? ' (≤ ' + i.low_stock_threshold + ')' : ''
    return '<span class="chip"><strong>' + esc(i.name) + '</strong> · ' + i.quantity_on_hand + ' on hand' + t + '</span>'
  }).join('')

  const lowStockBanner = lowStock.length > 0
    ? '<div class="alert">' +
        '<div class="alert-title">⚠ Low stock — ' + lowStock.length +
          ' item' + (lowStock.length === 1 ? '' : 's') + ' at or below threshold</div>' +
        '<div class="alert-body">' + lowChips + '</div>' +
      '</div>'
    : '<div class="alert ok"><div class="alert-title">All items above low-stock threshold</div></div>'

  const itemCountText = items.length + ' item' + (items.length === 1 ? '' : 's')
  const tbody = rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#888;padding:18px">No inventory items.</td></tr>'

  const css =
    '@page { size: letter; margin: 0.4in; }' +
    '* { box-sizing: border-box; }' +
    'html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; background: #fff; font-size: 10pt; line-height: 1.35; }' +
    '.doc { padding: 4px 2px; }' +
    'header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }' +
    'header h1 { margin: 0; font-size: 18pt; letter-spacing: -0.01em; }' +
    'header .sub { font-size: 9pt; color: #555; }' +
    'header .meta { text-align: right; font-size: 9pt; color: #555; }' +
    '.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }' +
    '.stat { border: 1px solid #ddd; border-left-width: 3px; padding: 6px 8px; border-radius: 3px; }' +
    '.stat .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }' +
    '.stat .value { font-size: 16pt; font-weight: 700; margin-top: 2px; line-height: 1.05; }' +
    '.stat .sub { font-size: 7.5pt; color: #888; }' +
    '.stat.blue { border-left-color: #2563eb; }' +
    '.stat.green { border-left-color: #16a34a; }' +
    '.stat.dark { border-left-color: #111; }' +
    '.stat.amber { border-left-color: #d97706; }' +
    '.stat.amber .value { color: #b45309; }' +
    '.alert { border: 1px solid #f59e0b; border-left-width: 4px; background: #fff7ed; padding: 8px 10px; border-radius: 3px; margin-bottom: 10px; }' +
    '.alert.ok { border-color: #cbd5e1; background: #f8fafc; border-left-color: #16a34a; }' +
    '.alert-title { font-weight: 700; font-size: 10pt; color: #b45309; margin-bottom: 4px; }' +
    '.alert.ok .alert-title { color: #166534; margin-bottom: 0; }' +
    '.alert-body { font-size: 9pt; color: #422006; display: flex; flex-wrap: wrap; gap: 4px 10px; }' +
    '.chip { background: #fff; border: 1px solid #fcd9a5; padding: 2px 6px; border-radius: 10px; }' +
    'table { width: 100%; border-collapse: collapse; font-size: 9pt; }' +
    'thead th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; border-bottom: 1.5px solid #111; padding: 4px 6px; font-weight: 600; background: #f8fafc; }' +
    'tbody td { padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: top; }' +
    'tbody tr.low { background: #fff7ed; }' +
    'tbody tr.low td { border-bottom-color: #fcd9a5; }' +
    'td.warn { width: 14px; color: #b45309; font-weight: 700; text-align: center; }' +
    'td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }' +
    'td.bold { font-weight: 700; }' +
    'td.lowtxt { color: #b45309; }' +
    '.name { font-weight: 600; }' +
    '.cat { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }' +
    'footer { margin-top: 8px; padding-top: 6px; border-top: 1px solid #ddd; font-size: 7.5pt; color: #888; display: flex; justify-content: space-between; }' +
    '@media print { .stat, .alert, table { break-inside: avoid; } thead { display: table-header-group; } }'

  return (
    '<!doctype html>' +
    '<html lang="en"><head>' +
    '<meta charset="utf-8" />' +
    '<title>' + esc(filename) + '</title>' +
    '<style>' + css + '</style>' +
    '</head><body>' +
    '<div class="doc">' +
      '<header>' +
        '<div>' +
          '<h1>Inventory Overview</h1>' +
          '<div class="sub">Office supply counts — meters, cables, tablets, fuses, cases, mounts.</div>' +
        '</div>' +
        '<div class="meta">' +
          '<div><strong>' + esc(today) + '</strong></div>' +
          '<div>LA Yellow Cab · Fleet Portal</div>' +
        '</div>' +
      '</header>' +
      '<div class="stats">' +
        '<div class="stat blue"><div class="label">Item types</div><div class="value">' + items.length + '</div><div class="sub">distinct SKUs</div></div>' +
        '<div class="stat green"><div class="label">Total on hand</div><div class="value">' + totalOnHand.toLocaleString() + '</div><div class="sub">new + used</div></div>' +
        '<div class="stat dark"><div class="label">Total value</div><div class="value">' + fmtMoney(totalValue) + '</div><div class="sub">on-hand × unit cost</div></div>' +
        '<div class="stat amber"><div class="label">Low stock</div><div class="value">' + lowStock.length + '</div><div class="sub">at/below threshold</div></div>' +
      '</div>' +
      lowStockBanner +
      '<table>' +
        '<thead><tr>' +
          '<th></th><th>Item</th>' +
          '<th style="text-align:right">New</th>' +
          '<th style="text-align:right">Used</th>' +
          '<th style="text-align:right">On Hand</th>' +
          '<th style="text-align:right">Threshold</th>' +
          '<th style="text-align:right">Unit $</th>' +
          '<th>Location</th><th>Vendor</th>' +
        '</tr></thead>' +
        '<tbody>' + tbody + '</tbody>' +
      '</table>' +
      '<footer>' +
        '<span>Generated ' + esc(today) + ' from Fleet Portal · Low-stock items highlighted in amber</span>' +
        '<span>' + itemCountText + '</span>' +
      '</footer>' +
    '</div>' +
    '<script>' +
      'document.title = ' + JSON.stringify(filename) + ';' +
      'window.addEventListener("load", function () { setTimeout(function () { window.focus(); window.print(); }, 200); });' +
    '</script>' +
    '</body></html>'
  )
}
