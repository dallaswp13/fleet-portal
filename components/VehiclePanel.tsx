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

const DRIVER_ACTIONS = [
  { action: 'reboot',         label: 'Reboot',         danger: false },
  { action: 'clear_dispatch', label: 'Clear Dispatch',  danger: false },
  { action: 'clear_app_data', label: 'Clear Cache',     danger: false },
  { action: 'support_driver', label: 'Support',         danger: false },
  { action: 'wipe',           label: 'Wipe',            danger: true  },
] as const

const PIM_ACTIONS = [
  { action: 'reboot',         label: 'Reboot',          danger: false },
  { action: 'kiosk_enter',    label: 'Kiosk On',        danger: false },
  { action: 'kiosk_exit',     label: 'Kiosk Off',       danger: false },
  { action: 'clear_pim_bt',   label: 'Clear BT',        danger: false },
  { action: 'clear_app_data', label: 'Clear Cache',     danger: false },
  { action: 'support_pim',    label: 'Support',         danger: false },
  { action: 'wipe',           label: 'Wipe',            danger: true  },
] as const

// ── Shared UI ──────────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', width: 130, flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : undefined, fontWeight: 500, wordBreak: 'break-all', flex: 1 }}>{value}</div>
    </div>
  )
}

function Sec({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '18px 0 6px' }}>
      {label}
    </div>
  )
}

