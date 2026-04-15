'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/Toaster'

/* ── Types ─────────────────────────────────────────────────── */
interface QuickAction {
  id: string; icon: string; title: string; description: string; color: string
  href?: string
}

/* ── Actions config ─────────────────────────────────────────── */
// Single unified action grid — no more split between "Working" and "M360" since
// MaaS360 command execution is live (auth + reboot + clear-app-data + wipe all
// verified against the real API).
//
// Replace Driver Tablet and Surrender Vehicle were removed 2026-04-15 per user
// request — the wipe-first workflows weren't getting used and the destructive
// path is better handled manually in the M360 portal.
//
// Remote Support is kept as a portal deep-link: the MaaS360 Webservices API
// has no "initiate remote control" endpoint (confirmed against
// "MaaS360 Webservices Reference Guide" v10.91, pages 125-172 — the action
// type list contains reboot, wipe, kiosk, clear data, etc. but not remote
// control). The admin portal is the only way to launch a TeamViewer session,
// so this card jumps straight there.
const ACTIONS: QuickAction[] = [
  { id: 'reboot_tablet',      icon: '🔄', color: '#3498db',      title: 'Reboot Tablet',         description: 'Send a reboot command to a driver or PIM tablet via MaaS360.' },
  { id: 'remote_support',     icon: '🛠', color: 'var(--green)', title: 'Remote Support',        description: 'Open the device in MaaS360 to launch a TeamViewer remote session.' },
  { id: 'create_vehicle',     icon: '🆕', color: '#1abc9c',      title: 'Create Vehicle',        description: 'Add a new vehicle record and provision driver + PIM users in MaaS360.' },
  { id: 'get_available_line', icon: '📞', color: '#8e44ad',      title: 'Get Available Line',    description: 'Find an unassigned Verizon line and assign it to a vehicle.' },
  { id: 'new_inbox_rule',     icon: '⚙️', color: '#e67e22',      title: 'New Inbox Rule',        description: 'Create an automation rule for incoming SMS messages.', href: '/sms' },
  { id: 'export_data',        icon: '📤', color: '#7f8c8d',      title: 'Export Fleet Data',     description: 'Download all fleet data as an Excel spreadsheet.' },
]

const FLEETS = [
  { label: 'E (ASC)', value: 'E' }, { label: 'L (ASC)', value: 'L' },
  { label: 'S (ASC)', value: 'S' }, { label: 'Y (ASC)', value: 'Y' },
  { label: 'U (ASC)', value: 'U' }, { label: 'C (CYC)', value: 'C' },
  { label: 'G (SDY)', value: 'G' }, { label: 'D (DEN)', value: 'D' },
]

/* ── Helpers ────────────────────────────────────────────────── */
function Spinner() {
  return <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
}

function ResultBanner({ ok, msg }: { ok: boolean; msg: string }) {
  return <div className={`alert ${ok ? 'alert-success' : 'alert-error'}`} style={{ fontSize: 13 }}>{msg}</div>
}

