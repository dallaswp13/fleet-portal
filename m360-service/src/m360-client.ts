/**
 * MaaS360 API Client — extracted from Fleet Portal
 *
 * Self-contained: no Supabase or Next.js dependencies.
 * Token is cached in-memory with a configurable persistence hook
 * so the host can plug in Redis, SQLite, or whatever.
 *
 * All M360 requests use XML transport (the registered credential type).
 * Device Actions V2 uses JSON body with XML auth header.
 */

import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })

// ── Configuration ────────────────────────────────────────────────────────────

export interface M360Config {
  baseUrl: string
  billingId: string
  platformId: string
  appId: string
  appVersion: string
  accessKey: string
  username: string
  password: string
  dispatchPackage: string
}

export function loadConfig(): M360Config {
  return {
    baseUrl:         (process.env.MAAS360_BASE_URL ?? 'https://services.m3.maas360.com').replace(/\/$/, ''),
    billingId:       process.env.MAAS360_BILLING_ID ?? '',
    platformId:      process.env.MAAS360_PLATFORM_ID ?? '3',
    appId:           process.env.MAAS360_APP_ID ?? '',
    appVersion:      process.env.MAAS360_APP_VERSION ?? '1.0',
    accessKey:       process.env.MAAS360_APP_ACCESS_KEY ?? process.env.MAAS360_ACCESS_KEY ?? '',
    username:        process.env.MAAS360_USERNAME ?? process.env.MAAS360_USER ?? '',
    password:        process.env.MAAS360_PASSWORD ?? process.env.MAAS360_PASS ?? '',
    dispatchPackage: process.env.DISPATCH_APP_PACKAGE ?? 'com.ccsi.taxidispatch',
  }
}

// ── Token Cache ──────────────────────────────────────────────────────────────

interface CachedToken { value: string; expires: number }
let _memToken: CachedToken | null = null

/**
 * Optional external persistence hook. Set via setTokenPersistence().
 * If not set, tokens are cached in-memory only (lost on restart).
 */
let _loadExternal: (() => Promise<CachedToken | null>) | null = null
let _saveExternal: ((token: string, expires: number) => Promise<void>) | null = null

export function setTokenPersistence(hooks: {
  load: () => Promise<CachedToken | null>
  save: (token: string, expires: number) => Promise<void>
}) {
  _loadExternal = hooks.load
  _saveExternal = hooks.save
}

// ── XML Helpers ──────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function parseXml(text: string): Record<string, unknown> {
  return xmlParser.parse(text) as Record<string, unknown>
}

function isTokenExpiredResponse(parsed: Record<string, unknown>): boolean {
  const auth = (parsed?.authResponse ?? parsed) as Record<string, unknown>
  return auth?.errorCode === 1007 || auth?.errorCode === '1007'
}

// ── Authentication ───────────────────────────────────────────────────────────

export async function getAuthToken(): Promise<string> {
  const now = Date.now()

  // 1. In-memory cache
  if (_memToken && _memToken.expires > now + 60_000) return _memToken.value

  // 2. External persistence (if configured)
  if (_loadExternal) {
    try {
      const ext = await _loadExternal()
      if (ext && ext.expires > now + 60_000) {
        _memToken = ext
        return ext.value
      }
    } catch { /* fall through */ }
  }

  // 3. Fresh token from MaaS360
  const cfg = loadConfig()
  if (!cfg.billingId) throw new Error('MAAS360_BILLING_ID not set')
  if (!cfg.appId) throw new Error('MAAS360_APP_ID not set')
  if (!cfg.accessKey) throw new Error('MAAS360_APP_ACCESS_KEY not set')
  if (!cfg.username) throw new Error('MAAS360_USERNAME not set')
  if (!cfg.password) throw new Error('MAAS360_PASSWORD not set')

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<authRequest>',
    '\t<maaS360AdminAuth>',
    `\t\t<platformID>${escapeXml(cfg.platformId)}</platformID>`,
    `\t\t<billingID>${escapeXml(cfg.billingId)}</billingID>`,
    `\t\t<password>${escapeXml(cfg.password)}</password>`,
    `\t\t<userName>${escapeXml(cfg.username)}</userName>`,
    `\t\t<appID>${escapeXml(cfg.appId)}</appID>`,
    `\t\t<appVersion>${escapeXml(cfg.appVersion)}</appVersion>`,
    `\t\t<appAccessKey>${escapeXml(cfg.accessKey)}</appAccessKey>`,
    '\t</maaS360AdminAuth>',
    '</authRequest>',
  ].join('\n')

  const authUrl = `${cfg.baseUrl}/auth-apis/auth/2.0/authenticate/customer/${cfg.billingId}`
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
    body: xmlBody,
  })

  const text = await res.text()
  let data: Record<string, unknown>
  try { data = parseXml(text) } catch { throw new Error(`M360 auth: invalid XML ${res.status} — ${text.slice(0, 300)}`) }

  const authResponse = (data?.authResponse ?? data) as Record<string, unknown>
  const errCode = authResponse?.errorCode
  const errDesc = authResponse?.errorDesc

  if (!res.ok || (errCode && Number(errCode) !== 0)) {
    throw new Error(`M360 auth failed (HTTP ${res.status}): ${errDesc ?? text.slice(0, 300)} [code ${errCode}]`)
  }

  const token = authResponse?.authToken as string | undefined
  if (!token) throw new Error(`M360 auth: no authToken in response — ${text.slice(0, 300)}`)

  const expires = Date.now() + 50 * 60 * 1000
  _memToken = { value: token, expires }
  if (_saveExternal) {
    try { await _saveExternal(token, expires) } catch { /* best-effort */ }
  }
  return token
}

