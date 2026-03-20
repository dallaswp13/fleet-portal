'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { FleetOverview } from '@/types'

interface Props { vehicle: FleetOverview; onClose: () => void; onSaved?: (updated: FleetOverview) => void }

type PanelTab = 'vehicle' | 'tablets' | 'driver' | 'notes' | 'messages' | 'transactions'

interface NoteEntry { text: string; ts: string }

function shortOs(s: string | null | undefined) {
  return s ? s.replace(/^Android\s*/i, '').replace(/\s*\(.*\)/, '').trim() || null : null
}

// Driver — no kiosk
const DRIVER_ACTIONS = [
  { action: 'reboot',         label: 'Reboot',        danger: false },
  { action: 'clear_dispatch', label: 'Clear Dispatch', danger: false },
  { action: 'clear_app_data', label: 'Clear Cache',   danger: false },
  { action: 'support_driver', label: 'Support',        danger: false },
  { action: 'wipe',           label: 'Wipe',           danger: true  },
] as const

// PIM — kiosk + wipe
const PIM_ACTIONS = [
  { action: 'reboot',        label: 'Reboot',    danger: false },
  { action: 'kiosk_enter',   label: 'Kiosk On',  danger: false },
  { action: 'kiosk_exit',    label: 'Kiosk Off', danger: false },
  { action: 'clear_pim_bt',  label: 'Clear BT',  danger: false },
  { action: 'clear_app_data',label: 'Clear Cache',danger: false },
  { action: 'support_pim',   label: 'Support',    danger: false },
  { action: 'wipe',          label: 'Wipe',       danger: true  },
] as const

