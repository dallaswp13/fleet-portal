import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/sms/media-proxy?url=<twilio_media_url>
 *
 * Twilio MMS attachments live at api.twilio.com URLs that require HTTP Basic
 * Auth with the account's SID+AuthToken. Browsers don't have those credentials,
 * so an <img src="https://api.twilio.com/.../Media/..."> tag fails to load and
 * clicking the link prompts the user for a username/password.
 *
 * This route fetches the image server-side using the credentials we already
 * have in env vars and streams the bytes back to the authenticated session,
 * so the inbox <img> tags render inline as expected.
 *
 * Security:
 *   - Requires an authenticated Supabase session — proxy is in-app only.
 *   - URL must be an api.twilio.com /Media/ path; anything else is 403.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  // Only proxy Twilio media URLs. Twilio's API host is api.twilio.com and
  // attachments live under /2010-04-01/Accounts/<sid>/Messages/<sid>/Media/<sid>.
  let parsed: URL
  try { parsed = new URL(url) } catch { return new NextResponse('Bad url', { status: 400 }) }
  const isTwilio = parsed.host === 'api.twilio.com' && parsed.pathname.includes('/Media/')
  if (!isTwilio) return new NextResponse('Forbidden', { status: 403 })

  const sid = process.env.TWILIO_ACCOUNT_SID
  const tok = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !tok) {
    return new NextResponse('Twilio credentials not configured', { status: 500 })
  }
  const auth = Buffer.from(`${sid}:${tok}`).toString('base64')

  try {
    // Twilio redirects /Media/<sid> to an S3 presigned URL. We follow the
    // redirect with credentials on the initial hop; the S3 URL itself does
    // not need them.
    const upstream = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      console.warn(`[media-proxy] upstream ${upstream.status} for ${url}`)
      return new NextResponse(null, { status: upstream.status })
    }
    const body        = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':  contentType,
        // MMS URLs are stable for the life of the message, so we can cache
        // aggressively. Browser cache only — keep it private since this is
        // auth-gated content.
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    console.error('[media-proxy] fetch threw:', err)
    return new NextResponse('Upstream error', { status: 502 })
  }
}
