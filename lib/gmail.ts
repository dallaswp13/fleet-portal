/**
 * Gmail helper for Google Voice SMS polling.
 *
 * Required Vercel environment variables:
 *   GMAIL_CREDENTIALS — base64-encoded client_secret JSON from Google Cloud Console
 *   GMAIL_TOKEN       — base64-encoded token.json from running voice_poller.py locally
 *
 * Setup steps:
 *   1. Run voice_poller.py locally once to generate token.json
 *   2. base64-encode both files:
 *      Windows: certutil -encode client_secret.json cred.b64
 *      Mac/Linux: base64 -i client_secret.json
 *   3. Paste the encoded content into Vercel env vars (no newlines)
 */

export interface VoiceMessage {
  gmail_id:    string
  received_at: string
  sender:      string
  sms_text:    string
}

export async function fetchNewVoiceMessages(): Promise<VoiceMessage[]> {
  const credentialsRaw = process.env.GMAIL_CREDENTIALS
  if (!credentialsRaw) {
    throw new Error('GMAIL_CREDENTIALS not set. Add it to Vercel environment variables.')
  }
  const credentials = JSON.parse(Buffer.from(credentialsRaw, 'base64').toString())

  // Try DB-stored token first (set via OAuth flow), then fall back to env var
  let token: Record<string, unknown>
  try {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const service = await createServiceClient()
    const { data } = await service.from('app_config').select('value').eq('key', 'gmail_token').single()
    if (data?.value) {
      token = JSON.parse(data.value)
    } else {
      throw new Error('No DB token')
    }
  } catch {
    const tokenRaw = process.env.GMAIL_TOKEN
    if (!tokenRaw) throw new Error('Gmail not connected. Go to Settings → SMS Setup → Connect Gmail.')
    token = JSON.parse(Buffer.from(tokenRaw, 'base64').toString())
  }

  // Use require() to bypass TypeScript module resolution for optional dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  let google: any
  try {
    google = require('googleapis').google
  } catch {
    throw new Error('googleapis package not installed. Add googleapis to dependencies.')
  }
  const { client_id, client_secret, redirect_uris } = credentials.installed ?? credentials.web
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])
  auth.setCredentials(token)

  const gmail  = google.gmail({ version: 'v1', auth })
  const result = await gmail.users.messages.list({
    userId: 'me', q: 'from:@txt.voice.google.com is:unread', maxResults: 20,
  })

  const msgRefs  = result.data.messages ?? []
  const messages: VoiceMessage[] = []

  for (const ref of msgRefs) {
    if (!ref.id) continue
    const msg = await gmail.users.messages.get({ userId: 'me', id: ref.id, format: 'full' })
    const headers: Record<string, string> = {}
    for (const h of msg.data.payload?.headers ?? []) {
      if (h.name && h.value) headers[h.name] = h.value
    }

    const body = getEmailBody(msg.data.payload)
    const sms  = parseGoogleVoiceSms(body)
    if (!sms) continue

    const ts         = parseInt(msg.data.internalDate ?? '0') / 1000
    const receivedAt = new Date(ts * 1000).toISOString()
    const fromHeader = headers['From'] ?? ''
    const nameMatch  = fromHeader.match(/^"?(.+?)"?\s*</)
    const sender     = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : fromHeader

    messages.push({ gmail_id: ref.id, received_at: receivedAt, sender, sms_text: sms })
  }

  return messages
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEmailBody(payload: any): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain') {
    return Buffer.from(payload.body?.data ?? '', 'base64').toString('utf-8')
  }
  for (const part of payload.parts ?? []) {
    const result = getEmailBody(part)
    if (result) return result
  }
  return ''
}

function parseGoogleVoiceSms(body: string): string | null {
  for (const marker of ['YOUR ACCOUNT', 'This email was sent', 'Google LLC']) {
    const idx = body.indexOf(marker)
    if (idx !== -1) body = body.slice(0, idx)
  }
  const skip = [/^<https?:\/\//, /^https?:\/\//, /^HELP/, /^email notification/i]
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !skip.some(p => p.test(l)))
  return lines.length ? lines.join(' ').trim() : null
}
