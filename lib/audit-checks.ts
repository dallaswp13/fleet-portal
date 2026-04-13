/**
 * Data Auditor — cross-source integrity checks.
 *
 * These checks exist because the portal imports from three independent sources
 * (CCSI, MaaS360, Verizon) that can disagree. Disagreements are where bugs
 * live. Each check returns a typed set of rows so a mis-match can't silently
 * become a "phone available → reassign → driver loses network" incident.
 *
 * Run all checks server-side via runAllChecks(); individual checks are also
 * exported for ad-hoc use.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface AuditSection {
  id: string
  title: string
  description: string
  severity: Severity
  count: number
  rows: Record<string, unknown>[]
  columns: { key: string; label: string }[]
  /** Natural-language explanation of what would need to be true for this count
   *  to go back to zero. Shown in the UI so Dallas knows how to resolve. */
  remediation?: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Supabase REST caps SELECT at 1000 rows. Paginate with .range() to get all. */
async function fetchAll<T = Record<string, unknown>>(
  svc: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let start = 0; start < 100_000; start += PAGE) {
    const q = svc.from(table).select(columns).range(start, start + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(`fetchAll ${table}: ${error.message}`)
    const batch = (data ?? []) as T[]
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

function isActivePhoneStatus(s: string | null | undefined): boolean {
  if (!s) return false
  const v = s.toLowerCase()
  // Verizon uses "Active" / "Suspended" / "Disconnected" / "Cancelled" / etc.
  return v === 'active' || v.startsWith('active')
}

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  vehicle_number: number
  fleet_id: string
  sheet_tab: string | null
  vehicle_name_key: string | null
  driver_phone_norm: string | null
  pim_phone_norm: string | null
  driver_tablet_phone_number: string | null
  pim_phone_number: string | null
  updated_at: string | null
}

interface VerizonLine {
  phone_number: string | null
  phone_norm: string | null
  phone_status: string | null
  sub_account: string | null
  office: string | null
  updated_at: string | null
}

interface Device {
  m360_device_id: string | null
  device_name: string | null
  name_key: string | null
  m360_user: string | null
  m360_user_norm: string | null
  updated_at: string | null
}

interface Driver {
  driver_id: number
  fleet_id: string
  name: string | null
  active: boolean | null
  personal_phone_norm: string | null
}

// ── individual checks ─────────────────────────────────────────────────────────

/** A — Phone-status conflicts: a cab is using a line Verizon no longer considers active. */
function phoneStatusConflicts(vehicles: Vehicle[], lines: VerizonLine[]): AuditSection {
  const inactiveByPhone = new Map<string, VerizonLine>()
  for (const l of lines) {
    const p = l.phone_norm ?? digits(l.phone_number)
    if (!p) continue
    if (!isActivePhoneStatus(l.phone_status)) inactiveByPhone.set(p, l)
  }

  const rows: Record<string, unknown>[] = []
  for (const v of vehicles) {
    if (v.sheet_tab !== 'Active Vehicles') continue
    for (const [role, norm, displayKey] of [
      ['Driver', v.driver_phone_norm, 'driver_tablet_phone_number'],
      ['PIM', v.pim_phone_norm, 'pim_phone_number'],
    ] as const) {
      if (!norm) continue
      const badLine = inactiveByPhone.get(norm)
      if (!badLine) continue
      rows.push({
        vehicle: `#${v.vehicle_number}${(v.fleet_id ?? '').toUpperCase()}`,
        role,
        phone_on_vehicle: v[displayKey],
        phone_status: badLine.phone_status,
        sub_account: badLine.sub_account,
      })
    }
  }
  return {
    id: 'phone-conflicts',
    title: 'Phone line inactive but still assigned',
    description: 'Verizon reports this line is not Active, yet CCSI has it assigned to a working cab. These drivers can lose network mid-shift.',
    severity: 'critical',
    count: rows.length,
    rows,
    columns: [
      { key: 'vehicle', label: 'Vehicle' },
      { key: 'role', label: 'Role' },
      { key: 'phone_on_vehicle', label: 'Phone on cab' },
      { key: 'phone_status', label: 'Verizon status' },
      { key: 'sub_account', label: 'Verizon sub-account' },
    ],
    remediation: 'Either swap in an Active line or correct the phone status in the next Verizon export.',
  }
}

/** B — Phantom assignments: cab claims a line Verizon has no record of. */
function phantomAssignments(vehicles: Vehicle[], lines: VerizonLine[]): AuditSection {
  const knownPhones = new Set<string>()
  for (const l of lines) {
    const p = l.phone_norm ?? digits(l.phone_number)
    if (p) knownPhones.add(p)
  }
  const rows: Record<string, unknown>[] = []
  for (const v of vehicles) {
    if (v.sheet_tab !== 'Active Vehicles') continue
    for (const [role, norm, displayKey] of [
      ['Driver', v.driver_phone_norm, 'driver_tablet_phone_number'],
      ['PIM', v.pim_phone_norm, 'pim_phone_number'],
    ] as const) {
      if (!norm || norm.length < 10) continue
      if (!knownPhones.has(norm)) {
        rows.push({
          vehicle: `#${v.vehicle_number}${(v.fleet_id ?? '').toUpperCase()}`,
          role,
          phone_on_vehicle: v[displayKey],
        })
      }
    }
  }
  return {
    id: 'phantom-assignments',
    title: 'Cab references a line Verizon does not know about',
    description: 'The phone number on this vehicle is not present in the Verizon export at all. Either the number is mistyped in CCSI, or the line is on a different account we do not import.',
    severity: 'high',
    count: rows.length,
    rows,
    columns: [
      { key: 'vehicle', label: 'Vehicle' },
      { key: 'role', label: 'Role' },
      { key: 'phone_on_vehicle', label: 'Phone on cab' },
    ],
    remediation: 'Verify the phone number typed into CCSI matches a line Verizon can see. Re-upload both CCSI and Verizon if stale.',
  }
}

/** C — Duplicate line assignments: same phone on multiple vehicles. */
function duplicateLineAssignments(vehicles: Vehicle[]): AuditSection {
  const byPhone = new Map<string, { vehicles: string[]; roles: string[] }>()
  for (const v of vehicles) {
    if (v.sheet_tab === 'Surrenders') continue
    for (const [role, norm] of [
      ['Driver', v.driver_phone_norm],
      ['PIM', v.pim_phone_norm],
    ] as const) {
      if (!norm || norm.length < 10) continue
      const label = `#${v.vehicle_number}${(v.fleet_id ?? '').toUpperCase()} (${role})`
      const entry = byPhone.get(norm) ?? { vehicles: [], roles: [] }
      entry.vehicles.push(label)
      entry.roles.push(role)
      byPhone.set(norm, entry)
    }
  }
  const rows: Record<string, unknown>[] = []
  for (const [phone, { vehicles: assigned }] of byPhone) {
    if (assigned.length > 1) {
      rows.push({
        phone,
        assignments: assigned.join(' · '),
        count: assigned.length,
      })
    }
  }
  rows.sort((a, b) => (b.count as number) - (a.count as number))
  return {
    id: 'duplicate-lines',
    title: 'Same phone assigned to multiple vehicles',
    description: 'A single Verizon line appears on more than one row in CCSI. One of these cabs will lose network, because the SIM can only be in one tablet.',
    severity: 'high',
    count: rows.length,
    rows,
    columns: [
      { key: 'phone', label: 'Phone' },
      { key: 'assignments', label: 'Assigned to' },
      { key: 'count', label: 'Copies' },
    ],
    remediation: 'Identify which cab physically has the SIM and remove the number from the other CCSI rows.',
  }
}

/** D — Unassigned active lines: pool candidates, review before the finder auto-suggests them. */
function unassignedActiveLines(vehicles: Vehicle[], lines: VerizonLine[]): AuditSection {
  const usedPhones = new Set<string>()
  for (const v of vehicles) {
    if (v.sheet_tab === 'Surrenders') continue
    if (v.driver_phone_norm) usedPhones.add(v.driver_phone_norm)
    if (v.pim_phone_norm) usedPhones.add(v.pim_phone_norm)
  }
  const rows: Record<string, unknown>[] = []
  for (const l of lines) {
    if (!isActivePhoneStatus(l.phone_status)) continue
    const p = l.phone_norm ?? digits(l.phone_number)
    if (!p) continue
    if (!usedPhones.has(p)) {
      rows.push({
        phone: l.phone_number,
        office: l.office,
        sub_account: l.sub_account,
        phone_status: l.phone_status,
      })
    }
  }
  return {
    id: 'unassigned-active-lines',
    title: 'Active lines not assigned to any cab',
    description: 'These are the pool of lines the available-line finder would draw from. Review this list before trusting automated suggestions — any line here will be offered as "available".',
    severity: 'medium',
    count: rows.length,
    rows,
    columns: [
      { key: 'phone', label: 'Phone' },
      { key: 'office', label: 'Office' },
      { key: 'sub_account', label: 'Sub-account' },
      { key: 'phone_status', label: 'Verizon status' },
    ],
    remediation: 'Confirm each line really is unassigned. If one is actually in-use but not on a cab record, update CCSI so it stops appearing here.',
  }
}

/** E — Orphan devices: MaaS360 has devices whose name_key matches no vehicle. */
function orphanDevices(vehicles: Vehicle[], devices: Device[]): AuditSection {
  const validKeys = new Set<string>()
  for (const v of vehicles) if (v.vehicle_name_key) validKeys.add(v.vehicle_name_key)
  const rows: Record<string, unknown>[] = []
  for (const d of devices) {
    if (!d.name_key) continue
    // PIM devices use leading * prefix — they decode to a name_key the vehicle shares
    if (!validKeys.has(d.name_key)) {
      rows.push({
        device_name: d.device_name,
        name_key: d.name_key,
        m360_user: d.m360_user,
      })
    }
  }
  return {
    id: 'orphan-devices',
    title: 'MaaS360 devices that do not map to a vehicle',
    description: 'These devices exist in MaaS360 but their name_key does not match any vehicle_name_key. Either the device is retired, the CCSI sheet is missing a cab, or the device-name convention broke.',
    severity: 'medium',
    count: rows.length,
    rows,
    columns: [
      { key: 'device_name', label: 'Device name' },
      { key: 'name_key', label: 'Computed name_key' },
      { key: 'm360_user', label: 'MaaS360 user' },
    ],
    remediation: 'If the device should be retired, remove it from MaaS360. If the vehicle is missing from CCSI, add it.',
  }
}

/** F — Active vehicles without a device: cab running with no tracked tablet. */
function vehiclesMissingDevice(vehicles: Vehicle[], devices: Device[]): AuditSection {
  const deviceKeyCount = new Map<string, number>()
  for (const d of devices) {
    if (!d.name_key) continue
    deviceKeyCount.set(d.name_key, (deviceKeyCount.get(d.name_key) ?? 0) + 1)
  }
  const rows: Record<string, unknown>[] = []
  for (const v of vehicles) {
    if (v.sheet_tab !== 'Active Vehicles') continue
    if (!v.vehicle_name_key) continue
    if ((deviceKeyCount.get(v.vehicle_name_key) ?? 0) === 0) {
      rows.push({
        vehicle: `#${v.vehicle_number}${(v.fleet_id ?? '').toUpperCase()}`,
        name_key: v.vehicle_name_key,
      })
    }
  }
  return {
    id: 'vehicles-missing-device',
    title: 'Active vehicles with no matching device',
    description: 'An active cab should have at least one MaaS360 device enrolled under its name_key. These do not.',
    severity: 'medium',
    count: rows.length,
    rows,
    columns: [
      { key: 'vehicle', label: 'Vehicle' },
      { key: 'name_key', label: 'Expected name_key' },
    ],
    remediation: 'Enroll the tablet in MaaS360 using the vehicle_name_key convention, or retire the vehicle.',
  }
}

/** G — Active drivers with no personal phone: SMS pipeline can never link them. */
function driversMissingPhone(drivers: Driver[]): AuditSection {
  const rows: Record<string, unknown>[] = []
  for (const d of drivers) {
    if (d.active === false) continue
    if (!d.personal_phone_norm || d.personal_phone_norm.length < 10) {
      rows.push({
        driver_id: d.driver_id,
        name: d.name,
        fleet: (d.fleet_id ?? '').toUpperCase(),
      })
    }
  }
  return {
    id: 'drivers-missing-phone',
    title: 'Active drivers with no personal phone on file',
    description: 'Inbound SMS from these drivers will never auto-link to their record. Not a correctness bug, but it limits the rule engine.',
    severity: 'low',
    count: rows.length,
    rows,
    columns: [
      { key: 'driver_id', label: 'Driver #' },
      { key: 'name', label: 'Name' },
      { key: 'fleet', label: 'Fleet' },
    ],
    remediation: 'Re-upload the Tableau Driver Report once Dispatch has added the number.',
  }
}

/** H — Staleness: time since last update per source table. */
async function dataFreshness(svc: SupabaseClient): Promise<AuditSection> {
  const sources = [
    { table: 'vehicles',      label: 'CCSI (vehicles)' },
    { table: 'devices',       label: 'MaaS360 (devices)' },
    { table: 'verizon_lines', label: 'Verizon (lines)' },
    { table: 'drivers',       label: 'Drivers' },
  ] as const
  const rows: Record<string, unknown>[] = []
  const now = Date.now()
  for (const s of sources) {
    const { data } = await svc.from(s.table)
      .select('updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    const ts = data?.updated_at as string | undefined
    const ageMs = ts ? now - new Date(ts).getTime() : null
    const ageDays = ageMs != null ? Math.floor(ageMs / 86400_000) : null
    rows.push({
      source: s.label,
      last_updated: ts ? new Date(ts).toLocaleString() : '(never imported)',
      age_days: ageDays ?? '—',
      status: ageDays == null ? 'never' : ageDays > 30 ? 'STALE' : ageDays > 14 ? 'aging' : 'fresh',
    })
  }
  const stale = rows.filter(r => r.status === 'STALE' || r.status === 'never').length
  const aging = rows.filter(r => r.status === 'aging').length
  return {
    id: 'freshness',
    title: 'Data freshness by source',
    description: 'A source older than two weeks is probably out-of-date. A month is almost certainly wrong.',
    severity: stale > 0 ? 'high' : aging > 0 ? 'medium' : 'info',
    count: stale + aging,
    rows,
    columns: [
      { key: 'source', label: 'Source' },
      { key: 'last_updated', label: 'Last updated' },
      { key: 'age_days', label: 'Days ago' },
      { key: 'status', label: 'Status' },
    ],
    remediation: 'Upload the affected source via Settings → Update Database.',
  }
}

// ── orchestrator ──────────────────────────────────────────────────────────────

export async function runAllChecks(svc: SupabaseClient): Promise<AuditSection[]> {
  const [vehicles, lines, devices, drivers, freshness] = await Promise.all([
    fetchAll<Vehicle>(svc, 'vehicles',
      'id, vehicle_number, fleet_id, sheet_tab, vehicle_name_key, driver_phone_norm, pim_phone_norm, driver_tablet_phone_number, pim_phone_number, updated_at'),
    fetchAll<VerizonLine>(svc, 'verizon_lines',
      'phone_number, phone_norm, phone_status, sub_account, office, updated_at'),
    fetchAll<Device>(svc, 'devices',
      'm360_device_id, device_name, name_key, m360_user, m360_user_norm, updated_at'),
    fetchAll<Driver>(svc, 'drivers',
      'driver_id, fleet_id, name, active, personal_phone_norm'),
    dataFreshness(svc),
  ])

  return [
    phoneStatusConflicts(vehicles, lines),
    phantomAssignments(vehicles, lines),
    duplicateLineAssignments(vehicles),
    unassignedActiveLines(vehicles, lines),
    orphanDevices(vehicles, devices),
    vehiclesMissingDevice(vehicles, devices),
    driversMissingPhone(drivers),
    freshness,
  ]
}

export function sectionsToSummary(sections: AuditSection[]) {
  const by: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const s of sections) {
    if (s.count > 0) by[s.severity]++
  }
  return by
}
