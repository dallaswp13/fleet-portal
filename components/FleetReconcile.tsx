'use client'

import { useState } from 'react'

type DiffRow = {
  vehicle_number: number
  fleet_id: string
  sheet_tab?: string | null
  from?: string | null
  to?: string
}

type Diff = {
  newVehicles:     DiffRow[]
  missingVehicles: DiffRow[]
  tabChanges:      DiffRow[]
  unchangedCount:  number
  ccsiCount:       number
  dbCount:         number
}

type DryRunResponse = { ok: true; mode: 'dry-run'; filename: string; diff: Diff }
type ApplyResponse  = { ok: boolean; mode: 'apply'; filename: string; diff: Diff; applied: { inserted: number; tabUpdated: number; surrendered: number; errors: string[] } }

export default function FleetReconcile() {
  const [file, setFile]       = useState<File | null>(null)
  const [busy, setBusy]       = useState(false)
  const [dryRun, setDryRun]   = useState<DryRunResponse | null>(null)
  const [applied, setApplied] = useState<ApplyResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function runDry() {
    if (!file) return
    setBusy(true); setError(null); setApplied(null); setDryRun(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', 'dry-run')
      const res = await fetch('/api/import/reconcile', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to reconcile'); return }
      setDryRun(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  async function runApply() {
    if (!file || !dryRun) return
    const n = dryRun.diff.newVehicles.length + dryRun.diff.tabChanges.length + dryRun.diff.missingVehicles.filter(m => m.sheet_tab !== 'Surrenders').length
    if (!confirm(`Apply ${n} changes?\n\n• Insert ${dryRun.diff.newVehicles.length} new vehicles\n• Move ${dryRun.diff.tabChanges.length} between tabs\n• Surrender ${dryRun.diff.missingVehicles.filter(m => m.sheet_tab !== 'Surrenders').length} missing\n\nThis cannot be undone from here.`)) return

    setBusy(true); setError(null); setApplied(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', 'apply')
      const res = await fetch('/api/import/reconcile', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to apply'); return }
      setApplied(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  const diff = dryRun?.diff

  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Fleet Reconciliation</h2>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
        Upload the current <b>CCSI.xlsx</b> to compare against the portal database.
        Dry-run first — no changes are made until you review and click <b>Apply</b>.
        Vehicles missing from CCSI will be marked <b>Surrendered</b> (never deleted).
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="file"
            accept=".xlsx"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setDryRun(null); setApplied(null); setError(null) }}
            disabled={busy}
            style={{ fontSize: 13 }}
          />
          <button
            className="btn-primary btn-sm"
            onClick={runDry}
            disabled={!file || busy}
          >
            {busy && !dryRun ? <><span className="spinner" /> Scanning…</> : '🔍 Dry Run'}
          </button>
          {dryRun && (
            <button
              className="btn-primary btn-sm"
              style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }}
              onClick={runApply}
              disabled={busy}
            >
              {busy ? <><span className="spinner" /> Applying…</> : '⚠ Apply Changes'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {applied && (
        <div className={`alert ${applied.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          <b>Apply complete.</b><br />
          Inserted: {applied.applied.inserted} &nbsp;·&nbsp;
          Tab moved: {applied.applied.tabUpdated} &nbsp;·&nbsp;
          Surrendered: {applied.applied.surrendered}
          {applied.applied.errors.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12 }}>Errors: {applied.applied.errors.join('; ')}</div>
          )}
        </div>
      )}

      {diff && (
        <div className="grid-stats" style={{ marginBottom: 20 }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase' }}>CCSI rows</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.ccsiCount}</div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase' }}>DB rows</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.dbCount}</div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase' }}>Unchanged</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.unchangedCount}</div>
          </div>
          <div className="card" style={{ padding: 14, borderColor: 'var(--green)' }}>
            <div style={{ fontSize: 11, color: 'var(--green)', textTransform: 'uppercase' }}>New</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.newVehicles.length}</div>
          </div>
          <div className="card" style={{ padding: 14, borderColor: 'var(--amber)' }}>
            <div style={{ fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase' }}>Moved</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.tabChanges.length}</div>
          </div>
          <div className="card" style={{ padding: 14, borderColor: 'var(--red)' }}>
            <div style={{ fontSize: 11, color: 'var(--red)', textTransform: 'uppercase' }}>Missing</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{diff.missingVehicles.length}</div>
          </div>
        </div>
      )}

      {diff && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <DiffList title={`New vehicles (${diff.newVehicles.length})`} color="var(--green)" rows={diff.newVehicles.map(r => ({ key: `${r.vehicle_number}${r.fleet_id}`, label: `#${r.vehicle_number}${(r.fleet_id ?? '').toUpperCase()}`, sub: `→ ${r.sheet_tab ?? ''}` }))} />
          <DiffList title={`Tab changes (${diff.tabChanges.length})`}  color="var(--amber)" rows={diff.tabChanges.map(r => ({ key: `${r.vehicle_number}${r.fleet_id}`, label: `#${r.vehicle_number}${(r.fleet_id ?? '').toUpperCase()}`, sub: `${r.from ?? '—'} → ${r.to}` }))} />
          <DiffList title={`Missing from CCSI (${diff.missingVehicles.length})`} color="var(--red)" rows={diff.missingVehicles.map(r => ({ key: `${r.vehicle_number}${r.fleet_id}`, label: `#${r.vehicle_number}${(r.fleet_id ?? '').toUpperCase()}`, sub: `currently: ${r.sheet_tab ?? '—'} → will mark Surrendered` }))} />
        </div>
      )}
    </div>
  )
}

function DiffList({ title, color, rows }: { title: string; color: string; rows: { key: string; label: string; sub: string }[] }) {
  return (
    <div className="card" style={{ padding: 0, borderLeft: `3px solid ${color}` }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ padding: 16, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>None</div>}
        {rows.map(r => (
          <div key={r.key} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.label}</div>
            <div style={{ color: 'var(--text3)', fontSize: 11 }}>{r.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
