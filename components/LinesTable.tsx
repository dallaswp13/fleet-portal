'use client'
import { useState, useCallback, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useVehiclePanel } from '@/components/useVehiclePanel'
import VehiclePanel from '@/components/VehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import UsageMeter from '@/components/UsageMeter'
import { exportToCsv } from '@/lib/exportCsv'
import type { FleetOverview } from '@/types'

interface Props {
  lines: Record<string,unknown>[]; page: number; totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean; activeTab: 'all'|'available'|'staff'
  fRole: string; fStatus: string; fVehicle: string
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

const maxUsage = 20 // cap for usage meter display

export default function LinesTable({ lines, page, totalPages, totalCount, search, sort, dir, activeTab, fRole, fStatus, fVehicle }: Props) {
  const [, startTransition] = useTransition()
  const router   = useRouter()
  const pathname = usePathname()
  const { vehicle: panelVehicle, error: panelError, openByNumber, close } = useVehiclePanel()
  const [localQ,      setLocalQ]      = useState(search)
  const [visibleCols, setVisibleCols] = useState(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base = { q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc', tab: activeTab, f_role: fRole, f_status: fStatus, f_vehicle: fVehicle }
    const p    = new URLSearchParams({ ...base, ...overrides })
    ;['f_role','f_status','f_vehicle'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, page, sort, dir, activeTab, fRole, fStatus, fVehicle, pathname, router])

  function handleSort(col: string) { nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc', page: '0' }) }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const activeFilters = [fRole, fStatus, fVehicle].filter(Boolean).length

  function statusColor(s: string | null) {
    const l = (s ?? '').toLowerCase()
    return l.includes('active') ? 'badge-green' : l.includes('suspend') ? 'badge-amber' : 'badge-gray'
  }

  function cellValue(l: Record<string,unknown>, key: string): React.ReactNode {
    switch (key) {
      case 'phone_number': return <span className="mono" style={{ fontWeight: 500 }}>{String(l.phone_number ?? '—')}</span>
      case 'office': return l.office ? <span className="badge badge-gray" style={{ fontSize: 10 }}>{String(l.office)}</span> : <span className="text-dim">—</span>
      case 'vehicle': return l.vehicle_number
        ? <span style={{ fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); openByNumber(l.vehicle_number as number, l.fleet_id as string) }}>
            {String(l.vehicle_number)} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{String(l.fleet_id ?? '').toUpperCase()}</span>
          </span>
        : <span className="text-dim">—</span>
      case 'role': return l.role
        ? <span className={`badge ${l.role === 'Driver' ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 10 }}>{String(l.role)}</span>
        : <span className="badge badge-gray" style={{ fontSize: 10 }}>Unassigned</span>
      case 'phone_status': return <span className={`badge ${statusColor(l.phone_status as string)}`} style={{ fontSize: 10 }}>{String(l.phone_status ?? 'Unknown')}</span>
      case 'monthly_usage_gb': return <UsageMeter value={Number(l.monthly_usage_gb ?? 0)} max={maxUsage} />
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
            {t === 'all' ? 'All Lines' : t === 'available' ? 'Available' : 'Staff'}
          </button>
        ))}
      </div>

      {activeTab === 'available' && (
        <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 12 }}>
          Lines in the Verizon usage report not matched to any vehicle in CCSI. These include hotspots, backup SIMs, and lines where CCSI has no phone number entry.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={localQ} onChange={e => setLocalQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && nav({ q: localQ, page: '0' })}
            placeholder="Search phone, user, plan…" style={{ height: 34 }} />
        </div>
        {activeFilters > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 34, fontSize: 11 }}
            onClick={() => nav({ f_role: '', f_status: '', f_vehicle: '', page: '0' })}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
        <ColumnPicker storageKey="lines-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={34} />
        <button className="btn-secondary btn-sm" style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
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
              {/* Filter row — only ≤10 unique value columns get dropdowns */}
              <tr>{displayCols.map(col => (
                <th key={col.key} style={{ padding: '3px 8px', background: 'var(--bg3)' }}>
                  {col.key === 'role' ? (
                    <select value={fRole} onChange={e => nav({ f_role: e.target.value, page: '0' })}
                      style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                      <option value="">All</option>
                      <option value="Driver">Driver</option>
                      <option value="PIM">PIM</option>
                      <option value="Unassigned">Unassigned</option>
                    </select>
                  ) : col.key === 'phone_status' ? (
                    <select value={fStatus} onChange={e => nav({ f_status: e.target.value, page: '0' })}
                      style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                      <option value="">All</option>
                      <option value="active">Active</option>
                      <option value="suspend">Suspended</option>
                    </select>
                  ) : col.key === 'vehicle' ? (
                    <select value={fVehicle} onChange={e => nav({ f_vehicle: e.target.value, page: '0' })}
                      style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                      <option value="">All</option>
                      <option value="assigned">Assigned</option>
                      <option value="unassigned">Unassigned</option>
                    </select>
                  ) : (
                    <div style={{ height: 22 }} />
                  )}
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

        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} lines · page {page + 1} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => nav({ page: String(page - 1) })}>← Prev</button>
              <button className="btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => nav({ page: String(page + 1) })}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
