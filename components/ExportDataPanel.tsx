'use client'
import { useState, useEffect } from 'react'

interface FieldDef { key: string; label: string; group: string }

const DEFAULT_FIELDS = new Set([
  'vehicle_number','fleet_id','driver_name','driver_lease',
  'device_name','m360_device_id','phone_number',
  'pim_device_name','pim_m360_device_id','pim_phone_number_verizon',
])

const STORAGE_KEY = 'fleet-export-fields'

function loadSavedFields(): Set<string> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const arr = JSON.parse(saved)
      if (Array.isArray(arr) && arr.length > 0) return new Set(arr)
    }
  } catch { /* ignore */ }
  return null
}

function saveFieldPrefs(selected: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)))
  } catch { /* ignore */ }
}

export default function ExportDataPanel() {
  const [fields,   setFields]   = useState<FieldDef[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_FIELDS))
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/export', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setFields(d.fields ?? [])
        // Restore saved preferences, falling back to defaults
        const saved = loadSavedFields()
        if (saved) setSelected(saved)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      saveFieldPrefs(next)
      return next
    })
  }

  function selectAll()  { const s = new Set(fields.map(f => f.key)); setSelected(s); saveFieldPrefs(s) }
  function selectNone() { const s = new Set<string>(); setSelected(s); saveFieldPrefs(s) }
  function selectDefaults() { const s = new Set(DEFAULT_FIELDS); setSelected(s); saveFieldPrefs(s) }

  function download() {
    const keys = fields.filter(f => selected.has(f.key)).map(f => f.key).join(',')
    window.open(`/api/export?fields=${keys}`, '_blank')
  }

  // Group fields
  const groups = fields.reduce<Record<string, FieldDef[]>>((acc, f) => {
    (acc[f.group] ??= []).push(f)
    return acc
  }, {})

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><span className="spinner" style={{ width: 20, height: 20 }} /></div>

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Export Fleet Data</h2>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Choose which fields to include in your Excel export.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn-secondary btn-sm" onClick={selectAll}>Select All</button>
        <button className="btn-secondary btn-sm" onClick={selectNone}>Clear All</button>
        <button className="btn-secondary btn-sm" onClick={selectDefaults}>Defaults</button>
        <span style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
          {selected.size} of {fields.length} fields selected
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        {Object.entries(groups).map(([group, gFields]) => (
          <div key={group} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontSize: 12, fontWeight: 600, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>
              {group}
            </div>
            <div style={{ padding: '8px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
              {gFields.map(f => (
                <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '3px 0' }}>
                  <input type="checkbox" checked={selected.has(f.key)} onChange={() => toggle(f.key)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                  <span style={{ color: selected.has(f.key) ? 'var(--text)' : 'var(--text3)' }}>{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" onClick={download} disabled={selected.size === 0}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download Fleet Export (.xlsx)
      </button>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
        Data is pulled from the fleet_overview view. Make sure your database is up to date before exporting.
      </div>
    </div>
  )
}
