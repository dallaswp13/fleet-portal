/**
 * Shared M360 action executor.
 *
 * Both the human-triggered API route (`app/api/maas360/action`) and the
 * autonomous SMS pipeline (`lib/smsProcess.ts`) call into this helper so the
 * kill-switch, audit log, and action dispatch live in one place.
 *
 * Callers who are Claude (caller === 'claude') are gated by the runtime
 * `claude_execute_actions_enabled` flag (migration 034). Human callers are
 * never blocked.
 */

import { writeAuditLog } from '@/lib/audit'
import { isClaudeExecuteActionsEnabled } from '@/lib/appSettings'
import {
  rebootDevice, wipeDevice, enterKioskMode, exitKioskMode,
  clearAppData, clearDispatchApp, clearPimBluetooth, initiateSupport,
} from '@/lib/maas360'

export type M360Caller = 'user' | 'claude'

export interface ExecM360Args {
  action: string
  deviceId: string
  vehicleNumber?: number | null
  packageName?: string
  confirmed?: boolean
  caller: M360Caller
  /** Who to record as the actor in the audit log. For human callers this
   *  is user.email; for Claude, pass a sentinel like 'claude@system'. */
  actorEmail: string
}

export interface ExecM360Result {
  success: boolean
  blocked?: boolean
  message: string
  data?: unknown
  error?: string
  /** HTTP-ish status — the route handler returns this verbatim. */
  status: number
}

/**
 * Actions Claude is allowed to execute autonomously. Everything else must be
 * triggered by a human — in practice these are the non-destructive, idempotent
 * "fix it now" actions. `wipe`, `kiosk_*`, and `support_*` are intentionally
 * excluded (destructive, or require a live human on the other end).
 */
const CLAUDE_ALLOWED_ACTIONS = new Set<string>([
  'reboot',
  'clear_dispatch',
  'clear_pim_bt',
  'clear_app_data',
])

export function isClaudeAllowedAction(action: string): boolean {
  return CLAUDE_ALLOWED_ACTIONS.has(action)
}

export async function executeM360Action(args: ExecM360Args): Promise<ExecM360Result> {
  const { action, deviceId, vehicleNumber, packageName, confirmed, caller, actorEmail } = args

  if (!action || !deviceId) {
    return { success: false, message: 'action and deviceId are required', error: 'bad_request', status: 400 }
  }

  if (action === 'wipe' && !confirmed) {
    return { success: false, message: 'Wipe requires confirmed: true', error: 'not_confirmed', status: 400 }
  }

  // Runtime kill-switch for Claude-initiated actions. Human-initiated clicks
  // (caller: 'user') always proceed; only autonomous Claude calls are gated.
  if (caller === 'claude') {
    if (!isClaudeAllowedAction(action)) {
      await writeAuditLog({
        userEmail: actorEmail, action,
        targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
        payload: { deviceId, packageName, caller },
        result: { blocked: 'Action not allowed for Claude' },
        success: false,
      })
      return {
        success: false,
        blocked: true,
        message: `Action ${action} is not allowed for autonomous execution. A human must trigger it.`,
        error: 'action_not_allowed_for_claude',
        status: 403,
      }
    }
    const executeEnabled = await isClaudeExecuteActionsEnabled()
    if (!executeEnabled) {
      await writeAuditLog({
        userEmail: actorEmail, action,
        targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
        payload: { deviceId, packageName, caller },
        result: { blocked: 'Claude execute-actions disabled' },
        success: false,
      })
      return {
        success: false,
        blocked: true,
        message: 'Claude execute-actions is disabled. Flip the toggle in the Claude button to allow this.',
        error: 'execute_actions_disabled',
        status: 403,
      }
    }
  }

  let result: { success: boolean; raw: unknown }
  let auditAction = action

  try {
    switch (action) {
      case 'reboot':         result = await rebootDevice(deviceId); break
      case 'wipe':           result = await wipeDevice(deviceId); break
      case 'kiosk_enter':    result = await enterKioskMode(deviceId); break
      case 'kiosk_exit':     result = await exitKioskMode(deviceId); break
      case 'clear_app_data': result = await clearAppData(deviceId, packageName); break
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
        break
      }
      default:
        return { success: false, message: `Unknown action: ${action}`, error: 'unknown_action', status: 400 }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await writeAuditLog({
      userEmail: actorEmail, action: auditAction,
      targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
      payload: { deviceId, packageName, caller }, result: { error: message }, success: false,
    })
    return { success: false, message, error: message, status: 502 }
  }

  await writeAuditLog({
    userEmail: actorEmail, action: auditAction,
    targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
    payload: { deviceId, packageName, caller }, result: result.raw as Record<string, unknown>,
    success: result.success,
  })

  const detail = result.raw && typeof result.raw === 'object' ? JSON.stringify(result.raw).slice(0, 300) : ''
  return {
    success: result.success,
    message: result.success ? `${action} sent successfully` : `${action} failed${detail ? `: ${detail}` : ''}`,
    data: result.raw,
    status: 200,
  }
}
