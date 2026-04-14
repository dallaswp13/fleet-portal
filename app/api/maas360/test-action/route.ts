import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rebootDevice, searchDeviceByName, testAuth } from '@/lib/maas360'

/**
 * GET /api/maas360/test-action?deviceId=xxx
 * GET /api/maas360/test-action?deviceName=xxx  (search first, then reboot)
 *
 * Debug endpoint — returns full auth + action response for troubleshooting.
 * Admin only. Does NOT actually reboot unless ?execute=true is passed.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const deviceId = url.searchParams.get('deviceId')
  const deviceName = url.searchParams.get('deviceName')
  const execute = url.searchParams.get('execute') === 'true'

  const results: Record<string, unknown> = { timestamp: new Date().toISOString() }

  // Step 1: Test auth
  try {
    const auth = await testAuth()
    results.auth = auth
    if (!auth.ok) {
      return NextResponse.json({ ...results, error: 'Auth failed — cannot proceed' })
    }
  } catch (err) {
    results.auth = { ok: false, error: err instanceof Error ? err.message : String(err) }
    return NextResponse.json({ ...results, error: 'Auth threw — cannot proceed' })
  }

  // Step 2: Resolve device ID (by name if needed)
  let resolvedDeviceId = deviceId
  if (deviceName && !deviceId) {
    try {
      const search = await searchDeviceByName(deviceName)
      results.search = search
      resolvedDeviceId = search.deviceId
      if (!resolvedDeviceId) {
        return NextResponse.json({ ...results, error: `No device found for name: ${deviceName}` })
      }
    } catch (err) {
      results.search = { error: err instanceof Error ? err.message : String(err) }
      return NextResponse.json({ ...results, error: 'Device search failed' })
    }
  }

  if (!resolvedDeviceId) {
    return NextResponse.json({ ...results, error: 'Provide ?deviceId=xxx or ?deviceName=xxx' }, { status: 400 })
  }

  results.resolvedDeviceId = resolvedDeviceId

  // Step 3: Execute reboot (only if ?execute=true)
  if (!execute) {
    results.note = 'Dry run — add &execute=true to actually send the reboot command'
    return NextResponse.json(results)
  }

  try {
    const reboot = await rebootDevice(resolvedDeviceId)
    results.reboot = reboot
  } catch (err) {
    results.reboot = { success: false, error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json(results)
}
