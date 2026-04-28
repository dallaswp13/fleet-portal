import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'
import { createM360User, addUserToM360Group } from '@/lib/m360-service-client'

/**
 * Provisions two MaaS360 users for a newly created vehicle.
 *
 * For vehicle_number=9999, fleet_id=E:
 *   Driver user: username "9999E" → group "E front"
 *   PIM user:    username "*9999E" → group "E pim"
 *
 * Returns per-step results so the UI can show which pieces succeeded.
 * Failures are non-fatal — the UI may still have created the Vehicles row.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { vehicleNumber, fleetId } = (await req.json()) as { vehicleNumber?: number; fleetId?: string }

  if (!vehicleNumber || !fleetId) {
    return NextResponse.json({ error: 'vehicleNumber and fleetId are required' }, { status: 400 })
  }

  const driverUser = `${vehicleNumber}${fleetId}`
  const pimUser    = `*${vehicleNumber}${fleetId}`
  const driverGroup = `${fleetId} front`
  const pimGroup    = `${fleetId} pim`

  const steps: Array<{ step: string; success: boolean; detail: string }> = []

  // 1. Create driver user
  try {
    const r = await createM360User({ userName: driverUser, firstName: `${vehicleNumber}`, lastName: `${fleetId} Driver` })
    steps.push({ step: `Create M360 user "${driverUser}"`, success: r.success, detail: summarize(r.raw) })
  } catch (err) {
    steps.push({ step: `Create M360 user "${driverUser}"`, success: false, detail: errMsg(err) })
  }

  // 2. Add driver user to {fleet} front group
  try {
    const r = await addUserToM360Group(driverUser, driverGroup)
    steps.push({ step: `Add "${driverUser}" → "${driverGroup}"`, success: r.success, detail: summarize(r.raw) })
  } catch (err) {
    steps.push({ step: `Add "${driverUser}" → "${driverGroup}"`, success: false, detail: errMsg(err) })
  }

  // 3. Create PIM user
  try {
    const r = await createM360User({ userName: pimUser, firstName: `${vehicleNumber}`, lastName: `${fleetId} PIM` })
    steps.push({ step: `Create M360 user "${pimUser}"`, success: r.success, detail: summarize(r.raw) })
  } catch (err) {
    steps.push({ step: `Create M360 user "${pimUser}"`, success: false, detail: errMsg(err) })
  }

  // 4. Add PIM user to {fleet} pim group
  try {
    const r = await addUserToM360Group(pimUser, pimGroup)
    steps.push({ step: `Add "${pimUser}" → "${pimGroup}"`, success: r.success, detail: summarize(r.raw) })
  } catch (err) {
    steps.push({ step: `Add "${pimUser}" → "${pimGroup}"`, success: false, detail: errMsg(err) })
  }

  const allOk = steps.every(s => s.success)

  try {
    await writeAuditLog({
      userEmail: user.email!,
      action: 'create_m360_users',
      targetType: 'device',
      targetId: `${vehicleNumber}${fleetId}`,
      vehicleNumber,
      payload: { driverUser, pimUser, driverGroup, pimGroup },
      result: { steps },
      success: allOk,
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({
    success: allOk,
    driverUser, pimUser, driverGroup, pimGroup,
    steps,
    message: allOk
      ? `Provisioned ${driverUser} and ${pimUser} in MaaS360.`
      : `M360 provisioning partial — ${steps.filter(s => s.success).length}/${steps.length} steps succeeded.`,
  })
}

function summarize(raw: unknown): string {
  if (!raw) return ''
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    return str.slice(0, 200)
  } catch { return '' }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}