function StatusDot({ status }: { status: string | null }) {
  const l = (status ?? '').toLowerCase()
  const c = l.startsWith('online') ? '#2ecc71' : l.startsWith('offline') ? '#f39c12' : 'var(--text3)'
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null || value === '') return null
  return (
    <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

function Sec({ label }: { label: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 0 4px' }}>{label}</div>
}

export default function VehiclePanel({ vehicle: v, onClose, onSaved }: Props) {
  const [tab,        setTab]        = useState<PanelTab>('vehicle')
  const [loadingAct, setLoadingAct] = useState<string | null>(null)
  const [actResults, setActResults] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [wipeKey,    setWipeKey]    = useState<string | null>(null)
  // Notes log
  const [noteLog,    setNoteLog]    = useState<NoteEntry[]>(() => {
    try { return v.notes ? JSON.parse(v.notes) : [] } catch { return v.notes ? [{ text: v.notes, ts: '' }] : [] }
  })
  const [newNote,    setNewNote]    = useState('')
  const [savingNote, setSavingNote] = useState(false)
  // Messages
  const [smsLog,     setSmsLog]     = useState<Record<string,unknown>[] | null>(null)
  const [loadingSms, setLoadingSms] = useState(false)
  const [txns,       setTxns]        = useState<Record<string,unknown>[] | null>(null)
  const [loadingTx,  setLoadingTx]   = useState(false)
  const [driver,     setDriver]     = useState<Record<string,unknown> | null | undefined>(undefined)
  const [driverQ,    setDriverQ]    = useState('')
  const [driverList, setDriverList] = useState<Record<string,unknown>[]>([])
  const [driverOpen, setDriverOpen] = useState(false)
  const [savingDrv,  setSavingDrv]  = useState(false)
  const [drvMsg,     setDrvMsg]     = useState<{ok:boolean;msg:string}|null>(null)

  async function act(action: string, deviceId: string | null, prefix: string) {
    if (!deviceId) return
    const key = `${prefix}-${action}`
    if (action === 'wipe' && wipeKey !== key) { setWipeKey(key); return }
    setLoadingAct(key); setWipeKey(null)
    try {
      const res  = await fetch('/api/maas360/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, deviceId, vehicleNumber: v.vehicle_number, confirmed: action === 'wipe' || undefined })
      })
      const data = await res.json()
      setActResults(p => ({ ...p, [key]: { ok: data.success, msg: data.message ?? data.error ?? 'Done' } }))
    } catch { setActResults(p => ({ ...p, [key]: { ok: false, msg: 'Network error' } })) }
    setLoadingAct(null)
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    const entry: NoteEntry = { text: newNote.trim(), ts: new Date().toISOString() }
    const updated = [entry, ...noteLog]
    const sb = createClient()
    const { error } = await sb.from('vehicles')
      .update({ notes: JSON.stringify(updated), updated_at: new Date().toISOString() })
      .eq('id', v.vehicle_id)
    if (!error) {
      setNoteLog(updated)
      setNewNote('')
      onSaved?.({ ...v, notes: JSON.stringify(updated) })
    }
    setSavingNote(false)
  }

  async function loadTransactions() {
    if (txns !== null) return
    setLoadingTx(true)
    const sb = createClient()
    const { data } = await sb.from('transactions')
      .select('*').eq('vehicle_id', v.vehicle_id)
      .order('transaction_date', { ascending: false }).limit(100)
    setTxns(data ?? [])
    setLoadingTx(false)
  }

  async function loadDriver() {
    if (driver !== undefined) return
    const sb = createClient()
    // Find driver currently assigned to this vehicle
    const { data } = await sb.from('drivers').select('*').eq('seated_vehicle_id', v.vehicle_id).maybeSingle()
    setDriver(data ?? null)
  }

  async function searchDrivers(q: string) {
    if (!q) { setDriverList([]); return }
    const sb = createClient()
    const { data } = await sb.from('drivers')
      .select('id,driver_id,name,fleet_id,personal_phone,image_url')
      .ilike('name', `%${q}%`)
      .order('name').limit(20)
    setDriverList(data ?? [])
  }

  async function assignDriver(driverId: string) {
    setSavingDrv(true); setDrvMsg(null)
    const sb = createClient()
    // Remove old assignment
    if (driver) {
      await sb.from('drivers').update({ seated_vehicle_id: null, seated_vehicle_number: null }).eq('id', String(driver.id))
    }
    // Set new assignment
    const { data: d, error } = await sb.from('drivers')
      .update({ seated_vehicle_id: v.vehicle_id, seated_vehicle_number: v.vehicle_number })
      .eq('id', driverId).select('*').single()
    if (error) setDrvMsg({ ok: false, msg: error.message })
    else { setDriver(d); setDrvMsg({ ok: true, msg: 'Driver assigned' }); setDriverOpen(false); setDriverQ('') }
    setSavingDrv(false)
  }

  async function unassignDriver() {
    if (!driver) return
    setSavingDrv(true)
    const sb = createClient()
    await sb.from('drivers').update({ seated_vehicle_id: null, seated_vehicle_number: null }).eq('id', String(driver.id))
    setDriver(null); setSavingDrv(false)
  }

  async function loadSmsLog() {
    if (smsLog !== null) return
    setLoadingSms(true)
    const sb = createClient()
    const { data } = await sb.from('sms_messages').select('*')
      .eq('vehicle_id', v.vehicle_id).order('received_at', { ascending: false }).limit(50)
    setSmsLog(data ?? [])
    setLoadingSms(false)
  }

  // Action buttons rendered below device name
  function ActBtns({ deviceId, prefix, actions }: {
    deviceId: string | null
    prefix: string
    actions: typeof DRIVER_ACTIONS | typeof PIM_ACTIONS
  }) {
    if (!deviceId) return null
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        {(actions as readonly { action: string; label: string; danger: boolean }[]).map(a => {
          const key     = `${prefix}-${a.action}`
          const busy    = loadingAct === key
          const res     = actResults[key]
          const pending = wipeKey === key
          return (
            <button key={a.action}
              onClick={() => act(a.action, deviceId, prefix)}
              disabled={loadingAct !== null}
              title={res ? res.msg : a.label}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${res ? (res.ok ? '#2ecc71' : '#e74c3c') : pending ? '#e74c3c' : a.danger ? 'rgba(231,76,60,0.4)' : 'var(--border)'}`,
                background: res ? (res.ok ? 'rgba(46,204,113,0.12)' : 'rgba(231,76,60,0.12)') : pending ? 'rgba(231,76,60,0.1)' : 'var(--bg3)',
                color: res ? (res.ok ? '#2ecc71' : '#e74c3c') : pending ? '#e74c3c' : a.danger ? '#e74c3c' : 'var(--text2)',
                fontWeight: 500,
              }}>
              {busy ? '…' : pending ? '⚠ confirm' : a.label}
            </button>
          )
        })}
      </div>
    )
  }

  function TabletSection({ title, accent, deviceName, deviceId, model, os, imei, policy, compliance, lastSeen, appVersion, phoneNumber, usageGb, phoneStatus, actions, prefix }: {
    title: string; accent: string
    deviceName?: string|null; deviceId?: string|null
    model?: string|null; os?: string|null; imei?: string|null
    policy?: string|null; compliance?: string|null; lastSeen?: string|null; appVersion?: string|null
    phoneNumber?: string|null; usageGb?: number|null; phoneStatus?: string|null
    actions: typeof DRIVER_ACTIONS | typeof PIM_ACTIONS; prefix: string
  }) {
    const isNon = (compliance ?? '').toLowerCase().includes('non')
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 8, borderBottom: `2px solid ${accent}`, paddingBottom: 4 }}>{title}</div>

        {/* Device name prominently + actions below */}
        {deviceName && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Device Name</div>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{deviceName}</div>
            <ActBtns deviceId={deviceId ?? null} prefix={prefix} actions={actions} />
          </div>
        )}
        {!deviceName && deviceId && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Device ID: {deviceId}</div>
            <ActBtns deviceId={deviceId} prefix={prefix} actions={actions} />
          </div>
        )}

        <Field label="Model"       value={model} />
        <Field label="Android OS"  value={os} />
        <Field label="IMEI"        value={imei} mono />
        <Field label="Policy"      value={policy} />
        <Field label="Compliance"  value={compliance
          ? <span className={`badge ${isNon ? 'badge-red' : 'badge-green'}`}>{compliance}</span>
          : null} />
        <Field label="Last Seen"   value={lastSeen} />
        <Field label="App Version" value={appVersion} />

        {phoneNumber && <>
          <Sec label="Verizon SIM" />
          <Field label="Phone #"    value={phoneNumber} mono />
          <Field label="Status"     value={phoneStatus} />
          {usageGb != null && <Field label="Data Usage" value={<strong>{Number(usageGb).toFixed(2)} GB</strong>} />}
          <a href={`https://businessportal.verizonwireless.com/devices/search?q=${phoneNumber.replace(/\D/g,'')}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: 'var(--accent)', display: 'inline-block', marginTop: 6 }}>
            Manage in Verizon ↗
          </a>
        </>}

        {!deviceName && !deviceId && !phoneNumber && (
          <div style={{ fontSize: 11, color: 'var(--text3)', padding: '8px 0', fontStyle: 'italic' }}>No data linked</div>
        )}
      </div>
    )
  }

  const TABS: { key: PanelTab; label: string }[] = [
    { key: 'vehicle',      label: 'Vehicle'      },
    { key: 'tablets',      label: 'Tablets'      },
    { key: 'driver',       label: 'Driver'       },
    { key: 'notes',        label: 'Notes'        },
    { key: 'messages',     label: 'Messages'     },
    { key: 'transactions', label: 'Transactions' },
  ]

  const totalUsage = (v.monthly_usage_gb ?? 0) + (v.pim_monthly_usage_gb ?? 0)

  return (
    <div className="vehicle-panel-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 48, background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 740, height: 'min(740px,90vh)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>

        {/* Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StatusDot status={v.online_status} />
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>#{v.vehicle_number}</span>
            <span className="badge badge-gray">{(v.fleet_id ?? '').toUpperCase()}</span>
            {v.office && <span className="badge badge-blue">{v.office}</span>}
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{v.online_status?.split(' -')[0] ?? 'Unknown'}</span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg2)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); if (t.key === 'messages') loadSmsLog(); if (t.key === 'driver') loadDriver(); if (t.key === 'transactions') loadTransactions() }}
              style={{ padding: '9px 16px', fontSize: 12, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--accent)' : 'var(--text3)', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 20px' }}>

          {/* VEHICLE */}
          {tab === 'vehicle' && <>
            <Field label="Fleet"    value={(v.fleet_id ?? '').toUpperCase()} />
            <Field label="Office"   value={v.office} />
            <Field label="Status"   value={v.online_status} />
            <Field label="Meter"    value={v.meter_status} />
            <Field label="RFID"     value={v.rfid} mono />
            <Field label="Sheet"    value={v.sheet_tab === 'Active Vehicles' ? 'Active' : v.sheet_tab === 'Test Vehicles' ? 'Test' : v.sheet_tab} />
            {totalUsage > 0 && <Field label="Total Data" value={<strong>{totalUsage.toFixed(2)} GB combined</strong>} />}
          </>}

          {/* TABLETS — side by side */}
          {tab === 'tablets' && (
            <div style={{ display: 'flex', gap: 20 }}>
              <TabletSection
                title="Driver Tablet" accent="var(--blue)" prefix="driver"
                deviceName={v.device_name} deviceId={v.m360_device_id}
                model={v.tablet_model} os={shortOs(v.android_os)} imei={v.imei}
                policy={v.m360_policy} compliance={v.compliance_status}
                lastSeen={v.last_reported} appVersion={v.driver_app_version}
                phoneNumber={v.driver_tablet_phone_number}
                usageGb={v.monthly_usage_gb} phoneStatus={v.phone_status}
                actions={DRIVER_ACTIONS}
              />
              <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
              <TabletSection
                title="PIM Tablet" accent="var(--amber)" prefix="pim"
                deviceName={v.pim_device_name} deviceId={v.pim_m360_device_id}
                model={v.pim_tablet_model}
                os={shortOs(v.pim_android_os)}
                imei={v.pim_imei}
                policy={v.pim_m360_policy}
                compliance={v.pim_compliance_status}
                lastSeen={v.pim_last_reported}
                appVersion={v.pim_app_version}
                phoneNumber={v.pim_phone_number}
                usageGb={v.pim_monthly_usage_gb} phoneStatus={v.pim_phone_status}
                actions={PIM_ACTIONS}
              />
            </div>
          )}

          {/* NOTES — timestamped log */}
          {tab === 'notes' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input value={newNote} onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addNote()}
                  placeholder="Add a note… (Enter to save)"
                  style={{ flex: 1 }} />
                <button className="btn-primary btn-sm" onClick={addNote} disabled={savingNote || !newNote.trim()}>
                  {savingNote ? <span className="spinner" /> : 'Add'}
                </button>
              </div>
              {noteLog.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No notes yet.</div>
              ) : noteLog.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 1 }}>
                    {n.ts ? new Date(n.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Legacy note'}
                  </div>
                  <div style={{ fontSize: 12 }}>{n.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* MESSAGES */}
          {tab === 'messages' && (
            <div>
              {loadingSms ? <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>
                : !smsLog || smsLog.length === 0
                  ? <div className="alert alert-warning">No messages linked to this vehicle. When a driver texts from their personal phone and it is associated with this vehicle via the Inbox, messages will appear here.</div>
                  : smsLog.map((m, i) => (
                    <div key={String(m.id)} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < smsLog.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(String(m.received_at)).toLocaleString()}</span>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{String(m.sender ?? '')}</span>
                      </div>
                      <div style={{ fontSize: 12, background: 'var(--bg3)', padding: '7px 10px', borderRadius: 'var(--radius)', lineHeight: 1.5 }}>{String(m.sms_text ?? '')}</div>
                      {m.result && <div style={{ fontSize: 10, color: m.success ? '#2ecc71' : 'var(--text3)', marginTop: 3 }}>{String(m.result)}</div>}
                    </div>
                  ))
              }
            </div>
          )}

          {/* DRIVER */}
          {tab === 'driver' && (
            <div>
              {/* Current driver */}
              {driver === undefined ? (
                <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>
              ) : driver ? (
                <div style={{ background: 'var(--bg3)', borderRadius: 'var(--radius-lg)', padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                  {driver.image_url
                    ? <img src={`/api/image-proxy?url=${encodeURIComponent(String(driver.image_url ?? ''))}`} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
                    : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
                  }
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{String(driver.name ?? '—')}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>Lease #{String(driver.driver_id ?? '')} · {String(driver.fleet_id ?? '').toUpperCase()}</div>
                    {driver.personal_phone ? <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>{String(driver.personal_phone)}</div> : null}
                  </div>
                  <button className="btn-secondary btn-sm" onClick={unassignDriver} disabled={savingDrv} style={{ fontSize: 11 }}>Unassign</button>
                </div>
              ) : (
                <div className="alert alert-warning" style={{ marginBottom: 16 }}>No driver assigned to this vehicle.</div>
              )}

              {/* Assign different driver */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                {driver ? 'Reassign Driver' : 'Assign Driver'}
              </div>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  placeholder="Search driver by name…"
                  value={driverQ}
                  onFocus={() => setDriverOpen(true)}
                  onBlur={() => setTimeout(() => setDriverOpen(false), 150)}
                  onChange={e => { setDriverQ(e.target.value); searchDrivers(e.target.value); setDriverOpen(true) }}
                  style={{ width: '100%' }}
                />
                {driverOpen && driverList.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, maxHeight: 200, overflowY: 'auto' }}>
                    {driverList.map(d => (
                      <div key={String(d.id)} onMouseDown={() => assignDriver(String(d.id))}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <span style={{ fontWeight: 500 }}>{String(d.name ?? '—')}</span>
                        <span style={{ color: 'var(--text3)', fontSize: 11 }}>#{String(d.driver_id ?? '')} · {String(d.fleet_id ?? '').toUpperCase()}</span>
                        {d.personal_phone ? <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{String(d.personal_phone)}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {drvMsg && <div className={`alert ${drvMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ fontSize: 12, marginTop: 8 }}>{drvMsg.msg}</div>}
            </div>
          )}

          {/* TRANSACTIONS */}
          {tab === 'transactions' && (
            <div>
              {loadingTx ? (
                <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>
              ) : !txns || txns.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>💳</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>No transactions for this vehicle.</div>
                  <a href="/settings?tab=db" style={{ textDecoration: 'none', fontSize: 12, color: 'var(--accent)' }}>
                    Import transactions.csv →
                  </a>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
                    {txns.length} transactions · ${txns.filter(t => t.status !== 'REFUNDED').reduce((s, t) => s + (parseFloat(String(t.amount ?? '0').replace(/[^0-9.-]/g,'')) || 0), 0).toFixed(2)} revenue
                  </div>
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {txns.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                        <div style={{ width: 90, fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                          {t.transaction_date ? new Date(String(t.transaction_date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                        <div style={{ flex: 1, fontSize: 12 }}>{String(t.description ?? t.payment_type ?? '—')}</div>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: String(t.status) === 'REFUNDED' ? 'var(--red)' : undefined }}>
                          {String(t.status) === 'REFUNDED' ? '-' : ''}${Math.abs(parseFloat(String(t.amount ?? '0').replace(/[^0-9.-]/g,'')) || 0).toFixed(2)}
                        </div>
                        <span className={`badge ${String(t.status) === 'COMPLETED' ? 'badge-green' : String(t.status) === 'REFUNDED' ? 'badge-red' : 'badge-gray'}`} style={{ fontSize: 9 }}>
                          {String(t.status ?? '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
