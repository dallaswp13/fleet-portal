'use client'
import { useState, useEffect } from 'react'

interface Balances {
  twilio: { ok: boolean; balance: string | null; currency: string | null; error: string | null }
  anthropic: { ok: boolean; error: string | null }
}

function formatCurrency(amount: string | null, currency: string | null): string {
  if (!amount) return '—'
  const num = parseFloat(amount)
  if (isNaN(num)) return amount
  const sym = (currency ?? 'USD') === 'USD' ? '$' : currency ?? ''
  return `${sym}${num.toFixed(2)}`
}

function balanceColor(amount: string | null): string {
  if (!amount) return 'var(--text3)'
  const num = parseFloat(amount)
  if (isNaN(num)) return 'var(--text3)'
  if (num < 5)  return 'var(--red)'
  if (num < 20) return 'var(--amber)'
  return 'var(--green)'
}

export default function BalanceIndicator() {
  const [data, setData] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTip, setShowTip] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/status/balances')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }

  useEffect(() => {
    load()
    // Refresh every 10 minutes
    const iv = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(iv)
  }, [])

  const twilioBalance = data?.twilio?.balance
  const twilioOk      = data?.twilio?.ok ?? false
  const anthropicOk   = data?.anthropic?.ok ?? false

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setShowTip(v => !v)}
        className="btn-icon"
        style={{ height: 32, padding: '0 10px', gap: 6, fontSize: 11, color: 'var(--text3)', width: 'auto', display: 'flex', alignItems: 'center' }}
        title="API account balances"
      >
        {loading ? (
          <span className="spinner" style={{ width: 12, height: 12 }} />
        ) : (
          <>
            <span style={{ fontWeight: 600, color: 'var(--text2)', fontSize: 11 }}>API</span>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: (twilioOk && anthropicOk) ? 'var(--green)' : (!twilioOk && !anthropicOk) ? 'var(--red)' : 'var(--amber)',
              flexShrink: 0,
            }} />
            {twilioOk && twilioBalance && (
              <span style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: balanceColor(twilioBalance),
              }}>
                {formatCurrency(twilioBalance, data?.twilio?.currency ?? 'USD')}
              </span>
            )}
          </>
        )}
      </button>

      {showTip && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '14px 16px',
          fontSize: 12, color: 'var(--text2)',
          boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 280,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 13, color: 'var(--text)' }}>
            API Accounts
          </div>

          {/* Twilio */}
          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: twilioOk ? 'var(--green)' : 'var(--red)',
                }} />
                <span style={{ fontWeight: 600 }}>Twilio SMS</span>
              </div>
              {twilioOk && twilioBalance && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
                  color: balanceColor(twilioBalance),
                }}>
                  {formatCurrency(twilioBalance, data?.twilio?.currency ?? 'USD')}
                </span>
              )}
            </div>
            {twilioOk ? (
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                {parseFloat(twilioBalance ?? '0') < 10
                  ? '⚠️ Balance is low — top up at twilio.com/console'
                  : 'Account funded and active'}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--red)' }}>
                {data?.twilio?.error === 'credentials_missing' ? 'TWILIO_ACCOUNT_SID / AUTH_TOKEN not set' : `Error: ${data?.twilio?.error}`}
              </div>
            )}
          </div>

          {/* Anthropic */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: anthropicOk ? 'var(--green)' : 'var(--red)',
                }} />
                <span style={{ fontWeight: 600 }}>Anthropic (Claude)</span>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: anthropicOk ? 'var(--green)' : 'var(--red)',
              }}>
                {anthropicOk ? 'Active' : 'Error'}
              </span>
            </div>
            {anthropicOk ? (
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                API key valid — check balance at{' '}
                <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  console.anthropic.com
                </a>
              </div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--red)' }}>
                {data?.anthropic?.error === 'key_missing' ? 'ANTHROPIC_API_KEY not set' : data?.anthropic?.error === 'invalid_key' ? 'API key is invalid or expired' : `Error: ${data?.anthropic?.error}`}
              </div>
            )}
          </div>

          <button
            onClick={load}
            style={{ marginTop: 12, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ↺ Refresh
          </button>
        </div>
      )}
    </div>
  )
}