/* ── Vehicle lookup shared component ────────────────────────── */
function VehicleLookup({ onFound, color }: {
  onFound: (v: { id: string; vehicle_number: number; fleet_id: string; m360_device_id: string | null; pim_m360_device_id: string | null; device_name: string | null; pim_device_name: string | null }) => void
  color: string
}) {
  const [input, setInput]   = useState('')
  const [busy,  setBusy]    = useState(false)
  const [error, setError]   = useState('')

  async function lookup() {
    const num = parseInt(input.trim())
    if (!num) return
    setBusy(true); setError('')
    const sb = createClient()
    const { data } = await sb
      .from('fleet_overview')
      .select('vehicle_id,vehicle_number,fleet_id,m360_device_id,pim_m360_device_id,device_name,pim_device_name')
      .eq('vehicle_number', num)
      .limit(1).single()
    setBusy(false)
    if (!data) { setError(`Vehicle #${num} not found.`); return }
    onFound({ id: data.vehicle_id, vehicle_number: data.vehicle_number, fleet_id: data.fleet_id,
      m360_device_id: data.m360_device_id, pim_m360_device_id: data.pim_m360_device_id,
      device_name: data.device_name, pim_device_name: data.pim_device_name })
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Vehicle Number</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input autoFocus placeholder="e.g. 6020" value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          style={{ flex: 1 }} />
        <button className="btn-primary btn-sm" onClick={lookup} disabled={busy || !input.trim()}
          style={{ background: color, borderColor: color }}>
          {busy ? <Spinner /> : 'Find →'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

type Vehicle = { id: string; vehicle_number: number; fleet_id: string; m360_device_id: string | null; pim_m360_device_id: string | null; device_name: string | null; pim_device_name: string | null }

/* ── M360 action helper ─────────────────────────────────────── */
async function m360Action(action: string, deviceId: string, vehicleNumber: number, confirmed = false) {
  const res = await fetch('/api/maas360/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, deviceId, vehicleNumber, confirmed }),
  })
  const data = await res.json()
  const ok = data.success ?? false
  const msg = data.message ?? data.error ?? 'Unknown response'
  const label = `Vehicle ${vehicleNumber} · ${action}`
  if (ok) toast.success(`${label} sent`, { detail: msg })
  else    toast.error(`${label} failed`, { detail: msg })
  return { ok, msg }
}

/* ── Remote Support workflow (M360 portal deep-link) ────────── */
//
// The MaaS360 Webservices API does not expose a "start remote control" action
// type (see Quick Actions config note above), so Remote Support opens the
// device's admin page in the portal. From there the admin can click
// "Remote Control" which launches TeamViewer externally.
function RemoteSupportModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [target,  setTarget]  = useState<'driver' | 'pim' | null>(null)

  function openInPortal(deviceId: string) {
    // Portal device-detail URL. The exact path has varied across M360 UI
    // revisions, so we use the tenant-aware search URL which reliably lands
    // on the device page for any billing ID. Admins then click "Actions →
    // Remote Control" from there.
    const url = `https://m3.maas360.com/emm/admin/action?action=viewDeviceDetails&csn=${encodeURIComponent(deviceId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {!vehicle ? (
        <VehicleLookup onFound={setVehicle} color={action.color} />
      ) : !target ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Which tablet?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => { if (vehicle.m360_device_id) { setTarget('driver'); openInPortal(vehicle.m360_device_id) } }}
              disabled={!vehicle.m360_device_id}
              style={{ textAlign: 'left', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: vehicle.m360_device_id ? 'pointer' : 'not-allowed', opacity: vehicle.m360_device_id ? 1 : 0.5 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Driver Tablet</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{vehicle.device_name ?? 'No device ID'}{vehicle.m360_device_id ? ' — open in M360' : ' — cannot open'}</div>
            </button>
            <button onClick={() => { if (vehicle.pim_m360_device_id) { setTarget('pim'); openInPortal(vehicle.pim_m360_device_id) } }}
              disabled={!vehicle.pim_m360_device_id}
              style={{ textAlign: 'left', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: vehicle.pim_m360_device_id ? 'pointer' : 'not-allowed', opacity: vehicle.pim_m360_device_id ? 1 : 0.5 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>PIM Tablet</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{vehicle.pim_device_name ?? 'No device ID'}{vehicle.pim_m360_device_id ? ' — open in M360' : ' — cannot open'}</div>
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, lineHeight: 1.5 }}>
            Remote Support opens the device in the MaaS360 admin portal in a new tab. Click <b>Actions → Remote Control</b> on the device page to launch TeamViewer.
            <br /><br />
            The MaaS360 Webservices API does not expose an endpoint to start a remote session programmatically, so this step has to happen in the portal.
          </div>
        </div>
      ) : null}
    </ModalShell>
  )
}

/* ── Reboot Tablet workflow ─────────────────────────────────── */
function RebootTabletModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [target,  setTarget]  = useState<'driver' | 'pim' | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  async function confirm() {
    if (!vehicle || !target) return
    setBusy(true)
    const deviceId = target === 'driver' ? vehicle.m360_device_id : vehicle.pim_m360_device_id
    if (!deviceId) {
      setResult({ ok: false, msg: `No M360 device ID for ${target} tablet. Import devices first.` })
      setBusy(false); return
    }
    const r = await m360Action('reboot', deviceId, vehicle.vehicle_number)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'reboot', target_type: 'device', target_id: deviceId, vehicle_number: vehicle.vehicle_number, payload: { target }, success: r.ok }) } catch { /* non-fatal */ }
    setBusy(false)
    setResult(r)
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {!vehicle ? (
        <VehicleLookup onFound={setVehicle} color={action.color} />
      ) : !target ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Which tablet?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => setTarget('driver')}
              style={{ textAlign: 'left', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Driver Tablet</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{vehicle.device_name ?? 'No device ID'}{vehicle.m360_device_id ? '' : ' — cannot reboot'}</div>
            </button>
            <button onClick={() => setTarget('pim')}
              style={{ textAlign: 'left', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>PIM Tablet</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{vehicle.pim_device_name ?? 'No device ID'}{vehicle.pim_m360_device_id ? '' : ' — cannot reboot'}</div>
            </button>
          </div>
        </div>
      ) : result ? (
        <ResultBanner ok={result.ok} msg={result.msg} />
      ) : (
        <div>
          <ConfirmBox rows={[
            ['Vehicle', `#${vehicle.vehicle_number} ${vehicle.fleet_id.toUpperCase()}`],
            ['Target', target === 'driver' ? `Driver: ${vehicle.device_name ?? '(unknown)'}` : `PIM: ${vehicle.pim_device_name ?? '(unknown)'}`],
            ['Action', 'Reboot via MaaS360'],
          ]} />
          <ActionButtons busy={busy} onBack={() => setTarget(null)} onConfirm={confirm} color={action.color} label="Send Reboot" />
        </div>
      )}
    </ModalShell>
  )
}

