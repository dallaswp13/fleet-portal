'use client'
import { useState, useCallback, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import VehiclePanel from '@/components/VehiclePanel'
import { useVehiclePanel } from '@/components/useVehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import { exportToCsv } from '@/lib/exportCsv'
import type { FleetOverview } from '@/types'

interface Props {
  devices: Record<string,unknown>[]; page: number; totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean
  fType: string; fCompliance: string; fModel: string
}

const ALL_COLS = [
  { key: 'device_name',       label: 'Device Name',   defaultVisible: true  },
  { key: 'is_pim',            label: 'Type',          defaultVisible: true  },
  { key: 'm360_user',         label: 'M360 User',     defaultVisible: true  },
  { key: 'tablet_model',      label: 'Model',         defaultVisible: true  },
  { key: 'android_os',        label: 'Android OS',    defaultVisible: true  },
  { key: 'imei',              label: 'IMEI',          defaultVisible: true  },
  { key: 'm360_policy',       label: 'Policy',        defaultVisible: true  },
  { key: 'compliance_status', label: 'Compliance',    defaultVisible: true  },
  { key: 'last_reported',     label: 'Last Reported', defaultVisible: true  },
]

// Compliance values have ≤10 unique options — dropdown filter
const COMPLIANCE_OPTS = ['Compliant', 'Non-Compliant', 'Unknown']

function shortOs(s: string | null | undefined) {
  return s ? (s.replace(/^Android\s*/i,'').replace(/\s*\(.*\)/,'').trim() || s) : '—'
}

export default function DevicesTable({ devices, page, totalPages, totalCount, search, sort, dir, fType, fCompliance, fModel }: Props) {
  const [, startTransition] = useTransition()
  const router   = useRouter()
  const pathname = usePathname()
  const { vehicle: panelVehicle, error: panelError, openByNumber, close } = useVehiclePanel()
  const [localQ,      setLocalQ]      = useState(search)
  const [visibleCols, setVisibleCols] = useState(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base = { q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc', f_type: fType, f_compliance: fCompliance, f_model: fModel }
    const p    = new URLSearchParams({ ...base, ...overrides })
    // Remove empty filter params
    ;['f_type','f_compliance','f_model'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, page, sort, dir, fType, fCompliance, fModel, pathname, router])

  function handleSort(col: string) { nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc', page: '0' }) }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const activeFilters = [fType, fCompliance, fModel].filter(Boolean).length

  function cellValue(d: Record<string,unknown>, key: string): React.ReactNode {
    const val = d[key]
    switch (key) {
      case 'is_pim': {
        const isPim = typeof d.device_name === 'string' && d.device_name.startsWith('*')
        return <span className={`badge ${isPim ? 'badge-amber' : 'badge-blue'}`} style={{ fontSize: 10 }}>{isPim ? 'PIM' : 'Driver'}</span>
      }
      case 'android_os': return <span style={{ fontSize: 12 }}>{shortOs(val as string)}</span>
      case 'compliance_status': {
        const s = String(val ?? '')
        const isNon = s.toLowerCase().includes('non')
        return s ? <span className={`badge ${isNon ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 10 }}>{s}</span> : <span className="text-dim">—</span>
      }
      default: return val ? <span style={{ fontSize: 12 }}>{String(val)}</span> : <span className="text-dim">—</span>
    }
  }

  return (
    <>
      {panelVehicle && <VehiclePanel vehicle={panelVehicle as unknown as FleetOverview} onClose={close} />}
      {panelError && <div className="alert alert-error" style={{ position: 'fixed', top: 20, right: 20, zIndex: 200 }}>{panelError}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={localQ} onChange={e => setLocalQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && nav({ q: localQ, page: '0' })}
            placeholder="Search device, model, IMEI…" style={{ height: 34 }} />
        </div>
        {activeFilters > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 34, fontSize: 11 }}
            onClick={() => nav({ f_type: '', f_compliance: '', f_model: '', page: '0' })}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
        <ColumnPicker storageKey="devices-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={34} />
        <button className="btn-secondary btn-sm" style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportToCsv('devices', devices, displayCols.map(c => ({ key: c.key, label: c.label })))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table>
            <thead>
              <tr>{displayCols.map(c => (
                <th key={c.key}>
                  <span onClick={() => handleSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {c.label}<SortIcon col={c.key} />
                  </span>
                </th>
              ))}</tr>
              {/* Filter row — dropdown for columns with ≤10 unique values */}
              <tr>{displayCols.map(col => (
                <th key={col.key} style={{ padding: '3px 8px', background: 'var(--bg3)' }}>
                  {col.key === 'is_pim' ? (
                    <select value={fType} onChange={e => nav({ f_type: e.target.value, page: '0' })}
                      style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                      <option value="">All</option>
                      <option value="driver">Driver</option>
                      <option value="pim">PIM</option>
                    </select>
                  ) : col.key === 'compliance_status' ? (
                    <select value={fCompliance} onChange={e => nav({ f_compliance: e.target.value, page: '0' })}
                      style={{ width: '100%', fontSize: 10, height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                      <option value="">All</option>
                      {COMPLIANCE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : col.key === 'tablet_model' ? (
                    <input value={fModel} onChange={e => nav({ f_model: e.target.value, page: '0' })}
                      placeholder="Filter…"
                      style={{ width: '100%', fontSize: 10, padding: '1px 4px', height: 22, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                  ) : (
                    <div style={{ height: 22 }} />
                  )}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {devices.map((d, i) => {
                const name = String(d.device_name ?? '')
                const nameKey = (d.name_key as string | null) ?? ''
                // Extract vehicle number from name_key (e.g. "2g" → vehicle 2, fleet G)
                const match = nameKey.match(/^(\d+)([a-z])$/)
                const vNum  = match ? parseInt(match[1]) : null
                const fleet = match ? match[2].toUpperCase() : null
                return (
                  <tr key={i} onClick={() => vNum ? openByNumber(vNum, fleet) : undefined}
                    style={{ cursor: vNum ? 'pointer' : 'default' }}>
                    {displayCols.map(c => (
                      <td key={c.key} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cellValue(d, c.key)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {devices.length === 0 && (
                <tr><td colSpan={displayCols.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>No devices found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} devices · page {page + 1} of {totalPages}</span>
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
