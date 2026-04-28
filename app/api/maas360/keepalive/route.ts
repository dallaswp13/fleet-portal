/**
 * MaaS360 keepalive cron endpoint
 *
 * Called by Vercel Cron every 30 minutes (configured in vercel.json).
 * Makes a lightweight API call to MaaS360 so the auth token never hits
 * its 60-minute idle expiry. Vercel passes CRON_SECRET automatically.
 *
 * Manual trigger (for testing): GET /api/maas360/keepalive
 * with header: Authorization: Bearer {CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchDeviceByName } from '@/lib/m360-service-client'

export async function GET(req: NextRequest) {
  // Verify this request is from Vercel Cron (or a manual test with the secret)
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Lightweight call: search for a device name that won't match anything.
    // This forces a token refresh if needed and resets the 60-min expiry on IBM's side.
    await searchDeviceByName('__keepalive__')
    return NextResponse.json({ ok: true, time: new Date().toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[maas360/keepalive] error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
