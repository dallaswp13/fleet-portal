'use client'
import { useState, useEffect, useRef } from 'react'

export interface ColDef { key: string; label: string; defaultVisible?: boolean }

interface Props {
  storageKey: string
  allColumns: ColDef[]
  onChange: (visible: string[]) => void
  height?: number
}

export function useColumnVisibility(storageKey: string, allColumns: ColDef[]) {
  const defaults = allColumns.filter(c => c.defaultVisible !== false).map(c => c.key)
  const [visible, setVisible] = useState<string[]>(defaults)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) setVisible(JSON.parse(stored))
    } catch {}
  }, [storageKey])

  function save(cols: string[]) {
    setVisible(cols)
    try { localStorage.setItem(storageKey, JSON.stringify(cols)) } catch {}
  }

  return { visible, save }
}

export default function ColumnPicker({ storageKey, allColumns, onChange, height = 32 }: Props) {
  const defaults  = allColumns.filter(c => c.defaultVisible !== false).map(c => c.key)
  const [open, setOpen]         = useState(false)
  const [cols, setCols]         = useState<string[]>(defaults)
  const [dragging, setDragging] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) { const parsed = JSON.parse(stored); setCols(parsed); onChange(parsed) }
      else onChange(defaults)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(key: string) {
    const next = cols.includes(key) ? cols.filter(k => k !== key) : [...cols, key]
    setCols(next); onChange(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }

  function onDragStart(key: string) { setDragging(key) }
  function onDragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    if (!dragging || dragging === key) return
    const from = cols.indexOf(dragging)
    const to   = cols.indexOf(key)
    if (from === -1 || to === -1) return
    const next = [...cols]
    next.splice(from, 1)
    next.splice(to, 0, dragging)
    setCols(next); onChange(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }

  function resetDefaults() {
    setCols(defaults); onChange(defaults)
    try { localStorage.setItem(storageKey, JSON.stringify(defaults)) } catch {}
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn-secondary btn-sm"
        onClick={() => setOpen(o => !o)}
        style={{ height, display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Columns
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50,
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', width: 220, padding: '8px 0'
        }}>
          <div style={{ padding: '6px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Columns</span>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={resetDefaults}>Reset</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', padding: '6px 12px 2px' }}>Drag to reorder</div>
          {allColumns.map(col => (
            <div key={col.key}
              draggable onDragStart={() => onDragStart(col.key)} onDragOver={e => onDragOver(e, col.key)} onDragEnd={() => setDragging(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'grab',
                background: dragging === col.key ? 'var(--bg4)' : 'transparent',
                borderLeft: dragging === col.key ? '2px solid var(--accent)' : '2px solid transparent'
              }}
              onClick={() => toggle(col.key)}
            >
              <div style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: 'pointer',
                background: cols.includes(col.key) ? 'var(--accent)' : 'transparent',
                border: `1px solid ${cols.includes(col.key) ? 'var(--accent)' : 'var(--border2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {cols.includes(col.key) && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#0a0c0f" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
              </div>
              <span style={{ fontSize: 12, color: cols.includes(col.key) ? 'var(--text)' : 'var(--text2)', userSelect: 'none' }}>{col.label}</span>
              <span style={{ marginLeft: 'auto', opacity: 0.3, fontSize: 11 }}>⠿</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
