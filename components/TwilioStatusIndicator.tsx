'use client'
import { useState, useEffect } from 'react'

type Status = 'checking' | 'ok' | 'error'

export default function TwilioStatusIndicator() {
  const [status,  setStatus]  = useState<Status>('checking')
  const [message, setMessage] = useState('')
  const [showTip, setShowTip] = useState(false)

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        setStatus(d.twilio ? 'ok' : 'error')
        setMessage(d.twilio ? 'Twilio SMS connected' : 'Twilio credentials not configured in Vercel')
      })
      .catch(() => { setStatus('error'); setMessage('Could not reach API') })
  }, [])

  const dot: Record<Status, string> = { checking: 'var(--amber)', ok: 'var(--green)', error: 'var(--red)' }
  const label: Record<Status, string> = { checking: 'Checking…', ok: 'Connected', error: 'Unavailable' }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setShowTip(v => !v)}
        className="btn-icon"
        style={{ height: 32, padding: '0 10px', gap: 6, fontSize: 12, color: 'var(--text3)', width: 'auto', display: 'flex', alignItems: 'center' }}
        title={`Twilio SMS: ${label[status]}`}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>SMS</span>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: dot[status],
          boxShadow: status === 'ok' ? `0 0 0 2px color-mix(in srgb, var(--green) 20%, transparent)` : undefined,
          flexShrink: 0,
        }} />
      </button>

      {showTip && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '10px 14px',
          fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 200,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: dot[status] }}>
            Twilio SMS — {label[status]}
          </div>
          {message && (
            <div style={{ color: 'var(--text3)', fontSize: 11, maxWidth: 260, whiteSpace: 'normal', lineHeight: 1.5 }}>
              {message}
            </div>
          )}
          <button
            onClick={() => { setStatus('checking'); setMessage('');
              fetch('/api/status').then(r => r.json())
                .then(d => { setStatus(d.twilio ? 'ok' : 'error'); setMessage(d.twilio ? 'Twilio SMS connected' : 'Twilio credentials not configured') })
                .catch(() => { setStatus('error'); setMessage('Could not reach API') })
            }}
            style={{ marginTop: 8, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ↺ Recheck
          </button>
        </div>
      )}
    </div>
  )
}