/* ── Get Available Line workflow ───────────────────────────── */
const OFFICES = [
  { label: 'ASC (E, L, S, Y, U)', value: 'ASC' },
  { label: 'CYC (C)',              value: 'CYC' },
  { label: 'SDY (G)',              value: 'SDY' },
  { label: 'DEN (D)',              value: 'DEN' },
]

function GetAvailableLineModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [office,    setOffice]    = useState('')
  const [busy,      setBusy]      = useState(false)
  const [line,      setLine]      = useState<{ id: string; phone_number: string; mobile_plan: string | null } | null>(null)
  const [availCount, setAvailCount] = useState(0)
  const [noLines,   setNoLines]   = useState(false)
  const [assignNum, setAssignNum] = useState('')
  const [result,    setResult]    = useState<{ ok: boolean; msg: string } | null>(null)

  async function findLine() {
    if (!office) return
    setBusy(true)
    const sb = createClient()

    const fleetIds = office === 'ASC' ? ['E','L','S','Y','U']
                   : office === 'CYC' ? ['C']
                   : office === 'SDY' ? ['G']
                   : office === 'DEN' ? ['D'] : []
    const { data: vehicles } = await sb.from('vehicles')
      .select('driver_phone_norm,pim_phone_norm')
      .in('fleet_id', fleetIds)
    const assignedNorms = new Set<string>()
    for (const v of vehicles ?? []) {
      if (v.driver_phone_norm) assignedNorms.add(v.driver_phone_norm)
      if (v.pim_phone_norm) assignedNorms.add(v.pim_phone_norm)
    }

    const { data: lines } = await sb.from('verizon_lines')
      .select('id,phone_number,phone_norm,mobile_plan')
      .eq('office', office)
      .limit(500)
    const available = (lines ?? []).filter(l => !assignedNorms.has(l.phone_norm ?? ''))
    setBusy(false)
    if (available.length === 0) { setNoLines(true); return }
    setAvailCount(available.length)
    setLine(available[0])
  }

  async function assignLine() {
    if (!line || !assignNum.trim()) return
    setBusy(true)
    const num = parseInt(assignNum.trim())
    const sb = createClient()
    const { data: veh } = await sb.from('vehicles').select('id').eq('vehicle_number', num).limit(1).single()
    if (!veh) { setResult({ ok: false, msg: `Vehicle #${num} not found.` }); setBusy(false); return }
    setResult({ ok: true, msg: `Available line: ${line.phone_number}\nPlan: ${line.mobile_plan ?? 'Unknown'}\n\nAssign this number to vehicle #${num} in the Verizon tab.\n\n⚠️ Search for this number in MaaS360 first to make sure it is not already active on another device.` })
    setBusy(false)
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {result ? <ResultBanner ok={result.ok} msg={result.msg} /> :
      !office ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Select Office</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {OFFICES.map(o => (
              <button key={o.value} onClick={() => setOffice(o.value)}
                style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{o.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{o.label}</div>
              </button>
            ))}
          </div>
        </div>
      ) : !line && !noLines ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          {busy ? <><span className="spinner" style={{ width: 20, height: 20 }} /><div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 10 }}>Searching for available lines in {office}…</div></> : (
            <button className="btn-primary" onClick={findLine} style={{ background: action.color, borderColor: action.color }}>Find Available Line</button>
          )}
        </div>
      ) : noLines ? (
        <div>
          <ResultBanner ok={false} msg={`No available lines found for ${office}. All lines are assigned to vehicles.`} />
          <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => { setOffice(''); setNoLines(false) }}>Try another office</button>
        </div>
      ) : line ? (
        <div>
          <ConfirmBox rows={[
            ['Office', office],
            ['Phone Number', line.phone_number],
            ['Plan', line.mobile_plan ?? 'Unknown'],
            ['Available', `${availCount} unassigned line${availCount !== 1 ? 's' : ''} in ${office}`],
          ]} />
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, marginTop: 12 }}>Assign to Vehicle (optional)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Vehicle #" value={assignNum} onChange={e => setAssignNum(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && assignLine()} style={{ flex: 1 }} />
            <button className="btn-primary btn-sm" onClick={assignLine} disabled={busy || !assignNum.trim()}
              style={{ background: action.color, borderColor: action.color }}>
              {busy ? <Spinner /> : 'Assign'}
            </button>
          </div>
          <button className="btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}
            onClick={() => { setResult({ ok: true, msg: `Available line: ${line.phone_number}\nPlan: ${line.mobile_plan ?? 'Unknown'}\nOffice: ${office} (${availCount} available)\n\n⚠️ Search for this number in MaaS360 first to make sure it is not already active on another device.` }) }}>
            Just show me the line
          </button>
        </div>
      ) : null}
    </ModalShell>
  )
}

