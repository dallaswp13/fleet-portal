'use client'
import { useState, useCallback, useTransition, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import VehiclePanel from '@/components/VehiclePanel'
import { useVehiclePanel } from '@/components/useVehiclePanel'
import ColumnPicker from '@/components/ColumnPicker'
import { exportToCsv } from '@/lib/exportCsv'
import type { FleetOverview } from '@/types'

interface Props {
  devices: Record<string,unknown>[]; page: number; perPage: number
  totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean
  fType: string; fCompliance: string; fModel: string; fOs: string; fPolicy: string
  osValues: string[]; policyValues: string[]
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

const COMPLIANCE_OPTS = ['Compliant', 'Non-Compliant', 'Unknown']

function shortOs(s: string | null | undefined) {
  return s ? (s.replace(/^Android\s*/i,'').replace(/\s*\(.*\)/,'').trim() || s) : '—'
}

const SEL = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent-dim)' : 'var(--bg2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  color: active ? 'var(--accent)' : 'var(--text)',
  fontWeight: active ? 600 : 400,
})

export default function DevicesTable({ devices, page, perPage, totalPages, totalCount, search, sort, dir, fType, fCompliance, fModel, fOs, fPolicy, osValues, policyValues }: Props) {
  const [, startTransition] = useTransition()
  const router   = useRouter()
  const pathname = usePathname()
  const { vehicle: panelVehicle, error: panelError, openByNumber, close } = useVehiclePanel()
  const [localQ,      setLocalQ]      = useState(search)
  const [visibleCols, setVisibleCols] = useState(ALL_COLS.filter(c => c.defaultVisible !== false).map(c => c.key))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocalQ(search) }, [search])

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base = { q: search, page: String(page), sort, dir: dir ? 'asc' : 'desc', per_page: String(perPage), f_type: fType, f_compliance: fCompliance, f_model: fModel, f_os: fOs, f_policy: fPolicy }
    const p    = new URLSearchParams({ ...base, ...overrides })
    ;['f_type','f_compliance','f_model','f_os','f_policy','q'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, page, sort, dir, perPage, fType, fCompliance, fModel, fOs, fPolicy, pathname, router])

  function handleSearch(val: string) {
    setLocalQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => nav({ q: val, page: '0' }), 350)
  }

  function handleSort(col: string) { nav({ sort: col, dir: sort === col && dir ? 'desc' : 'asc', page: '0' }) }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↑' : ' ↓'}</span>
  }

  const displayCols   = ALL_COLS.filter(c => visibleCols.includes(c.key))
  const activeFilters = [fType, fCompliance, fModel, fOs, fPolicy].filter(Boolean).length

  function cellValue(d: Record<string,unknown>, key: string): React.ReactNode {
    const val = d[key]
    switch (key) {
      case 'is_pim': {
        const isPim = typeof d.device_name === 'string' && d.device_name.startsWith('*')
        return <span className={`badge ${isPim ? 'badge-amber' : 'badge-blue'}`}>{isPim ? 'PIM' : 'Driver'}</span>
      }
      case 'android_os': return <span style={{ fontSize: 12 }}>{shortOs(val as string)}</span>
      case 'compliance_status': {
        const s = String(val ?? ''); const isNon = s.toLowerCase().includes('non')
        return s ? <span className={`badge ${isNon ? 'badge-red' : 'badge-green'}`}>{s}</span> : <span className="text-dim">—</span>
      }
      default: return val ? <span style={{ fontSize: 12 }}>{String(val)}</span> : <span className="text-dim">—</span>
    }
  }

  return (
    <>
      {panelVehicle && <VehiclePanel vehicle={panelVehicle as unknown as FleetOverview} onClose={close} />}
      {panelError && <div className="alert alert-error" style={{ position: 'fixed', top: 20, right: 20, zIndex: 200 }}>{panelError}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={localQ} onChange={e => handleSearch(e.target.value)}
            placeholder="Search device, model, IMEI…" style={{ height: 36 }} />
        </div>
        {activeFilters > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 36, fontSize: 11 }}
            onClick={() => nav({ f_type: '', f_compliance: '', f_model: '', f_os: '', f_policy: '', page: '0' })}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
        <select value={perPage} onChange={e => nav({ per_page: e.target.value, page: '0' })}
          className="btn-secondary toolbar-select">
          {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <ColumnPicker storageKey="devices-cols" allColumns={ALL_COLS} onChange={setVisibleCols} height={36} />
        <button className="btn-secondary btn-sm" style={{ height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
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
              <tr>{displayCols.map(col => (
                <th key={col.key} style={{ padding: '3px 6px', background: 'var(--bg3)' }}>
                  {col.key === 'is_pim' ? (
                    <select className="filter-select" value={fType} onChange={e => nav({ f_type: e.target.value, page: '0' })} style={SEL(!!fType)}>
                      <option value="">All types</option>
                      <option value="driver">Driver</option>
                      <option value="pim">PIM</option>
                    </select>
                  ) : col.key === 'compliance_status' ? (
                    <select className="filter-select" value={fCompliance} onChange={e => nav({ f_compliance: e.target.value, page: '0' })} style={SEL(!!fCompliance)}>
                      <option value="">All</option>
                      {COMPLIANCE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : col.key === 'tablet_model' ? (
                    <input className="filter-select" value={fModel} onChange={e => nav({ f_model: e.target.value, page: '0' })}
                      placeholder="Filter model…" style={SEL(!!fModel)} />
                  ) : col.key === 'android_os' ? (
                    <select className="filter-select" value={fOs} onChange={e => nav({ f_os: e.target.value, page: '0' })} style={SEL(!!fOs)}>
                      <option value="">All</option>
                      {osValues.map(o => <option key={o} value={o}>{shortOs(o)}</option>)}
                    </select>
                  ) : col.key === 'm360_policy' ? (
                    <select className="filter-select" value={fPolicy} onChange={e => nav({ f_policy: e.target.value, page: '0' })} style={SEL(!!fPolicy)}>
                      <option value="">All</option>
                      {policyValues.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : <div />}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {devices.map((d, i) => {
                const nameKey   = (d.name_key as string | null) ?? ''
                const match     = nameKey.match(/^(\d+)([a-z])$/)
                const vNum      = match ? parseInt(match[1]) : null
                const fleet     = match ? match[2].toUpperCase() : null
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
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} devices · page {page + 1} of {totalPages || 1}</span>
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
