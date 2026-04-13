/**
 * Shared CCSI.xlsx parser.
 *
 * Used by both the bulk import route (/api/import) and the churn reconciliation
 * route (/api/import/reconcile) which compares CCSI against the DB and surfaces
 * new / missing / moved vehicles before making any destructive changes.
 */

function digitsOnly(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

function clean(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return ['', ' ', 'nan', 'none', 'n/a', 'null', 'undefined'].includes(s.toLowerCase()) ? null : s
}

export type CcsiRecord = {
  vehicle_number: number
  fleet_id: string
  sheet_tab: string
  driver_app_version: string | null
  pim_app_version: string | null
  online_status: string | null
  driver_tablet_bluetooth_addr: string | null
  meter_status: string | null
  driver_tablet_phone_number: string | null
  pim_phone_number: string | null
  rfid: string | null
  meter_bluetooth_name: string | null
  driver_phone_norm: string
  pim_phone_norm: string
  vehicle_name_key: string
  updated_at: string
}

export async function parseCCSI(buffer: ArrayBuffer): Promise<{ records: CcsiRecord[]; counts: Record<string, number> }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array' })

  const SHEETS: Record<string, string> = {
    'Active Vehicles': 'Active Vehicles',
    'Test Vehicles':   'Test Vehicles',
    'Surrenders':      'Surrenders',
  }

  const seen = new Map<string, CcsiRecord>()
  const counts: Record<string, number> = {}

  for (const [sheetName, tabLabel] of Object.entries(SHEETS)) {
    const ws = wb.Sheets[sheetName]
    if (!ws) { counts[sheetName] = 0; continue }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    let n = 0
    for (const row of rows) {
      const vnumRaw = row['Vehicle #']
      if (vnumRaw == null) continue
      const vnum = parseInt(String(vnumRaw), 10)
      if (isNaN(vnum)) continue

      const fleet = clean(row['Fleet ID']) ?? ''
      const dp    = clean(row['Driver Tablet Phone Number'])
      const pp    = clean(row['PIM Phone Number'])

      seen.set(`${vnum}|${fleet}`, {
        vehicle_number: vnum,
        fleet_id: fleet,
        sheet_tab: tabLabel,
        driver_app_version: clean(row['Driver App Version']),
        pim_app_version: clean(row['PIM App Version']),
        online_status: clean(row['Online Status']),
        driver_tablet_bluetooth_addr: clean(row['Driver Tablet Bluetooth Address']),
        meter_status: clean(row['Meter Status']),
        driver_tablet_phone_number: dp,
        pim_phone_number: pp,
        rfid: clean(row['RFID']),
        meter_bluetooth_name: clean(row['(Meter) Bluetooth Name']),
        driver_phone_norm: digitsOnly(dp),
        pim_phone_norm: digitsOnly(pp),
        vehicle_name_key: `${vnum}${fleet}`.toLowerCase(),
        updated_at: new Date().toISOString(),
      })
      n++
    }
    counts[sheetName] = n
  }

  return { records: Array.from(seen.values()), counts }
}

export type ReconcileDiff = {
  newVehicles: CcsiRecord[]                 // In CCSI, not in DB
  missingVehicles: { vehicle_number: number; fleet_id: string; sheet_tab: string | null }[]  // In DB, not in CCSI
  tabChanges: { vehicle_number: number; fleet_id: string; from: string | null; to: string }[]  // Existing but moved sheet_tab (e.g., Active → Surrenders)
  unchangedCount: number
  ccsiCount: number
  dbCount: number
}