/* ── Create Vehicle workflow ────────────────────────────────── */
function CreateVehicleModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vNum,    setVNum]    = useState('')
  const [fleet,   setFleet]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [stepLog, setStepLog] = useState<string[]>([])
  const [result,  setResult]  = useState<{ ok: boolean; msg: string; steps?: { step: string; success: boolean; detail: string }[] } | null>(null)

  async function create() {
    const num = parseInt(vNum.trim())
    if (!num || !fleet) return
    setBusy(true)
    setStepLog([`Creating vehicle #${num}${fleet}…`])
    const sb = createClient()

    const { data: existing } = await sb.from('vehicles').select('id').eq('vehicle_number', num).eq('fleet_id', fleet).limit(1).single()
    if (existing) { setResult({ ok: false, msg: `Vehicle #${num} ${fleet} already exists in the database.` }); setBusy(false); return }

    const nameKey = `${num}${fleet}`.toLowerCase()
    const { error } = await sb.from('vehicles').insert({
      vehicle_number: num, fleet_id: fleet,
      vehicle_name_key: nameKey,
      sheet_tab: 'Active Vehicles',
      updated_at: new Date().toISOString()
    })
    if (error) { setResult({ ok: false, msg: `DB insert failed: ${error.message}` }); setBusy(false); return }

    setStepLog(prev => [...prev, `✓ Vehicle row created (${num}${fleet})`, `Provisioning MaaS360 users…`])

    const { data: { user } } = await sb.auth.getUser()
    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'create_vehicle', target_type: 'vehicle', target_id: nameKey, vehicle_number: num, success: true }) } catch { /* non-fatal */ }

    let m360Ok = false
    let m360Steps: { step: string; success: boolean; detail: string }[] = []
    let m360Msg = ''
    try {
      const res = await fetch('/api/maas360/create-vehicle-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleNumber: num, fleetId: fleet })
      })
      const data = await res.json()
      m360Ok = data.success ?? false
      m360Steps = data.steps ?? []
      m360Msg = data.message ?? (data.error ?? 'No response')
    } catch (err) {
      m360Msg = err instanceof Error ? err.message : 'Network error calling MaaS360'
    }

    setBusy(false)
    const summary = [
      `✅ Vehicle #${num}${fleet} created in database.`,
      m360Ok
        ? `✅ MaaS360: ${m360Msg}`
        : `⚠️ MaaS360: ${m360Msg}`,
      '',
      `Driver user: ${num}${fleet} → "${fleet} front" group`,
      `PIM user:    *${num}${fleet} → "${fleet} pim" group`,
    ].join('\n')
    setResult({ ok: true, msg: summary, steps: m360Steps })
  }

  function reset() {
    setResult(null); setStepLog([]); setVNum(''); setFleet('')
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {result ? (
        <div>
          <ResultBanner ok={result.ok} msg={result.msg} />
          {result.steps && result.steps.length > 0 && (
            <div style={{ marginTop: 12, background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>M360 Provisioning Steps</div>
              {result.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '3px 0', alignItems: 'flex-start' }}>
                  <span style={{ color: s.success ? 'var(--green)' : 'var(--red)', flexShrink: 0, width: 14 }}>{s.success ? '✓' : '✗'}</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text)' }}>{s.step}</div>
                    {s.detail && <div style={{ color: 'var(--text3)', fontSize: 10, marginTop: 2, wordBreak: 'break-word' }}>{s.detail}</div>}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn-secondary" onClick={reset}>Add another</button>
            <button className="btn-primary" onClick={onClose} style={{ background: action.color, borderColor: action.color }}>Done</button>
          </div>
        </div>
      ) :
      !fleet ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Select Fleet</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {FLEETS.map(f => (
              <button key={f.value} onClick={() => setFleet(f.value)}
                style={{ padding: '9px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, lineHeight: 1.5 }}>
            Creating a vehicle will also provision two MaaS360 users:<br />
            • Driver — username <code>#{`{vehicle#}${'{fleet}'}`}</code> in <code>{'{fleet}'} front</code> group<br />
            • PIM — username <code>*{`{vehicle#}${'{fleet}'}`}</code> in <code>{'{fleet}'} pim</code> group
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Vehicle Number</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input autoFocus placeholder="e.g. 9999" value={vNum} onChange={e => setVNum(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !busy && create()} style={{ flex: 1 }} />
            <button className="btn-primary btn-sm" onClick={create} disabled={busy || !vNum.trim()}
              style={{ background: action.color, borderColor: action.color }}>
              {busy ? <Spinner /> : 'Create'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
            Fleet: {fleet} · Creates vehicle row + driver/PIM users in MaaS360.
          </div>
          {vNum.trim() && (
            <div style={{ marginTop: 10, background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '8px 10px', fontSize: 11, color: 'var(--text2)' }}>
              <div>Driver user: <code>{vNum.trim()}{fleet}</code> → <code>{fleet} front</code></div>
              <div>PIM user: <code>*{vNum.trim()}{fleet}</code> → <code>{fleet} pim</code></div>
            </div>
          )}
          {busy && stepLog.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
              {stepLog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setFleet('')} disabled={busy}>← Change fleet</button>
        </div>
      )}
    </ModalShell>
  )
}

/* ── Export Data workflow ───────────────────────────────────── */
function ExportDataModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [busy,   setBusy]   = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [fieldCount, setFieldCount] = useState(0)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fleet-export-fields')
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr)) setFieldCount(arr.length)
      }
    } catch { /* ignore */ }
  }, [])

  function exportWithPrefs() {
    setBusy(true)
    try {
      const saved = localStorage.getItem('fleet-export-fields')
      let keys = ''
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.length > 0) keys = arr.join(',')
      }
      const url = keys ? `/api/export?fields=${keys}` : '/api/export'
      window.open(url, '_blank')
      setBusy(false)
      setResult({ ok: true, msg: `✓ Export started${keys ? ` with ${keys.split(',').length} selected fields` : ' with all fields'}.` })
    } catch {
      setBusy(false)
      setResult({ ok: false, msg: 'Export failed.' })
    }
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {result ? <ResultBanner ok={result.ok} msg={result.msg} /> : (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Downloads an Excel file with your fleet data. Uses your saved field preferences from Settings → Export Data.
          </div>
          {fieldCount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>✓</span> {fieldCount} fields selected from your preferences
            </div>
          )}
          {!fieldCount && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
              No saved preferences — all fields will be exported. Customize in Settings → Export Data.
            </div>
          )}
          <ActionButtons busy={busy} onConfirm={exportWithPrefs} color={action.color} label="Download Excel (.xlsx)" />
        </div>
      )}
    </ModalShell>
  )
}

