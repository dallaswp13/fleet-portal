import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchDeviceByName } from '@/lib/m360-service-client'
import { executeM360Action } from '@/lib/maas360Exec'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, deviceId, vehicleNumber, packageName, confirmed, deviceName, caller } = body as {
    action: string; deviceId: string; vehicleNumber?: number
    packageName?: string; confirmed?: boolean; deviceName?: string
    // caller: 'user' (default, admin clicked a button) | 'claude' (autonomous agent).
    // Claude-initiated actions are gated by the Execute Actions ON/OFF toggle
    // in the Claude button popover — see lib/appSettings.ts + migration 034.
    caller?: 'user' | 'claude'
  }

  // search_device is a lookup, not an action — handle it inline so we can
  // skip the gate/audit logic.
  if (action === 'search_device') {
    if (!deviceName) return NextResponse.json({ error: 'deviceName required for search_device' }, { status: 400 })
    try {
      const driverSearch = await searchDeviceByName(deviceName)
      const pimSearch    = await searchDeviceByName('*' + deviceName)
      return NextResponse.json({
        success: true,
        driverDeviceId: driverSearch.deviceId,
        pimDeviceId:    pimSearch.deviceId,
        driverFound:    driverSearch.found,
        pimFound:       pimSearch.found,
      })
    } catch (err) {
      return NextResponse.json({
        success: false, driverDeviceId: null, pimDeviceId: null,
        error: err instanceof Error ? err.message : 'Search failed',
      })
    }
  }

  const result = await executeM360Action({
    action,
    deviceId,
    vehicleNumber,
    packageName,
    confirmed,
    caller: caller ?? 'user',
    actorEmail: user.email!,
  })

  const { status, ...payload } = result
  return NextResponse.json(payload, { status })
}
