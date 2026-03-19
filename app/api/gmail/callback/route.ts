import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/gmail/callback
 * Handles the OAuth callback from Google.
 * Exchanges the code for tokens and stores GMAIL_TOKEN as a Supabase secret
 * (since we can't write Vercel env vars at runtime, we store in DB instead).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return new NextResponse('Missing code parameter', { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const credRaw = process.env.GMAIL_CREDENTIALS
  if (!credRaw) {
    return new NextResponse('GMAIL_CREDENTIALS not configured', { status: 501 })
  }

  try {
    const creds = JSON.parse(Buffer.from(credRaw, 'base64').toString())
    const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web
    const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? redirect_uris[0]
    const redirect = `${siteUrl}/api/gmail/callback`

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      return new NextResponse(`Token exchange failed: ${text}`, { status: 500 })
    }

    const token = await tokenRes.json()

    // Store token in Supabase (app_config table) so it persists and can be refreshed
    const service = createClient()
    await (await service).from('app_config').upsert({
      key:        'gmail_token',
      value:      JSON.stringify(token),
      updated_by: user.email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

    // Redirect back to SMS page with success
    return NextResponse.redirect(new URL('/sms?gmail=connected', req.url))
  } catch (err) {
    return new NextResponse(`OAuth error: ${err}`, { status: 500 })
  }
}
