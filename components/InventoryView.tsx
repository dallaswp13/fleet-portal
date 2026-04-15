'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toaster'

export interface InventoryItem {
  id: string
  name: string
  category: string | null
  quantity_on_hand: number
  low_stock_threshold: number | null
  location: string | null
  notes: string | null
  sort_order: number
  updated_at: string
  updated_by: string | null
}

/**
 * Editable inventory grid. Admins see inline controls (−/+ quick adjust,
 * Edit / Delete, Add Item); non-admins see a read-only table.
 *
 * Writes hit /api/inventory and then router.refresh() pulls fresh server-
 * rendered rows — the server component is the source of truth.
 */
export default function InventoryView({
  initialItems, canEdit,
}: { initialItems: InventoryItem[]; canEdit: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [adding, setAdding] = useState(false)

  const items = initialItems

  const lowStock = useMemo(
    () => items.filter(i => i.low_stock_threshold != null && i.quantity_on_hand <= i.low_stock_threshold),
    [items],
  )
  const totalOnHand = useMemo(
    () => items.reduce((sum, i) => sum + (i.quantity_on_hand || 0), 0),
    [items],
  )

  async function adjust(id: string, delta: number) {
    if (!canEdit) return
    setBusyId(id)
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, delta }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        toast.error('Adjust failed', { detail: txt.slice(0, 120) || `HTTP ${res.status}` })
      } else {
        startTransition(() => router.refresh())
      }
    } finally {
      setBusyId(null)
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

  return (
    <>
      {/* Summary strip */}
      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <StatCard label="Item types"      value={items.length}          color="var(--blue)" sub="distinct SKUs" />
        <StatCard label="Total on hand"   value={totalOnHand}           color="var(--green)" sub="all units" />
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
          {canEdit ? 'Admin view — click the +/− buttons to adjust counts, or Edit to change other fields.' : 'Read-only view.'}
        </div>
        {canEdit && (
          <button className="btn-primary btn-sm" onClick={() => setAdding(true)} disabled={pending}>
            + Add item
          </button>
        )}
      </div>

      <div className="table-wrap card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Item</th>
              <th style={{ width: 130 }}>On hand</th>
              <th style={{ width: 110 }}>Low-stock</th>
              <th>Location</th>
              <th>Notes</th>
              <th style={{ width: 150 }}>Updated</th>
              {canEdit && <th style={{ width: 130 }} />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>
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
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {canEdit && (
                        <button
                          className="btn-secondary btn-sm"
                          style={{ padding: '2px 8px', minWidth: 28 }}
                          disabled={busyId === i.id || pending || i.quantity_on_hand <= 0}
                          onClick={() => adjust(i.id, -1)}
                          title="Decrement by 1"
                        >−</button>
                      )}
                      <span style={{ fontSize: 18, fontWeight: 700, minWidth: 36, textAlign: 'center', color: isLow ? 'var(--amber)' : 'inherit' }}>
                        {i.quantity_on_hand}
                      </span>
                      {canEdit && (
                        <button
                          className="btn-secondary btn-sm"
                          style={{ padding: '2px 8px', minWidth: 28 }}
                          disabled={busyId === i.id || pending}
                          onClick={() => adjust(i.id, 1)}
                          title="Increment by 1"
                        >+</button>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {i.low_stock_threshold == null ? <span>—</span> : `≤ ${i.low_stock_threshold}`}
                  </td>
                  <td style={{ fontSize: 12 }}>{i.location || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.notes ?? ''}>
                    {i.notes || <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {new Date(i.updated_at).toLocaleString()}
                    {i.updated_by && <div style={{ fontSize: 10 }}>{i.updated_by}</div>}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-secondary btn-sm" style={{ marginRight: 4 }} disabled={pending || busyId === i.id} onClick={() => setEditing(i)}>
                        Edit
                      </button>
                      <button className="btn-danger btn-sm" disabled={pending || busyId === i.id} onClick={() => remove(i.id, i.name)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(editing || adding) && (
        <ItemModal
          initial={editing}
          onClose={() => { setEditing(null); setAdding(false) }}
          onSaved={() => {
            setEditing(null); setAdding(false)
            startTransition(() => router.refresh())
          }}
        />
      )}
    </>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>
    </div>
  )
}

function ItemModal({
  initial, onClose, onSaved,
}: { initial: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName]       = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [qty, setQty]         = useState(String(initial?.quantity_on_hand ?? 0))
  const [low, setLow]         = useState(initial?.low_stock_threshold == null ? '' : String(initial.low_stock_threshold))
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes]     = useState(initial?.notes ?? '')
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 100))
  const [saving, setSaving]   = useState(false)

  async function save() {
    const qtyNum = parseInt(qty, 10)
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!Number.isFinite(qtyNum) || qtyNum < 0) { toast.error('On-hand must be ≥ 0'); return }
    const lowNum = low.trim() === '' ? null : parseInt(low, 10)
    if (lowNum != null && (!Number.isFinite(lowNum) || lowNum < 0)) { toast.error('Low-stock must be ≥ 0 or blank'); return }
    const sortNum = parseInt(sortOrder, 10)

    setSaving(true)
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: initial?.id,
          name: name.trim(),
          category: category.trim() || null,
          quantity_on_hand: qtyNum,
          low_stock_threshold: lowNum,
          location: location.trim() || null,
          notes: notes.trim() || null,
          sort_order: Number.isFinite(sortNum) ? sortNum : 100,
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        toast.error('Save failed', { detail: txt.slice(0, 120) || `HTTP ${res.status}` })
      } else {
        toast.success(initial ? 'Item updated' : 'Item added')
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ padding: 20, minWidth: 420, maxWidth: 560, width: '90%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
          {initial ? 'Edit item' : 'Add item'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name *">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. OBD Meter" autoFocus />
          </Field>
          <Field label="Category">
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. meters" />
          </Field>
          <Field label="On hand *">
            <input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} />
          </Field>
          <Field label="Low-stock threshold">
            <input type="number" min={0} value={low} onChange={e => setLow(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Location">
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Storeroom A" />
          </Field>
          <Field label="Sort order">
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
          </Field>
          <Field label="Notes" span={2}>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} />
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (initial ? 'Save' : 'Add')}
          </button>
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
