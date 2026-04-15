import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'
import { gunzipSync } from 'node:zlib'

// Vercel serverless function timeout — 60s on Pro, 10s on Hobby
export const maxDuration = 60

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

// ── Parse Tableau "Driver Report" ─────────────────────────────────────────────
// Tableau quirks: file is UTF-16LE with a BOM, fields are TAB-separated (not
// commas), and the phone column looks like "323 7105857 (PORT.)". Decoded by
// detectAndDecodeTextFile() before reaching here.
//
// Maps onto public.drivers — populates personal_phone, drivers_license,
// drivers_license_expire, address, etc. Driver names are split into First +
// Last in the report; we recombine "FIRST LAST" for the existing `name` field.
function parseDriverReport(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Tableau uses tabs even in .csv exports
  const splitRow = (l: string) => l.split('\t').map(s => s.trim())

  const headers = splitRow(lines[0])
  const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase())

  const iFleet     = idx('Fleet ID')
  const iDriver    = idx('Driver ID')
  const iActive    = idx('Active')
  const iAllowed   = idx('Allowed To Work')
  const iCity      = idx('City')
  const iLicExp    = idx('Drv License Expire')
  const iLicNbr    = idx('Drv License Nbr')
  const iEmail     = idx('Email Address')
  const iFirst     = idx('First Name')
  const iInsert    = idx('Insert Date')
  const iLast      = idx('Last Name')
  const iCmplnts   = idx('Nbr Complaints')
  const iPhone     = idx('Phone - PORT')
  const iState     = idx('State')
  const iStreet1   = idx('Street1')
  const iStreet2   = idx('Street2')
  const iZip       = idx('Zip Code')

  if (iDriver < 0 || iFleet < 0) {
    throw new Error('Driver Report: missing required "Driver ID" or "Fleet ID" column')
  }

  // "323 7105857 (PORT.)" → "3237105857"; tolerate "(none)" / "" / leading 1
  const cleanPhone = (raw: string | undefined): string | null => {
    const s = (raw ?? '').replace(/\(port\.?\)/i, '').replace(/\D/g, '')
    if (!s) return null
    const trimmed = s.length === 11 && s[0] === '1' ? s.slice(1) : s
    return trimmed.length === 10 ? trimmed : null
  }

  // "2024-10-04 00:00:00" → "2024-10-04"; tolerate empty / malformed
  const cleanDate = (raw: string | undefined): string | null => {
    const s = (raw ?? '').trim().slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }

  const seen = new Map<number, Record<string, unknown>>()
  const now  = new Date().toISOString()

  for (let r = 1; r < lines.length; r++) {
    const cols = splitRow(lines[r])
    const driverIdRaw = cols[iDriver]
    const id = parseInt((driverIdRaw ?? '').trim(), 10)
    if (isNaN(id)) continue

    const fleet = (cols[iFleet] ?? '').trim()
    const first = clean(cols[iFirst])
    const last  = clean(cols[iLast])
    const fullName = [first, last].filter(Boolean).join(' ').trim() || null

    const personalPhone = iPhone >= 0 ? cleanPhone(cols[iPhone]) : null
    const activeRaw = clean(cols[iActive]) ?? ''
    const allowedRaw = iAllowed >= 0 ? clean(cols[iAllowed]) ?? '' : ''
    const cmpltRaw  = iCmplnts >= 0 ? cols[iCmplnts] : ''
    const cmpltN    = cmpltRaw ? parseInt(cmpltRaw, 10) : NaN

    seen.set(id, {
      driver_id:              id,
      fleet_id:               fleet,
      // office is computed by DB trigger from fleet_id
      name:                   fullName,
      email:                  iEmail >= 0 ? clean(cols[iEmail]) : null,
      active:                 activeRaw.toUpperCase() === 'Y',
      allowed_to_work:        allowedRaw ? allowedRaw.toUpperCase() === 'Y' : null,
      personal_phone:         personalPhone,
      // personal_phone_norm is auto-set by DB trigger
      drivers_license:        iLicNbr >= 0 ? clean(cols[iLicNbr]) : null,
      drivers_license_expire: iLicExp >= 0 ? cleanDate(cols[iLicExp]) : null,
      // drivers_license_state isn't in the Tableau report — column "State" is the
      // address state, populated below
      city:                   iCity >= 0 ? clean(cols[iCity]) : null,
      state:                  iState >= 0 ? clean(cols[iState]) : null,
      street1:                iStreet1 >= 0 ? clean(cols[iStreet1]) : null,
      street2:                iStreet2 >= 0 ? clean(cols[iStreet2]) : null,
      zip_code:               iZip >= 0 ? clean(cols[iZip]) : null,
      insert_date:            iInsert >= 0 ? cleanDate(cols[iInsert]) : null,
      complaints_count:       Number.isFinite(cmpltN) ? cmpltN : null,
      updated_at:             now,
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


// Decode a CSV/TSV file buffer, auto-detecting UTF-16LE/BE BOM (Tableau exports
// are UTF-16LE) and falling back to UTF-8.
function decodeTextFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer).replace(/^\uFEFF/, '')
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer).replace(/^\uFEFF/, '')
  }
  return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '')
}

