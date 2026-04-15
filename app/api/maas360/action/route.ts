import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'
import { isClaudeExecuteActionsEnabled } from '@/lib/appSettings'
import {
  rebootDevice, wipeDevice, enterKioskMode, exitKioskMode,
  clearAppData, clearDispatchApp, clearPimBluetooth, initiateSupport,
  searchDeviceByName
} from '@/lib/maas360'
import type { MaaS360Action } from '@/types'

const DISPATCH_PACKAGE = process.env.DISPATCH_APP_PACKAGE ?? 'com.ccsi.taxidispatch'
const BT_PACKAGE       = 'com.android.bluetooth'

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

  if (!action || !deviceId) {
    return NextResponse.json({ error: 'action and deviceId are required' }, { status: 400 })
  }

  if (action === 'wipe' && !confirmed) {
    return NextResponse.json({ error: 'Wipe requires confirmed: true' }, { status: 400 })
  }

  // Runtime kill-switch for Claude-initiated actions. Human-initiated clicks
  // (the default) always proceed; only autonomous Claude calls are gated.
  if (caller === 'claude') {
    const executeEnabled = await isClaudeExecuteActionsEnabled()
    if (!executeEnabled) {
      await writeAuditLog({
        userEmail: user.email!, action,
        targetType: 'device', targetId: deviceId, vehicleNumber,
        payload: { deviceId, packageName, caller },
        result: { blocked: 'Claude execute-actions disabled' },
        success: false,
      })
      return NextResponse.json({
        success: false,
        blocked: true,
        message: 'Claude execute-actions is disabled. Flip the toggle in the Claude button to allow this.',
      }, { status: 403 })
    }
  }

  let result: { success: boolean; raw: unknown }
  let auditAction = action

  try {
    switch (action as MaaS360Action | string) {
      case 'reboot':        result = await rebootDevice(deviceId); break
      case 'wipe':          result = await wipeDevice(deviceId); break
      case 'kiosk_enter':   result = await enterKioskMode(deviceId); break
      case 'kiosk_exit':    result = await exitKioskMode(deviceId); break
      case 'clear_app_data':result = await clearAppData(deviceId, packageName); break
      case 'clear_dispatch':
        result = await clearDispatchApp(deviceId)
        auditAction = 'clear_dispatch'
        break
      case 'clear_pim_bt':
        result = await clearPimBluetooth(deviceId)
        auditAction = 'clear_pim_bt'
        break
      case 'support_driver':
      case 'support_pim': {
        const sup = await initiateSupport(deviceId)
        result = { success: sup.success, raw: sup.raw }
        auditAction = action
        break
      }
      case 'search_device': {
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
          return NextResponse.json({ success: false, driverDeviceId: null, pimDeviceId: null, error: err instanceof Error ? err.message : 'Search failed' })
        }
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await writeAuditLog({
      userEmail: user.email!, action: auditAction,
      targetType: 'device', targetId: deviceId, vehicleNumber,
      payload: { deviceId, packageName }, result: { error: message }, success: false
    })
    return NextResponse.json({ error: message }, { status: 502 })
  }

  await writeAuditLog({
    userEmail: user.email!, action: auditAction,
    targetType: 'device', targetId: deviceId, vehicleNumber,
    payload: { deviceId, packageName }, result: result.raw as Record<string, unknown>,
    success: result.success
  })

  const detail = result.raw && typeof result.raw === 'object' ? JSON.stringify(result.raw).slice(0, 300) : ''
  return NextResponse.json({
    success: result.success,
    message: result.success ? `${action} sent successfully` : `${action} failed${detail ? `: ${detail}` : ''}`,
    data: result.raw
  })
}
