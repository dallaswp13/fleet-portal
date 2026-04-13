'use client'
import { useState, useEffect } from 'react'

type Status = 'checking' | 'ok' | 'error'

interface TwilioDetail {
  auth: boolean
  sender: boolean
  senderType: 'messaging_service' | 'phone_number' | 'none'
}

export default function TwilioStatusIndicator() {
  const [status, setStatus] = useState<Status>('checking')
  const [detail, setDetail] = useState<TwilioDetail | null>(null)
  const [showTip, setShowTip] = useState(false)

  function load() {
    setStatus('checking'); setDetail(null)
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        setStatus(d.twilio ? 'ok' : 'error')
        setDetail(d.twilioDetail ?? null)
      })
      .catch(() => { setStatus('error'); setDetail(null) })
  }

  useEffect(() => { load() }, [])

  const dot: Record<Status, string> = { checking: 'var(--amber)', ok: 'var(--green)', error: 'var(--red)' }
  const label: Record<Status, string> = { checking: 'Checking…', ok: 'Connected', error: 'Unavailable' }

  const senderLabel =
    detail?.senderType === 'messaging_service' ? 'Messaging Service SID' :
    detail?.senderType === 'phone_number'      ? 'Phone Number' :
    'Not set'

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
          borderRadius: 'var(--radius-lg)', padding: '12px 14px',
          fontSize: 12, color: 'var(--text2)',
          boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 260,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: dot[status] }}>
            Twilio SMS — {label[status]}
          </div>
          {detail && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: detail.auth ? 'var(--green)' : 'var(--red)' }} />
                <span>Account SID + Auth Token: <strong>{detail.auth ? 'set' : 'missing'}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: detail.sender ? 'var(--green)' : 'var(--red)' }} />
                <span>Sender: <strong>{senderLabel}</strong></span>
              </div>
            </div>
          )}
          {status === 'error' && (
            <div style={{ color: 'var(--text3)', fontSize: 11, lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              Set in Vercel:<br />
              <code style={{ fontSize: 10 }}>TWILIO_ACCOUNT_SID</code><br />
              <code style={{ fontSize: 10 }}>TWILIO_AUTH_TOKEN</code><br />
              +{' one of:'}<br />
              <code style={{ fontSize: 10 }}>TWILIO_MESSAGING_SERVICE_SID</code> (MG…)<br />
              <code style={{ fontSize: 10 }}>TWILIO_PHONE_NUMBER</code> (+1…)
            </div>
          )}
          <button
            onClick={load}
            style={{ marginTop: 8, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ↺ Recheck
          </button>
        </div>
      )}
    </div>
  )
}
