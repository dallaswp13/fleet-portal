import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check admin
  const { data: profile } = await supabase.from('user_profiles').select('is_admin').eq('id', user.id).single()
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  const isAdmin = profile?.is_admin === true || (adminEmail && user.email === adminEmail)
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  // Fetch all fleet_overview data in batches
  const allRows: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('fleet_overview')
      .select('vehicle_number,fleet_id,device_name,m360_device_id,phone_number,pim_device_name,pim_m360_device_id,pim_phone_number_verizon')
      .order('vehicle_number')
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    allRows.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  // Fetch seated drivers
  const { data: drivers } = await supabase
    .from('drivers')
    .select('driver_id,name,seated_vehicle_number')
    .not('seated_vehicle_number', 'is', null)
  const driverMap = new Map<number, { driver_id: number; name: string | null }>()
  for (const d of drivers ?? []) {
    if (d.seated_vehicle_number) driverMap.set(d.seated_vehicle_number, { driver_id: d.driver_id, name: d.name })
  }

  // Build worksheet data
  const headers = [
    'Vehicle #', 'Fleet', 'Current Driver', 'Driver Lease #',
    'Driver Tablet Device Name', 'Driver Tablet M360 ID', 'Driver Tablet Phone',
    'PIM Tablet Device Name', 'PIM Tablet M360 ID', 'PIM Tablet Phone',
  ]

  const rows = allRows.map(r => {
    const vNum = r.vehicle_number as number
    const drv = driverMap.get(vNum)
    return [
      vNum,
      r.fleet_id ?? '',
      drv?.name ?? '',
      drv?.driver_id ?? '',
      r.device_name ?? '',
      r.m360_device_id ?? '',
      r.phone_number ?? '',
      r.pim_device_name ?? '',
      r.pim_m360_device_id ?? '',
      r.pim_phone_number_verizon ?? '',
    ]
  })

  // Create workbook
  const wb = XLSX.utils.book_new()
  const wsData = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Set column widths
  ws['!cols'] = [
    { wch: 10 }, // Vehicle #
    { wch: 6 },  // Fleet
    { wch: 25 }, // Driver name
    { wch: 12 }, // Lease #
    { wch: 20 }, // Driver device name
    { wch: 18 }, // Driver M360 ID
    { wch: 15 }, // Driver phone
    { wch: 20 }, // PIM device name
    { wch: 18 }, // PIM M360 ID
    { wch: 15 }, // PIM phone
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Export')

  // Generate buffer
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="fleet-export-${date}.xlsx"`,
    },
  })
}
