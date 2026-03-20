'use client'
import { useState } from 'react'

export default function ClaudeSupportToggle() {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setShowTooltip(v => !v)}
        title="Claude Support (requires MaaS360 API)"
        className="btn-icon"
        style={{ height: 32, padding: '0 10px', gap: 5, fontSize: 12, color: 'var(--text3)', opacity: 0.6, width: 'auto', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <span style={{ fontWeight: 500 }}>Claude</span>
        <span style={{ fontSize: 10, background: 'var(--bg4)', padding: '1px 5px', borderRadius: 10 }}>Off</span>
      </button>
      {showTooltip && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '10px 14px',
          fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-lg)', zIndex: 200,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Claude Support is disabled</div>
          <div style={{ color: 'var(--text3)' }}>Configure MaaS360 API to enable</div>
          <a href="/api/maas360/test" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-block', marginTop: 6 }}>
            Test MaaS360 connection →
          </a>
        </div>
      )}
    </div>
  )
}
