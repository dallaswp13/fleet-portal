import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/gmail/auth
 * Starts the Google OAuth flow. Redirects user to Google consent screen.
 * After consent, Google redirects to /api/gmail/callback.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const credRaw = process.env.GMAIL_CREDENTIALS
  if (!credRaw) {
    return NextResponse.json({ error: 'GMAIL_CREDENTIALS not set in Vercel environment variables.' }, { status: 501 })
  }

  try {
    const creds = JSON.parse(Buffer.from(credRaw, 'base64').toString())
    const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web

    // Use the Vercel deployment URL as redirect
    const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? redirect_uris[0]
    const redirect = `${siteUrl}/api/gmail/callback`

    const params = new URLSearchParams({
      client_id,
      redirect_uri:  redirect,
      response_type: 'code',
      scope:         'https://www.googleapis.com/auth/gmail.readonly',
      access_type:   'offline',
      prompt:        'consent',
    })

    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  } catch (err) {
    return NextResponse.json({ error: `Failed to parse GMAIL_CREDENTIALS: ${err}` }, { status: 500 })
  }
}
