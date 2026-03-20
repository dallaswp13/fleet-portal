'use client'
import { useState, useEffect } from 'react'

interface Stat {
  label: string
  value: number
  sub: string
  color?: string
  href: string
}

interface Props { stats: Stat[] }

const ALL_KEYS = ['Total Vehicles','Online','Offline','Inactive','Devices','Verizon Lines']
const STORAGE_KEY = 'dashboard-visible-stats'

export default function DashboardStats({ stats }: Props) {
  const [visible,    setVisible]    = useState<string[]>(ALL_KEYS)
  const [editMode,   setEditMode]   = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setVisible(JSON.parse(stored))
    } catch {}
  }, [])

  function toggleStat(label: string) {
    const next = visible.includes(label)
      ? visible.filter(k => k !== label)
      : [...visible, label]
    setVisible(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  const shown = stats.filter(s => visible.includes(s.label))

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn-ghost btn-sm" onClick={() => setEditMode(e => !e)}
          style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          {editMode ? 'Done' : 'Customize'}
        </button>
      </div>

      {editMode && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '12px 16px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center'
        }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Show:</span>
          {stats.map(s => (
            <button key={s.label} onClick={() => toggleStat(s.label)}
              style={{
                height: 30, padding: '0 10px', fontSize: 11, borderRadius: 'var(--radius)',
                background: visible.includes(s.label) ? 'var(--accent)' : 'var(--bg3)',
                border: `1px solid ${visible.includes(s.label) ? 'var(--accent)' : 'var(--border)'}`,
                color: visible.includes(s.label) ? '#0a0c0f' : 'var(--text2)',
                cursor: 'pointer', fontWeight: visible.includes(s.label) ? 600 : 400,
              }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid-stats">
        {shown.map(s => (
          <a key={s.label} href={s.href} className="stat-card-link">
            <div className="stat-card stat-card-hover">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={s.color ? { color: s.color } : {}}>{s.value.toLocaleString()}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
