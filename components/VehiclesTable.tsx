'use client'
import { useState, useTransition, useCallback, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import VehiclePanel from '@/components/VehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import { exportToCsv } from '@/lib/exportCsv'
import type { FleetOverview } from '@/types'

interface Props {
  vehicles: FleetOverview[]; page: number; perPage: number
  totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean
  fStatus: string; fFleet: string; fMeter: string; fTab: string
}

const ALL_COLS = [
  { key: 'vehicle_number',             label: 'Vehicle #',    defaultVisible: true  },
  { key: 'fleet_id',                   label: 'Fleet',        defaultVisible: true  },
  { key: 'online_status',              label: 'Status',       defaultVisible: true  },
  { key: 'driver_app_version',         label: 'Driver App',   defaultVisible: true  },
  { key: 'pim_app_version',            label: 'PIM App',      defaultVisible: true  },
  { key: 'driver_tablet_phone_number', label: 'Driver Phone', defaultVisible: true  },
  { key: 'pim_phone_number',           label: 'PIM Phone',    defaultVisible: true  },
  { key: 'meter_status',               label: 'Meter',        defaultVisible: true  },
  { key: 'rfid',                       label: 'RFID',         defaultVisible: true  },
  { key: 'sheet_tab',                  label: 'Tab',          defaultVisible: true  },
  { key: 'device_name',                label: 'Device',       defaultVisible: false },
  { key: 'monthly_usage_gb',           label: 'Usage GB',     defaultVisible: false },
]

// Columns with a fixed set of values — get server-side dropdown filters
const FILTER_COLS: Record<string, { label: string; value: string }[]> = {
  online_status: [{ label: 'Online', value: 'Online' }, { label: 'Offline', value: 'Offline' }],
  fleet_id:      [
    { label: 'C (CYC)', value: 'C' }, { label: 'D (DEN)', value: 'D' }, { label: 'G (SDY)', value: 'G' },
    { label: 'E (ASC)', value: 'E' }, { label: 'L (ASC)', value: 'L' }, { label: 'S (ASC)', value: 'S' },
    { label: 'Y (ASC)', value: 'Y' }, { label: 'U (ASC)', value: 'U' },
  ],
  meter_status:  [{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }],
  sheet_tab:     [{ label: 'Active', value: 'Active Vehicles' }, { label: 'Test', value: 'Test Vehicles' }, { label: 'Surrendered', value: 'Surrenders' }],
}

// Map col key → URL param name
const COL_TO_PARAM: Record<string, string> = {
  online_status: 'f_status',
  fleet_id:      'f_fleet',
  meter_status:  'f_meter',
  sheet_tab:     'f_tab',
}

const PER_PAGE_OPTIONS = [25, 50, 100]

export default function VehiclesTable({ vehicles, page, perPage, totalPages, totalCount, search, sort, dir, fStatus, fFleet, fMeter, fTab }: Props) {
  const [, startTransition] = useTransition()
  const router     = useRouter()
  const pathname   = usePathname()
  const [localQ,   setLocalQ]   = useState(search)
  const [panel,    setPanel]    = useState<FleetOverview | null>(null)
  const [visibleCols, setVisibleCols] = useState<string[]>(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))

  useEffect(() => { setLocalQ(search) }, [search])

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base: Record<string, string> = {
      q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc',
      per_page: String(perPage),
      f_status: fStatus, f_fleet: fFleet, f_meter: fMeter, f_tab: fTab,
    }
    const p = new URLSearchParams({ ...base, ...overrides })
    // Remove empty filter params for clean URLs
    ;['f_status','f_fleet','f_meter','f_tab','q'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, page, sort, dir, perPage, fStatus, fFleet, fMeter, fTab, pathname, router])

  function handleSort(col: string) {
    nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc', page: '0' })
  }

  function handleFilter(param: string, value: string) {
    nav({ [param]: value, page: '0' })
  }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const activeFilters = [fStatus, fFleet, fMeter, fTab].filter(Boolean)

  function cellValue(v: FleetOverview, key: string): React.ReactNode {
    switch (key) {
      case 'vehicle_number': return <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{v.vehicle_number}</span>
      case 'fleet_id':       return <span className="badge badge-gray">{String(v.fleet_id ?? '').toUpperCase()}</span>
      case 'online_status': {
        const s = String(v.online_status ?? '').toLowerCase()
        const color = s.startsWith('online') ? 'badge-green' : s.startsWith('offline') ? 'badge-amber' : 'badge-gray'
        return <span className={`badge ${color}`}>{v.online_status?.split(' -')[0] ?? '—'}</span>
      }
      case 'meter_status': {
        const s = String(v.meter_status ?? '').toLowerCase()
        return <span className={`badge ${s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-gray' : 'badge-gray'}`}>{v.meter_status ?? '—'}</span>
      }
      case 'sheet_tab': {
        const s = String(v.sheet_tab ?? '')
        return <span className="badge badge-gray">{s === 'Active Vehicles' ? 'Active' : s === 'Test Vehicles' ? 'Test' : s === 'Surrenders' ? 'Surrendered' : s}</span>
      }
      default: {
        const val = (v as unknown as Record<string, unknown>)[key]
        return val ? <span style={{ fontSize: 12 }}>{String(val)}</span> : <span className="text-dim">—</span>
      }
    }
  }

  const hasFilters = displayCols.some(c => !!FILTER_COLS[c.key])

  return (
    <>
      {panel && <VehiclePanel vehicle={panel} onClose={() => setPanel(null)} onSaved={updated => setPanel(updated)} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {/* Search */}
        <form style={{ flex: '1 1 260px' }} onSubmit={e => { e.preventDefault(); nav({ q: localQ, page: '0' }) }}>
          <div className="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={localQ} onChange={e => setLocalQ(e.target.value)} placeholder="Search vehicle #, phone, RFID…" style={{ height: 34 }} />
          </div>
        </form>

        {/* Per-page selector */}
        <select value={perPage} onChange={e => nav({ per_page: e.target.value, page: '0' })}
          style={{ height: 34, fontSize: 12, padding: '0 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', cursor: 'pointer' }}>
          {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n} per page</option>)}
        </select>

        {/* Clear filters */}
        {activeFilters.length > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 34 }}
            onClick={() => nav({ f_status: '', f_fleet: '', f_meter: '', f_tab: '', page: '0' })}>
            Clear {activeFilters.length} filter{activeFilters.length > 1 ? 's' : ''}
          </button>
        )}

        <ColumnPicker storageKey="vehicles-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={34} />
        <button className="btn-secondary btn-sm" style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportToCsv('vehicles', vehicles as unknown as Record<string,unknown>[], displayCols.map(c => ({ key: c.key, label: c.label })))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          <table>
            <thead>
              <tr>
                {displayCols.map(c => (
                  <th key={c.key}>
                    <span onClick={() => handleSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                      {c.label}<SortIcon col={c.key} />
                    </span>
                  </th>
                ))}
              </tr>
              {/* Filter row — only for columns with known value sets */}
              {hasFilters && (
                <tr>
                  {displayCols.map(col => {
                    const param   = COL_TO_PARAM[col.key]
                    const opts    = FILTER_COLS[col.key]
                    const current = param === 'f_status' ? fStatus : param === 'f_fleet' ? fFleet : param === 'f_meter' ? fMeter : param === 'f_tab' ? fTab : ''
                    return (
                      <th key={col.key} style={{ padding: '3px 8px', background: 'var(--bg3)' }}>
                        {opts && param ? (
                          <select value={current} onChange={e => handleFilter(param, e.target.value)}
                            style={{ width: '100%', fontSize: 11, height: 24, background: current ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, color: current ? 'var(--accent)' : 'var(--text)', fontWeight: current ? 600 : 400, cursor: 'pointer' }}>
                            <option value="">All</option>
                            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : <div />}
                      </th>
                    )
                  })}
                </tr>
              )}
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.vehicle_id} onClick={() => setPanel(v)} style={{ cursor: 'pointer' }}>
                  {displayCols.map(c => (
                    <td key={c.key} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cellValue(v, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {vehicles.length === 0 && (
                <tr><td colSpan={displayCols.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                  {activeFilters.length > 0 ? 'No vehicles match the active filters.' : 'No vehicles found.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            {totalCount.toLocaleString()} total · page {page + 1} of {totalPages || 1}
          </span>
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