/* ── Shared UI components ───────────────────────────────────── */
function ModalShell({ action, onClose, children }: { action: QuickAction; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 22 }}>{action.icon}</span>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{action.title}</div>
          <button className="btn-icon" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ padding: '16px 20px 20px', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

function ConfirmBox({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 14 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
          <span style={{ color: 'var(--text3)', width: 120, flexShrink: 0 }}>{k}</span>
          <span style={{ fontWeight: 500 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function ActionButtons({ busy, onBack, onConfirm, color, label, danger = false, disabled = false }: {
  busy: boolean; onBack?: () => void; onConfirm: () => void
  color: string; label: string; danger?: boolean; disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
      {onBack && <button className="btn-secondary" onClick={onBack} disabled={busy}>← Back</button>}
      <button className="btn-primary" onClick={onConfirm} disabled={busy || disabled}
        style={{ background: danger ? 'var(--red)' : color, borderColor: danger ? 'var(--red)' : color, display: 'flex', alignItems: 'center', gap: 6 }}>
        {busy ? <><Spinner /> Working…</> : label}
      </button>
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────── */
export default function ActionsPage() {
  const [active, setActive] = useState<QuickAction | null>(null)

  function renderModal() {
    if (!active) return null
    const props = { action: active, onClose: () => setActive(null) }
    switch (active.id) {
      case 'remote_support':     return <RemoteSupportModal     {...props} />
      case 'reboot_tablet':      return <RebootTabletModal      {...props} />
      case 'create_vehicle':     return <CreateVehicleModal     {...props} />
      case 'get_available_line': return <GetAvailableLineModal  {...props} />
      case 'export_data':        return <ExportDataModal        {...props} />
      default: return null
    }
  }

  return (
    <div className="page-content">
      {renderModal()}

      <div className="page-header">
        <div><h1>Quick Actions</h1><p>Guided workflows and fleet management tools</p></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {ACTIONS.map(action => (
          <button key={action.id}
            onClick={() => action.href ? (window.location.href = action.href) : setActive(action)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '18px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', display: 'flex', flexDirection: 'column', gap: 8 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = action.color; e.currentTarget.style.background = `${action.color}0d` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg2)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: `${action.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text)' }}>
              {action.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{action.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4, marginTop: 2 }}>{action.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
