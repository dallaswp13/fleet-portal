/**
 * HCL MaaS360 API Client — XML Transport
 *
 * All requests use Content-Type: application/xml and parse XML responses.
 * The MaaS360 credentials are registered for XML applications.
 *
 * Auth:   POST /auth-apis/auth/1.0/authenticate/{billingID}
 * Reboot: POST /device-apis/devices/2.0/reboot/customer/{billingID}/device/{deviceId}
 * Other:  POST /device-apis/devices/1.0/{billingID}/sendAction
 * Search: GET  /device-apis/devices/2.0/search/customer/{billingID}
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
 */

import { createServiceClient } from '@/lib/supabase/server'
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })

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

/* ── Token persistence (Supabase) ─────────────────────────────────────── */

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
    if (expires <= Date.now() + 60_000) return null
    return { value: data.token as string, expires }
  } catch {
    return null
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

/* ── XML helpers ──────────────────────────────────────────────────────── */

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function parseXml(text: string): Record<string, unknown> {
  return xmlParser.parse(text) as Record<string, unknown>
}

/* ── Authentication ───────────────────────────────────────────────────── */

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

  // Body format: no outer <authRequest> wrapper — confirmed from MaaS360 API tester
  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<maaS360AdminAuth>',
    `  <billingID>${escapeXml(BILLING_ID)}</billingID>`,
    `  <platformID>${escapeXml(PLATFORM_ID)}</platformID>`,
    `  <appID>${escapeXml(APP_ID)}</appID>`,
    `  <appVersion>${escapeXml(APP_VERSION)}</appVersion>`,
    `  <appAccessKey>${escapeXml(ACCESS_KEY)}</appAccessKey>`,
    `  <userName>${escapeXml(USERNAME)}</userName>`,
    `  <password>${escapeXml(PASSWORD)}</password>`,
    '</maaS360AdminAuth>',
  ].join('\n')

  const res = await fetch(`${BASE_URL}/auth-apis/auth/1.0/authenticate/${BILLING_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
    body: xmlBody,
  })

  const text = await res.text()
  let data: Record<string, unknown>
  try { data = parseXml(text) } catch { throw new Error(`MaaS360 auth: invalid XML ${res.status} — ${text.slice(0, 300)}`) }

  // Response may come as <authResponse> at top level or nested
  const authResponse = (data?.authResponse ?? data) as Record<string, unknown>

  if (!res.ok) {
    const code = authResponse?.errorCode
    const desc = authResponse?.errorDesc ?? text.slice(0, 300)
    throw new Error(`MaaS360 auth failed (HTTP ${res.status}): ${desc} [code ${code}]\nCredentials: billingID=${BILLING_ID}, appID=${APP_ID}, user=${USERNAME}`)
  }

  const token = (authResponse?.authToken as string | undefined)
  if (!token) throw new Error(`MaaS360 auth: no authToken in response — ${text.slice(0, 300)}`)

  const expires = Date.now() + 50 * 60 * 1000
  _memToken = { value: token, expires }
  await saveTokenToDb(token, expires)
  return token
}

/* ── Request helpers ──────────────────────────────────────────────────── */

function authHeaders(token: string) {
  return { 'Content-Type': 'application/xml', 'Accept': 'application/xml', 'Authorization': `MaaS token=${token}` }
}

async function m360Fetch(url: string, token: string, method: string, body?: string): Promise<{ ok: boolean; parsed: Record<string, unknown>; rawText: string }> {
  const opts: RequestInit = { method, headers: authHeaders(token) }
  if (body) opts.body = body
  const res  = await fetch(url, opts)
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = parseXml(text) } catch { parsed = { _rawText: text } }
  return { ok: res.ok, parsed, rawText: text }
}

/* ── Device actions ───────────────────────────────────────────────────── */

export async function rebootDevice(deviceId: string): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()
  const { ok, parsed } = await m360Fetch(
    `${BASE_URL}/device-apis/devices/2.0/reboot/customer/${BILLING_ID}/device/${deviceId}`,
    token, 'POST'
  )
  return { success: ok, raw: parsed }
}

const ACTION_MAP: Record<string, string> = {
  wipe: 'FactoryReset', kiosk_enter: 'EnableKioskMode', kiosk_exit: 'DisableKioskMode', clear_app_data: 'ClearAppData',
}

async function sendDeviceAction(deviceId: string, actionKey: string, extra?: Record<string, string>): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token  = await getAuthToken()
  const action = ACTION_MAP[actionKey] ?? actionKey

  const extraXml = extra
    ? Object.entries(extra).map(([k, v]) => `  <${k}>${escapeXml(v)}</${k}>`).join('\n')
    : ''

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sendActionRequest>',
    '  <deviceIds>',
    `    <deviceId>${escapeXml(deviceId)}</deviceId>`,
    '  </deviceIds>',
    `  <action>${escapeXml(action)}</action>`,
    extraXml,
    '</sendActionRequest>',
  ].join('\n')

  const { ok, parsed } = await m360Fetch(
    `${BASE_URL}/device-apis/devices/1.0/${BILLING_ID}/sendAction`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
}

const DISPATCH_PKG = () => process.env.DISPATCH_APP_PACKAGE ?? 'com.ccsi.taxidispatch'
const BT_PKG       = 'com.android.bluetooth'

export async function wipeDevice(d: string)        { return sendDeviceAction(d, 'wipe') }
export async function enterKioskMode(d: string)    { return sendDeviceAction(d, 'kiosk_enter') }
export async function exitKioskMode(d: string)     { return sendDeviceAction(d, 'kiosk_exit') }
export async function clearAppData(d: string, pkg?: string) { return sendDeviceAction(d, 'clear_app_data', pkg ? { packageName: pkg } : undefined) }
export async function clearDispatchApp(d: string)  { return clearAppData(d, DISPATCH_PKG()) }
export async function clearPimBluetooth(d: string) { return clearAppData(d, BT_PKG) }
export async function initiateSupport(d: string)   { return rebootDevice(d) }

/* ── Device search ────────────────────────────────────────────────────── */

export async function searchDeviceByName(deviceName: string): Promise<{ deviceId: string | null; found: unknown[] }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()
  const { parsed } = await m360Fetch(
    `${BASE_URL}/device-apis/devices/2.0/search/customer/${BILLING_ID}?deviceName=${encodeURIComponent(deviceName)}&pageSize=5&pageNumber=1`,
    token, 'GET'
  )

  // XML response: <devices><device>...</device></devices>
  // fast-xml-parser returns a single object if one device, array if multiple
  const devices = parsed?.devices as Record<string, unknown> | undefined
  const rawDevice = devices?.device
  const list: Record<string, unknown>[] = Array.isArray(rawDevice) ? rawDevice : rawDevice ? [rawDevice as Record<string, unknown>] : []
  return { deviceId: (list[0]?.maas360DeviceID as string) ?? null, found: list }
}

/* ── Auth test ────────────────────────────────────────────────────────── */

export async function testAuth(): Promise<{ ok: boolean; message: string; credentials: Record<string, string>; debug?: string }> {
  const c = cfg()
  const credentials = {
    billingID:  c.BILLING_ID  || '(not set)',
    appID:      c.APP_ID      || '(not set)',
    accessKey:  c.ACCESS_KEY  ? c.ACCESS_KEY.slice(0, 6) + '…(' + c.ACCESS_KEY.length + ' chars)' : '(not set)',
    username:   c.USERNAME    || '(not set)',
    password:   c.PASSWORD    ? '…set…' : '(not set)',
    baseUrl:    c.BASE_URL,
    transport:  'XML',
  }
  try {
    // Force fresh auth — bypasses both caches
    _memToken = null
    try {
      const svc = createServiceClient()
      await svc.from('maas360_token').delete().eq('id', 1)
    } catch { /* ignore if table doesn't exist yet */ }
    const token = await getAuthToken()
    return { ok: true, message: `Auth OK. Token: ${token.slice(0, 8)}…`, credentials }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: msg, credentials, debug: msg }
  }
}
