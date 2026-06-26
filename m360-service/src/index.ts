/**
 * M360 API Service — Standalone Express Server
 *
 * Wraps the MaaS360 XML API behind clean REST endpoints. Any app can call
 * these instead of talking to M360 directly. Supports:
 *
 *   - API key authentication (shared keys for each consumer)
 *   - Sandbox mode (M360_ENV=sandbox → logs calls, returns mock success)
 *   - Request logging (every call logged with timestamp, caller, action)
 *   - Token management (in-memory cache, auto-refresh)
 *
 * Deploy as: Vercel serverless, Railway, Render, or plain VPS.
 */

import 'dotenv/config'
import express from 'express'
import {
  rebootDevice, wipeDevice, enterKioskMode, exitKioskMode,
  clearAppData, clearDispatchApp, clearPimBluetooth,
  searchDeviceByName, createUser, addUserToGroup, testAuth,
  type ActionResult,
} from './m360-client'

const app = express()
app.use(express.json())

const PORT = parseInt(process.env.PORT ?? '3360', 10)
const ENV = process.env.M360_ENV ?? 'sandbox'
const API_KEYS = new Set((process.env.API_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean))
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'

const isSandbox = ENV === 'sandbox'

// ── Request Logging ──────────────────────────────────────────────────────────

interface RequestLogEntry {
  timestamp: string
  method: string
  path: string
  action: string
  deviceId?: string
  caller: string
  sandbox: boolean
  durationMs: number
  success: boolean
  error?: string
}

const requestLog: RequestLogEntry[] = []
const MAX_LOG_SIZE = 1000

function logRequest(entry: RequestLogEntry) {
  requestLog.unshift(entry)
  if (requestLog.length > MAX_LOG_SIZE) requestLog.length = MAX_LOG_SIZE
  const level = entry.success ? 'info' : 'warn'
  if (LOG_LEVEL === 'debug' || level !== 'info' || LOG_LEVEL === 'info') {
    console.log(`[m360-service] ${entry.timestamp} ${entry.method} ${entry.path} → ${entry.action} ${entry.sandbox ? '[SANDBOX]' : ''} ${entry.success ? 'OK' : 'FAIL'} (${entry.durationMs}ms)`)
  }
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Skip auth if no keys configured (dev mode)
  if (API_KEYS.size === 0) {
    (req as express.Request & { caller: string }).caller = 'anonymous'
    next()
    return
  }

  const authHeader = req.headers.authorization
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.api_key as string

  if (!key || !API_KEYS.has(key)) {
    res.status(401).json({ error: 'Invalid or missing API key' })
    return
  }

  // Use key prefix as caller identifier
  (req as express.Request & { caller: string }).caller = key.slice(0, 10) + '…'
  next()
}

app.use('/api', authenticate)

// ── Sandbox Wrapper ──────────────────────────────────────────────────────────

function sandboxResult(action: string, deviceId: string): ActionResult {
  return {
    success: true,
    raw: {
      _sandbox: true,
      _action: action,
      _deviceId: deviceId,
      _message: `[SANDBOX] ${action} would have been sent to device ${deviceId}. No real API call was made.`,
    },
  }
}

// ── Device Action Routes ─────────────────────────────────────────────────────

type ActionHandler = (deviceId: string, packageName?: string) => Promise<ActionResult>

const ACTION_MAP: Record<string, { handler: ActionHandler; destructive: boolean }> = {
  reboot:         { handler: (d) => rebootDevice(d), destructive: false },
  wipe:           { handler: (d) => wipeDevice(d), destructive: true },
  kiosk_enter:    { handler: (d) => enterKioskMode(d), destructive: false },
  kiosk_exit:     { handler: (d) => exitKioskMode(d), destructive: false },
  clear_app_data: { handler: (d, pkg) => clearAppData(d, pkg), destructive: false },
  clear_dispatch: { handler: (d) => clearDispatchApp(d), destructive: false },
  clear_pim_bt:   { handler: (d) => clearPimBluetooth(d), destructive: false },
}

