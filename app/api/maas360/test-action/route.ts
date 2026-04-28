import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthToken } from '@/lib/m360-service-client'

/**
 * GET /api/maas360/test-action?deviceId=xxx&execute=true
 *
 * Probes multiple URL patterns for the Device Actions V2 endpoint to find
 * which one works on this M360 instance. Returns results for all patterns.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const deviceId = url.searchParams.get('deviceId')
  const execute = url.searchParams.get('execute') === 'true'

  if (!deviceId) {
    return NextResponse.json({ error: 'Provide ?deviceId=xxx' }, { status: 400 })
  }

  // Get a real auth token directly (not from testAuth display string)
  let token: string
  try {
    token = await getAuthToken()
  } catch (err) {
    return NextResponse.json({ error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` })
  }

  const BASE_URL = process.env.MAAS360_BASE_URL?.replace(/\/$/, '') ?? 'https://services.m3.maas360.com'
  const BILLING_ID = process.env.MAAS360_BILLING_ID ?? ''
  const actionType = 'MDM_AFW_REMOTE_REBOOT'

  // All URL patterns found in IBM docs (inconsistent across pages):
  const patterns = [
    `/actions/1.0/customer/${BILLING_ID}/action/${actionType}/device/${deviceId}`,
    `/action-apis/actions/1.0/customer/${BILLING_ID}/action/${actionType}/device/${deviceId}`,
    `/action-apis/action-mgmt-apis/actions/1.0/customer/${BILLING_ID}/action/${actionType}/device/${deviceId}`,
    `/actionapis/actions/1.0/customer/${BILLING_ID}/action/${actionType}/device/${deviceId}`,
  ]

  const jsonBody = JSON.stringify({
    name: actionType,
    expiryDate: Date.now() + 24 * 60 * 60 * 1000,
    requestorWorkflow: 'FLEET_PORTAL',
  })

  const results: Record<string, unknown>[] = []

  for (const path of patterns) {
    const fullUrl = `${BASE_URL}${path}`
    try {
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Authorization': `MaaS token="${token}"`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: execute ? jsonBody : undefined,
      })
      const text = await res.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* keep as text */ }

      results.push({
        path,
        httpStatus: res.status,
        response: parsed,
      })
    } catch (err) {
      results.push({
        path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    deviceId,
    execute,
    tokenPrefix: token.slice(0, 8),
    body: execute ? JSON.parse(jsonBody) : '(not sent — add &execute=true)',
    results,
  })
}
