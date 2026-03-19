'use client'
import { useState, useRef } from 'react'

interface Props { value: number; max: number }

export default function UsageMeter({ value, max }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const ref           = useRef<HTMLDivElement>(null)

  const pct   = max > 0 ? Math.min(value / max, 1) : 0
  const size  = 28
  const s     = 3
  const r     = (size - s) / 2
  const circ  = 2 * Math.PI * r
  const dash  = pct * circ
  const color = pct >= 0.7 ? '#e74c3c' : pct >= 0.3 ? '#f39c12' : '#2ecc71'

  if (value === 0 || value == null) return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'default' }}
      onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY })}
      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setTip(null)}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={s} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={s}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 11, color, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
        {value.toFixed(1)}
      </span>
      {tip && (
        <div style={{
          position: 'fixed', left: tip.x + 12, top: tip.y - 32,
          background: 'var(--bg4)', border: '1px solid var(--border2)',
          borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--text)',
          whiteSpace: 'nowrap', zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <span style={{ color, fontWeight: 600 }}>{value.toFixed(2)} GB</span>
          <span style={{ color: 'var(--text3)', marginLeft: 6 }}>of {max} GB · {(pct * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  )
}
