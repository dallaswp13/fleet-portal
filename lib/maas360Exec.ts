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
import { rebootDevice } from '@/lib/m360-service-client'

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
 * Actions Claude is allowed to execute autonomously. Reboot is the only
 * verified remote action against the MaaS360 API, so it is the only one Claude
 * (or any caller) can run. Other action types were removed when they could not
 * be verified against the live API.
 */
const CLAUDE_ALLOWED_ACTIONS = new Set<string>([
  'reboot',
])

export function isClaudeAllowedAction(action: string): boolean {
  return CLAUDE_ALLOWED_ACTIONS.has(action)
}

export async function executeM360Action(args: ExecM360Args): Promise<ExecM360Result> {
  const { action, deviceId, vehicleNumber, caller, actorEmail } = args

  if (!action || !deviceId) {
    return { success: false, message: 'action and deviceId are required', error: 'bad_request', status: 400 }
  }

  // Only verified actions are accepted. Reboot is the only remote action wired
  // to the MaaS360 API; anything else is rejected here so the portal never
  // exposes a control that silently does nothing.
  if (!isClaudeAllowedAction(action)) {
    return { success: false, message: `Action "${action}" is not supported.`, error: 'unsupported_action', status: 400 }
  }

  // Runtime kill-switch for Claude-initiated actions. Human-initiated clicks
  // (caller: 'user') always proceed; only autonomous Claude calls are gated.
  if (caller === 'claude') {
    if (!isClaudeAllowedAction(action)) {
      await writeAuditLog({
        userEmail: actorEmail, action,
        targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
        payload: { deviceId, caller },
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
        payload: { deviceId, caller },
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
  const auditAction = action

  try {
    switch (action) {
      case 'reboot': result = await rebootDevice(deviceId); break
      default:
        return { success: false, message: `Unknown action: ${action}`, error: 'unknown_action', status: 400 }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await writeAuditLog({
      userEmail: actorEmail, action: auditAction,
      targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
      payload: { deviceId, caller }, result: { error: message }, success: false,
    })
    return { success: false, message, error: message, status: 502 }
  }

  await writeAuditLog({
    userEmail: actorEmail, action: auditAction,
    targetType: 'device', targetId: deviceId, vehicleNumber: vehicleNumber ?? null,
    payload: { deviceId, caller }, result: result.raw as Record<string, unknown>,
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
