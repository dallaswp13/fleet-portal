'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/* ── Types ─────────────────────────────────────────────────── */
interface QuickAction {
  id: string; icon: string; title: string; description: string; color: string
  href?: string
}

/* ── Actions config ─────────────────────────────────────────── */
const WORKING_ACTIONS: QuickAction[] = [
  { id: 'create_vehicle',    icon: '🆕', color: '#1abc9c',       title: 'Create Vehicle',        description: 'Add a new vehicle record to the database.' },
  { id: 'get_available_line', icon: '📞', color: '#8e44ad',      title: 'Get Available Line',    description: 'Find an unassigned Verizon line and assign it to a vehicle.' },
  { id: 'export_data',       icon: '📤', color: '#7f8c8d',       title: 'Export Fleet Data',     description: 'Download all fleet data as an Excel spreadsheet.' },
  { id: 'new_inbox_rule',    icon: '⚙️', color: '#e67e22',       title: 'New Inbox Rule',        description: 'Create an automation rule for incoming SMS messages.', href: '/sms' },
]

const M360_ACTIONS: QuickAction[] = [
  { id: 'reboot_tablet',    icon: '🔄', color: '#3498db',       title: 'Reboot Tablet',         description: 'Send a reboot command to a driver or PIM tablet via M360.' },
  { id: 'replace_tablet',   icon: '📱', color: 'var(--blue)',   title: 'Replace Driver Tablet', description: 'Wipe the driver tablet and log the replacement.' },
  { id: 'surrender_vehicle', icon: '🚕', color: 'var(--amber)', title: 'Surrender Vehicle',     description: 'Wipe both devices, unseat driver, and mark surrendered.' },
  { id: 'remote_support',   icon: '🛠', color: 'var(--green)',  title: 'Remote Support',        description: 'Initiate a TeamViewer remote support session via M360. Pending API access.' },
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
  return { ok: data.success ?? false, msg: data.message ?? data.error ?? 'Unknown response' }
}

/* ── Replace Tablet workflow ────────────────────────────────── */
function ReplaceTabletModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [reason,  setReason]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  const REASONS = ['Screen damage', 'Device lost', 'Battery failure', 'Software issue', 'Other']

  async function confirm() {
    if (!vehicle || !reason) return
    setBusy(true)
    const msgs: string[] = []
    // 1. Wipe driver tablet via M360
    if (vehicle.m360_device_id) {
      const r = await m360Action('wipe', vehicle.m360_device_id, vehicle.vehicle_number, true)
      msgs.push(`M360 wipe: ${r.msg}`)
    } else {
      msgs.push('M360 wipe: skipped (no device ID — import devices first)')
    }
    // 2. Log note on vehicle
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const { data: veh } = await sb.from('vehicles').select('notes').eq('id', vehicle.id).single()
    let log: { text: string; ts: string }[] = []
    try { log = JSON.parse(veh?.notes ?? '[]') } catch { log = [] }
    log.unshift({ text: `[Replace Tablet] Reason: ${reason} · Device: ${vehicle.device_name ?? 'unknown'} · by: ${user?.email}`, ts: new Date().toISOString() })
    await sb.from('vehicles').update({ notes: JSON.stringify(log), updated_at: new Date().toISOString() }).eq('id', vehicle.id)
    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'replace_tablet', target_type: 'vehicle', target_id: vehicle.id, vehicle_number: vehicle.vehicle_number, payload: { reason, device_name: vehicle.device_name }, success: true }) } catch { /* non-fatal */ }
    setBusy(false)
    setResult({ ok: true, msg: msgs.join('\n') })
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {!vehicle ? (
        <VehicleLookup onFound={setVehicle} color={action.color} />
      ) : !reason ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reason for replacement</div>
          {REASONS.map(r => (
            <button key={r} onClick={() => setReason(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', marginBottom: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
              {r}
            </button>
          ))}
        </div>
      ) : result ? (
        <ResultBanner ok={result.ok} msg={result.msg} />
      ) : (
        <div>
          <ConfirmBox rows={[
            ['Vehicle', `#${vehicle.vehicle_number} ${vehicle.fleet_id.toUpperCase()}`],
            ['Driver device', vehicle.device_name ?? '(no device ID)'],
            ['Reason', reason],
            ['Action', 'Factory wipe driver tablet via M360'],
          ]} />
          <ActionButtons busy={busy} onBack={() => setReason('')} onConfirm={confirm} color={action.color} label="Wipe Tablet" />
        </div>
      )}
    </ModalShell>
  )
}

