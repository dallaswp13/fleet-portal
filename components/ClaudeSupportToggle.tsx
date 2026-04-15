'use client'
import { useState, useEffect, useRef } from 'react'

/**
 * Claude button in the top bar.
 *
 * Shows:
 *   - green indicator if ANTHROPIC_API_KEY is set ("Claude API is reachable")
 *   - "On" / "Off" chip reflecting whether Responding is enabled (the most
 *     user-visible toggle — it gates whether drivers get auto-replies)
 *
 * Popover content:
 *   - API status (Connected / Not configured)
 *   - Responding ON/OFF toggle — does Claude reply to inbound SMS?
 *   - Execute Actions ON/OFF toggle — can Claude-initiated calls to
 *     /api/maas360/action proceed?  Only applies to autonomous calls
 *     (caller:'claude'); admin button-clicks are never blocked.
 *
 * Both toggles write to public.app_settings via /api/app-settings (migration
 * 034). Changes take effect on the very next webhook/action call — there is
 * no cache on the server.
 */
export default function ClaudeSupportToggle() {
  const [showTooltip, setShowTooltip] = useState(false)
  const [apiConnected, setApiConnected] = useState<boolean | null>(null) // null while loading
  const [responding, setResponding] = useState<boolean | null>(null)
  const [executeActions, setExecuteActions] = useState<boolean | null>(null)
  const [saving, setSaving] = useState<'responding' | 'execute' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Load both the API status (for the green/gray dot) and the app_settings
  // values (for the two toggles) in parallel on mount.
  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/status').then(r => r.json()).catch(() => ({})),
        fetch('/api/app-settings').then(r => r.json()).catch(() => ({})),
      ])
      setApiConnected(!!statusRes?.claude)
      const s = settingsRes?.settings ?? {}
      setResponding(s.claude_responding_enabled === true)
      setExecuteActions(s.claude_execute_actions_enabled === true)
    } catch {
      setApiConnected(false)
      setResponding(false)
      setExecuteActions(false)
    }
  }

  // Close the popover on outside click — otherwise it lingers when you click
  // into a different part of the app, which feels broken.
  useEffect(() => {
    if (!showTooltip) return
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showTooltip])

  async function updateSetting(key: 'claude_responding_enabled' | 'claude_execute_actions_enabled', value: boolean) {
    const which = key === 'claude_responding_enabled' ? 'responding' : 'execute'
    setSaving(which)
    setError(null)

    // Optimistic update so the UI feels instant; revert on failure.
    const prev = key === 'claude_responding_enabled' ? responding : executeActions
    if (key === 'claude_responding_enabled') setResponding(value)
    else setExecuteActions(value)

    try {
      const res = await fetch('/api/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) {
        const msg = await res.text()
        setError(msg.slice(0, 120) || 'Failed to save')
        if (key === 'claude_responding_enabled') setResponding(prev)
        else setExecuteActions(prev)
      }
    } catch {
      setError('Network error')
      if (key === 'claude_responding_enabled') setResponding(prev)
      else setExecuteActions(prev)
    } finally {
      setSaving(null)
    }
  }

  // Button chip reflects Responding state (the more user-visible toggle).
  const chipOn = responding === true
  const loading = apiConnected === null || responding === null || executeActions === null

  return (
    <div ref={popoverRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setShowTooltip(v => !v)}
        title="Claude Support"
        className="btn-icon"
        style={{ height: 32, padding: '0 10px', gap: 5, fontSize: 12, color: chipOn ? 'var(--green)' : 'var(--text3)', opacity: apiConnected ? 1 : 0.6, width: 'auto', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <span style={{ fontWeight: 500 }}>Claude</span>
        {loading ? (
          <span className="spinner" style={{ width: 10, height: 10 }} />
        ) : (
          <span style={{ fontSize: 10, background: chipOn ? 'var(--green)' : 'var(--bg4)', color: chipOn ? '#fff' : 'var(--text3)', padding: '1px 5px', borderRadius: 10 }}>
            {chipOn ? 'On' : 'Off'}
          </span>
        )}
      </button>

      {showTooltip && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '14px 16px',
          fontSize: 12, color: 'var(--text2)', minWidth: 280,
          boxShadow: 'var(--shadow-lg)', zIndex: 200,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Claude Support</div>

          {/* API connection status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: apiConnected ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
            <span style={{ fontSize: 11 }}>Anthropic API: {apiConnected ? 'Connected' : 'Not configured'}</span>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: 12 }} />

          {/* Responding toggle */}
          <ToggleRow
            label="Responding"
            description="Claude replies to driver texts automatically."
            value={responding === true}
            disabled={saving === 'responding' || !apiConnected}
            saving={saving === 'responding'}
            onChange={v => updateSetting('claude_responding_enabled', v)}
          />

          {/* Execute actions toggle */}
          <ToggleRow
            label="Execute Actions"
            description="Claude can reboot devices & run M360 actions autonomously. Admin button-clicks are never affected."
            value={executeActions === true}
            disabled={saving === 'execute' || !apiConnected}
            saving={saving === 'execute'}
            onChange={v => updateSetting('claude_execute_actions_enabled', v)}
          />

          {error && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>
          )}

          {!apiConnected && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              Set ANTHROPIC_API_KEY in Vercel to enable Claude.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToggleRow({
  label, description, value, onChange, disabled, saving,
}: {
  label: string
  description: string
  value: boolean
  disabled: boolean
  saving: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
        <button
          onClick={() => !disabled && onChange(!value)}
          disabled={disabled}
          style={{
            position: 'relative',
            width: 36, height: 20,
            borderRadius: 10,
            background: value ? 'var(--green)' : 'var(--bg4)',
            border: '1px solid var(--border)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            padding: 0,
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
          title={value ? 'On' : 'Off'}
        >
          <span
            style={{
              position: 'absolute',
              top: 1, left: value ? 17 : 1,
              width: 16, height: 16,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left 0.15s',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
          />
          {saving && (
            <span className="spinner" style={{
              position: 'absolute', top: 3, left: value ? 3 : 19,
              width: 12, height: 12, borderTopColor: value ? '#fff' : 'var(--text3)',
            }} />
          )}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}>{description}</div>
    </div>
  )
}
