import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testAuth } from '@/lib/maas360'

/**
 * GET /api/maas360/test-action?deviceId=xxx
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

  // Step 1: Auth
  let token: string
  try {
    const auth = await testAuth()
    if (!auth.ok) return NextResponse.json({ auth, error: 'Auth failed' })
    token = auth.message.match(/Token: (\S+)/)?.[1] ?? ''
    if (!token) return NextResponse.json({ auth, error: 'Could not extract token' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) })
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
        url: fullUrl,
        method: execute ? 'POST (with body)' : 'POST (no body — dry probe)',
        httpStatus: res.status,
        response: parsed,
      })
    } catch (err) {
      results.push({
        path,
        url: fullUrl,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    deviceId,
    execute,
    baseUrl: BASE_URL,
    billingId: BILLING_ID,
    actionType,
    body: execute ? JSON.parse(jsonBody) : '(not sent — add &execute=true)',
    results,
  })
}
