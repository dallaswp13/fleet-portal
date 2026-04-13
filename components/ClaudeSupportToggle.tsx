'use client'
import { useState, useEffect } from 'react'

export default function ClaudeSupportToggle() {
  const [showTooltip, setShowTooltip] = useState(false)
  const [status, setStatus] = useState<{ claude: boolean; checking: boolean }>({ claude: false, checking: true })

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setStatus({ claude: d.claude ?? false, checking: false }))
      .catch(() => setStatus({ claude: false, checking: false }))
  }, [])

  const isOn = status.claude

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setShowTooltip(v => !v)}
        title="Claude Support Status"
        className="btn-icon"
        style={{ height: 32, padding: '0 10px', gap: 5, fontSize: 12, color: isOn ? 'var(--green)' : 'var(--text3)', opacity: isOn ? 1 : 0.6, width: 'auto', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <span style={{ fontWeight: 500 }}>Claude</span>
        {status.checking ? (
          <span className="spinner" style={{ width: 10, height: 10 }} />
        ) : (
          <span style={{ fontSize: 10, background: isOn ? 'var(--green)' : 'var(--bg4)', color: isOn ? '#fff' : 'var(--text3)', padding: '1px 5px', borderRadius: 10 }}>
            {isOn ? 'On' : 'Off'}
          </span>
        )}
      </button>
      {showTooltip && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '12px 16px',
          fontSize: 12, color: 'var(--text2)', minWidth: 220,
          boxShadow: 'var(--shadow-lg)', zIndex: 200,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Claude Support Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.claude ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
            <span>Anthropic API: {status.claude ? 'Connected' : 'Not configured'}</span>
          </div>
          {!status.claude && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              ANTHROPIC_API_KEY needed in Vercel.
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
            Powers SMS intent parsing, translation, and automated replies.
          </div>
        </div>
      )}
    </div>
  )
}
