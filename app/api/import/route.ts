import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
  // merge-duplicates: UPDATE existing rows, INSERT new ones
  // return=minimal: don't return row data (faster)
  // NOTE: columns NOT included in the payload are left unchanged (notes, created_at, etc.)
  'Prefer':        'resolution=merge-duplicates,return=minimal',
}

function digitsOnly(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d.length === 10 ? d : d
}

function clean(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return ['', ' ', 'nan', 'None', 'N/A', 'NaN', 'null', 'undefined'].includes(s.toLowerCase()) ? null : s
}

const OFFICE_MAP: Record<string, string> = {
  '571689935-00002': 'ASC',
  '571689935-00003': 'CYC',
  '571689935-00004': 'SDY',
  '571689935-00010': 'DEN',
  '571689935-00007': 'Staff',
  '571689935-00009': 'Staff',
}

async function upsertBatch(table: string, conflict: string, records: Record<string, unknown>[]): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(records) })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Upsert ${table} failed (${res.status}): ${txt.slice(0, 300)}`)
  }
}

// Upsert in batches, calling onProgress after each batch
async function upsertAll(
  table: string,
  conflict: string,
  records: Record<string, unknown>[],
  batchSize = 200,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < records.length; i += batchSize) {
    await upsertBatch(table, conflict, records.slice(i, i + batchSize))
    onProgress?.(Math.min(i + batchSize, records.length), records.length)
  }
}

// ── Parse CCSI xlsx ──────────────────────────────────────────────────────────
async function parseCCSI(buffer: ArrayBuffer): Promise<{ records: Record<string, unknown>[]; counts: Record<string, number> }> {
  const XLSX = await import('xlsx')
  const wb   = XLSX.read(buffer, { type: 'array' })

  const SHEETS: Record<string, string> = {
    'Active Vehicles': 'Active Vehicles',
    'Test Vehicles':   'Test Vehicles',
    'Surrenders':      'Surrenders',
  }

  const seen  = new Map<string, Record<string, unknown>>()
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

      // IMPORTANT: 'notes' is intentionally excluded — it is only editable in the portal
      // and must never be overwritten by a spreadsheet import.
      seen.set(`${vnum}|${fleet}`, {
        vehicle_number:               vnum,
        fleet_id:                     fleet,
        sheet_tab:                    tabLabel,
        driver_app_version:           clean(row['Driver App Version']),
        pim_app_version:              clean(row['PIM App Version']),
        online_status:                clean(row['Online Status']),
        driver_tablet_bluetooth_addr: clean(row['Driver Tablet Bluetooth Address']),
        meter_status:                 clean(row['Meter Status']),
        driver_tablet_phone_number:   dp,
        pim_phone_number:             pp,
        rfid:                         clean(row['RFID']),
        meter_bluetooth_name:         clean(row['(Meter) Bluetooth Name']),
        driver_phone_norm:            digitsOnly(dp),
        pim_phone_norm:               digitsOnly(pp),
        vehicle_name_key:             `${vnum}${fleet}`.toLowerCase(),
        updated_at:                   new Date().toISOString(),
        // office and notes are NOT set here:
        // - office is computed by DB trigger from fleet_id
        // - notes must never be overwritten by import
      })
      n++
    }
    counts[sheetName] = n
  }

  return { records: Array.from(seen.values()), counts }
}

// ── Parse CSV ────────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
}

// ── Parse Devices CSV ────────────────────────────────────────────────────────
function parseDevices(text: string): Record<string, unknown>[] {
  const rows = parseCSV(text)
  const seen = new Map<string, Record<string, unknown>>()

  for (const row of rows) {
    const m360Id = clean(row['Device ID'])
    if (!m360Id) continue

    let imei: string | null = null
    const imeiRaw = row['IMEI/MEID']
    if (imeiRaw?.trim()) {
      const n = parseFloat(imeiRaw)
      imei = isNaN(n) ? clean(imeiRaw) : String(Math.round(n))
    }

    const user  = clean(row['Username'])
    const dname = clean(row['Device Name'])
    const nameKey = dname ? dname.replace(/^\*+/, '').split('-')[0].toLowerCase() : null

    seen.set(m360Id, {
      m360_device_id:    m360Id,
      device_name:       dname,
      m360_user:         user,
      m360_user_norm:    digitsOnly(user),
      name_key:          nameKey,
      tablet_model:      clean(row['Model']),
      android_os:        clean(row['Operating System']),
      imei,
      m360_policy:       clean(row['MDM Policy']),
      compliance_status: clean(row['Compliance Status']),
      last_reported:     clean(row['Last Reported']),
      updated_at:        new Date().toISOString(),
    })
  }
  return Array.from(seen.values())
}

// ── Parse Verizon CSV ────────────────────────────────────────────────────────
function parseVerizon(text: string): Record<string, unknown>[] {
  const rows = parseCSV(text)
  const seen = new Map<string, Record<string, unknown>>()

  for (const row of rows) {
    const rawPhone = clean(row['Wireless number'])
    if (!rawPhone) continue
    const phone = digitsOnly(rawPhone)
    if (phone.length < 10) continue

    let usage: number | null = null
    const usageRaw = row['Domestic GB']
    if (usageRaw?.trim()) {
      const n = parseFloat(usageRaw)
      if (!isNaN(n)) usage = n
    }

    const acctNum = clean(row['Account number'])
    seen.set(phone, {
      phone_number:     phone,
      phone_norm:       phone,
      sub_account:      clean(row['Account name']),
      account_number:   acctNum,
      office:           acctNum ? (OFFICE_MAP[acctNum] ?? null) : null,
      phone_status:     clean(row['Wireless number status']),
      verizon_user:     clean(row['User name']),
      mobile_plan:      clean(row['Price plan description']),
      monthly_usage_gb: usage,
      updated_at:       new Date().toISOString(),
    })
  }
  return Array.from(seen.values())
}


// ── Parse Drivers xlsx ────────────────────────────────────────────────────────
async function parseDrivers(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx')
  const wb   = XLSX.read(buffer, { type: 'array' })
  const ws   = wb.Sheets['Active Drivers']
  if (!ws) throw new Error('Sheet "Active Drivers" not found in workbook')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const seen = new Map<number, Record<string, unknown>>()

  const FLEET_OFFICE: Record<string, string> = {
    C: 'CYC', G: 'SDY', D: 'DEN',
    E: 'ASC', L: 'ASC', S: 'ASC', Y: 'ASC', U: 'ASC',
  }

  for (const row of rows) {
    const driverId = row['Driver ID']
    if (driverId == null) continue
    const id = parseInt(String(driverId), 10)
    if (isNaN(id)) continue

    const fleet   = clean(row['Fleet ID']) ?? ''
    const imageUrl = clean(row['imageUrl'])  // Keep full URL including datetime cache param

    seen.set(id, {
      driver_id:   id,
      fleet_id:    fleet,
      office:      FLEET_OFFICE[fleet.toUpperCase()] ?? null,
      name:        clean(row['Name']),
      email:       clean(row['Driver Email Address']),
      image_url:   imageUrl,
      active:      String(row['Driver Active']).toUpperCase() === 'Y',
      updated_at:  new Date().toISOString(),
    })
  }
  return Array.from(seen.values())
}


// ── Parse Square transactions CSV ─────────────────────────────────────────────
function parseTransactions(text: string): Record<string, unknown>[] {
  const lines  = text.split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const records: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) ?? []
    const row: Record<string, unknown> = {}
    headers.forEach((h, j) => { row[h] = (cols[j] ?? '').replace(/^"|"$/g, '').trim() })
    if (!row['Transaction ID'] && !row['transaction_id']) continue
    records.push({
      transaction_id:   row['Transaction ID'] ?? row['transaction_id'],
      transaction_date: row['Date'] ?? row['transaction_date'],
      amount:           parseFloat(String(row['Amount'] ?? row['amount'] ?? '0').replace(/[^0-9.-]/g, '')) || 0,
      payment_type:     row['Payment Method'] ?? row['payment_type'] ?? null,
      device_name:      row['Device Name'] ?? row['device_name'] ?? null,
      location:         row['Location'] ?? row['location'] ?? null,
      description:      row['Description'] ?? row['description'] ?? null,
      status:           row['Status'] ?? row['status'] ?? null,
      vehicle_id:       null,   // always present — set during vehicle linking below
      raw:              JSON.stringify(row).slice(0, 500),
      updated_at:       new Date().toISOString(),
    })
  }
  return records
}

// ── Detect file type ─────────────────────────────────────────────────────────
function detectType(filename: string, text: string): 'ccsi' | 'drivers' | 'devices' | 'verizon' | 'transactions' | null {
  const lower = filename.toLowerCase()
  if (lower.includes('transaction')) return 'transactions'
  if (lower.includes('driver') && lower.endsWith('.xlsx')) return 'drivers'
  if (lower.endsWith('.xlsx')) return 'ccsi'
  if (lower.includes('view_all_devices') || lower.includes('devices')) return 'devices'
  if (lower.includes('unbilled') || lower.includes('usage') || lower.includes('account')) return 'verizon'
  const firstLine = text.slice(0, 300).toLowerCase()
  if (firstLine.includes('wireless number')) return 'verizon'
  if (firstLine.includes('device id') && firstLine.includes('imei')) return 'devices'
  return null
}

// ── Streaming route handler ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const supabaseService = await createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  // Use a ReadableStream to send progress events as NDJSON lines
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        send({ type: 'start', filename: file.name })

        const buffer = await file.arrayBuffer()
        const isXlsx = file.name.toLowerCase().endsWith('.xlsx')
        const text   = isXlsx ? '' : new TextDecoder().decode(buffer)
        const type   = detectType(file.name, text)

        if (!type) {
          send({ type: 'error', error: `Could not identify file type for "${file.name}". Expected CCSI.xlsx, View_All_Devices.csv, or account_unbilled_usage_report.csv` })
          controller.close(); return
        }

        send({ type: 'progress', stage: 'parsing', message: `Parsing ${file.name}…`, pct: 5 })

        let records: Record<string, unknown>[] = []
        let message = ''
        let counts: Record<string, number> = {}

        if (type === 'transactions') {
          const txRecs = parseTransactions(text)

          // Link transactions to vehicles by device_name → name_key
          const { data: vehRows } = await supabaseService
            .from('vehicles').select('id,vehicle_name_key')
          const vehKeyMap = new Map<string, string>()
          for (const v of vehRows ?? []) if (v.vehicle_name_key) vehKeyMap.set(v.vehicle_name_key, v.id)

          // Also build vehicle_number → id map for Location-based matching
          const vehNumMap = new Map<number, string>()
          for (const v of vehRows ?? []) {
            const match = v.vehicle_name_key?.match(/^(\d+)/)
            if (match) vehNumMap.set(parseInt(match[1]), v.id)
          }

          for (const tx of txRecs) {
            // Try device_name first: "6390E-SM-T387V" → name_key "6390e"
            const dname = String(tx.device_name ?? '')
            const nameKey = dname ? dname.replace(/^\*+/, '').split('-')[0].toLowerCase() : null
            let vehicleId = nameKey ? (vehKeyMap.get(nameKey) ?? null) : null

            // Fallback: parse vehicle number from Location "Cab #6020"
            if (!vehicleId) {
              const loc = String(tx.location ?? '')
              const locMatch = loc.match(/(?:cab|vehicle|#)\s*#?\s*(\d{1,4})/i)
              if (locMatch) vehicleId = vehNumMap.get(parseInt(locMatch[1])) ?? null
            }

            tx.vehicle_id = vehicleId  // always set (null if no match)
          }

          await upsertAll('transactions', 'transaction_id', txRecs, 200, (done, total) => {
            const pct = 15 + Math.round((done / total) * 80)
            send({ type: 'progress', stage: 'upserting', message: `Saving ${done} / ${total}…`, pct, done, total })
          })
          send({ type: 'done', total: txRecs.length, message: `Imported ${txRecs.length} transactions` })
          await writeAuditLog({ userEmail: user.email!, action: 'import_transactions', targetType: 'device', targetId: file.name, payload: { filename: file.name }, result: { total: txRecs.length }, success: true })
          controller.close(); return
        } else if (type === 'drivers') {
          const driverRecs = await parseDrivers(buffer)
          await upsertAll('drivers', 'driver_id', driverRecs, 200, (done, total) => {
            const pct = 15 + Math.round((done / total) * 80)
            send({ type: 'progress', stage: 'upserting', message: `Saving ${done} / ${total}…`, pct, done, total })
          })
          send({ type: 'done', total: driverRecs.length, message: `Imported ${driverRecs.length} drivers` })
          await writeAuditLog({ userEmail: user.email!, action: 'import_drivers', targetType: 'device', targetId: file.name, payload: { filename: file.name }, result: { total: driverRecs.length }, success: true })
          controller.close(); return
        } else if (type === 'ccsi') {
          const result = await parseCCSI(buffer)
          records = result.records
          counts  = result.counts
          message = `Parsed ${records.length} vehicles across ${Object.keys(counts).length} sheets`
        } else if (type === 'devices') {
          records = parseDevices(text)
          message = `Parsed ${records.length} devices`
        } else {
          records = parseVerizon(text)
          message = `Parsed ${records.length} Verizon lines`
        }

        send({ type: 'progress', stage: 'parsed', message, pct: 15, total: records.length })

        // Upsert with progress
        const table    = type === 'ccsi' ? 'vehicles' : type === 'devices' ? 'devices' : 'verizon_lines'
        const conflict = type === 'ccsi' ? 'vehicle_number,fleet_id' : type === 'devices' ? 'm360_device_id' : 'phone_number'
        const BATCH    = 200

        await upsertAll(table, conflict, records, BATCH, (done, total) => {
          const pct = 15 + Math.round((done / total) * 80)
          send({ type: 'progress', stage: 'upserting', message: `Saving ${done} / ${total}…`, pct, done, total })
        })

        send({ type: 'progress', stage: 'done', message: `Complete`, pct: 100 })

        await writeAuditLog({
          userEmail:  user.email!,
          action:     `import_${type}`,
          targetType: 'device',
          targetId:   file.name,
          payload:    { filename: file.name, size: file.size, counts },
          result:     { total: records.length },
          success:    true,
        })

        send({ type: 'done', total: records.length, message: `Imported ${records.length} ${type} records`, counts })

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send({ type: 'error', error: message })
        await writeAuditLog({
          userEmail:  user?.email ?? 'unknown',
          action:     'import_unknown',
          targetType: 'device',
          targetId:   file.name,
          result:     { error: message },
          success:    false,
        }).catch(() => {})
      }

      controller.close()
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type':  'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
