/**
 * HCL MaaS360 API Client
 *
 * IMPORTANT: All process.env reads are inside functions, NOT at module level.
 * This ensures Vercel picks up updated env vars without requiring a cold start.
 *
 * Auth:   POST /auth-apis/auth/1.0/authenticate/{billingID}
 * Reboot: POST /device-apis/devices/2.0/reboot/customer/{billingID}/device/{deviceId}
 * Other:  POST /device-apis/devices/1.0/{billingID}/sendAction
 *
 * ENV VARS:
 *   MAAS360_BASE_URL, MAAS360_BILLING_ID, MAAS360_PLATFORM_ID
 *   MAAS360_APP_ID, MAAS360_APP_VERSION
 *   MAAS360_APP_ACCESS_KEY  (or MAAS360_ACCESS_KEY)
 *   MAAS360_USERNAME
 *   MAAS360_PASSWORD
 *
 * Token persistence: stored in Supabase `maas360_token` table (id=1) so it
 * survives across Vercel serverless instances. A cron job at /api/maas360/keepalive
 * calls MaaS360 every 30 min to prevent the 60-min token expiry.
 *
 * Required Supabase table (run once in Supabase SQL editor):
 *   create table maas360_token (
 *     id integer primary key default 1,
 *     token text not null,
 *     expires_at timestamptz not null,
 *     updated_at timestamptz not null default now(),
 *     constraint single_row check (id = 1)
 *   );
 *   alter table maas360_token enable row level security;
 *   -- No RLS policies needed: only service role accesses this table.
 */

import { createServiceClient } from '@/lib/supabase/server'

// In-memory cache — fast path within a single serverless instance lifetime
let _memToken: { value: string; expires: number } | null = null

function cfg() {
  return {
    BASE_URL:    (process.env.MAAS360_BASE_URL  ?? 'https://services.m3.maas360.com').replace(/\/$/, ''),
    BILLING_ID:  process.env.MAAS360_BILLING_ID  ?? '',
    PLATFORM_ID: process.env.MAAS360_PLATFORM_ID ?? '5',
    APP_ID:      process.env.MAAS360_APP_ID       ?? '',
    APP_VERSION: process.env.MAAS360_APP_VERSION  ?? '1.0',
    ACCESS_KEY:  process.env.MAAS360_APP_ACCESS_KEY ?? process.env.MAAS360_ACCESS_KEY ?? '',
    USERNAME:    process.env.MAAS360_USERNAME       ?? process.env.MAAS360_USER        ?? '',
    PASSWORD:    process.env.MAAS360_PASSWORD       ?? process.env.MAAS360_PASS        ?? '',
  }
}

async function loadTokenFromDb(): Promise<{ value: string; expires: number } | null> {
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('maas360_token')
      .select('token, expires_at')
      .eq('id', 1)
      .single()
    if (!data) return null
    const expires = new Date(data.expires_at as string).getTime()
    if (expires <= Date.now() + 60_000) return null // treat as expired
    return { value: data.token as string, expires }
  } catch {
    return null // DB unavailable — fall through to fresh auth
  }
}

