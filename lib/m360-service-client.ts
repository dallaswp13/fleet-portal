/**
 * M360 Service Client — optional proxy layer
 *
 * When M360_SERVICE_URL is set, all M360 calls go through the standalone
 * m360-service instead of calling the MaaS360 API directly. This lets you:
 *   - Test with sandbox mode (service running in sandbox)
 *   - Share the M360 integration across multiple tools
 *   - Centralize token management and logging
 *
 * When M360_SERVICE_URL is NOT set, this module falls back to the direct
 * maas360.ts client — zero behavior change from today.
 *
 * Usage in Fleet Portal:
 *   Replace imports from '@/lib/maas360' with '@/lib/m360-service-client'
 *   (same function signatures, same return types)
 */

import * as directClient from '@/lib/maas360'

const SERVICE_URL = process.env.M360_SERVICE_URL?.replace(/\/$/, '') ?? ''
const SERVICE_KEY = process.env.M360_SERVICE_API_KEY ?? ''

function isServiceConfigured(): boolean {
  return SERVICE_URL.length > 0
}

async function serviceCall<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${SERVICE_URL}${path}`
  const headers: Record<string, string> = {}
  if (SERVICE_KEY) headers['Authorization'] = `Bearer ${SERVICE_KEY}`
  if (method === 'POST') headers['Content-Type'] = 'application/json'

  const opts: RequestInit = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error ?? `M360 service returned HTTP ${res.status}`)
  }
  return data as T
}

interface ActionResult { success: boolean; raw: unknown }
interface ServiceActionResponse { success: boolean; data: unknown; message: string; sandbox: boolean }

function toActionResult(resp: ServiceActionResponse): ActionResult {
  return { success: resp.success, raw: resp.data }
}

// ── Device Actions ───────────────────────────────────────────────────────────

export async function rebootDevice(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.rebootDevice(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'reboot', deviceId })
  return toActionResult(resp)
}

export async function wipeDevice(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.wipeDevice(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'wipe', deviceId, confirmed: true })
  return toActionResult(resp)
}

export async function enterKioskMode(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.enterKioskMode(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'kiosk_enter', deviceId })
  return toActionResult(resp)
}

export async function exitKioskMode(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.exitKioskMode(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'kiosk_exit', deviceId })
  return toActionResult(resp)
}

export async function clearAppData(deviceId: string, pkg?: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.clearAppData(deviceId, pkg)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'clear_app_data', deviceId, packageName: pkg })
  return toActionResult(resp)
}

export async function clearDispatchApp(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.clearDispatchApp(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'clear_dispatch', deviceId })
  return toActionResult(resp)
}

export async function clearPimBluetooth(deviceId: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.clearPimBluetooth(deviceId)
  const resp = await serviceCall<ServiceActionResponse>('/api/device/action', 'POST', { action: 'clear_pim_bt', deviceId })
  return toActionResult(resp)
}

export async function initiateSupport(deviceId: string): Promise<ActionResult> {
  // Service doesn't have a separate support endpoint — it's just a reboot
  if (!isServiceConfigured()) return directClient.initiateSupport(deviceId)
  return rebootDevice(deviceId)
}

// ── Device Search ────────────────────────────────────────────────────────────

export async function searchDeviceByName(deviceName: string): Promise<{ deviceId: string | null; found: unknown[] }> {
  if (!isServiceConfigured()) return directClient.searchDeviceByName(deviceName)
  return serviceCall<{ deviceId: string | null; found: unknown[] }>(`/api/device/search?name=${encodeURIComponent(deviceName)}`, 'GET')
}

// ── User Provisioning ────────────────────────────────────────────────────────

export async function createM360User(params: {
  userName: string; domain?: string; emailAddress?: string; firstName?: string; lastName?: string
}): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.createM360User(params)
  const resp = await serviceCall<ServiceActionResponse>('/api/user/create', 'POST', params)
  return toActionResult(resp)
}

export async function addUserToM360Group(userName: string, groupName: string): Promise<ActionResult> {
  if (!isServiceConfigured()) return directClient.addUserToM360Group(userName, groupName)
  const resp = await serviceCall<ServiceActionResponse>('/api/user/assign-group', 'POST', { userName, groupName })
  return toActionResult(resp)
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function getAuthToken(): Promise<string> {
  // Auth tokens are managed by the service when configured.
  // If not, fall back to direct client.
  if (!isServiceConfigured()) return directClient.getAuthToken()
  // The service handles auth internally; callers don't need the token.
  // Return a placeholder to satisfy existing interfaces.
  const resp = await serviceCall<{ ok: boolean; message: string }>('/api/health', 'GET')
  if (!resp.ok) throw new Error(resp.message)
  return '(managed-by-service)'
}

export async function testAuth(): Promise<{ ok: boolean; message: string; credentials: Record<string, string>; debug?: string }> {
  if (!isServiceConfigured()) return directClient.testAuth()
  const resp = await serviceCall<{ ok: boolean; message: string; sandbox: boolean }>('/api/health', 'GET')
  return {
    ok: resp.ok,
    message: resp.message + (resp.sandbox ? ' [via m360-service, SANDBOX]' : ' [via m360-service]'),
    credentials: { mode: resp.sandbox ? 'sandbox' : 'production', serviceUrl: SERVICE_URL },
  }
}
