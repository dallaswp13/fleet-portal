import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

// All available export fields with display labels
const ALL_FIELDS: { key: string; label: string; group: string }[] = [
  // Core
  { key: 'vehicle_number',  label: 'Vehicle #',           group: 'Core' },
  { key: 'fleet_id',        label: 'Fleet',               group: 'Core' },
  { key: 'office',          label: 'Office',              group: 'Core' },
  { key: 'sheet_tab',       label: 'Status (Sheet Tab)',  group: 'Core' },
  { key: 'online_status',   label: 'Online Status',       group: 'Core' },
  // Driver
  { key: 'driver_name',     label: 'Current Driver',      group: 'Driver' },
  { key: 'driver_lease',    label: 'Driver Lease #',      group: 'Driver' },
  // Driver Device
  { key: 'device_name',          label: 'Driver Tablet Name',      group: 'Driver Device' },
  { key: 'm360_device_id',       label: 'Driver M360 ID',          group: 'Driver Device' },
  { key: 'driver_app_version',   label: 'Driver App Version',      group: 'Driver Device' },
  { key: 'tablet_model',         label: 'Driver Tablet Model',     group: 'Driver Device' },
  { key: 'android_os',           label: 'Driver Android OS',       group: 'Driver Device' },
  { key: 'imei',                 label: 'Driver IMEI',             group: 'Driver Device' },
  { key: 'compliance_status',    label: 'Driver Compliance',       group: 'Driver Device' },
  { key: 'last_reported',        label: 'Driver Last Reported',    group: 'Driver Device' },
  // Driver Verizon
  { key: 'phone_number',         label: 'Driver Phone #',          group: 'Driver Verizon' },
  { key: 'monthly_usage_gb',     label: 'Driver Data Usage (GB)',  group: 'Driver Verizon' },
  { key: 'verizon_user',         label: 'Verizon User',            group: 'Driver Verizon' },
  { key: 'mobile_plan',          label: 'Mobile Plan',             group: 'Driver Verizon' },
  { key: 'phone_status',         label: 'Driver Line Status',      group: 'Driver Verizon' },
  // PIM Device
  { key: 'pim_device_name',      label: 'PIM Tablet Name',         group: 'PIM Device' },
  { key: 'pim_m360_device_id',   label: 'PIM M360 ID',             group: 'PIM Device' },
  { key: 'pim_app_version',      label: 'PIM App Version',         group: 'PIM Device' },
  { key: 'pim_tablet_model',     label: 'PIM Tablet Model',        group: 'PIM Device' },
  { key: 'pim_android_os',       label: 'PIM Android OS',          group: 'PIM Device' },
  { key: 'pim_imei',             label: 'PIM IMEI',                group: 'PIM Device' },
  { key: 'pim_compliance_status',label: 'PIM Compliance',          group: 'PIM Device' },
  { key: 'pim_last_reported',    label: 'PIM Last Reported',       group: 'PIM Device' },
  // PIM Verizon
  { key: 'pim_phone_number_verizon', label: 'PIM Phone #',         group: 'PIM Verizon' },
  { key: 'pim_monthly_usage_gb',     label: 'PIM Data Usage (GB)', group: 'PIM Verizon' },
  { key: 'pim_phone_status',         label: 'PIM Line Status',     group: 'PIM Verizon' },
  // Equipment
  { key: 'rfid',                 label: 'RFID',                    group: 'Equipment' },
  { key: 'meter_bluetooth_name', label: 'Centrodyne Meter Name',   group: 'Equipment' },
  { key: 'meter_status',         label: 'Meter Status',            group: 'Equipment' },
]

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check admin
  const { data: profile } = await supabase.from('user_profiles').select('is_admin').eq('id', user.id).single()
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  const isAdmin = profile?.is_admin === true || (adminEmail && user.email === adminEmail)
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  // Parse requested fields from query string
  const fieldsParam = req.nextUrl.searchParams.get('fields')
  const requestedKeys = fieldsParam ? fieldsParam.split(',') : null
  const validKeys = new Set(ALL_FIELDS.map(f => f.key))
  const selectedFields = requestedKeys
    ? ALL_FIELDS.filter(f => requestedKeys.includes(f.key) && validKeys.has(f.key))
    : ALL_FIELDS.filter(f => ['vehicle_number','fleet_id','driver_name','driver_lease','device_name','m360_device_id','phone_number','pim_device_name','pim_m360_device_id','pim_phone_number_verizon'].includes(f.key))

  // Build DB select columns (exclude virtual driver fields)
  const dbCols = selectedFields
    .filter(f => f.key !== 'driver_name' && f.key !== 'driver_lease')
    .map(f => f.key)
  const needDrivers = selectedFields.some(f => f.key === 'driver_name' || f.key === 'driver_lease')

  // Fetch all fleet_overview data in batches
  const allRows: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('fleet_overview')
      .select(dbCols.join(','))
      .order('vehicle_number')
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    allRows.push(...(data as unknown as Record<string, unknown>[]))
    if (data.length < 1000) break
    from += 1000
  }

  // Fetch seated drivers if needed
  const driverMap = new Map<number, { driver_id: number; name: string | null }>()
  if (needDrivers) {
    const { data: drivers } = await supabase
      .from('drivers')
      .select('driver_id,name,seated_vehicle_number')
      .not('seated_vehicle_number', 'is', null)
    for (const d of drivers ?? []) {
      if (d.seated_vehicle_number) driverMap.set(d.seated_vehicle_number, { driver_id: d.driver_id, name: d.name })
    }
  }

  // Build worksheet data
  const headers = selectedFields.map(f => f.label)
  const rows = allRows.map(r => {
    const vNum = r.vehicle_number as number
    const drv = driverMap.get(vNum)
    return selectedFields.map(f => {
      if (f.key === 'driver_name') return drv?.name ?? ''
      if (f.key === 'driver_lease') return drv?.driver_id ?? ''
      return r[f.key] ?? ''
    })
  })

  // Create workbook
  const wb = XLSX.utils.book_new()
  const wsData = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Set column widths
  ws['!cols'] = selectedFields.map(f => ({ wch: Math.max(f.label.length + 2, 12) }))

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Export')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="fleet-export-${date}.xlsx"`,
    },
  })
}

// Return available fields metadata
export async function POST() {
  return NextResponse.json({ fields: ALL_FIELDS })
}
