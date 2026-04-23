'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/Toaster'

const ACTION_LABELS: Record<string, string> = {
  reboot: 'Reboot', wipe: 'Factory Wipe', kiosk_enter: 'Kiosk Enter',
  kiosk_exit: 'Kiosk Exit', clear_app_data: 'Clear App Data',
  activate_sim: 'Activate SIM', import_ccsi: 'Import CCSI',
  import_devices: 'Import Devices', import_verizon: 'Import Verizon',
  inventory_create: 'Inv. Created', inventory_update: 'Inv. Updated',
  inventory_adjust: 'Inv. Adjusted', inventory_delete: 'Inv. Deleted',
  inventory_card_create: 'Card Created', inventory_card_update: 'Card Updated',
  inventory_card_execute: 'Card Executed', inventory_card_delete: 'Card Deleted',
}

interface AuditLog {
  id: string
  created_at: string
  action: string
  target_type: string
  target_id: string
  vehicle_number: number | null
  user_email: string
  success: boolean
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
}

interface FilterOptions {
  actions: string[]
  targetTypes: string[]
}

const DATE_PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

export default function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ actions: [], targetTypes: [] })

  // Filters
  const [selectedActions, setSelectedActions] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const buildQuery = useCallback((pg: number, format?: string) => {
    const params = new URLSearchParams()
    params.set('page', String(pg))
    params.set('per_page', '50')
    if (selectedActions.length > 0) params.set('action', selectedActions.join(','))
    if (selectedTypes.length > 0) params.set('target_type', selectedTypes.join(','))
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    if (format) params.set('format', format)
    return `/api/audit?${params.toString()}`
  }, [selectedActions, selectedTypes, dateFrom, dateTo])

  const fetchLogs = useCallback(async (pg: number) => {
    setLoading(true)
    try {
      const res = await fetch(buildQuery(pg))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setLogs(data.logs)
      setCount(data.count)
      setPage(data.page)
      setTotalPages(data.totalPages)
      if (data.filterOptions) setFilterOptions(data.filterOptions)
    } catch (err) {
      toast.error('Failed to load audit log', { detail: String(err) })
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => { fetchLogs(0) }, [fetchLogs])

  function applyPreset(days: number) {
    const from = new Date()
    from.setDate(from.getDate() - days)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(new Date().toISOString().slice(0, 10))
  }

  function clearFilters() {
    setSelectedActions([])
    setSelectedTypes([])
    setDateFrom('')
    setDateTo('')
  }

  async function exportCSV() {
    setExporting(true)
    try {
      const res = await fetch(buildQuery(0, 'csv'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CSV exported')
    } catch (err) {
      toast.error('Export failed', { detail: String(err) })
    } finally {
      setExporting(false)
    }
  }

  const hasFilters = selectedActions.length > 0 || selectedTypes.length > 0 || dateFrom || dateTo

  function toggleAction(action: string) {
    setSelectedActions(prev => prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action])
  }

  function toggleType(type: string) {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  function badgeClass(action: string) {
    if (action === 'wipe') return 'badge-red'
    if (action.startsWith('import')) return 'badge-blue'
    if (action.startsWith('inventory')) return 'badge-purple'
    return 'badge-gray'
  }

  /** Build a human-readable detail string from the audit log payload */
  function formatDetails(log: AuditLog): string | null {
    const p = log.payload
    if (!p) return null

    // Inventory card execute — show each item's before → after
    if (log.action === 'inventory_card_execute' && Array.isArray(p.changes)) {
      return (p.changes as { name: string; qty_before: number; qty_after: number; subtracted: number }[])
        .map(c => `${c.name}: ${c.qty_before} → ${c.qty_after} (−${c.subtracted})`)
        .join(', ')
    }
    // Legacy card execute format
    if (log.action === 'inventory_card_execute' && Array.isArray(p.items_subtracted)) {
      return (p.items_subtracted as { subtracted: number; remaining: number }[])
        .map(c => `−${c.subtracted}, ${c.remaining} left`)
        .join('; ')
    }

    // Inventory adjust — show field before → after
    if (log.action === 'inventory_adjust' && p.previous !== undefined) {
      const label = p.name ? String(p.name) : ''
      return `${label}: ${p.previous} → ${p.new_value} (${Number(p.delta) > 0 ? '+' : ''}${p.delta} ${p.field ?? 'new'})`
    }

    // Inventory update — show changed fields
    if (log.action === 'inventory_update' && p.changes && typeof p.changes === 'object') {
      const changes = p.changes as Record<string, { from: unknown; to: unknown }>
      const parts = Object.entries(changes)
        .filter(([k]) => !['updated_at', 'updated_by'].includes(k))
        .map(([k, v]) => {
          const label = k.replace(/_/g, ' ').replace('quantity ', 'qty ')
          return `${label}: ${v.from ?? '—'} → ${v.to ?? '—'}`
        })
      return parts.length > 0 ? `${p.name ? String(p.name) + ' — ' : ''}${parts.join(', ')}` : null
    }

    // Inventory create
    if (log.action === 'inventory_create' && p.name) {
      const parts: string[] = [`"${p.name}"`]
      if (p.quantity_new) parts.push(`new: ${p.quantity_new}`)
      if (p.quantity_used) parts.push(`used: ${p.quantity_used}`)
      return parts.join(', ')
    }

    // Inventory delete
    if (log.action === 'inventory_delete' && p.name) return `Deleted "${p.name}"`

    // Inventory card create/update/delete
    if (log.action.startsWith('inventory_card_') && p.card_name) {
      if (log.action === 'inventory_card_delete') return `Deleted "${p.card_name}"`
      const items = p.items_count ? ` (${p.items_count} items)` : ''
      return `"${p.card_name}"${items}`
    }

    // Import actions
    if (log.action.startsWith('import') && p.filename) {
      const r = log.result as Record<string, unknown> | null
      const total = r?.total ?? ''
      return `${p.filename}${total ? ` — ${total} rows` : ''}${p.skipped ? `, ${p.skipped} skipped` : ''}`
    }

    // M360 device actions (reboot, wipe, etc.)
    if (log.vehicle_number && log.result) {
      const r = log.result as Record<string, unknown>
      return r.message ? String(r.message) : null
    }

    return null
  }

  /** Return a link URL for the log entry, or null if not linkable */
  function getLink(log: AuditLog): string | null {
    if (log.target_type === 'inventory') return '/inventory'
    if (log.vehicle_number) return `/fleet/vehicles?q=${log.vehicle_number}`
    if (log.target_type === 'device') return '/fleet/devices'
    if (log.action.startsWith('import')) return '/settings?tab=data'
    return null
  }

  return (
    <div>
      {/* ── FILTER BAR ── */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* Action type filter */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Action type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {filterOptions.actions.map(a => (
                <button key={a} onClick={() => toggleAction(a)}
                  className={selectedActions.includes(a) ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  style={{ fontSize: 10, padding: '2px 8px' }}>
                  {ACTION_LABELS[a] ?? a}
                </button>
              ))}
              {filterOptions.actions.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Loading…</span>}
            </div>
          </div>

          {/* Target type filter */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Target type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {filterOptions.targetTypes.map(t => (
                <button key={t} onClick={() => toggleType(t)}
                  className={selectedTypes.includes(t) ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  style={{ fontSize: 10, padding: '2px 8px' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Date range</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={{ fontSize: 11, padding: '3px 6px', width: 130 }} />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={{ fontSize: 11, padding: '3px 6px', width: 130 }} />
              {DATE_PRESETS.map(p => (
                <button key={p.days} className="btn-secondary btn-sm"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => applyPreset(p.days)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear / Export */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {hasFilters && (
              <button className="btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={clearFilters}>
                Clear filters
              </button>
            )}
            <button className="btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={exportCSV} disabled={exporting}>
              {exporting ? 'Exporting…' : '📥 Export CSV'}
            </button>
          </div>
        </div>
      </div>

      {/* ── LOG TABLE ── */}
      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {count.toLocaleString()} {hasFilters ? 'matching' : 'total'} actions
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Loading…</span>}
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th><th>Action</th><th>Details</th>
                <th>Vehicle #</th><th>User</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const details = formatDetails(log)
                const link = getLink(log)
                const target = log.target_type === 'inventory' && log.payload?.name
                  ? String(log.payload.name)
                  : log.target_type === 'inventory' && log.payload?.card_name
                    ? String(log.payload.card_name)
                    : log.target_id

                return (
                <tr key={log.id} style={{ cursor: link ? 'pointer' : undefined }}
                  onClick={() => { if (link) window.location.href = link }}>
                  <td className="mono text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className={`badge ${badgeClass(log.action)}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    {link && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 4 }}>→</span>}
                  </td>
                  <td style={{ fontSize: 11, maxWidth: 360, color: 'var(--text2)' }}>
                    <div style={{ fontWeight: 500 }}>{target}</div>
                    {details && (
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4, whiteSpace: 'normal' }}>
                        {details}
                      </div>
                    )}
                  </td>
                  <td>{log.vehicle_number ? <span className="tag">#{log.vehicle_number}</span> : <span className="text-dim">—</span>}</td>
                  <td className="text-dim truncate" style={{ maxWidth: 180, fontSize: 11 }}>{log.user_email}</td>
                  <td><span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>{log.success ? '✓' : '✗'}</span></td>
                </tr>
                )
              })}
              {!loading && logs.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                  {hasFilters ? 'No records match your filters.' : 'No audit records yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page + 1} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-secondary btn-sm"
                disabled={page === 0} onClick={() => fetchLogs(page - 1)}>← Prev</button>
              <button className="btn-secondary btn-sm"
                disabled={page >= totalPages - 1} onClick={() => fetchLogs(page + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
