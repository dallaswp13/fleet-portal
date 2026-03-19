'use client'
import { useState, useTransition, useCallback, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import VehiclePanel from '@/components/VehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import { exportToCsv } from '@/lib/exportCsv'
import type { FleetOverview } from '@/types'

interface Props {
  vehicles: FleetOverview[]; page: number; totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean
}

const ALL_COLS = [
  { key: 'vehicle_number',             label: 'Vehicle #',    defaultVisible: true  },
  { key: 'fleet_id',                   label: 'Fleet',        defaultVisible: true  },
  { key: 'office',                     label: 'Office',       defaultVisible: true  },
  { key: 'online_status',              label: 'Status',       defaultVisible: true  },
  { key: 'driver_app_version',         label: 'Driver App',   defaultVisible: true  },
  { key: 'pim_app_version',            label: 'PIM App',      defaultVisible: true  },
  { key: 'meter_status',               label: 'Meter',        defaultVisible: true  },
  { key: 'driver_tablet_phone_number', label: 'Driver Phone', defaultVisible: true  },
  { key: 'pim_phone_number',           label: 'PIM Phone',    defaultVisible: true  },
  { key: 'rfid',                       label: 'RFID',         defaultVisible: true  },
  { key: 'device_name',                label: 'Device Name',  defaultVisible: true  },
  { key: 'verizon_user',               label: 'Verizon User', defaultVisible: true  },
  { key: 'monthly_usage_gb',           label: 'Usage GB',     defaultVisible: true  },
  { key: 'sheet_tab',                  label: 'Tab',          defaultVisible: true  },
  { key: 'meter_bluetooth_name',       label: 'Meter BT',     defaultVisible: false },
]

// Columns that support dropdown filtering
const FILTER_OPTIONS: Record<string, { label: string; value: string }[]> = {
  office:        [{ label: 'ASC', value: 'ASC' }, { label: 'CYC', value: 'CYC' }, { label: 'SDY', value: 'SDY' }, { label: 'DEN', value: 'DEN' }],
  fleet_id:      [{ label: 'C', value: 'C' }, { label: 'D', value: 'D' }, { label: 'G', value: 'G' }, { label: 'E', value: 'E' }, { label: 'L', value: 'L' }, { label: 'S', value: 'S' }, { label: 'Y', value: 'Y' }, { label: 'U', value: 'U' }],
  online_status: [{ label: 'Online', value: 'Online' }, { label: 'Offline', value: 'Offline' }],
  meter_status:  [{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }],
  sheet_tab:     [{ label: 'Active', value: 'Active Vehicles' }, { label: 'Test', value: 'Test Vehicles' }, { label: 'Surrendered', value: 'Surrenders' }],
}

export default function VehiclesTable({ vehicles, page, totalPages, totalCount, search, sort, dir }: Props) {
  const [, startTransition] = useTransition()
  const router              = useRouter()
  const pathname            = usePathname()
  const [selectedVehicle, setSelectedVehicle] = useState<FleetOverview | null>(null)
  const [localQ,   setLocalQ]      = useState(search)
  const [visibleCols, setVisibleCols] = useState<string[]>(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  useEffect(() => { setLocalQ(search) }, [search])

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const p = new URLSearchParams({ q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc', ...overrides })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, page, sort, dir, pathname, router])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault(); nav({ q: localQ, page: '0' })
  }

  function handleSort(col: string) {
    nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc' })
  }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols = ALL_COLS.filter(c => visibleCols.includes(c.key))

  // Client-side column filtering on top of server-side data
  const filtered = vehicles.filter(v => {
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val) continue
      const row = v as unknown as Record<string, unknown>
      const cell = String(row[key] ?? '').toLowerCase()
      if (!cell.includes(val.toLowerCase())) return false
    }
    return true
  })

  function cellValue(v: FleetOverview, key: string): React.ReactNode {
    const val = (v as unknown as Record<string, unknown>)[key]
    switch (key) {
      case 'vehicle_number': return <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{v.vehicle_number}</span>
      case 'fleet_id':       return <span className="badge badge-gray">{String(val ?? '').toUpperCase()}</span>
      case 'office':         return val ? <span className="badge badge-gray">{String(val)}</span> : <span className="text-dim">—</span>
      case 'online_status': {
        const s = String(val ?? '').toLowerCase()
        const color = s.startsWith('online') ? 'badge-green' : s.startsWith('offline') ? 'badge-amber' : 'badge-gray'
        return <span className={`badge ${color}`}>{String(val ?? '—').split(' -')[0]}</span>
      }
      case 'monthly_usage_gb': return val != null ? <span>{Number(val).toFixed(1)} GB</span> : <span className="text-dim">—</span>
      case 'sheet_tab': {
        const t = String(val ?? '')
        return <span className="badge badge-gray" style={{ fontSize: 10 }}>{t === 'Active Vehicles' ? 'Active' : t === 'Test Vehicles' ? 'Test' : t === 'Surrenders' ? 'Surrendered' : t}</span>
      }
      default: return val ? <span style={{ fontSize: 12 }}>{String(val)}</span> : <span className="text-dim">—</span>
    }
  }

  const activeFilters = Object.values(colFilters).filter(Boolean).length

  return (
    <>
      {selectedVehicle && <VehiclePanel vehicle={selectedVehicle} onClose={() => setSelectedVehicle(null)} />}

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={localQ} onChange={e => setLocalQ(e.target.value)} placeholder="Search vehicle #, phone, RFID…" style={{ height: 34 }} />
        </div>
        {activeFilters > 0 && (
          <button type="button" className="btn-secondary btn-sm" style={{ height: 34, fontSize: 11 }}
            onClick={() => setColFilters({})}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
        <ColumnPicker storageKey="vehicles-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={34} />
        <button type="button" className="btn-secondary btn-sm" style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportToCsv('vehicles', filtered as unknown as Record<string,unknown>[], displayCols.map(c => ({ key: c.key, label: c.label })))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </form>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
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
              {/* Column filter row — dropdowns only, no text inputs */}
              {displayCols.some(c => !!FILTER_OPTIONS[c.key]) && (
                <tr>
                  {displayCols.map(col => (
                    <th key={col.key} style={{ padding: '3px 8px', background: 'var(--bg3)' }}>
                      {FILTER_OPTIONS[col.key] ? (
                        <select value={colFilters[col.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [col.key]: e.target.value }))}
                          style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                          <option value="">All</option>
                          {FILTER_OPTIONS[col.key].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : <div />}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.vehicle_id} onClick={() => setSelectedVehicle(v)} style={{ cursor: 'pointer' }}>
                  {displayCols.map(c => (
                    <td key={c.key} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cellValue(v, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={displayCols.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                  {activeFilters > 0 ? 'No vehicles match the active column filters.' : 'No vehicles found.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} total · page {page + 1} of {totalPages}</span>
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