export async function invalidateToken(): Promise<void> {
  _memToken = null
}

// ── Request Helper ───────────────────────────────────────────────────────────

function authHeaders(token: string, opts: { method?: 'GET' | 'POST'; contentType?: 'xml' | 'json' } = {}) {
  const { method = 'POST', contentType = 'xml' } = opts
  const headers: Record<string, string> = {
    'Authorization': `MaaS token="${token}"`,
  }
  if (method === 'POST') {
    headers['Content-Type'] = contentType === 'json' ? 'application/json' : 'application/xml'
    headers['Accept'] = contentType === 'json' ? 'application/json' : 'application/xml'
  }
  return headers
}

async function m360Fetch(
  url: string, token: string, method: string, body?: string, contentType: 'xml' | 'json' = 'xml'
): Promise<{ ok: boolean; parsed: Record<string, unknown>; rawText: string }> {
  const httpMethod = (method.toUpperCase() === 'GET' ? 'GET' : 'POST') as 'GET' | 'POST'
  const opts: RequestInit = { method, headers: authHeaders(token, { method: httpMethod, contentType }) }
  if (body) opts.body = body
  const res = await fetch(url, opts)
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = parseXml(text) } catch { parsed = { _rawText: text } }

  // Auto-retry on token expiry (errorCode 1007)
  if (isTokenExpiredResponse(parsed) || (!res.ok && text.includes('1007'))) {
    _memToken = null
    await new Promise(r => setTimeout(r, 500))
    const freshToken = await getAuthToken()
    const retryOpts: RequestInit = { method, headers: authHeaders(freshToken, { method: httpMethod, contentType }) }
    if (body) retryOpts.body = body
    const retryRes = await fetch(url, retryOpts)
    const retryText = await retryRes.text()
    let retryParsed: Record<string, unknown> = {}
    try { retryParsed = parseXml(retryText) } catch { retryParsed = { _rawText: retryText } }
    return { ok: retryRes.ok && !isTokenExpiredResponse(retryParsed), parsed: retryParsed, rawText: retryText }
  }

  return { ok: res.ok, parsed, rawText: text }
}

// ── Device Actions ───────────────────────────────────────────────────────────

export type ActionResult = { success: boolean; raw: unknown }

/** Device Actions V2 — POST with JSON body */
async function executeAction(deviceId: string, actionType: string, additionalParams?: Record<string, unknown>): Promise<ActionResult> {
  const cfg = loadConfig()
  const token = await getAuthToken()
  const url = `${cfg.baseUrl}/action-apis/actions/1.0/customer/${cfg.billingId}/action/${actionType}/device/${deviceId}`

  const jsonBody: Record<string, unknown> = {
    name: actionType,
    expiryDate: Date.now() + 24 * 60 * 60 * 1000,
    requestorWorkflow: 'M360_SERVICE',
  }
  if (additionalParams) jsonBody.additionalParams = additionalParams

  const { ok, parsed, rawText } = await m360Fetch(url, token, 'POST', JSON.stringify(jsonBody), 'json')

  let responseData: Record<string, unknown> = parsed
  if ((!parsed || Object.keys(parsed).length === 0 || parsed._rawText) && rawText) {
    try { responseData = JSON.parse(rawText) as Record<string, unknown> } catch { responseData = { _rawText: rawText.slice(0, 500) } }
  }

  return { success: ok && !isTokenExpiredResponse(responseData), raw: responseData }
}

