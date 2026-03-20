'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OFFICES, ASC_FLEETS, getFleetIdsFromFilters, type Office } from '@/lib/filters'

interface Driver {
  id: string; driver_id: number; fleet_id: string; office: string | null
  name: string | null; email: string | null; image_url: string | null
  active: boolean; personal_phone: string | null; notes: string | null
  seated_vehicle_number: number | null; seated_vehicle_id: string | null
  created_at: string; updated_at: string
}

interface Vehicle { id: string; vehicle_number: number; fleet_id: string; office: string | null }

function DriversContent() {
  const searchParams  = useSearchParams()
  const officesParam  = searchParams.get('offices')
  const ascFleetParam = searchParams.get('asc_fleets')

  const officeFilter: Office[] = officesParam
    ? officesParam.split(',').filter((o): o is Office => OFFICES.includes(o as Office))
    : [...OFFICES]
  const ascFleetFilter: string[] = ascFleetParam
    ? ascFleetParam.split(',').filter(f => ASC_FLEETS.includes(f as typeof ASC_FLEETS[number]))
    : [...ASC_FLEETS]
  const fleetIdFilter = getFleetIdsFromFilters(officeFilter, ascFleetFilter)

  const [drivers,   setDrivers]   = useState<Driver[]>([])
  const [vehicles,  setVehicles]  = useState<Vehicle[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'all'>('active')
  const [selected,  setSelected]  = useState<Driver | null>(null)
  const [editing,   setEditing]   = useState(false)

  // Edit state
  const [editPhone,   setEditPhone]   = useState('')
  const [editNotes,   setEditNotes]   = useState('')
  const [editVehicle, setEditVehicle] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      // Batch load all drivers — Supabase default row limit is 1000
      let driverData: Driver[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('drivers').select('*').order('name').range(from, from + 999)
        if (error || !data || data.length === 0) break
        driverData = [...driverData, ...(data as Driver[])]
        if (data.length < 1000) break
        from += 1000
      }

      const { data: vehicleData } = await supabase
        .from('vehicles').select('id,vehicle_number,fleet_id,office')
        .eq('sheet_tab', 'Active Vehicles').order('vehicle_number')

      setDrivers(driverData)
      setVehicles((vehicleData ?? []) as Vehicle[])
      setLoading(false)
    }
    load()
  }, [])

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
    setDrivers(prev => prev.map(d => d.id === selected.id
      ? { ...d, personal_phone: editPhone || null, notes: editNotes || null, seated_vehicle_id: editVehicle || null, seated_vehicle_number: veh?.vehicle_number ?? null }
      : d))
    setSelected(prev => prev ? { ...prev, personal_phone: editPhone || null, notes: editNotes || null, seated_vehicle_id: editVehicle || null, seated_vehicle_number: veh?.vehicle_number ?? null } : null)
    setEditing(false)
  }

  const filtered = useMemo(() => drivers.filter(d => {
    if (activeTab === 'active'   && !d.active)  return false
    if (activeTab === 'inactive' &&  d.active)  return false
    // Fleet filter (handles office + ASC sub-fleets)
    if (fleetIdFilter !== null) {
      if (fleetIdFilter.length === 0) return false
      if (!fleetIdFilter.includes(d.fleet_id.toUpperCase())) return false
    }
    if (!search) return true
    const q = search.toLowerCase()
    return [d.name, d.email, String(d.driver_id), d.personal_phone ?? '', String(d.seated_vehicle_number ?? '')]
      .some(f => f?.toLowerCase().includes(q))
  }), [drivers, fleetIdFilter, ascFleetFilter, officeFilter, activeTab, search])

  const activeCount   = drivers.filter(d => d.active).length
  const inactiveCount = drivers.filter(d => !d.active).length
  const totalCount    = drivers.length

  return (
    <div className="page-content">
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
              {/* Status badge */}
              <div style={{ marginBottom: 16 }}>
                <span className={`badge ${selected.active ? 'badge-green' : 'badge-gray'}`}>{selected.active ? 'Active' : 'Inactive'}</span>
              </div>

              {[
                { label: 'Email',          value: selected.email?.trim() || null },
                { label: 'Seated Vehicle', value: selected.seated_vehicle_number ? `#${selected.seated_vehicle_number} ${selected.fleet_id.toUpperCase()}` : null },
              ].map(r => r.value && (
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
                    { label: 'Personal Phone', value: selected.personal_phone },
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
          <p>{loading ? 'Loading…' : `${filtered.length} drivers`}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={activeTab === 'active'   ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setActiveTab('active')}>Active ({activeCount})</button>
        <button className={activeTab === 'inactive' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setActiveTab('inactive')}>Inactive ({inactiveCount})</button>
        <button className={activeTab === 'all'      ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setActiveTab('all')}>All ({totalCount})</button>
      </div>

      {/* Search */}
      <div className="search-wrap" style={{ marginBottom: 14 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input placeholder="Search name, lease #, email, vehicle…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Driver grid */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {filtered.map(d => (
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
                <span className="badge badge-gray">{d.fleet_id.toUpperCase()}</span>
                {d.seated_vehicle_number && <span className="tag" style={{ fontSize: 10 }}>#{d.seated_vehicle_number}</span>}
                {!d.active && <span className="badge badge-gray">Inactive</span>}
                {d.personal_phone && <span style={{ fontSize: 10, color: 'var(--green)' }}>📱</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: 'var(--text3)' }}>
              No drivers found. Import CCSI-drivers.xlsx using Update Database in Settings.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DriversPage() {
  return (
    <Suspense fallback={<div className="page-content"><div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" /></div></div>}>
      <DriversContent />
    </Suspense>
  )
}
