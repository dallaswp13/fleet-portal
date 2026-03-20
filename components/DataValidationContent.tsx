'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Issue {
  type: string
  severity: 'error' | 'warning'
  vehicle_number?: number
  fleet_id?: string
  detail: string
  fix?: string
  id?: string
}

interface VehicleRow {
  id: string; vehicle_number: number; fleet_id: string; office: string | null
  driver_phone_norm: string | null; pim_phone_norm: string | null
  vehicle_name_key: string | null; device_name: string | null
  pim_device_name: string | null
}

export default function DataValidationContent() {
  const [issues,   setIssues]   = useState<Issue[]>([])
  const [running,  setRunning]  = useState(false)
  const [ran,      setRan]      = useState(false)
  const [fixing,   setFixing]   = useState<string | null>(null)
  const [fixMsg,   setFixMsg]   = useState<string | null>(null)

  async function runValidation() {
    setRunning(true); setIssues([]); setRan(false); setFixMsg(null)
    const supabase = createClient()
    const found: Issue[] = []

    const [{ data: vehicles }, { data: lines }, { data: devices }, { data: drivers }] = await Promise.all([
      supabase.from('vehicles').select('id,vehicle_number,fleet_id,office,driver_phone_norm,pim_phone_norm,vehicle_name_key,device_name,pim_device_name').order('vehicle_number'),
      supabase.from('verizon_lines').select('id,phone_number,phone_norm,office,account_number').limit(5000),
      supabase.from('devices').select('id,device_name,name_key,m360_device_id').limit(5000),
      supabase.from('drivers').select('id,driver_id,name,fleet_id,seated_vehicle_id,personal_phone_norm').limit(5000),
    ])

    const linePhoneMap  = new Map<string, string>() // phone_norm → line id
    for (const l of lines ?? []) if (l.phone_norm) linePhoneMap.set(l.phone_norm, l.id)

    const deviceKeyMap  = new Map<string, string>() // name_key → device id
    for (const d of devices ?? []) if (d.name_key) deviceKeyMap.set(d.name_key, d.id)

    const driverVehMap  = new Map<string, string>() // seated_vehicle_id → driver id
    for (const d of drivers ?? []) if (d.seated_vehicle_id) driverVehMap.set(d.seated_vehicle_id, d.id)

    for (const v of vehicles ?? [] as VehicleRow[]) {
      const vn = v.vehicle_number, fl = (v.fleet_id ?? '').toUpperCase()

      // 1. Missing office
      if (!v.office) found.push({ type: 'Missing Office', severity: 'error', vehicle_number: vn, fleet_id: fl, detail: `Vehicle ${vn}${fl} has no office assignment`, fix: 'trigger', id: v.id })

      // 2. Driver phone not linked to Verizon line
      if (v.driver_phone_norm && !linePhoneMap.has(v.driver_phone_norm)) {
        found.push({ type: 'Unlinked Driver Phone', severity: 'warning', vehicle_number: vn, fleet_id: fl, detail: `Driver phone ${v.driver_phone_norm} not found in Verizon lines — may be missing from import or wrong format` })
      }

      // 3. PIM phone not linked to Verizon line
      if (v.pim_phone_norm && !linePhoneMap.has(v.pim_phone_norm)) {
        found.push({ type: 'Unlinked PIM Phone', severity: 'warning', vehicle_number: vn, fleet_id: fl, detail: `PIM phone ${v.pim_phone_norm} not found in Verizon lines` })
      }

      // 4. No device linked (name_key not found in devices)
      if (v.vehicle_name_key && !deviceKeyMap.has(v.vehicle_name_key)) {
        found.push({ type: 'No Device Linked', severity: 'warning', vehicle_number: vn, fleet_id: fl, detail: `Vehicle key "${v.vehicle_name_key}" not found in device list — device not imported or different naming` })
      }

      // 5. No driver assigned
      if (!driverVehMap.has(v.id)) {
        // Only warn for active ASC vehicles
        if (v.office === 'ASC') {
          found.push({ type: 'No Driver Assigned', severity: 'warning', vehicle_number: vn, fleet_id: fl, detail: `No driver assigned — assign via Vehicle Panel → Driver tab` })
        }
      }
    }

    // 6. Verizon lines with no office
    const noOfficeLines = (lines ?? []).filter(l => !l.office && !['571689935-00007','571689935-00009'].includes(l.account_number ?? ''))
    if (noOfficeLines.length > 0) {
      found.push({ type: 'Lines Missing Office', severity: 'warning', detail: `${noOfficeLines.length} Verizon lines have no office assignment — run migration 008 or re-import Verizon usage`, fix: 'backfill_line_office' })
    }

    // 7. Devices with no vehicle match
    const unmatchedDevices = (devices ?? []).filter(d => d.name_key && !(vehicles ?? []).some((v: VehicleRow) => v.vehicle_name_key === d.name_key))
    if (unmatchedDevices.length > 0) {
      found.push({ type: 'Unmatched Devices', severity: 'warning', detail: `${unmatchedDevices.length} devices in MaaS360 don't match any vehicle — possibly surrendered or renamed` })
    }

    setIssues(found)
    setRan(true)
    setRunning(false)
  }

  async function applyFix(fix: string, id?: string) {
    if (!id && fix === 'trigger') return
    setFixing(fix + (id ?? '')); setFixMsg(null)
    const supabase = createClient()

    if (fix === 'trigger' && id) {
      // Force re-trigger office assignment from fleet_id
      const { error } = await supabase.from('vehicles').update({ updated_at: new Date().toISOString() }).eq('id', id)
      setFixMsg(error ? `Error: ${error.message}` : 'Triggered — office will be recomputed by DB trigger')
    } else if (fix === 'backfill_line_office') {
      // Update lines where office is null based on account_number mapping
      const officeMap: Record<string, string> = {
        '571689935-00002': 'ASC', '571689935-00003': 'CYC',
        '571689935-00004': 'SDY', '571689935-00010': 'DEN',
        '571689935-00007': 'Staff', '571689935-00009': 'Staff',
      }
      let updated = 0
      for (const [acct, office] of Object.entries(officeMap)) {
        const { data } = await supabase.from('verizon_lines').update({ office }).eq('account_number', acct).is('office', null).select('id')
        updated += data?.length ?? 0
      }
      setFixMsg(`Updated ${updated} lines with office assignments`)
    }

    setFixing(null)
  }

  const errors   = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Data Validation</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
          Identify missing links between vehicles, devices, Verizon lines, and drivers. Fix common issues automatically.
        </p>
        <button className="btn-primary" onClick={runValidation} disabled={running}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {running ? <><span className="spinner" /> Scanning…</> : '🔍 Run Validation'}
        </button>
      </div>

      {ran && (
        <>
          {fixMsg && <div className="alert alert-success" style={{ marginBottom: 12 }}>{fixMsg}</div>}

          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, background: errors.length ? 'rgba(231,76,60,0.08)' : 'rgba(46,204,113,0.08)', border: `1px solid ${errors.length ? '#e74c3c44' : '#2ecc7144'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: errors.length ? '#e74c3c' : '#2ecc71' }}>{errors.length}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Errors</div>
            </div>
            <div style={{ flex: 1, background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{warnings.length}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Warnings</div>
            </div>
            <div style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{issues.length}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Total Issues</div>
            </div>
          </div>

          {issues.length === 0 ? (
            <div className="alert alert-success">✓ No data issues found. All links are healthy.</div>
          ) : (
            <div className="card">
              <table>
                <thead>
                  <tr><th>Type</th><th>Vehicle</th><th>Detail</th><th style={{ width: 100 }}>Fix</th></tr>
                </thead>
                <tbody>
                  {issues.map((issue, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`badge ${issue.severity === 'error' ? 'badge-red' : 'badge-amber'}`}>
                          {issue.type}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {issue.vehicle_number ? `${issue.vehicle_number} ${issue.fleet_id ?? ''}` : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 400 }}>{issue.detail}</td>
                      <td>
                        {issue.fix ? (
                          <button className="btn-secondary btn-sm" style={{ fontSize: 11 }}
                            onClick={() => applyFix(issue.fix!, issue.id)}
                            disabled={fixing === issue.fix + (issue.id ?? '')}>
                            {fixing === issue.fix + (issue.id ?? '') ? <span className="spinner" /> : 'Auto-fix'}
                          </button>
                        ) : <span className="text-dim" style={{ fontSize: 11 }}>Manual</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