// ── Detect file type ─────────────────────────────────────────────────────────
function detectType(filename: string, text: string): 'ccsi' | 'drivers' | 'driver_report' | 'devices' | 'verizon' | null {
  const lower = filename.toLowerCase()
  if (lower.includes('driver') && lower.endsWith('.xlsx')) return 'drivers'
  if (lower.endsWith('.xlsx')) return 'ccsi'
  // Tableau driver report — recognized by filename or by header signature
  if (lower.includes('driver report') || lower.includes('driver_report')) return 'driver_report'
  if (lower.includes('view_all_devices') || lower.includes('devices')) return 'devices'
  if (lower.includes('unbilled') || lower.includes('usage') || lower.includes('account')) return 'verizon'
  const firstLine = text.slice(0, 600).toLowerCase()
  // Tableau driver report uses tabs and has these distinctive columns
  if (firstLine.includes('drv license nbr') || (firstLine.includes('phone - port') && firstLine.includes('driver id'))) {
    return 'driver_report'
  }
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

  // Support two upload formats:
  // 1. Gzip binary body with X-Filename header (new — avoids Vercel 4.5 MB payload limit)
  // 2. Legacy FormData multipart (fallback for smaller files or older clients)
  let fileName: string
  let fileBuffer: ArrayBuffer

  const xFilename = req.headers.get('x-filename')
  if (xFilename) {
    // Gzip binary upload path
    fileName = decodeURIComponent(xFilename)
    const raw = await req.arrayBuffer()
    const isGzipped = req.headers.get('content-encoding') === 'gzip'
    fileBuffer = isGzipped ? gunzipSync(Buffer.from(raw)).buffer as ArrayBuffer : raw
  } else {
    // Legacy FormData path
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    fileName = file.name
    fileBuffer = await file.arrayBuffer()
  }

  // Use a ReadableStream to send progress events as NDJSON lines
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        send({ type: 'start', filename: fileName })

        const buffer = fileBuffer
        const isXlsx = fileName.toLowerCase().endsWith('.xlsx')
        // decodeTextFile() handles UTF-16 BOM (Tableau quirk) + UTF-8 fallback
        const text   = isXlsx ? '' : decodeTextFile(buffer)
        const type   = detectType(fileName, text)

        if (!type) {
          send({ type: 'error', error: `Could not identify file type for "${fileName}". Expected CCSI.xlsx, Active Drivers.xlsx, Driver Report.csv, View_All_Devices.csv, or account_unbilled_usage_report.csv` })
          controller.close(); return
        }

        send({ type: 'progress', stage: 'parsing', message: `Parsing ${fileName}…`, pct: 5 })

        let records: Record<string, unknown>[] = []
        let message = ''
        let counts: Record<string, number> = {}

        if (type === 'drivers') {
          const driverRecs = await parseDrivers(buffer)
          await upsertAll('drivers', 'driver_id', driverRecs, 200, (done, total) => {
            const pct = 15 + Math.round((done / total) * 80)
            send({ type: 'progress', stage: 'upserting', message: `Saving ${done} / ${total}…`, pct, done, total })
          })
          send({ type: 'done', total: driverRecs.length, message: `Imported ${driverRecs.length} drivers` })
          await writeAuditLog({ userEmail: user.email!, action: 'import_drivers', targetType: 'device', targetId: fileName, payload: { filename: fileName }, result: { total: driverRecs.length }, success: true })
          controller.close(); return
        } else if (type === 'driver_report') {
          // Tableau Driver Report → drivers (license, address, personal phone)
          const drvRecs = parseDriverReport(text)
          if (drvRecs.length === 0) {
            send({ type: 'error', error: 'Driver Report parsed 0 rows. Check that the file is the Tableau export with the expected columns (Fleet ID, Driver ID, Phone - PORT, Drv License Nbr, …).' })
            controller.close(); return
          }
          await upsertAll('drivers', 'driver_id', drvRecs, 200, (done, total) => {
            const pct = 15 + Math.round((done / total) * 80)
            send({ type: 'progress', stage: 'upserting', message: `Saving ${done} / ${total}…`, pct, done, total })
          })
          await writeAuditLog({ userEmail: user.email!, action: 'import_driver_report', targetType: 'device', targetId: fileName, payload: { filename: fileName, size: fileBuffer.byteLength }, result: { total: drvRecs.length }, success: true })
          send({ type: 'done', total: drvRecs.length, message: `Imported ${drvRecs.length} driver-report rows (license, phone, address)` })
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
          targetId:   fileName,
          payload:    { filename: fileName, size: fileBuffer.byteLength, counts },
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
          targetId:   fileName,
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