/* ── Surrender Vehicle workflow ─────────────────────────────── */
function SurrenderVehicleModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vehicle,  setVehicle]  = useState<Vehicle | null>(null)
  const [reason,   setReason]   = useState('')
  const [busy,     setBusy]     = useState(false)
  const [result,   setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  const REASONS = ['Driver surrendered voluntarily', 'Lease expired', 'Accident / total loss', 'Repossessed', 'Other']

  async function confirm() {
    if (!vehicle || !reason) return
    setBusy(true)
    const msgs: string[] = []
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()

    // 1. Wipe driver tablet
    if (vehicle.m360_device_id) {
      const r = await m360Action('wipe', vehicle.m360_device_id, vehicle.vehicle_number, true)
      msgs.push(`Driver tablet wipe: ${r.msg}`)
    } else {
      msgs.push('Driver tablet: no device ID — skipped')
    }

    // 2. Wipe PIM tablet
    if (vehicle.pim_m360_device_id) {
      const r = await m360Action('wipe', vehicle.pim_m360_device_id, vehicle.vehicle_number, true)
      msgs.push(`PIM tablet wipe: ${r.msg}`)
    } else {
      msgs.push('PIM tablet: no device ID — skipped')
    }

    // 3. Unseat driver
    const { data: driver } = await sb.from('drivers')
      .select('id, name, driver_id').eq('seated_vehicle_id', vehicle.id).single()
    if (driver) {
      await sb.from('drivers').update({ seated_vehicle_id: null, seated_vehicle_number: null, updated_at: new Date().toISOString() }).eq('id', driver.id)
      msgs.push(`Driver unseated: ${driver.name ?? `#${driver.driver_id}`}`)
    } else {
      msgs.push('No driver seated — skipped unseat')
    }

    // 4. Mark vehicle surrendered
    const { data: veh } = await sb.from('vehicles').select('notes').eq('id', vehicle.id).single()
    let log: { text: string; ts: string }[] = []
    try { log = JSON.parse(veh?.notes ?? '[]') } catch { log = [] }
    log.unshift({ text: `[Surrender] Reason: ${reason} · by: ${user?.email}`, ts: new Date().toISOString() })
    await sb.from('vehicles').update({
      sheet_tab: 'Surrenders', online_status: 'Surrendered',
      notes: JSON.stringify(log), updated_at: new Date().toISOString()
    }).eq('id', vehicle.id)
    msgs.push('Vehicle marked as Surrendered')

    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'surrender_vehicle', target_type: 'vehicle', target_id: vehicle.id, vehicle_number: vehicle.vehicle_number, payload: { reason }, success: true }) } catch { /* non-fatal */ }
    setBusy(false)
    setResult({ ok: true, msg: msgs.join('\n') })
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {!vehicle ? (
        <VehicleLookup onFound={setVehicle} color={action.color} />
      ) : !reason ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reason for surrender</div>
          {REASONS.map(r => (
            <button key={r} onClick={() => setReason(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', marginBottom: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
              {r}
            </button>
          ))}
        </div>
      ) : result ? (
        <>
          {msgs(result.msg)}
        </>
      ) : (
        <div>
          <ConfirmBox rows={[
            ['Vehicle', `#${vehicle.vehicle_number} ${vehicle.fleet_id.toUpperCase()}`],
            ['Driver device', vehicle.device_name ?? '(none)'],
            ['PIM device', vehicle.pim_device_name ?? '(none)'],
            ['Reason', reason],
            ['Actions', 'Wipe both devices · unseat driver · mark Surrendered'],
          ]} />
          <ActionButtons busy={busy} onBack={() => setReason('')} onConfirm={confirm} color={action.color} label="Surrender Vehicle" danger />
        </div>
      )}
    </ModalShell>
  )
}

