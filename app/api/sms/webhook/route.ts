import { NextRequest, NextResponse, after } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { processInboundSms } from '@/lib/smsProcess'

/**
 * Twilio Incoming SMS Webhook
 *
 * Configure in Twilio Console:
 *   - Messaging Service: Messaging Services → <your service> → Integration →
 *     Inbound Settings → "Send a webhook" → POST <base-url>/api/sms/webhook
 *   - OR Phone Number: Phone Numbers → <your number> → Messaging
 *     Configuration → "A message comes in" → Webhook → POST <base-url>/api/sms/webhook
 *
 * Twilio sends form-encoded body with: From, To, Body, MessageSid, etc.
 * We store the message and return empty TwiML so Twilio knows we received it.
 *
 * GET on this endpoint returns a small JSON health payload so you can verify
 * the URL is reachable from a browser.
 */

function normalizePhone(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>'
const xmlResponse = (body = EMPTY_TWIML, status = 200) =>
  new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })

/**
 * Verify Twilio webhook signature.
 *
 * Twilio signs requests with HMAC-SHA1(authToken, url + sorted-concatenated-params)
 * and sends the base64 digest in the `X-Twilio-Signature` header.
 * Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Returns true if the signature is valid (or if verification is disabled
 * because TWILIO_AUTH_TOKEN is unset — allows local dev).
 */
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature) return false
  const sortedKeys = Object.keys(params).sort()
  const payload = url + sortedKeys.map(k => k + params[k]).join('')
  const expected = createHmac('sha1', authToken).update(payload).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Build the exact URL Twilio used to sign the request. In production Twilio
 * sees the public deployment URL which may differ from req.url (behind a
 * proxy/load balancer). Prefer X-Forwarded-* headers if present.
 */
function reconstructSignedUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const path  = new URL(req.url).pathname
  const query = new URL(req.url).search
  return `${proto}://${host}${path}${query}`
}

