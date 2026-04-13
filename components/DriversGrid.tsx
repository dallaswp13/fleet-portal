'use client'
import { useState, useEffect, useTransition, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fleetColor } from '@/lib/filters'

interface Driver {
  id: string; driver_id: number; fleet_id: string; office: string | null
  name: string | null; email: string | null; image_url: string | null
  active: boolean; personal_phone: string | null; notes: string | null
  seated_vehicle_number: number | null; seated_vehicle_id: string | null
  drivers_license: string | null
  drivers_license_expire: string | null
  city: string | null; state: string | null
  street1: string | null; street2: string | null; zip_code: string | null
  allowed_to_work: boolean | null; complaints_count: number | null
  created_at: string; updated_at: string
}

interface Vehicle { id: string; vehicle_number: number; fleet_id: string; office: string | null }

interface Props {
  drivers: Record<string, unknown>[]
  page: number; totalPages: number; totalCount: number
  search: string; activeTab: 'active' | 'inactive' | 'all'
  activeCount: number; inactiveCount: number; allCount: number
}

export default function DriversGrid({ drivers: rawDrivers, page, totalPages, totalCount, search, activeTab, activeCount, inactiveCount, allCount }: Props) {
  const router    = useRouter()
  const pathname  = usePathname()
  const [, startTransition] = useTransition()
  const inputRef  = useRef<HTMLInputElement>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const drivers = rawDrivers as unknown as Driver[]

  const [selected, setSelected] = useState<Driver | null>(null)
  const [editing,  setEditing]  = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // Edit state
  const [editPhone,   setEditPhone]   = useState('')
  const [editNotes,   setEditNotes]   = useState('')
  const [editVehicle, setEditVehicle] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // Load vehicles for the edit dropdown (one-time)
  useEffect(() => {
    const sb = createClient()
    sb.from('vehicles').select('id,vehicle_number,fleet_id,office')
      .eq('sheet_tab', 'Active Vehicles').order('vehicle_number')
      .then(({ data }) => setVehicles((data ?? []) as Vehicle[]))
  }, [])

  const nav = useCallback((updates: Record<string, string>) => {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    startTransition(() => router.push(`${pathname}?${p.toString()}`, { scroll: false }))
  }, [pathname, router, startTransition])

  function handleSearch(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => nav({ q: value, page: '0' }), 300)
  }

  function openDriver(d: Driver) {
    setSelected(d); setEditing(false)
    setEditPhone(d.personal_phone ?? '')
    setEditNotes(d.notes ?? '')
    setEditVehicle(d.seated_vehicle_id ?? '')
    setSaveMsg(null)
  }

  async function saveDriver() {
    if (!selected) return
    setSaving(true); setSaveMsg(null)
    const supabase = createClient()
    const veh = vehicles.find(v => v.id === editVehicle)
    const { error } = await supabase.from('drivers').update({
      personal_phone:        editPhone || null,
      notes:                 editNotes || null,
      seated_vehicle_id:     editVehicle || null,
      seated_vehicle_number: veh?.vehicle_number ?? null,
      updated_at:            new Date().toISOString(),
    }).eq('id', selected.id)
    setSaving(false)
    if (error) { setSaveMsg({ ok: false, text: error.message }); return }
    setSaveMsg({ ok: true, text: 'Saved' })
    setEditing(false)
    // Refresh page data
    startTransition(() => router.refresh())
  }

  return (
    <>
      {/* Detail Panel */}
      {selected && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14 }}>
              {selected.image_url?.trim() ? (
                <img src={`/api/image-proxy?url=${encodeURIComponent(selected.image_url ?? "")}`} alt={selected.name ?? ''} loading="lazy" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name ?? '—'}</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>#{selected.driver_id}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{selected.fleet_id.toUpperCase()} Fleet · {selected.office ?? '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary btn-sm" onClick={() => { setEditing(e => !e); setSaveMsg(null) }}>✏ {editing ? 'Cancel' : 'Edit'}</button>
                <button className="btn-icon" onClick={() => setSelected(null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
              <div style={{ marginBottom: 16 }}>
                <span className={`badge ${selected.active ? 'badge-green' : 'badge-gray'}`}>{selected.active ? 'Active' : 'Inactive'}</span>
              </div>

              {(() => {
                const lic = selected.drivers_license
                const exp = selected.drivers_license_expire
                const expDate = exp ? new Date(exp) : null
                const expired = expDate ? expDate.getTime() < Date.now() : false
                const expSoon = expDate ? !expired && expDate.getTime() < Date.now() + 60 * 86400_000 : false
                const addr = [selected.street1, selected.street2, [selected.city, selected.state].filter(Boolean).join(', '), selected.zip_code]
                  .filter(Boolean).join(' · ')
                return [
                  { label: 'Email',          value: selected.email?.trim() || null },
                  { label: 'Phone',          value: selected.personal_phone || null },
                  { label: 'Drivers License', value: lic ? <span><span style={{ fontFamily: 'var(--font-mono)' }}>{lic}</span>{exp && <span style={{ marginLeft: 8, color: expired ? 'var(--red)' : expSoon ? 'var(--amber)' : 'var(--text3)', fontSize: 11 }}>exp {exp}{expired ? ' (EXPIRED)' : expSoon ? ' (soon)' : ''}</span>}</span> : null },
                  { label: 'Address',        value: addr || null },
                  { label: 'Seated Vehicle', value: selected.seated_vehicle_number ? `#${selected.seated_vehicle_number} ${selected.fleet_id.toUpperCase()}` : null },
                  { label: 'Complaints',     value: selected.complaints_count != null && selected.complaints_count > 0 ? String(selected.complaints_count) : null },
                ]
              })().map(r => r.value && (
                <div key={r.label} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 130, fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{r.label}</div>
                  <div style={{ fontSize: 12 }}>{r.value}</div>
                </div>
              ))}

              {editing ? (
                <div style={{ marginTop: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Personal Phone #</label>
                    <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="e.g. 3105551234" />
                    <div className="form-hint">Used to link incoming SMS to this driver</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Seated Vehicle</label>
                    <select value={editVehicle} onChange={e => setEditVehicle(e.target.value)}>
                      <option value="">— Unassigned —</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>#{v.vehicle_number} {v.fleet_id.toUpperCase()} {v.office ? `(${v.office})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
                  </div>
                  {saveMsg && <div className={`alert ${saveMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 10, fontSize: 12 }}>{saveMsg.text}</div>}
                  <button className="btn-primary" onClick={saveDriver} disabled={saving} style={{ width: '100%' }}>
                    {saving ? <><span className="spinner" /> Saving…</> : 'Save Changes'}
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {[
                    { label: 'Notes',          value: selected.notes },
                  ].map(r => r.value && (
                    <div key={r.label} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 130, fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{r.label}</div>
                      <div style={{ fontSize: 12 }}>{r.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Drivers</h1>
          <p>{totalCount.toLocaleString()} drivers</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={activeTab === 'active'   ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => nav({ tab: 'active', page: '0' })}>Active ({activeCount})</button>
        <button className={activeTab === 'inactive' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => nav({ tab: 'inactive', page: '0' })}>Inactive ({inactiveCount})</button>
        <button className={activeTab === 'all'      ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => nav({ tab: 'all', page: '0' })}>All ({allCount})</button>
      </div>

      {/* Search */}
      <div className="search-wrap" style={{ marginBottom: 14 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input ref={inputRef} placeholder="Search name, lease #, email, vehicle…"
          defaultValue={search}
          onChange={e => handleSearch(e.target.value)} />
      </div>

      {/* Driver grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {drivers.map(d => (
          <div key={d.id} onClick={() => openDriver(d)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px', cursor: 'pointer', transition: 'border-color 0.12s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {d.image_url?.trim() ? (
                <img src={`/api/image-proxy?url=${encodeURIComponent(d.image_url ?? "")}`} alt={d.name ?? ''} loading="lazy" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name ?? '—'}</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', letterSpacing: '-0.01em' }}>{d.driver_id}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: `${fleetColor(d.fleet_id)}22`, color: fleetColor(d.fleet_id), border: `1px solid ${fleetColor(d.fleet_id)}44` }}>{d.fleet_id.toUpperCase()}</span>
              {d.seated_vehicle_number && <span className="tag" style={{ fontSize: 10 }}>#{d.seated_vehicle_number}</span>}
              {!d.active && <span className="badge badge-gray">Inactive</span>}
              {d.personal_phone && <span style={{ fontSize: 10, color: 'var(--green)' }}>📱</span>}
            </div>
          </div>
        ))}
        {drivers.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: 'var(--text3)' }}>
            {search ? 'No drivers match your search.' : 'No drivers found. Import CCSI-drivers.xlsx using Update Database in Settings.'}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, padding: '10px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page + 1} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-secondary btn-sm" onClick={() => nav({ page: String(page - 1) })}
              style={{ pointerEvents: page === 0 ? 'none' : 'auto', opacity: page === 0 ? 0.4 : 1 }}>← Prev</button>
            <button className="btn-secondary btn-sm" onClick={() => nav({ page: String(page + 1) })}
              style={{ pointerEvents: page >= totalPages - 1 ? 'none' : 'auto', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next →</button>
          </div>
        </div>
      )}
    </>
  )
}