/* ── Remote Support workflow ────────────────────────────────── */
function RemoteSupportModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  const [steps, setSteps] = useState<{ label: string; status: 'pending' | 'running' | 'done' | 'error'; msg?: string }[]>([])

  async function confirm() {
    if (!vehicle) return
    setBusy(true)

    const stepDefs = [
      { label: 'Reboot driver tablet', run: () => vehicle.m360_device_id ? m360Action('reboot', vehicle.m360_device_id!, vehicle.vehicle_number) : Promise.resolve({ ok: false, msg: 'No driver device ID' }) },
      { label: 'Clear dispatch app cache', run: () => vehicle.m360_device_id ? m360Action('clear_dispatch', vehicle.m360_device_id!, vehicle.vehicle_number) : Promise.resolve({ ok: false, msg: 'No driver device ID' }) },
      { label: 'Clear PIM Bluetooth', run: () => vehicle.pim_m360_device_id ? m360Action('clear_pim_bt', vehicle.pim_m360_device_id!, vehicle.vehicle_number) : Promise.resolve({ ok: false, msg: 'No PIM device ID — skipped' }) },
    ]

    const newSteps: { label: string; status: 'pending' | 'running' | 'done' | 'error'; msg?: string }[] = stepDefs.map(s => ({ label: s.label, status: 'pending' as const }))
    setSteps([...newSteps])

    let allOk = true
    const msgs: string[] = []

    for (let i = 0; i < stepDefs.length; i++) {
      newSteps[i] = { ...newSteps[i], status: 'running' }
      setSteps([...newSteps])

      const r = await stepDefs[i].run()
      newSteps[i] = { label: newSteps[i].label, status: r.ok ? 'done' : 'error', msg: r.msg }
      setSteps([...newSteps])
      msgs.push(`${r.ok ? '✓' : '✗'} ${newSteps[i].label}: ${r.msg}`)
      if (!r.ok && newSteps[i].label !== 'Clear PIM Bluetooth') allOk = false
    }

    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()

    // Log note on vehicle
    const { data: veh } = await sb.from('vehicles').select('notes').eq('id', vehicle.id).single()
    let log: { text: string; ts: string }[] = []
    try { log = JSON.parse(veh?.notes ?? '[]') } catch { log = [] }
    log.unshift({ text: `[Remote Support] ${msgs.join(' | ')} · by: ${user?.email}`, ts: new Date().toISOString() })
    await sb.from('vehicles').update({ notes: JSON.stringify(log), updated_at: new Date().toISOString() }).eq('id', vehicle.id)

    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'remote_support', target_type: 'device', target_id: vehicle.m360_device_id ?? vehicle.id, vehicle_number: vehicle.vehicle_number, payload: { steps: msgs }, success: allOk }) } catch { /* non-fatal */ }
    setBusy(false)
    setResult({ ok: allOk, msg: msgs.join('\n') })
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {!vehicle ? (
        <VehicleLookup onFound={setVehicle} color={action.color} />
      ) : result ? (
        <div>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
              <span>{s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : '⬜'}</span>
              <span style={{ fontWeight: 500 }}>{s.label}</span>
              {s.msg && <span style={{ fontSize: 11, color: 'var(--text3)' }}>— {s.msg}</span>}
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <ResultBanner ok={result.ok} msg={result.ok ? 'Support sequence complete' : 'Some steps failed — see details above'} />
          </div>
        </div>
      ) : steps.length > 0 ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Running support sequence…</div>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
              <span>{s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : s.status === 'running' ? '⏳' : '⬜'}</span>
              <span style={{ fontWeight: 500, opacity: s.status === 'pending' ? 0.5 : 1 }}>{s.label}</span>
              {s.msg && <span style={{ fontSize: 11, color: 'var(--text3)' }}>— {s.msg}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <ConfirmBox rows={[
            ['Vehicle', `#${vehicle.vehicle_number} ${vehicle.fleet_id.toUpperCase()}`],
            ['Driver device', vehicle.device_name ?? '(no device ID)'],
            ['PIM device', vehicle.pim_device_name ?? '(no device ID)'],
            ['Actions', '1) Reboot driver tablet\n2) Clear dispatch app cache\n3) Clear PIM Bluetooth'],
          ]} />
          <ActionButtons busy={busy} onBack={() => setVehicle(null)} onConfirm={confirm} color={action.color} label="Run Support Sequence" />
        </div>
      )}
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

    // Get all phone norms assigned to any vehicle (across all fleets sharing this office)
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

    // Get lines for this office that aren't assigned to any vehicle
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
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  async function create() {
    const num = parseInt(vNum.trim())
    if (!num || !fleet) return
    setBusy(true)
    const sb = createClient()

    // Check if vehicle already exists
    const { data: existing } = await sb.from('vehicles').select('id').eq('vehicle_number', num).eq('fleet_id', fleet).limit(1).single()
    if (existing) { setResult({ ok: false, msg: `Vehicle #${num} ${fleet} already exists in the database.` }); setBusy(false); return }

    const nameKey = `${num}${fleet}`.toLowerCase()
    const { error } = await sb.from('vehicles').insert({
      vehicle_number: num, fleet_id: fleet,
      vehicle_name_key: nameKey,
      sheet_tab: 'Active Vehicles',
      updated_at: new Date().toISOString()
    })
    if (error) { setResult({ ok: false, msg: error.message }); setBusy(false); return }
    const { data: { user } } = await sb.auth.getUser()
    try { await sb.from('audit_log').insert({ user_email: user?.email, action: 'create_vehicle', target_type: 'vehicle', target_id: nameKey, vehicle_number: num, success: true }) } catch { /* non-fatal */ }
    setBusy(false)
    setResult({ ok: true, msg: `Vehicle #${num} ${fleet} created.\n\nNext steps: pair tablets and run a device import to link M360 IDs.` })
  }

  return (
    <ModalShell action={action} onClose={onClose}>
      {result ? <ResultBanner ok={result.ok} msg={result.msg} /> :
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
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Vehicle Number</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input autoFocus placeholder="e.g. 9999" value={vNum} onChange={e => setVNum(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()} style={{ flex: 1 }} />
            <button className="btn-primary btn-sm" onClick={create} disabled={busy || !vNum.trim()}
              style={{ background: action.color, borderColor: action.color }}>
              {busy ? <Spinner /> : 'Create'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
            Fleet: {fleet} · Creates a new Active Vehicle record in the database.
          </div>
          <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setFleet('')}>← Change fleet</button>
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
    // Check if user has saved field preferences
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
      // Use saved preferences from the Export Data settings panel
      const saved = localStorage.getItem('fleet-export-fields')
      let keys = ''
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.length > 0) keys = arr.join(',')
      }
      // Use the XLSX export endpoint with saved field preferences
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

function msgs(msg: string) {
  return (
    <div className="alert alert-success" style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{msg}</div>
  )
}

/* ── Main Page ─────────────────────────────────────────────── */
export default function ActionsPage() {
  const [active, setActive] = useState<QuickAction | null>(null)

  function renderModal() {
    if (!active) return null
    const props = { action: active, onClose: () => setActive(null) }
    switch (active.id) {
      case 'replace_tablet':     return <ReplaceTabletModal     {...props} />
      case 'surrender_vehicle':  return <SurrenderVehicleModal  {...props} />
      case 'remote_support':     return <RemoteSupportModal     {...props} />
      case 'reboot_tablet':      return <RebootTabletModal      {...props} />
      case 'create_vehicle':     return <CreateVehicleModal     {...props} />
      case 'get_available_line': return <GetAvailableLineModal  {...props} />
      case 'export_data':        return <ExportDataModal        {...props} />
      default: return null
    }
  }

  function renderActionGrid(actions: QuickAction[]) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {actions.map(action => (
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
    )
  }

  return (
    <div className="page-content">
      {renderModal()}

      <div className="page-header">
        <div><h1>Quick Actions</h1><p>Guided workflows and fleet management tools</p></div>
      </div>

      {renderActionGrid(WORKING_ACTIONS)}

      <div style={{ marginTop: 32, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)', margin: 0 }}>MaaS360 Device Actions</h2>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--amber-bg, var(--bg4))', color: 'var(--amber, var(--text3))', fontWeight: 600 }}>Pending API Access</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>These actions require MaaS360 API device management permissions. Contact M360 support to enable.</p>
      </div>

      {renderActionGrid(M360_ACTIONS)}
    </div>
  )
}