/**
 * Shared handler for device actions. Used by both /api/device/action and shortcuts.
 */
async function handleDeviceAction(req: express.Request, res: express.Response) {
  const start = Date.now()
  const caller = (req as express.Request & { caller?: string }).caller ?? 'unknown'
  const { action, deviceId, packageName, confirmed } = req.body as {
    action?: string; deviceId?: string; packageName?: string; confirmed?: boolean
  }

  if (!action || !deviceId) {
    res.status(400).json({ error: 'action and deviceId are required' })
    return
  }

  const mapping = ACTION_MAP[action]
  if (!mapping) {
    res.status(400).json({ error: `Unknown action: ${action}`, availableActions: Object.keys(ACTION_MAP) })
    return
  }

  if (mapping.destructive && !confirmed) {
    res.status(400).json({ error: `${action} is destructive — pass confirmed: true to proceed` })
    return
  }

  try {
    let result: ActionResult
    if (isSandbox) {
      result = sandboxResult(action, deviceId)
    } else {
      result = await mapping.handler(deviceId, packageName)
    }

    logRequest({
      timestamp: new Date().toISOString(), method: 'POST', path: req.path,
      action, deviceId, caller, sandbox: isSandbox, durationMs: Date.now() - start,
      success: result.success,
    })

    res.json({
      success: result.success,
      sandbox: isSandbox,
      action,
      deviceId,
      message: result.success ? `${action} sent successfully` : `${action} failed`,
      data: result.raw,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logRequest({
      timestamp: new Date().toISOString(), method: 'POST', path: req.path,
      action, deviceId, caller, sandbox: isSandbox, durationMs: Date.now() - start,
      success: false, error: message,
    })
    res.status(502).json({ success: false, error: message })
  }
}

/**
 * POST /api/device/action
 * Body: { action, deviceId, packageName?, confirmed? }
 */
app.post('/api/device/action', handleDeviceAction)

/**
 * POST /api/device/reboot — convenience shortcut
 * Body: { deviceId }
 */
app.post('/api/device/reboot', (req, res) => {
  req.body.action = 'reboot'
  handleDeviceAction(req, res)
})

// ── Device Search ────────────────────────────────────────────────────────────

/**
 * GET /api/device/search?name=<deviceName>
 */
app.get('/api/device/search', async (req, res) => {
  const start = Date.now()
  const caller = (req as express.Request & { caller?: string }).caller ?? 'unknown'
  const name = req.query.name as string

  if (!name) {
    res.status(400).json({ error: 'name query parameter is required' })
    return
  }

  try {
    let result: { deviceId: string | null; found: unknown[] }
    if (isSandbox) {
      result = { deviceId: 'sandbox-device-001', found: [{ maas360DeviceID: 'sandbox-device-001', deviceName: name, _sandbox: true }] }
    } else {
      result = await searchDeviceByName(name)
    }

    logRequest({
      timestamp: new Date().toISOString(), method: 'GET', path: '/api/device/search',
      action: 'search', caller, sandbox: isSandbox, durationMs: Date.now() - start, success: true,
    })

    res.json({ success: true, sandbox: isSandbox, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logRequest({
      timestamp: new Date().toISOString(), method: 'GET', path: '/api/device/search',
      action: 'search', caller, sandbox: isSandbox, durationMs: Date.now() - start, success: false, error: message,
    })
    res.status(502).json({ success: false, error: message })
  }
})

// ── User Provisioning ────────────────────────────────────────────────────────

/**
 * POST /api/user/create
 * Body: { userName, domain?, emailAddress?, firstName?, lastName? }
 */
app.post('/api/user/create', async (req, res) => {
  const start = Date.now()
  const caller = (req as express.Request & { caller?: string }).caller ?? 'unknown'
  const { userName, domain, emailAddress, firstName, lastName } = req.body as Record<string, string>

  if (!userName) { res.status(400).json({ error: 'userName is required' }); return }

  try {
    let result: ActionResult
    if (isSandbox) {
      result = { success: true, raw: { _sandbox: true, userName, message: 'User would be created' } }
    } else {
      result = await createUser({ userName, domain, emailAddress, firstName, lastName })
    }

    logRequest({
      timestamp: new Date().toISOString(), method: 'POST', path: '/api/user/create',
      action: 'create_user', caller, sandbox: isSandbox, durationMs: Date.now() - start, success: result.success,
    })
    res.json({ success: result.success, sandbox: isSandbox, data: result.raw })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ success: false, error: message })
  }
})

/**
 * POST /api/user/assign-group
 * Body: { userName, groupName }
 */
app.post('/api/user/assign-group', async (req, res) => {
  const start = Date.now()
  const caller = (req as express.Request & { caller?: string }).caller ?? 'unknown'
  const { userName, groupName } = req.body as { userName?: string; groupName?: string }

  if (!userName || !groupName) { res.status(400).json({ error: 'userName and groupName are required' }); return }

  try {
    let result: ActionResult
    if (isSandbox) {
      result = { success: true, raw: { _sandbox: true, userName, groupName, message: 'User would be added to group' } }
    } else {
      result = await addUserToGroup(userName, groupName)
    }

    logRequest({
      timestamp: new Date().toISOString(), method: 'POST', path: '/api/user/assign-group',
      action: 'assign_group', caller, sandbox: isSandbox, durationMs: Date.now() - start, success: result.success,
    })
    res.json({ success: result.success, sandbox: isSandbox, data: result.raw })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ success: false, error: message })
  }
})

