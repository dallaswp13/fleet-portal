/**
 * HCL MaaS360 API Client — XML Transport
 *
 * All requests use Content-Type: application/xml and parse XML responses.
 * The MaaS360 credentials are registered for XML applications.
 *
 * Auth:   POST /auth-apis/auth/2.0/authenticate/customer/{billingID}
 * Action: POST /action-apis/actions/1.0/customer/{billingID}/action/{actionType}/device/{deviceCsn}  (V2, JSON body)
 * Search: GET  /device-apis/devices/1.0/search/{billingID}
 *
 * Action types (from official docs):
 *   MDM_AFW_REMOTE_REBOOT — Restart device (Android 7+, agent 5.65+)
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
    PLATFORM_ID: process.env.MAAS360_PLATFORM_ID ?? '3',
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

export async function getAuthToken(): Promise<string> {
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

  // Body format matches M360 API tester: <authRequest> wraps <maaS360AdminAuth>
  // Field order matches M360 reference: platformID, billingID, password, userName, appID, appVersion, appAccessKey
  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<authRequest>',
    '\t<maaS360AdminAuth>',
    `\t\t<platformID>${escapeXml(PLATFORM_ID)}</platformID>`,
    `\t\t<billingID>${escapeXml(BILLING_ID)}</billingID>`,
    `\t\t<password>${escapeXml(PASSWORD)}</password>`,
    `\t\t<userName>${escapeXml(USERNAME)}</userName>`,
    `\t\t<appID>${escapeXml(APP_ID)}</appID>`,
    `\t\t<appVersion>${escapeXml(APP_VERSION)}</appVersion>`,
    `\t\t<appAccessKey>${escapeXml(ACCESS_KEY)}</appAccessKey>`,
    '\t</maaS360AdminAuth>',
    '</authRequest>',
  ].join('\n')

  // Auth 2.0 endpoint — supports script-only accounts and returns refresh tokens
  const authUrl = `${BASE_URL}/auth-apis/auth/2.0/authenticate/customer/${BILLING_ID}`
  console.log(`[maas360] Authenticating via Auth 2.0: ${authUrl} (user=${USERNAME}, appID=${APP_ID})`)

  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
    body: xmlBody,
  })

  const text = await res.text()
  let data: Record<string, unknown>
  try { data = parseXml(text) } catch { throw new Error(`MaaS360 auth: invalid XML ${res.status} — ${text.slice(0, 300)}`) }

  // Response may come as <authResponse> at top level or nested
  const authResponse = (data?.authResponse ?? data) as Record<string, unknown>

  // M360 can return HTTP 200 with an error payload — check the body too
  const errCode = authResponse?.errorCode
  const errDesc = authResponse?.errorDesc

  if (!res.ok || (errCode && Number(errCode) !== 0)) {
    const credInfo = [
      `billingID=${BILLING_ID}`,
      `appID=${APP_ID}`,
      `user=${USERNAME}`,
      `accessKey=${ACCESS_KEY ? ACCESS_KEY.slice(0, 4) + '…(' + ACCESS_KEY.length + ')' : '(empty)'}`,
      `password=${PASSWORD ? '(' + PASSWORD.length + ' chars)' : '(empty)'}`,
      `platformID=${PLATFORM_ID}`,
      `baseUrl=${BASE_URL}`,
    ].join(', ')
    throw new Error(
      `MaaS360 auth failed (HTTP ${res.status}): ${errDesc ?? text.slice(0, 300)} [code ${errCode}]\n` +
      `Auth URL: ${authUrl}\n` +
      `Credentials: ${credInfo}`
    )
  }

  const token = (authResponse?.authToken as string | undefined)
  if (!token) throw new Error(`MaaS360 auth: no authToken in response — ${text.slice(0, 300)}`)

  const expires = Date.now() + 50 * 60 * 1000
  _memToken = { value: token, expires }
  await saveTokenToDb(token, expires)
  return token
}

/* ── Request helpers ──────────────────────────────────────────────────── */

function authHeaders(token: string, opts: { method?: 'GET' | 'POST'; contentType?: 'xml' | 'json' } = {}) {
  const { method = 'POST', contentType = 'xml' } = opts
  // IBM docs show: Authorization MaaS token="<value>" — quotes are required.
  const headers: Record<string, string> = {
    'Authorization': `MaaS token="${token}"`,
  }
  // Only set Content-Type and Accept for POST. GET requests don't need them.
  if (method === 'POST') {
    if (contentType === 'json') {
      headers['Content-Type'] = 'application/json'
      headers['Accept'] = 'application/json'
    } else {
      headers['Content-Type'] = 'application/xml'
      headers['Accept'] = 'application/xml'
    }
  }
  return headers
}

