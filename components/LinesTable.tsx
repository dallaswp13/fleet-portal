'use client'
import { useState, useCallback, useTransition, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useVehiclePanel } from '@/components/useVehiclePanel'
import VehiclePanel from '@/components/VehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import UsageMeter from '@/components/UsageMeter'
import { exportToCsv } from '@/lib/exportCsv'
import { fleetColor, officeColor } from '@/lib/filters'
import type { FleetOverview } from '@/types'

interface Props {
  lines: Record<string,unknown>[]; page: number; perPage: number
  totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean; activeTab: 'all'|'available'|'staff'
  fRole: string; fStatus: string; fVehicle: string
  availableCount?: number; assignedCount?: number
}

const ALL_COLS = [
  { key: 'phone_number',     label: 'Phone #',      defaultVisible: true  },
  { key: 'office',           label: 'Office',       defaultVisible: true  },
  { key: 'vehicle',          label: 'Vehicle',      defaultVisible: true  },
  { key: 'role',             label: 'Role',         defaultVisible: true  },
  { key: 'phone_status',     label: 'Status',       defaultVisible: true  },
  { key: 'verizon_user',     label: 'Verizon User', defaultVisible: true  },
  { key: 'mobile_plan',      label: 'Mobile Plan',  defaultVisible: true  },
  { key: 'monthly_usage_gb', label: 'Usage',        defaultVisible: true  },
  { key: 'sub_account',      label: 'Sub Account',  defaultVisible: true  },
  { key: 'account_number',   label: 'Account #',    defaultVisible: false },
]

const SEL = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent-dim)' : 'var(--bg2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  color: active ? 'var(--accent)' : 'var(--text)',
  fontWeight: active ? 600 : 400,
})