/** Legacy sendAction endpoint — XML body */
const LEGACY_ACTION_MAP: Record<string, string> = {
  wipe: 'FactoryReset', kiosk_enter: 'EnableKioskMode', kiosk_exit: 'DisableKioskMode', clear_app_data: 'ClearAppData',
}

async function sendDeviceAction(deviceId: string, actionKey: string, extra?: Record<string, string>): Promise<ActionResult> {
  const cfg = loadConfig()
  const token = await getAuthToken()
  const action = LEGACY_ACTION_MAP[actionKey] ?? actionKey

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
    `${cfg.baseUrl}/device-apis/devices/1.0/${cfg.billingId}/sendAction`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function rebootDevice(deviceId: string): Promise<ActionResult> {
  await invalidateToken()
  await getAuthToken()
  return executeAction(deviceId, 'MDM_AFW_REMOTE_REBOOT')
}

export async function wipeDevice(deviceId: string): Promise<ActionResult> {
  return sendDeviceAction(deviceId, 'wipe')
}

export async function enterKioskMode(deviceId: string): Promise<ActionResult> {
  return sendDeviceAction(deviceId, 'kiosk_enter')
}

export async function exitKioskMode(deviceId: string): Promise<ActionResult> {
  return sendDeviceAction(deviceId, 'kiosk_exit')
}

export async function clearAppData(deviceId: string, packageName?: string): Promise<ActionResult> {
  return sendDeviceAction(deviceId, 'clear_app_data', packageName ? { packageName } : undefined)
}

export async function clearDispatchApp(deviceId: string): Promise<ActionResult> {
  return clearAppData(deviceId, loadConfig().dispatchPackage)
}

export async function clearPimBluetooth(deviceId: string): Promise<ActionResult> {
  return clearAppData(deviceId, 'com.android.bluetooth')
}

// ── Device Search ────────────────────────────────────────────────────────────

export async function searchDeviceByName(deviceName: string): Promise<{ deviceId: string | null; found: unknown[] }> {
  const cfg = loadConfig()
  const token = await getAuthToken()
  const { parsed } = await m360Fetch(
    `${cfg.baseUrl}/device-apis/devices/1.0/search/${cfg.billingId}?deviceName=${encodeURIComponent(deviceName)}&pageSize=5&pageNumber=1`,
    token, 'GET'
  )

  const devices = parsed?.devices as Record<string, unknown> | undefined
  const rawDevice = devices?.device
  const list: Record<string, unknown>[] = Array.isArray(rawDevice) ? rawDevice : rawDevice ? [rawDevice as Record<string, unknown>] : []
  return { deviceId: (list[0]?.maas360DeviceID as string) ?? null, found: list }
}

// ── User Provisioning ────────────────────────────────────────────────────────

export async function createUser(params: {
  userName: string; domain?: string; emailAddress?: string; firstName?: string; lastName?: string
}): Promise<ActionResult> {
  const cfg = loadConfig()
  const token = await getAuthToken()
  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<user>',
    `  <userName>${escapeXml(params.userName)}</userName>`,
    `  <domain>${escapeXml(params.domain ?? 'local')}</domain>`,
    `  <emailAddress>${escapeXml(params.emailAddress ?? `${params.userName}@layellowcab.local`)}</emailAddress>`,
    `  <firstName>${escapeXml(params.firstName ?? params.userName)}</firstName>`,
    `  <lastName>${escapeXml(params.lastName ?? 'Driver')}</lastName>`,
    '</user>',
  ].join('\n')

  const { ok, parsed } = await m360Fetch(
    `${cfg.baseUrl}/user-apis/user/1.0/addUser/customer/${cfg.billingId}`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
}

export async function addUserToGroup(userName: string, groupName: string): Promise<ActionResult> {
  const cfg = loadConfig()
  const token = await getAuthToken()
  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<userGroupAssociation>',
    `  <userName>${escapeXml(userName)}</userName>`,
    `  <userGroupName>${escapeXml(groupName)}</userGroupName>`,
    '</userGroupAssociation>',
  ].join('\n')

  const { ok, parsed } = await m360Fetch(
    `${cfg.baseUrl}/user-apis/user/1.0/addUserToGroup/customer/${cfg.billingId}`,
    token, 'POST', xmlBody
  )
  return { success: ok, raw: parsed }
}

// ── Auth Test ────────────────────────────────────────────────────────────────

export async function testAuth(): Promise<{ ok: boolean; message: string }> {
  try {
    _memToken = null
    const token = await getAuthToken()
    return { ok: true, message: `Auth OK. Token: ${token.slice(0, 8)}…` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