function StatusDot({ status }: { status: string | null }) {
  const l = (status ?? '').toLowerCase()
  const c = l.startsWith('online') ? 'var(--green)' : l.startsWith('offline') ? 'var(--amber)' : 'var(--text3)'
  return <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 0 3px ${c}22` }} />
}

// ── Main component ─────────────────────────────────────────────────────────

export default function VehiclePanel({ vehicle: v, onClose, onSaved }: Props) {
  const [tab,        setTab]        = useState<PanelTab>('vehicle')
  const [loadingAct, setLoadingAct] = useState<string | null>(null)
  const [actResults, setActResults] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [wipeKey,    setWipeKey]    = useState<string | null>(null)
  const [noteLog,    setNoteLog]    = useState<NoteEntry[]>(() => {
    try { return v.notes ? JSON.parse(v.notes) : [] } catch { return v.notes ? [{ text: v.notes, ts: '' }] : [] }
  })
  const [newNote,    setNewNote]    = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [smsLog,     setSmsLog]     = useState<Record<string,unknown>[] | null>(null)
  const [loadingSms, setLoadingSms] = useState(false)
  const [txns,       setTxns]       = useState<Record<string,unknown>[] | null>(null)
  const [loadingTx,  setLoadingTx]  = useState(false)
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
    if (!error) { setNoteLog(updated); setNewNote(''); onSaved?.({ ...v, notes: JSON.stringify(updated) }) }
    setSavingNote(false)
  }

  async function loadTransactions() {
    if (txns !== null) return
    setLoadingTx(true)
    const sb = createClient()
    const { data } = await sb.from('transactions').select('*').eq('vehicle_id', v.vehicle_id)
      .order('transaction_date', { ascending: false }).limit(100)
    setTxns(data ?? []); setLoadingTx(false)
  }

  async function loadDriver() {
    if (driver !== undefined) return
    const sb = createClient()
    const { data } = await sb.from('drivers').select('*').eq('seated_vehicle_id', v.vehicle_id).maybeSingle()
    setDriver(data ?? null)
  }

  async function searchDrivers(q: string) {
    if (!q) { setDriverList([]); return }
    const sb = createClient()
    const { data } = await sb.from('drivers').select('id,driver_id,name,fleet_id,personal_phone,image_url')
      .ilike('name', `%${q}%`).order('name').limit(20)
    setDriverList(data ?? [])
  }

  async function assignDriver(driverId: string) {
    setSavingDrv(true); setDrvMsg(null)
    const sb = createClient()
    if (driver) await sb.from('drivers').update({ seated_vehicle_id: null, seated_vehicle_number: null }).eq('id', String(driver.id))
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
    setSmsLog(data ?? []); setLoadingSms(false)
  }

  function ActBtns({ deviceId, prefix, actions }: {
    deviceId: string | null; prefix: string
    actions: typeof DRIVER_ACTIONS | typeof PIM_ACTIONS
  }) {
    if (!deviceId) return null
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {(actions as readonly { action: string; label: string; danger: boolean }[]).map(a => {
          const key     = `${prefix}-${a.action}`
          const busy    = loadingAct === key
          const res     = actResults[key]
          const pending = wipeKey === key
          return (
            <button key={a.action} onClick={() => act(a.action, deviceId, prefix)}
              disabled={loadingAct !== null}
              title={res ? res.msg : a.label}
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 500,
                border: `1px solid ${res ? (res.ok ? 'var(--green)' : 'var(--red)') : pending ? 'var(--red)' : a.danger ? 'rgba(231,76,60,0.4)' : 'var(--border)'}`,
                background: res ? (res.ok ? 'var(--green-bg)' : 'var(--red-bg)') : pending ? 'var(--red-bg)' : 'var(--bg3)',
                color: res ? (res.ok ? 'var(--green)' : 'var(--red)') : pending ? 'var(--red)' : a.danger ? 'var(--red)' : 'var(--text2)',
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
    const hasData = deviceName || deviceId || phoneNumber
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${accent}` }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{title}</span>
          {appVersion && <span className="badge" style={{ background: `${accent}18`, color: accent, fontSize: 11 }}>v{appVersion}</span>}
        </div>

        {!hasData ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: '12px 0' }}>No data linked</div>
        ) : <>
          {/* Device name + actions */}
          {(deviceName || deviceId) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>Device</div>
              <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{deviceName ?? deviceId}</div>
              <ActBtns deviceId={deviceId ?? null} prefix={prefix} actions={actions} />
            </div>
          )}

          <Field label="Model"       value={model} />
          <Field label="Android OS"  value={os} />
          <Field label="IMEI"        value={imei} mono />
          <Field label="Policy"      value={policy} />
          <Field label="Compliance"  value={compliance
            ? <span className={`badge ${isNon ? 'badge-red' : 'badge-green'}`}>{compliance}</span>
            : null} />
          <Field label="Last Seen"   value={lastSeen ? new Date(lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null} />

          {phoneNumber && <>
            <Sec label="Verizon SIM" />
            <Field label="Phone #"    value={<span style={{ fontFamily: 'var(--font-mono)' }}>{phoneNumber}</span>} />
            <Field label="Status"     value={phoneStatus} />
            <Field label="Data Usage" value={usageGb != null ? <strong>{Number(usageGb).toFixed(2)} GB</strong> : null} />
            <a href={`https://businessportal.verizonwireless.com/devices/search?q=${phoneNumber.replace(/\D/g,'')}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-block', marginTop: 8 }}>
              Manage in Verizon ↗
            </a>
          </>}
        </>}
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
  const statusLabel = v.online_status?.split(' -')[0] ?? 'Unknown'
  const statusColor = statusLabel.toLowerCase().startsWith('online') ? 'var(--green)' : statusLabel.toLowerCase().startsWith('offline') ? 'var(--amber)' : 'var(--text3)'

  return (
    <div className="vehicle-panel-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 48, background: 'rgba(0,0,0,0.6)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 780, height: 'min(780px,92vh)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }} className="vehicle-panel-box">

        {/* ── Header ───────────────────────────────────────────── */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--bg3)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot status={v.online_status} />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>#{v.vehicle_number}</span>
                <span className="badge badge-gray" style={{ fontSize: 12 }}>{(v.fleet_id ?? '').toUpperCase()}</span>
                {v.office && <span className="badge badge-blue" style={{ fontSize: 12 }}>{v.office}</span>}
              </div>
              <div style={{ fontSize: 12, color: statusColor, fontWeight: 500, marginTop: 2 }}>{statusLabel}</div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg2)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); if (t.key === 'messages') loadSmsLog(); if (t.key === 'driver') loadDriver(); if (t.key === 'transactions') loadTransactions() }}
              style={{ padding: '11px 18px', fontSize: 13, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--accent)' : 'var(--text3)', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ──────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>

          {/* VEHICLE */}
          {tab === 'vehicle' && <>
            <Field label="Fleet"      value={(v.fleet_id ?? '').toUpperCase()} />
            <Field label="Office"     value={v.office} />
            <Field label="Status"     value={<span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>} />
            <Field label="Meter"      value={v.meter_status} />
            <Field label="RFID"       value={v.rfid} mono />
            <Field label="Sheet"      value={
              v.sheet_tab === 'Active Vehicles' ? <span className="badge badge-green">Active</span>
              : v.sheet_tab === 'Test Vehicles' ? <span className="badge badge-amber">Test</span>
              : v.sheet_tab === 'Surrenders'    ? <span className="badge badge-red">Surrendered</span>
              : v.sheet_tab
            } />
            {totalUsage > 0 && <Field label="Combined Data" value={<strong>{totalUsage.toFixed(2)} GB this cycle</strong>} />}
          </>}

          {/* TABLETS */}
          {tab === 'tablets' && (
            <div style={{ display: 'flex', gap: 28 }}>
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
                model={v.pim_tablet_model} os={shortOs(v.pim_android_os)} imei={v.pim_imei}
                policy={v.pim_m360_policy} compliance={v.pim_compliance_status}
                lastSeen={v.pim_last_reported} appVersion={v.pim_app_version}
                phoneNumber={v.pim_phone_number}
                usageGb={v.pim_monthly_usage_gb} phoneStatus={v.pim_phone_status}
                actions={PIM_ACTIONS}
              />
            </div>
          )}

          {/* NOTES */}
          {tab === 'notes' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input value={newNote} onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addNote()}
                  placeholder="Add a note… (Enter to save)" style={{ flex: 1 }} />
                <button className="btn-primary btn-sm" onClick={addNote} disabled={savingNote || !newNote.trim()}>
                  {savingNote ? <span className="spinner" /> : 'Add'}
                </button>
              </div>
              {noteLog.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No notes yet.</div>
              ) : noteLog.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 2, minWidth: 110 }}>
                    {n.ts ? new Date(n.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Legacy'}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>{n.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* DRIVER */}
          {tab === 'driver' && (
            <div>
              {driver === undefined ? (
                <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>
              ) : driver ? (
                <div style={{ background: 'var(--bg3)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
                  {driver.image_url
                    ? <img src={`/api/image-proxy?url=${encodeURIComponent(String(driver.image_url ?? ''))}`} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }} />
                    : <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>👤</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{String(driver.name ?? '—')}</span>
                      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>#{String(driver.driver_id ?? '')}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{String(driver.fleet_id ?? '').toUpperCase()} Fleet</div>
                    {driver.personal_phone ? <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text2)', marginTop: 2 }}>{String(driver.personal_phone)}</div> : null}
                  </div>
                  <button className="btn-secondary btn-sm" onClick={unassignDriver} disabled={savingDrv}>Unassign</button>
                </div>
              ) : (
                <div className="alert alert-warning" style={{ marginBottom: 20 }}>No driver assigned to this vehicle.</div>
              )}

              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                {driver ? 'Reassign Driver' : 'Assign Driver'}
              </div>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input placeholder="Search driver by name…" value={driverQ}
                  onFocus={() => setDriverOpen(true)}
                  onBlur={() => setTimeout(() => setDriverOpen(false), 150)}
                  onChange={e => { setDriverQ(e.target.value); searchDrivers(e.target.value); setDriverOpen(true) }}
                  style={{ width: '100%' }} />
                {driverOpen && driverList.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, maxHeight: 220, overflowY: 'auto' }}>
                    {driverList.map(d => (
                      <div key={String(d.id)} onMouseDown={() => assignDriver(String(d.id))}
                        style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <span style={{ fontWeight: 600 }}>{String(d.name ?? '—')}</span>
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>#{String(d.driver_id ?? '')}</span>
                        <span style={{ color: 'var(--text3)', fontSize: 11, marginLeft: 'auto' }}>{String(d.fleet_id ?? '').toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {drvMsg && <div className={`alert ${drvMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 8 }}>{drvMsg.msg}</div>}
            </div>
          )}

          {/* MESSAGES */}
          {tab === 'messages' && (
            <div>
              {loadingSms ? <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>
                : !smsLog || smsLog.length === 0
                  ? <div className="alert alert-warning">No messages linked to this vehicle. Messages from a driver&apos;s personal phone will appear here once associated via the Inbox.</div>
                  : smsLog.map((m, i) => (
                    <div key={String(m.id)} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < smsLog.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(String(m.received_at)).toLocaleString()}</span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}>{String(m.sender ?? '')}</span>
                      </div>
                      <div style={{ fontSize: 13, background: 'var(--bg3)', padding: '9px 12px', borderRadius: 'var(--radius)', lineHeight: 1.5 }}>{String(m.sms_text ?? '')}</div>
                      {m.result && <div style={{ fontSize: 11, color: m.success ? 'var(--green)' : 'var(--text3)', marginTop: 4 }}>{String(m.result)}</div>}
                    </div>
                  ))
              }
            </div>
          )}

          {/* TRANSACTIONS */}
          {tab === 'transactions' && (
            <div>
              {loadingTx ? (
                <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>
              ) : !txns || txns.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>💳</div>
                  <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 16 }}>No transactions for this vehicle.</div>
                  <a href="/settings?tab=db" style={{ textDecoration: 'none', fontSize: 13, color: 'var(--accent)' }}>Import transactions.csv →</a>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, fontWeight: 500 }}>
                    {txns.length} transactions · ${txns.filter(t => t.status !== 'REFUNDED').reduce((s, t) => s + (parseFloat(String(t.amount ?? '0').replace(/[^0-9.-]/g,'')) || 0), 0).toFixed(2)} revenue
                  </div>
                  {txns.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <div style={{ width: 80, fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>
                        {t.transaction_date ? new Date(String(t.transaction_date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                      </div>
                      <div style={{ flex: 1, fontSize: 13 }}>{String(t.description ?? t.payment_type ?? '—')}</div>
                      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, color: String(t.status) === 'REFUNDED' ? 'var(--red)' : undefined }}>
                        {String(t.status) === 'REFUNDED' ? '-' : ''}${Math.abs(parseFloat(String(t.amount ?? '0').replace(/[^0-9.-]/g,'')) || 0).toFixed(2)}
                      </div>
                      <span className={`badge ${String(t.status) === 'COMPLETED' ? 'badge-green' : String(t.status) === 'REFUNDED' ? 'badge-red' : 'badge-gray'}`}>
                        {String(t.status ?? '—')}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