async function saveTokenToDb(token: string, expires: number): Promise<void> {
  try {
    const svc = createServiceClient()
    await svc.from('maas360_token').upsert({
      id: 1,
      token,
      expires_at: new Date(expires).toISOString(),
      updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[maas360] failed to persist token to DB:', e)
  }
}

async function getAuthToken(): Promise<string> {
  const now = Date.now()

  // 1. Fast path: in-memory cache (same serverless instance)
  if (_memToken && _memToken.expires > now + 60_000) return _memToken.value

  // 2. Persistent path: Supabase (survives instance recycling)
  const dbToken = await loadTokenFromDb()
  if (dbToken) {
    _memToken = dbToken
    return dbToken.value
  }

  // 3. Fetch a fresh token from MaaS360
  const { BASE_URL, BILLING_ID, PLATFORM_ID, APP_ID, APP_VERSION, ACCESS_KEY, USERNAME, PASSWORD } = cfg()

  if (!BILLING_ID) throw new Error('MAAS360_BILLING_ID not set')
  if (!APP_ID)     throw new Error('MAAS360_APP_ID not set')
  if (!ACCESS_KEY) throw new Error('MAAS360_APP_ACCESS_KEY not set')
  if (!USERNAME)   throw new Error('MAAS360_USERNAME not set')
  if (!PASSWORD)   throw new Error('MAAS360_PASSWORD not set')

  // Body format confirmed from MaaS360 API tester: no outer "authRequest" wrapper
  const body = {
    maaS360AdminAuth: {
      billingID: BILLING_ID, platformID: PLATFORM_ID,
      appID: APP_ID, appVersion: APP_VERSION,
      appAccessKey: ACCESS_KEY, userName: USERNAME, password: PASSWORD,
    }
  }

  // Correct URL: /authenticate/{billingID} — no "/customer/" segment
  const res = await fetch(`${BASE_URL}/auth-apis/auth/1.0/authenticate/${BILLING_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: Record<string, unknown>
  try { data = JSON.parse(text) } catch { throw new Error(`MaaS360 auth: non-JSON ${res.status} — ${text.slice(0, 200)}`) }

  if (!res.ok) {
    const ar   = data?.authResponse as Record<string, unknown> | undefined
    const code = ar?.errorCode
    const desc = ar?.errorDesc ?? JSON.stringify(data).slice(0, 200)
    throw new Error(`MaaS360 auth failed (HTTP ${res.status}): ${desc} [code ${code}]\nCredentials: billingID=${BILLING_ID}, appID=${APP_ID}, user=${USERNAME}`)
  }

  const token = (data?.authResponse as Record<string, unknown>)?.authToken as string | undefined
  if (!token) throw new Error(`MaaS360 auth: no authToken — ${JSON.stringify(data).slice(0, 200)}`)

  const expires = Date.now() + 50 * 60 * 1000 // cache for 50 min (token valid 60 min)
  _memToken = { value: token, expires }
  await saveTokenToDb(token, expires)
  return token
}

function authHdrs(token: string) {
  return { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `MaaS token=${token}` }
}

export async function rebootDevice(deviceId: string): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()
  const res   = await fetch(`${BASE_URL}/device-apis/devices/2.0/reboot/customer/${BILLING_ID}/device/${deviceId}`, { method: 'POST', headers: authHdrs(token) })
  const raw   = await res.json().catch(async () => ({ _raw: await res.text() }))
  return { success: res.ok, raw }
}

const ACTION_MAP: Record<string, string> = {
  wipe: 'FactoryReset', kiosk_enter: 'EnableKioskMode', kiosk_exit: 'DisableKioskMode', clear_app_data: 'ClearAppData',
}

async function sendDeviceAction(deviceId: string, actionKey: string, extra?: Record<string,unknown>): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token  = await getAuthToken()
  const action = ACTION_MAP[actionKey] ?? actionKey
  const body   = { sendActionRequest: { deviceIds: { deviceId: [deviceId] }, action, ...extra } }
  const res    = await fetch(`${BASE_URL}/device-apis/devices/1.0/${BILLING_ID}/sendAction`, { method: 'POST', headers: authHdrs(token), body: JSON.stringify(body) })
  const raw    = await res.json().catch(async () => ({ _raw: await res.text() }))
  return { success: res.ok, raw }
}

const DISPATCH_PKG = () => process.env.DISPATCH_APP_PACKAGE ?? 'com.ccsi.taxidispatch'
const BT_PKG       = 'com.android.bluetooth'

export async function wipeDevice(d: string)        { return sendDeviceAction(d, 'wipe') }
export async function enterKioskMode(d: string)    { return sendDeviceAction(d, 'kiosk_enter') }
export async function exitKioskMode(d: string)     { return sendDeviceAction(d, 'kiosk_exit') }
export async function clearAppData(d: string, pkg?: string) { return sendDeviceAction(d, 'clear_app_data', pkg ? { packageName: pkg } : {}) }
export async function clearDispatchApp(d: string)  { return clearAppData(d, DISPATCH_PKG()) }
export async function clearPimBluetooth(d: string) { return clearAppData(d, BT_PKG) }
export async function initiateSupport(d: string)   { return rebootDevice(d) }

export async function searchDeviceByName(deviceName: string): Promise<{ deviceId: string | null; found: unknown[] }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()
  const res   = await fetch(`${BASE_URL}/device-apis/devices/2.0/search/customer/${BILLING_ID}?deviceName=${encodeURIComponent(deviceName)}&pageSize=5&pageNumber=1`, { headers: authHdrs(token) })
  const data  = await res.json().catch(() => ({})) as Record<string,unknown>
  const list  = ((data.devices as Record<string,unknown>)?.device ?? []) as Record<string,unknown>[]
  return { deviceId: list[0]?.maas360DeviceID as string ?? null, found: list }
}

export async function testAuth(): Promise<{ ok: boolean; message: string; credentials: Record<string, string> }> {
  const c = cfg()
  const credentials = {
    billingID:  c.BILLING_ID  || '(not set)',
    appID:      c.APP_ID      || '(not set)',
    accessKey:  c.ACCESS_KEY  ? c.ACCESS_KEY.slice(0, 6) + '…(' + c.ACCESS_KEY.length + ' chars)' : '(not set)',
    username:   c.USERNAME    || '(not set)',
    password:   c.PASSWORD    ? '…set…' : '(not set)',
    baseUrl:    c.BASE_URL,
  }
  try {
    // Force fresh auth so we always test current env vars (bypasses both caches)
    _memToken = null
    try {
      const svc = createServiceClient()
      await svc.from('maas360_token').delete().eq('id', 1)
    } catch { /* ignore if table doesn't exist yet */ }
    const token = await getAuthToken()
    return { ok: true, message: `Auth OK. Token: ${token.slice(0, 8)}…`, credentials }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), credentials }
  }
}