export async function GET() {
  // Health check — visit in browser to verify routing
  return NextResponse.json({
    ok: true,
    endpoint: '/api/sms/webhook',
    message: 'Webhook reachable. Configure this URL in Twilio Messaging Service → Integration → Inbound Settings → Send a webhook (POST).',
  })
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    console.error('[twilio-webhook] failed to parse form body:', err)
    return xmlResponse()
  }

  // ── Signature verification ────────────────────────────────────────────────
  // Twilio signs every webhook with the configured auth token. Reject any
  // request whose signature doesn't match to prevent spoofed inbound messages
  // triggering auto-replies or M360 actions. Verification is skipped only if
  // TWILIO_AUTH_TOKEN is unset (local dev) or the escape hatch
  // TWILIO_SKIP_SIGNATURE=1 is set.
  const authToken  = process.env.TWILIO_AUTH_TOKEN ?? ''
  const skipVerify = process.env.TWILIO_SKIP_SIGNATURE === '1'
  if (authToken && !skipVerify) {
    const params: Record<string, string> = {}
    formData.forEach((v, k) => { params[k] = typeof v === 'string' ? v : '' })
    const url = reconstructSignedUrl(req)
    const sig = req.headers.get('x-twilio-signature')
    const ok  = verifyTwilioSignature(url, params, sig, authToken)
    if (!ok) {
      console.warn('[twilio-webhook] signature verification FAILED', {
        url, hasSig: !!sig, sid: formData.get('MessageSid')?.toString(),
      })
      return new NextResponse('Forbidden', { status: 403 })
    }
  } else if (!authToken) {
    console.warn('[twilio-webhook] TWILIO_AUTH_TOKEN unset — signature verification disabled (dev only)')
  }

  const from       = formData.get('From')?.toString() ?? ''
  const body       = formData.get('Body')?.toString() ?? ''
  const sid        = formData.get('MessageSid')?.toString() ?? ''
  const to         = formData.get('To')?.toString() ?? ''
  const fromCity   = formData.get('FromCity')?.toString() ?? ''
  const fromState  = formData.get('FromState')?.toString() ?? ''
  const numMedia   = parseInt(formData.get('NumMedia')?.toString() ?? '0', 10) || 0

  console.log(`[twilio-webhook] inbound SMS from=${from} to=${to} sid=${sid} body="${body.slice(0, 80)}"`)

  if (!from || !body) {
    console.warn('[twilio-webhook] missing From or Body — ignoring', { from, bodyLength: body.length })
    return xmlResponse()
  }

  const svc = createServiceClient()
  const phoneNorm = normalizePhone(from)
  const senderLabel = fromCity && fromState ? `${fromCity}, ${fromState}` : from

  // Deduplicate by Twilio SID (gracefully handle if twilio_sid column doesn't exist)
  if (sid) {
    try {
      const { data: existing } = await svc.from('sms_messages')
        .select('id').eq('twilio_sid', sid).limit(1).maybeSingle()
      if (existing) {
        console.log(`[twilio-webhook] duplicate SID ${sid} — skipping insert`)
        return xmlResponse()
      }
    } catch (err) {
      // Column may not exist (migration 027 not applied) — fall through to insert attempt
      console.warn('[twilio-webhook] dedupe query failed (likely missing twilio_sid column):', err)
    }
  }

  // Compose row with all Twilio columns (migration 027 schema).
  //
  // We stamp `claude_status: 'thinking'` on insert so the Inbox UI can show
  // the "Claude is thinking…" indicator the instant the message arrives via
  // Supabase Realtime — even though the actual processing happens async in
  // `after()` below. The processInboundSms pipeline transitions this to
  // 'replied' / 'executed' / 'manual' / 'failed' when it completes.
  const fullRow = {
    gmail_id: sid ? `twilio_${sid}` : `twilio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sender: senderLabel,
    sender_phone: phoneNorm,
    sms_text: body,
    direction: 'inbound',
    source: 'twilio',
    twilio_sid: sid || null,
    recipient_phone: null,
    processed: false,
    claude_status: 'thinking',
    received_at: new Date().toISOString(),
  }

  let { data: inserted, error } = await svc
    .from('sms_messages')
    .insert(fullRow)
    .select('id')
    .single()

  // If migration 027 isn't applied, strip Twilio-only columns and retry
  if (error && /direction|source|twilio_sid|recipient_phone|claude_status/i.test(error.message)) {
    console.warn('[twilio-webhook] Twilio schema columns missing — retrying without them. Run migration 027 to enable.')
    const { direction, source, twilio_sid, recipient_phone, claude_status, ...legacy } = fullRow
    const retry = await svc.from('sms_messages').insert(legacy).select('id').single()
    inserted = retry.data
    error = retry.error
  }

  if (error) {
    // Log but still return OK to Twilio — returning non-200 causes Twilio to retry and queue failures
    console.error('[twilio-webhook] insert failed:', error.message, { fullRow })
    return xmlResponse()
  }

  console.log(`[twilio-webhook] stored inbound message from ${phoneNorm} (media=${numMedia})`)

  // Run the unified processing pipeline AFTER we've responded to Twilio.
  //
  // Why: the old flow awaited processInboundSms (which calls the Anthropic
  // API and can take several seconds) before returning TwiML. That made the
  // Inbox feel laggy — the new inbound message + Claude's reply both showed
  // up at the same moment. By moving this work into `after()`:
  //   1. Twilio gets an instant 200 response (well under its 15s budget).
  //   2. Supabase Realtime delivers the INSERT to the open Inbox tab right
  //      now, so the message appears immediately with a "thinking" badge.
  //   3. processInboundSms runs to completion on its own time and fires
  //      UPDATEs that clear the indicator and show the reply.
  //
  // `after()` keeps the serverless invocation alive until the work is done.
  // Errors are logged; they never bubble back to Twilio.
  if (inserted?.id) {
    const messageId = inserted.id
    after(async () => {
      try {
        const result = await processInboundSms(svc, {
          messageId,
          smsText: body,
          senderPhone: phoneNorm,
        })
        console.log(`[twilio-webhook] processed (async):`, result)
      } catch (err) {
        console.error('[twilio-webhook] processInboundSms threw (async):', err)
        // Best-effort: clear the 'thinking' indicator so the UI doesn't
        // hang forever if something in processing crashed before smsProcess
        // could update the row.
        try {
          await svc.from('sms_messages').update({
            claude_status: 'failed',
            processed: true,
            result: 'Background processing error',
          }).eq('id', messageId)
        } catch { /* swallow */ }
      }
    })
  }

  return xmlResponse()
}