function isTokenExpiredResponse(parsed: Record<string, unknown>): boolean {
  // M360 returns errorCode 1007 for expired tokens, sometimes nested under authResponse
  const auth = (parsed?.authResponse ?? parsed) as Record<string, unknown>
  return auth?.errorCode === 1007 || auth?.errorCode === '1007'
}

async function invalidateToken(): Promise<void> {
  _memToken = null
  try {
    const svc = createServiceClient()
    await svc.from('maas360_token').delete().eq('id', 1)
  } catch { /* ignore */ }
}

async function m360Fetch(url: string, token: string, method: string, body?: string, contentType: 'xml' | 'json' = 'xml'): Promise<{ ok: boolean; parsed: Record<string, unknown>; rawText: string }> {
  const httpMethod = (method.toUpperCase() === 'GET' ? 'GET' : 'POST') as 'GET' | 'POST'
  const opts: RequestInit = { method, headers: authHeaders(token, { method: httpMethod, contentType }) }
  if (body) opts.body = body
  const res  = await fetch(url, opts)
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = parseXml(text) } catch { parsed = { _rawText: text } }

  // Auto-retry on token expiry (errorCode 1007)
  // Also check non-OK HTTP status which often means token issue
  if (isTokenExpiredResponse(parsed) || (!res.ok && text.includes('1007'))) {
    console.warn('[maas360] Token expired (1007) — invalidating all caches and fetching fresh token.')
    // Force full invalidation: clear both in-memory and DB cache
    _memToken = null
    try {
      const svc = createServiceClient()
      await svc.from('maas360_token').delete().eq('id', 1)
    } catch { /* ignore */ }

    // Small delay to ensure M360 server-side invalidation propagates
    await new Promise(r => setTimeout(r, 500))

    const freshToken = await getAuthToken()
    console.log(`[maas360] Got fresh token: ${freshToken.slice(0, 8)}… — retrying request.`)
    const retryOpts: RequestInit = { method, headers: authHeaders(freshToken, { method: httpMethod, contentType }) }
    if (body) retryOpts.body = body
    const retryRes  = await fetch(url, retryOpts)
    const retryText = await retryRes.text()
    let retryParsed: Record<string, unknown> = {}
    try { retryParsed = parseXml(retryText) } catch { retryParsed = { _rawText: retryText } }

    // If STILL expired after fresh auth, something is seriously wrong
    if (isTokenExpiredResponse(retryParsed)) {
      console.error('[maas360] Token still expired after fresh auth — M360 may be rejecting the account.')
    }
    return { ok: retryRes.ok && !isTokenExpiredResponse(retryParsed), parsed: retryParsed, rawText: retryText }
  }

  return { ok: res.ok, parsed, rawText: text }
}

/* ── Device actions ───────────────────────────────────────────────────── */

/**
 * Execute a device action via the M360 Device Actions V2 API.
 *
 * Official endpoint (from IBM/HCL docs, page 125):
 *   POST /action-apis/actions/1.0/customer/{billingID}/action/{actionType}/device/{deviceCsn}
 *   Content-Type: application/json
 *   Authorization: MaaS token="<ADMIN_AUTH_MAAS_TOKEN>"
 *
 * Required JSON body: { name, expiryDate, requestorWorkflow }
 *
 * Sample: https://services.m3.maas360.com/action-apis/actions/1.0/customer/1101234/action/MDM_AFW_REMOTE_REBOOT/device/a1b2c3
 */