export default function LinesTable({ lines, page, perPage, totalPages, totalCount, search, sort, dir, activeTab, fRole, fStatus, fVehicle, availableCount, assignedCount }: Props) {
  const [, startTransition] = useTransition()
  const router   = useRouter()
  const pathname = usePathname()
  const { vehicle: panelVehicle, error: panelError, openByNumber, close } = useVehiclePanel()
  const [localQ,      setLocalQ]      = useState(search)
  const [visibleCols, setVisibleCols] = useState(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const isTypingRef  = useRef(false)

  // Refocus input after server re-render while typing
  useEffect(() => {
    if (isTypingRef.current) inputRef.current?.focus()
  })

  useEffect(() => { setLocalQ(search) }, [search])

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base = { q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc', per_page: String(perPage), tab: activeTab, f_role: fRole, f_status: fStatus, f_vehicle: fVehicle }
    const p    = new URLSearchParams({ ...base, ...overrides })
    ;['f_role','f_status','f_vehicle','q'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }))
  }, [search, page, sort, dir, perPage, activeTab, fRole, fStatus, fVehicle, pathname, router])

  function handleSearch(val: string) {
    setLocalQ(val)
    isTypingRef.current = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      isTypingRef.current = false
      nav({ q: val, page: '0' })
    }, 350)
  }

  function handleSort(col: string) { nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc', page: '0' }) }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols   = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const activeFilters = [fRole, fStatus, fVehicle].filter(Boolean).length

  function statusColor(s: string | null) {
    const l = (s ?? '').toLowerCase()
    return l.includes('active') ? 'badge-green' : l.includes('suspend') ? 'badge-amber' : 'badge-gray'
  }

  function cellValue(l: Record<string,unknown>, key: string): React.ReactNode {
    switch (key) {
      case 'phone_number': return <span className="mono" style={{ fontWeight: 500 }}>{String(l.phone_number ?? '—')}</span>
      case 'office': { if (!l.office) return <span className="text-dim">—</span>; const oc = officeColor(l.office as string); return <span className="badge" style={{ background: `${oc}22`, color: oc, border: `1px solid ${oc}44` }}>{String(l.office)}</span> }
      case 'vehicle': return l.vehicle_number
        ? <span style={{ fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); openByNumber(l.vehicle_number as number, l.fleet_id as string) }}>
            {String(l.vehicle_number)} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{String(l.fleet_id ?? '').toUpperCase()}</span>
          </span>
        : <span className="text-dim">—</span>
      case 'role': return l.role
        ? <span className={`badge ${l.role === 'Driver' ? 'badge-blue' : 'badge-amber'}`}>{String(l.role)}</span>
        : <span className="badge badge-gray">Unassigned</span>
      case 'phone_status': return <span className={`badge ${statusColor(l.phone_status as string)}`}>{String(l.phone_status ?? 'Unknown')}</span>
      case 'monthly_usage_gb': return <UsageMeter value={Number(l.monthly_usage_gb ?? 0)} max={20} />
      case 'sub_account': return <span style={{ fontSize: 12 }}>{String(l.sub_account ?? l.account_number ?? '—')}</span>
      default: return l[key] ? <span style={{ fontSize: 12 }}>{String(l[key])}</span> : <span className="text-dim">—</span>
    }
  }

  return (
    <>
      {panelVehicle && <VehiclePanel vehicle={panelVehicle as unknown as FleetOverview} onClose={close} />}
      {panelError && <div className="alert alert-error" style={{ position: 'fixed', top: 20, right: 20, zIndex: 200 }}>{panelError}</div>}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['all','available','staff'] as const).map(t => (
          <button key={t} className={activeTab === t ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => nav({ tab: t, page: '0' })}
            style={{ marginLeft: t === 'staff' ? 8 : 0 }}>
            {t === 'all' ? 'All Lines' : t === 'available' ? `Available${availableCount ? ` (${availableCount})` : ''}` : 'Staff'}
          </button>
        ))}
      </div>

      {activeTab === 'available' && (
        <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 12 }}>
          Lines not matched to any vehicle — hotspots, backup SIMs, or lines with no phone number in CCSI.
          {totalCount === 0 && assignedCount !== undefined && (
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              {assignedCount > 0
                ? `All lines are currently matched to vehicles (${assignedCount} assigned phone numbers). If this seems wrong, re-import CCSI and Verizon data to refresh phone norm matching.`
                : 'No vehicles have phone numbers assigned yet. Import CCSI data to populate vehicle phone numbers, then re-check.'}
              {' '}Run migration 025 for improved Available tab filtering.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input ref={inputRef} value={localQ} onChange={e => handleSearch(e.target.value)}
            placeholder="Search phone, user, plan…" style={{ height: 36 }} />
        </div>
        {activeFilters > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 36, fontSize: 11 }}
            onClick={() => nav({ f_role: '', f_status: '', f_vehicle: '', page: '0' })}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
        <select value={perPage} onChange={e => nav({ per_page: e.target.value, page: '0' })}
          className="btn-secondary toolbar-select">
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <ColumnPicker storageKey="lines-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={36} />
        <button className="btn-secondary btn-sm" style={{ height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportToCsv('verizon-lines', lines, displayCols.map(c => ({ key: c.key, label: c.label })))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table>
            <thead>
              <tr>{displayCols.map(c => (
                <th key={c.key}>
                  <span onClick={() => handleSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {c.label}<SortIcon col={c.key} />
                  </span>
                </th>
              ))}</tr>
              <tr>{displayCols.map(col => (
                <th key={col.key} style={{ padding: '3px 6px', background: 'var(--bg3)' }}>
                  {col.key === 'role' ? (
                    <select value={fRole} onChange={e => nav({ f_role: e.target.value, page: '0' })} style={SEL(!!fRole)}>
                      <option value="">All roles</option>
                      <option value="Driver">Driver</option>
                      <option value="PIM">PIM</option>
                      <option value="Unassigned">Unassigned</option>
                    </select>
                  ) : col.key === 'phone_status' ? (
                    <select value={fStatus} onChange={e => nav({ f_status: e.target.value, page: '0' })} style={SEL(!!fStatus)}>
                      <option value="">All statuses</option>
                      <option value="active">Active</option>
                      <option value="suspend">Suspended</option>
                    </select>
                  ) : col.key === 'vehicle' ? (
                    <select value={fVehicle} onChange={e => nav({ f_vehicle: e.target.value, page: '0' })} style={SEL(!!fVehicle)}>
                      <option value="">All</option>
                      <option value="assigned">Assigned</option>
                      <option value="unassigned">Unassigned</option>
                    </select>
                  ) : <div />}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}
                  onClick={() => l.vehicle_number ? openByNumber(l.vehicle_number as number, l.fleet_id as string) : undefined}
                  style={{ cursor: l.vehicle_number ? 'pointer' : 'default' }}>
                  {displayCols.map(c => (
                    <td key={c.key} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cellValue(l, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={displayCols.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>No lines found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} lines · page {page + 1} of {totalPages || 1}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => nav({ page: '0' })}>«</button>
            <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => nav({ page: String(page - 1) })}>← Prev</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => nav({ page: String(page + 1) })}>Next →</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => nav({ page: String(totalPages - 1) })}>»</button>
          </div>
        </div>
      </div>
    </>
  )
}