// ── Health & Utility ─────────────────────────────────────────────────────────

/** GET /api/health — verify M360 credentials */
app.get('/api/health', async (_req, res) => {
  const result = await testAuth()
  res.json({ ...result, env: ENV, sandbox: isSandbox })
})

/** GET /api/keepalive — lightweight call to prevent token expiry */
app.get('/api/keepalive', async (_req, res) => {
  try {
    if (isSandbox) {
      res.json({ ok: true, sandbox: true, message: 'Keepalive skipped in sandbox' })
      return
    }
    await searchDeviceByName('__keepalive__')
    res.json({ ok: true, message: 'Token refreshed' })
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' })
  }
})

/** GET /api/log — recent request log (last 100 entries) */
app.get('/api/log', (_req, res) => {
  const limit = parseInt(_req.query.limit as string ?? '100', 10)
  res.json({ entries: requestLog.slice(0, limit), total: requestLog.length })
})

/** GET /api/actions — list all available actions */
app.get('/api/actions', (_req, res) => {
  res.json({
    actions: Object.entries(ACTION_MAP).map(([name, { destructive }]) => ({ name, destructive })),
    env: ENV,
    sandbox: isSandbox,
  })
})

// ── Root ─────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    service: 'm360-service',
    version: '1.0.0',
    env: ENV,
    sandbox: isSandbox,
    endpoints: [
      'POST /api/device/action    — execute a device action (reboot, wipe, kiosk, clear)',
      'POST /api/device/reboot    — shortcut for reboot',
      'GET  /api/device/search    — search device by name',
      'POST /api/user/create      — create M360 user account',
      'POST /api/user/assign-group — add user to group',
      'GET  /api/health           — verify M360 auth credentials',
      'GET  /api/keepalive        — refresh auth token',
      'GET  /api/log              — recent request log',
      'GET  /api/actions          — list available actions',
    ],
  })
})

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  m360-service running on http://localhost:${PORT}`)
  console.log(`  Environment: ${ENV}${isSandbox ? ' (sandbox — no real M360 calls)' : ' (LIVE — calls real M360 API)'}`)
  console.log(`  API keys configured: ${API_KEYS.size > 0 ? API_KEYS.size : 'none (open access)'}`)
  console.log()
})

export default app