async function executeAction(deviceId: string, actionType: string, additionalParams?: Record<string, unknown>): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()

  const url = `${BASE_URL}/action-apis/actions/1.0/customer/${BILLING_ID}/action/${actionType}/device/${deviceId}`

  // V2 requires a JSON body with name, expiryDate (epoch ms), requestorWorkflow
  const jsonBody: Record<string, unknown> = {
    name: actionType,
    expiryDate: Date.now() + 24 * 60 * 60 * 1000, // 24h from now
    requestorWorkflow: 'FLEET_PORTAL',
  }
  if (additionalParams) {
    jsonBody.additionalParams = additionalParams
  }

  console.log(`[maas360] executeAction V2: POST ${actionType} on device ${deviceId} → ${url}`)
  console.log(`[maas360] body: ${JSON.stringify(jsonBody)}`)

  const { ok, parsed, rawText } = await m360Fetch(url, token, 'POST', JSON.stringify(jsonBody), 'json')

  // V2 returns JSON — try parsing as JSON if XML parser returned empty/junk
  let responseData: Record<string, unknown> = parsed
  if ((!parsed || Object.keys(parsed).length === 0 || parsed._rawText) && rawText) {
    try {
      responseData = JSON.parse(rawText) as Record<string, unknown>
    } catch {
      responseData = { _rawText: rawText.slice(0, 500) }
    }
  }

  console.log(`[maas360] executeAction response: ok=${ok}, status rawText=${rawText.slice(0, 300)}`)

  if (ok && !isTokenExpiredResponse(responseData)) {
    console.log(`[maas360] executeAction success:`, JSON.stringify(responseData).slice(0, 300))
    return { success: true, raw: responseData }
  }

  console.warn(`[maas360] executeAction failed: ${rawText.slice(0, 400)}`)
  return { success: false, raw: { ...responseData, _httpOk: ok, _rawText: rawText.slice(0, 500) } }
}

export async function rebootDevice(deviceId: string): Promise<{ success: boolean; raw: unknown }> {
  // Force-clear any stale cached token before critical operations
  await invalidateToken()
  await getAuthToken() // warm up fresh token — executeAction will use it

  console.log(`[maas360] rebootDevice: MDM_AFW_REMOTE_REBOOT on device ${deviceId}`)
  return executeAction(deviceId, 'MDM_AFW_REMOTE_REBOOT')
}

/**
 * Legacy sendAction endpoint (kept for actions that may not have an
 * actionapis equivalent yet). Uses the older XML-body format:
 *   POST /device-apis/devices/1.0/{billingID}/sendAction
 */
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
    `${BASE_URL}/device-apis/devices/1.0/search/${BILLING_ID}?deviceName=${encodeURIComponent(deviceName)}&pageSize=5&pageNumber=1`,
    token, 'GET'
  )

  // XML response: <devices><device>...</device></devices>
  // fast-xml-parser returns a single object if one device, array if multiple
  const devices = parsed?.devices as Record<string, unknown> | undefined
  const rawDevice = devices?.device
  const list: Record<string, unknown>[] = Array.isArray(rawDevice) ? rawDevice : rawDevice ? [rawDevice as Record<string, unknown>] : []
  return { deviceId: (list[0]?.maas360DeviceID as string) ?? null, found: list }
}

/* ── User provisioning ────────────────────────────────────────────────── */

/**
 * Create a MaaS360 user (local domain) and optionally assign to a user group.
 * Used by the Create Vehicle quick action to provision driver + PIM accounts.
 *
 * Endpoints (HCL MaaS360 User APIs):
 *   POST /user-apis/user/1.0/addUser/customer/{billingID}
 *   POST /user-apis/user/1.0/addUserToGroup/customer/{billingID}
 *
 * NOTE: These endpoints require M360 user-management permissions on the API
 * application. If disabled, callers will receive a non-OK response with the
 * raw XML error payload. This is expected until API access is provisioned.
 */
export async function createM360User(params: {
  userName: string
  domain?: string
  emailAddress?: string
  firstName?: string
  lastName?: string
}): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()

  const userName    = params.userName
  const domain      = params.domain ?? 'local'
  const email       = params.emailAddress ?? `${userName}@layellowcab.local`
  const firstName   = params.firstName ?? userName
  const lastName    = params.lastName  ?? 'Driver'

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<user>',
    `  <userName>${escapeXml(userName)}</userName>`,
    `  <domain>${escapeXml(domain)}</domain>`,
    `  <emailAddress>${escapeXml(email)}</emailAddress>`,
    `  <firstName>${escapeXml(firstName)}</firstName>`,
    `  <lastName>${escapeXml(lastName)}</lastName>`,
    '</user>',
  ].join('\n')

  const { ok, parsed } = await m360Fetch(
    `${BASE_URL}/user-apis/user/1.0/addUser/customer/${BILLING_ID}`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
}

export async function addUserToM360Group(userName: string, groupName: string): Promise<{ success: boolean; raw: unknown }> {
  const { BASE_URL, BILLING_ID } = cfg()
  const token = await getAuthToken()

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<userGroupAssociation>',
    `  <userName>${escapeXml(userName)}</userName>`,
    `  <userGroupName>${escapeXml(groupName)}</userGroupName>`,
    '</userGroupAssociation>',
  ].join('\n')

  const { ok, parsed } = await m360Fetch(
    `${BASE_URL}/user-apis/user/1.0/addUserToGroup/customer/${BILLING_ID}`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
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
