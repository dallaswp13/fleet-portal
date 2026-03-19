'use client'
import { useState, useCallback, useTransition, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { exportToCsv } from '@/lib/exportCsv'
import VehiclePanel from '@/components/VehiclePanel'
import { useVehiclePanel } from '@/components/useVehiclePanel'
import type { FleetOverview } from '@/types'

interface Props {
  transactions: Record<string,unknown>[]; page: number; perPage: number
  totalPages: number; totalCount: number
  search: string; sort: string; dir: boolean; vehicle: string; fStatus: string
}

const SEL = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent-dim)' : 'var(--bg2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  color: active ? 'var(--accent)' : 'var(--text)',
  fontWeight: active ? 600 : 400,
})

const COLS = [
  { key: 'transaction_date', label: 'Date'        },
  { key: 'location',         label: 'Vehicle'      },
  { key: 'device_name',      label: 'Device'       },
  { key: 'description',      label: 'Description'  },
  { key: 'amount',           label: 'Amount'       },
  { key: 'payment_type',     label: 'Method'       },
  { key: 'status',           label: 'Status'       },
]

export default function TransactionsTable({ transactions, page, perPage, totalPages, totalCount, search, sort, dir, vehicle, fStatus }: Props) {
  const [, startTransition] = useTransition()
  const router   = useRouter()
  const pathname = usePathname()
  const { vehicle: panelVehicle, openByNumber, close } = useVehiclePanel()
  const [localQ, setLocalQ]   = useState(search)
  const [localV, setLocalV]   = useState(vehicle)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocalQ(search) }, [search])
  useEffect(() => { setLocalV(vehicle) }, [vehicle])

  const nav = useCallback((overrides: Record<string, string> = {}) => {
    const base = { q: search, sort, dir: dir ? 'desc' : 'asc', vehicle, page: String(page), per_page: String(perPage), f_status: fStatus }
    const p    = new URLSearchParams({ ...base, ...overrides })
    ;['q','vehicle','f_status'].forEach(k => { if (!p.get(k)) p.delete(k) })
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }, [search, sort, dir, vehicle, page, perPage, fStatus, pathname, router])

  function handleSearch(val: string) {
    setLocalQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => nav({ q: val, page: '0' }), 350)
  }

  function handleVehicle(val: string) {
    setLocalV(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => nav({ vehicle: val, page: '0' }), 350)
  }

  function handleSort(col: string) { nav({ sort: col, dir: sort === col && dir ? 'asc' : 'desc', page: '0' }) }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--accent)', fontSize: 10 }}>{dir ? ' ↓' : ' ↑'}</span>
  }

  function fmtCurrency(v: unknown) {
    const n = parseFloat(String(v ?? '0').replace(/[^0-9.-]/g, ''))
    if (isNaN(n)) return '—'
    return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: n < 0 ? 'var(--red)' : undefined }}>
      {n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}
    </span>
  }

  function fmtDate(v: unknown) {
    if (!v) return '—'
    try { return new Date(String(v)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
    catch { return String(v) }
  }

  const activeFilters = [fStatus].filter(Boolean).length

  return (
    <>
      {panelVehicle && <VehiclePanel vehicle={panelVehicle as unknown as FleetOverview} onClose={close} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-wrap" style={{ flex: '1 1 220px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={localQ} onChange={e => handleSearch(e.target.value)}
            placeholder="Search ID, location, description…" style={{ height: 34 }} />
        </div>
        <div className="search-wrap" style={{ width: 160 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <input value={localV} onChange={e => handleVehicle(e.target.value)}
            placeholder="Filter vehicle…" style={{ height: 34 }} />
        </div>
        {activeFilters > 0 && (
          <button className="btn-secondary btn-sm" style={{ height: 34, fontSize: 11 }}
            onClick={() => nav({ f_status: '', page: '0' })}>
            Clear filter
          </button>
        )}
        <select value={perPage} onChange={e => nav({ per_page: e.target.value, page: '0' })}
          className="btn-secondary toolbar-select">
          {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className="btn-secondary btn-sm" style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={() => exportToCsv('transactions', transactions, COLS.map(c => ({ key: c.key, label: c.label })))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table>
            <thead>
              <tr>{COLS.map(c => (
                <th key={c.key}>
                  <span onClick={() => handleSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {c.label}<SortIcon col={c.key} />
                  </span>
                </th>
              ))}</tr>
              <tr>{COLS.map(col => (
                <th key={col.key} style={{ padding: '3px 6px', background: 'var(--bg3)' }}>
                  {col.key === 'status' ? (
                    <select value={fStatus} onChange={e => nav({ f_status: e.target.value, page: '0' })} style={SEL(!!fStatus)}>
                      <option value="">All statuses</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="REFUNDED">Refunded</option>
                    </select>
                  ) : <div />}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => {
                const locMatch = String(t.location ?? '').match(/(?:cab|vehicle|#)\s*#?\s*(\d{1,4})/i)
                const vNum     = locMatch ? parseInt(locMatch[1]) : null
                const fleet    = String(t.device_name ?? '').replace(/^\*/, '').replace(/^\d+/, '').split('-')[0].toUpperCase() || null
                return (
                  <tr key={i} onClick={() => vNum ? openByNumber(vNum, fleet) : undefined}
                    style={{ cursor: vNum ? 'pointer' : 'default' }}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtDate(t.transaction_date)}</td>
                    <td style={{ fontSize: 12, fontWeight: 500 }}>{String(t.location ?? '—')}</td>
                    <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}>{String(t.device_name ?? '—')}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{String(t.description ?? '—')}</td>
                    <td>{fmtCurrency(t.amount)}</td>
                    <td style={{ fontSize: 12 }}>{String(t.payment_type ?? '—')}</td>
                    <td><span className={`badge ${String(t.status) === 'COMPLETED' ? 'badge-green' : String(t.status) === 'REFUNDED' ? 'badge-red' : 'badge-gray'}`} style={{ fontSize: 10 }}>{String(t.status ?? '—')}</span></td>
                  </tr>
                )
              })}
              {transactions.length === 0 && (
                <tr><td colSpan={COLS.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>No transactions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCount.toLocaleString()} transactions · page {page + 1} of {totalPages || 1}</span>
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
